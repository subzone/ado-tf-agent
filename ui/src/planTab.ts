import * as SDK from "azure-devops-extension-sdk";
import { getClient } from "azure-devops-extension-api/Common/Client";
import { BuildRestClient } from "azure-devops-extension-api/Build";
import "./planTab.css";

const TF_PLAN_ATTACHMENT_TYPE = "terraform.plan.json";
const CONTRIBUTION_ID = "subzone.ado-tf-agent.terraform-plan-tab";

// ── Types ────────────────────────────────────────────────────────────────────

interface ResourceChange {
  address?: string;
  type?: string;
  change?: {
    actions?: string[];
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
    after_unknown?: Record<string, unknown>;
    before_sensitive?: Record<string, unknown>;
    after_sensitive?: Record<string, unknown>;
  };
}

interface ConfigResource {
  address?: string;
  expressions?: Record<string, unknown>;
}

interface TerraformPlanJson {
  resource_changes?: ResourceChange[];
  terraform_version?: string;
  format_version?: string;
  configuration?: { root_module?: { resources?: ConfigResource[] } };
}

type ActionKind = "create" | "delete" | "update" | "replace" | "no-op" | "read";

interface PolicyWarning {
  severity: "high" | "medium" | "low";
  address: string;
  rule: string;
  detail: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function classifyActions(actions: string[]): ActionKind {
  if (actions.includes("create") && actions.includes("delete")) return "replace";
  if (actions.includes("create")) return "create";
  if (actions.includes("delete")) return "delete";
  if (actions.includes("update")) return "update";
  if (actions.includes("read"))   return "read";
  return "no-op";
}

function actionBadge(actions: string[]): string {
  const kind = classifyActions(actions);
  const label: Record<ActionKind, string> = {
    create: "+  create", delete: "−  delete", update: "~  update",
    replace: "±  replace", read: "○  read", "no-op": "   no-op",
  };
  return `<span class="tf-badge tf-badge--${kind}">${label[kind]}</span>`;
}

// ── Feature: Summary bar ─────────────────────────────────────────────────────

function renderSummary(plan: TerraformPlanJson): string {
  const counts: Record<ActionKind, number> = { create: 0, delete: 0, update: 0, replace: 0, read: 0, "no-op": 0 };
  for (const rc of plan.resource_changes || []) counts[classifyActions(rc.change?.actions || [])]++;
  const parts = [
    counts.create  ? `<span class="tf-badge tf-badge--create">+${counts.create} add</span>` : null,
    counts.update  ? `<span class="tf-badge tf-badge--update">~${counts.update} change</span>` : null,
    counts.replace ? `<span class="tf-badge tf-badge--replace">±${counts.replace} replace</span>` : null,
    counts.delete  ? `<span class="tf-badge tf-badge--delete">−${counts.delete} destroy</span>` : null,
    counts.read    ? `<span class="tf-badge tf-badge--read">○${counts.read} read</span>` : null,
  ].filter(Boolean);
  if (!parts.length) return `<div class="tf-summary"><span class="tf-badge tf-badge--no-op">No changes</span></div>`;
  return `<div class="tf-summary">${parts.join("")}</div>`;
}

// ── Feature 2: Policy / compliance warnings ──────────────────────────────────

function runPolicyChecks(plan: TerraformPlanJson): PolicyWarning[] {
  const warnings: PolicyWarning[] = [];

  for (const rc of plan.resource_changes || []) {
    const addr = rc.address || "";
    const type = rc.type || "";
    const after = rc.change?.after as Record<string, unknown> | null ?? {};
    const actions = rc.change?.actions || [];
    if (!actions.includes("create") && !actions.includes("update")) continue;

    // S3: public access
    if (type === "aws_s3_bucket_public_access_block") {
      for (const key of ["block_public_acls", "block_public_policy", "restrict_public_buckets", "ignore_public_acls"]) {
        if (after[key] === false) {
          warnings.push({ severity: "high", address: addr, rule: "S3 Public Access", detail: `${key} is false — bucket may be publicly accessible.` });
        }
      }
    }

    // S3: no versioning
    if (type === "aws_s3_bucket_versioning") {
      const cfg = after.versioning_configuration as Record<string, unknown> | undefined;
      if (cfg?.status !== "Enabled") {
        warnings.push({ severity: "low", address: addr, rule: "S3 Versioning Disabled", detail: "Versioning is not enabled — accidental deletions cannot be recovered." });
      }
    }

    // S3: no encryption
    if (type === "aws_s3_bucket" && !plan.resource_changes?.some(r => r.type === "aws_s3_bucket_server_side_encryption_configuration" && r.address?.includes(addr.split(".")[1] ?? ""))) {
      warnings.push({ severity: "medium", address: addr, rule: "S3 Encryption", detail: "No aws_s3_bucket_server_side_encryption_configuration found for this bucket." });
    }

    // Security group: open ingress
    if (type === "aws_security_group") {
      const ingress = after.ingress as Array<Record<string, unknown>> | undefined ?? [];
      for (const rule of ingress) {
        const cidrs = (rule.cidr_blocks as string[] | undefined) ?? [];
        const ipv6 = (rule.ipv6_cidr_blocks as string[] | undefined) ?? [];
        if (cidrs.includes("0.0.0.0/0") || ipv6.includes("::/0")) {
          const port = rule.from_port === rule.to_port ? `port ${rule.from_port}` : `ports ${rule.from_port}–${rule.to_port}`;
          warnings.push({ severity: rule.from_port === 22 || rule.from_port === 3389 ? "high" : "medium", address: addr, rule: "Open Ingress", detail: `Ingress on ${port} is open to the world (0.0.0.0/0).` });
        }
      }
    }

    // IAM: wildcard policy
    if (type === "aws_iam_role_policy" || type === "aws_iam_policy") {
      const doc = typeof after.policy === "string" ? after.policy : "";
      if (doc.includes('"Action": "*"') || doc.includes('"Action":"*"')) {
        warnings.push({ severity: "high", address: addr, rule: "IAM Wildcard Action", detail: 'Policy contains "Action": "*" — overly permissive.' });
      }
      if (doc.includes('"Resource": "*"') || doc.includes('"Resource":"*"')) {
        warnings.push({ severity: "medium", address: addr, rule: "IAM Wildcard Resource", detail: 'Policy contains "Resource": "*" — consider scoping to specific resources.' });
      }
    }

    // RDS: no encryption
    if (type === "aws_db_instance" && after.storage_encrypted !== true) {
      warnings.push({ severity: "high", address: addr, rule: "RDS Encryption", detail: "storage_encrypted is not true — database storage is unencrypted." });
    }

    // RDS: publicly accessible
    if (type === "aws_db_instance" && after.publicly_accessible === true) {
      warnings.push({ severity: "high", address: addr, rule: "RDS Public Access", detail: "publicly_accessible is true — database is reachable from the internet." });
    }

    // EBS: no encryption
    if (type === "aws_ebs_volume" && after.encrypted !== true) {
      warnings.push({ severity: "medium", address: addr, rule: "EBS Encryption", detail: "EBS volume is not encrypted." });
    }

    // EC2 launch template: no IMDSv2
    if (type === "aws_launch_template") {
      const meta = after.metadata_options as Record<string, unknown> | undefined;
      if (!meta || meta.http_tokens !== "required") {
        warnings.push({ severity: "medium", address: addr, rule: "IMDSv2 Not Enforced", detail: "metadata_options.http_tokens is not 'required' — IMDSv2 is not enforced." });
      }
    }

    // azurerm: storage account public access
    if (type === "azurerm_storage_account" && after.allow_blob_public_access === true) {
      warnings.push({ severity: "high", address: addr, rule: "Azure Blob Public Access", detail: "allow_blob_public_access is true." });
    }

    // azurerm: no HTTPS only
    if (type === "azurerm_storage_account" && after.enable_https_traffic_only === false) {
      warnings.push({ severity: "high", address: addr, rule: "Azure HTTPS Only", detail: "enable_https_traffic_only is false — HTTP traffic is allowed." });
    }
  }

  return warnings;
}

function renderWarnings(warnings: PolicyWarning[]): string {
  if (!warnings.length) return "";
  const iconMap = { high: "🔴", medium: "🟡", low: "🔵" };
  const high = warnings.filter(w => w.severity === "high").length;
  const med  = warnings.filter(w => w.severity === "medium").length;
  const low  = warnings.filter(w => w.severity === "low").length;

  const summary = [
    high ? `<span class="tf-warn-count tf-warn-count--high">${high} high</span>` : null,
    med  ? `<span class="tf-warn-count tf-warn-count--medium">${med} medium</span>` : null,
    low  ? `<span class="tf-warn-count tf-warn-count--low">${low} low</span>` : null,
  ].filter(Boolean).join(" ");

  const rows = warnings.map(w => `
    <tr class="tf-warn-row tf-warn-row--${w.severity}">
      <td>${iconMap[w.severity]}</td>
      <td><code>${esc(w.address)}</code></td>
      <td><strong>${esc(w.rule)}</strong></td>
      <td>${esc(w.detail)}</td>
    </tr>`).join("");

  return `
    <div class="tf-warnings">
      <div class="tf-warnings-header">
        ⚠️ <strong>Policy warnings</strong> &nbsp; ${summary}
      </div>
      <table class="tf-warn-table">
        <thead><tr><th></th><th>Resource</th><th>Rule</th><th>Detail</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// ── Feature 4: Expandable diff rows ─────────────────────────────────────────

function renderValue(val: unknown, sensitive: unknown): string {
  if (sensitive === true) return `<span class="tf-sensitive">(sensitive)</span>`;
  if (val === null || val === undefined) return `<span class="tf-null">null</span>`;
  if (typeof val === "boolean") return `<span class="tf-bool">${val}</span>`;
  if (typeof val === "number") return `<span class="tf-num">${val}</span>`;
  if (typeof val === "string") return `<span class="tf-str">${esc(val)}</span>`;
  return `<span class="tf-str">${esc(JSON.stringify(val))}</span>`;
}

function renderDiffTable(rc: ResourceChange): string {
  const before = rc.change?.before ?? {};
  const after  = rc.change?.after  ?? {};
  const afterUnknown = rc.change?.after_unknown  ?? {};
  const beforeSens   = rc.change?.before_sensitive ?? {};
  const afterSens    = rc.change?.after_sensitive  ?? {};
  const kind = classifyActions(rc.change?.actions || []);

  const allKeys = Array.from(new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])).sort();
  if (!allKeys.length) return `<p class="muted" style="margin:8px 0">No attribute details available.</p>`;

  const rows = allKeys.map((key) => {
    const bVal = (before as Record<string, unknown>)?.[key];
    const aVal = (after  as Record<string, unknown>)?.[key];
    const bSens = (beforeSens as Record<string, unknown>)?.[key];
    const aSens = (afterSens  as Record<string, unknown>)?.[key];
    const unknown = (afterUnknown as Record<string, unknown>)?.[key];
    const changed = JSON.stringify(bVal) !== JSON.stringify(aVal) || unknown;

    const beforeCell = kind === "create" ? `<span class="tf-null">-</span>` : renderValue(bVal, bSens);
    const afterCell  = unknown ? `<span class="tf-unknown">(known after apply)</span>`
      : kind === "delete" ? `<span class="tf-null">-</span>` : renderValue(aVal, aSens);

    return `<tr class="${changed ? "tf-diff-row--changed" : ""}">
      <td class="tf-diff-key">${esc(key)}</td>
      <td class="tf-diff-before">${beforeCell}</td>
      <td class="tf-diff-after">${afterCell}</td>
    </tr>`;
  });

  return `<table class="tf-diff-table">
    <thead><tr><th>Attribute</th><th>Before</th><th>After</th></tr></thead>
    <tbody>${rows.join("")}</tbody>
  </table>`;
}

// ── Feature 1: Filter / search bar + table ───────────────────────────────────

function renderTable(plan: TerraformPlanJson): string {
  const changes = (plan.resource_changes || []).filter(
    rc => classifyActions(rc.change?.actions || []) !== "no-op"
  );

  const rows = changes.map((rc, i) => `
    <tr class="tf-row-summary" data-idx="${i}"
        data-address="${esc(rc.address || "")}"
        data-type="${esc(rc.type || "")}"
        data-action="${classifyActions(rc.change?.actions || [])}"
        role="button" tabindex="0" aria-expanded="false">
      <td class="tf-expand-cell"><span class="tf-chevron">▶</span></td>
      <td>${esc(rc.address || "")}</td>
      <td>${esc(rc.type || "")}</td>
      <td>${actionBadge(rc.change?.actions || [])}</td>
    </tr>
    <tr class="tf-row-detail" id="tf-detail-${i}" hidden>
      <td colspan="4" class="tf-diff-cell">${renderDiffTable(rc)}</td>
    </tr>`).join("");

  return `
    <div class="tf-filter-bar">
      <input id="tf-search" type="search" placeholder="Filter by address or type…" autocomplete="off" />
      <div class="tf-filter-actions">
        <label><input type="checkbox" id="tf-filter-create"  checked> <span class="tf-badge tf-badge--create">create</span></label>
        <label><input type="checkbox" id="tf-filter-update"  checked> <span class="tf-badge tf-badge--update">update</span></label>
        <label><input type="checkbox" id="tf-filter-replace" checked> <span class="tf-badge tf-badge--replace">replace</span></label>
        <label><input type="checkbox" id="tf-filter-delete"  checked> <span class="tf-badge tf-badge--delete">delete</span></label>
        <label><input type="checkbox" id="tf-filter-read"   > <span class="tf-badge tf-badge--read">read</span></label>
      </div>
    </div>
    <table class="tf-table" id="tf-changes-table">
      <thead><tr><th></th><th>Address</th><th>Type</th><th>Action</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4">No resource changes.</td></tr>'}</tbody>
    </table>
    <p class="muted" id="tf-filter-empty" hidden>No resources match the current filter.</p>`;
}

function attachTableBehaviour(): void {
  const table = document.getElementById("tf-changes-table");
  if (!table) return;

  // Toggle expand
  const toggle = (row: HTMLElement) => {
    const detail = document.getElementById(`tf-detail-${row.dataset.idx}`);
    const chevron = row.querySelector(".tf-chevron");
    if (!detail) return;
    const expanded = !detail.hidden;
    detail.hidden = expanded;
    row.setAttribute("aria-expanded", String(!expanded));
    if (chevron) chevron.textContent = expanded ? "▶" : "▼";
  };
  table.addEventListener("click", e => {
    const row = (e.target as HTMLElement).closest(".tf-row-summary") as HTMLElement | null;
    if (row) toggle(row);
  });
  table.addEventListener("keydown", e => {
    if (e.key === "Enter" || e.key === " ") {
      const row = (e.target as HTMLElement).closest(".tf-row-summary") as HTMLElement | null;
      if (row) { e.preventDefault(); toggle(row); }
    }
  });

  // Filter
  const applyFilter = () => {
    const q = (document.getElementById("tf-search") as HTMLInputElement)?.value.toLowerCase() ?? "";
    const checked = new Set(
      (["create", "update", "replace", "delete", "read"] as ActionKind[])
        .filter(a => (document.getElementById(`tf-filter-${a}`) as HTMLInputElement)?.checked)
    );
    let visible = 0;
    table.querySelectorAll<HTMLElement>(".tf-row-summary").forEach(row => {
      const addr   = (row.dataset.address ?? "").toLowerCase();
      const type   = (row.dataset.type ?? "").toLowerCase();
      const action = row.dataset.action as ActionKind;
      const show   = checked.has(action) && (q === "" || addr.includes(q) || type.includes(q));
      row.hidden = !show;
      const detail = document.getElementById(`tf-detail-${row.dataset.idx}`);
      if (detail && !show) detail.hidden = true;
      if (show) visible++;
    });
    const empty = document.getElementById("tf-filter-empty");
    if (empty) empty.hidden = visible > 0;
  };

  document.getElementById("tf-search")?.addEventListener("input", applyFilter);
  ["create", "update", "replace", "delete", "read"].forEach(a =>
    document.getElementById(`tf-filter-${a}`)?.addEventListener("change", applyFilter)
  );
}

// ── Feature 3: Real dependency graph ─────────────────────────────────────────

function buildDependencyGraph(plan: TerraformPlanJson): string {
  const changes = plan.resource_changes || [];
  const configResources = plan.configuration?.root_module?.resources || [];
  const actionMap = new Map<string, ActionKind>();
  for (const rc of changes) if (rc.address) actionMap.set(rc.address, classifyActions(rc.change?.actions || []));

  const nodeSet = new Set<string>(changes.map(rc => rc.address).filter(Boolean) as string[]);
  const edges = new Set<string>();

  for (const cfgRes of configResources) {
    const src = cfgRes.address;
    if (!src || !nodeSet.has(src)) continue;
    const refs = new Set<string>();
    const collect = (val: unknown) => {
      if (!val || typeof val !== "object") return;
      if (Array.isArray(val)) { val.forEach(collect); return; }
      const obj = val as Record<string, unknown>;
      if (Array.isArray(obj.references)) {
        for (const r of obj.references as string[]) {
          const addr = r.split(".").slice(0, 2).join(".");
          if (nodeSet.has(addr) && addr !== src) refs.add(addr);
        }
      }
      Object.values(obj).forEach(collect);
    };
    collect(cfgRes.expressions);
    for (const dep of refs) edges.add(`${src}||${dep}`);
  }

  const nid = (a: string) => `n_${a.replace(/[^a-zA-Z0-9]/g, "_")}`;
  const e   = (s: string) => s.replace(/"/g, "'").slice(0, 60);
  const styleMap: Record<ActionKind, string> = {
    create: ":::create", delete: ":::delete", update: ":::update",
    replace: ":::replace", read: ":::read", "no-op": ":::noop",
  };

  const lines = [
    "flowchart LR",
    "  classDef create  fill:#dff6dd,stroke:#107c10,color:#107c10",
    "  classDef delete  fill:#fde7e9,stroke:#a4262c,color:#a4262c",
    "  classDef update  fill:#fff4ce,stroke:#c8a400,color:#7a5c00",
    "  classDef replace fill:#fff4ce,stroke:#c8a400,color:#7a5c00",
    "  classDef read    fill:#f0f0f0,stroke:#bbb,color:#444",
    "  classDef noop    fill:#f8f8f8,stroke:#ddd,color:#aaa",
  ];

  for (const addr of nodeSet) {
    const kind = actionMap.get(addr) ?? "no-op";
    const label = addr.includes(".") ? addr.split(".").slice(-2).join(".") : addr;
    lines.push(`  ${nid(addr)}["${e(label)}"]${styleMap[kind]}`);
  }
  for (const edge of edges) {
    const [from, to] = edge.split("||");
    lines.push(`  ${nid(from)} --> ${nid(to)}`);
  }
  return lines.join("\n");
}

async function renderDiagram(src: string): Promise<void> {
  const host = document.getElementById("tf-diagram-host");
  if (!host) return;
  try {
    const mermaid = (await import("mermaid")).default;
    mermaid.initialize({ startOnLoad: false, theme: "default", securityLevel: "loose", flowchart: { useMaxWidth: true, htmlLabels: false } });
    const el = document.createElement("div");
    el.className = "mermaid";
    el.textContent = src;
    host.innerHTML = "";
    host.appendChild(el);
    await mermaid.run({ nodes: [el] });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    host.innerHTML = `<p class="muted">Diagram error: ${esc(msg)}</p><pre class="tf-mermaid-fallback">${esc(src)}</pre>`;
  }
}

// ── Data loading ─────────────────────────────────────────────────────────────

async function downloadAttachment(url: string): Promise<string> {
  const token = await SDK.getAccessToken();
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) throw new Error(`Attachment download failed: HTTP ${resp.status}`);
  return resp.text();
}

function getBuildIdFromSDK(): Promise<number | undefined> {
  try {
    const cfg = SDK.getConfiguration() as Record<string, unknown>;
    const fromObj = (o: unknown) => {
      if (o && typeof o === "object" && "id" in o) {
        const id = (o as { id: unknown }).id;
        return typeof id === "number" ? id : undefined;
      }
    };
    for (const key of ["build", "buildDetails"]) {
      const id = fromObj(cfg[key]);
      if (id) return Promise.resolve(id);
    }
    if (typeof cfg.buildId === "number") return Promise.resolve(cfg.buildId);
  } catch { /* */ }
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), 3000);
    try {
      SDK.register(CONTRIBUTION_ID, {
        onBuildChanged: (build: { id?: number }) => {
          clearTimeout(timer);
          resolve(typeof build?.id === "number" ? build.id : undefined);
        },
      });
    } catch { clearTimeout(timer); resolve(undefined); }
  });
}

async function findBuildWithAttachment(
  buildClient: BuildRestClient,
  project: string,
  hintBuildId?: number,
): Promise<{ buildId: number; attachmentUrl: string }> {
  const candidates: number[] = hintBuildId ? [hintBuildId] : [];
  const recentBuilds = await buildClient.getBuilds(project, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 10);
  for (const b of recentBuilds) if (b.id && !candidates.includes(b.id)) candidates.push(b.id);
  for (const buildId of candidates) {
    try {
      const attachments = await buildClient.getAttachments(project, buildId, TF_PLAN_ATTACHMENT_TYPE);
      if (attachments.length > 0) {
        const url = (attachments[0] as unknown as { _links?: { self?: { href?: string } } })?._links?.self?.href;
        if (url) return { buildId, attachmentUrl: url };
      }
    } catch { /* */ }
  }
  throw new Error(`No Terraform plan attachment found in the last ${candidates.length} builds.`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const app = document.getElementById("app");
  if (!app) return;

  try {
    await SDK.init({ loaded: false, applyTheme: true });
    await SDK.ready();
    await SDK.notifyLoadSucceeded();

    const project = SDK.getWebContext().project;
    if (!project?.name) throw new Error("No project context.");

    app.innerHTML = `<p class="muted">Finding latest Terraform plan…</p>`;

    const buildClient = getClient(BuildRestClient);
    const hintBuildId = await getBuildIdFromSDK();
    const { buildId, attachmentUrl } = await findBuildWithAttachment(buildClient, project.name, hintBuildId);

    app.innerHTML = `<p class="muted">Loading plan for build ${buildId}…</p>`;
    const text = await downloadAttachment(attachmentUrl);
    const plan = JSON.parse(text) as TerraformPlanJson;

    const meta = [
      plan.terraform_version ? `Terraform ${esc(plan.terraform_version)}` : null,
      plan.format_version ? `format ${esc(String(plan.format_version))}` : null,
    ].filter(Boolean).join(" · ");

    const warnings = runPolicyChecks(plan);
    const edgeCount = (plan.configuration?.root_module?.resources || []).length;

    app.innerHTML = `
      <div class="tf-header">
        <h2>Infrastructure plan</h2>
        <p class="muted">${meta || "From plan attachment."} · Build <code>#${buildId}</code></p>
      </div>
      ${renderSummary(plan)}
      ${renderWarnings(warnings)}
      <h3>Resource changes <span class="muted" style="font-size:.8rem;font-weight:400">— click a row to expand diff</span></h3>
      ${renderTable(plan)}
      <h3>Dependency graph${edgeCount ? ` <span class="muted" style="font-size:.8rem;font-weight:400">${edgeCount} resources</span>` : ""}</h3>
      <div class="diagram-wrap" id="tf-diagram-host"><p class="muted">Rendering…</p></div>
    `;

    attachTableBehaviour();
    void renderDiagram(buildDependencyGraph(plan));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : "";
    console.error("[TF] ERROR:", message);
    app.innerHTML = `<div class="error">
      <strong>Could not load plan</strong>
      <p><code>${esc(message)}</code></p>
      <details><summary>Debug</summary><pre style="font-size:.75rem;overflow:auto;max-height:200px">${esc(stack || "")}</pre></details>
      <p class="muted">• Run Terraform plan with <strong>publishPlanArtifact: true</strong></p>
    </div>`;
    try { await SDK.notifyLoadFailed(message); } catch { /* */ }
  }
}

void main();
