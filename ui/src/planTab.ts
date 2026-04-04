import * as SDK from "azure-devops-extension-sdk";
import { getClient } from "azure-devops-extension-api/Common/Client";
import {
  BuildRestClient,
  BuildServiceIds,
  type IBuildPageDataService,
} from "azure-devops-extension-api/Build";
import "./planTab.css";

const TF_PLAN_ATTACHMENT_TYPE = "terraform.plan.json";

interface ResourceChange {
  address?: string;
  type?: string;
  change?: { actions?: string[] };
}

interface TerraformPlanJson {
  resource_changes?: ResourceChange[];
  terraform_version?: string;
  format_version?: string;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildMermaid(plan: TerraformPlanJson): string {
  const changes = plan.resource_changes || [];
  const groups = new Map<string, ResourceChange[]>();
  for (const rc of changes) {
    const t = rc.type || "unknown";
    const prov = t.includes("_") ? t.split("_")[0]! : "misc";
    if (!groups.has(prov)) groups.set(prov, []);
    groups.get(prov)!.push(rc);
  }
  const lines: string[] = ["flowchart TB"];
  let gi = 0;
  for (const [prov, list] of groups) {
    const esc = (s: string) => s.replace(/"/g, "'").slice(0, 120);
    lines.push(`  subgraph g${gi}["${esc(prov)}"]`);
    list.forEach((rc, idx) => {
      const addr = rc.address || `${prov}.${idx}`;
      const id = `n_${gi}_${idx}`;
      const actions = (rc.change?.actions || []).join(",");
      lines.push(`    ${id}["${esc(addr)}\\n${esc(actions || "unknown")}"]`);
    });
    lines.push("  end");
    gi++;
  }
  return lines.join("\n");
}

function renderTable(plan: TerraformPlanJson): string {
  const rows = (plan.resource_changes || []).map((rc) => {
    const actions = (rc.change?.actions || []).join(", ");
    return `<tr><td>${escapeHtml(rc.address || "")}</td><td>${escapeHtml(rc.type || "")}</td><td>${escapeHtml(actions)}</td></tr>`;
  });
  return `<table class="tf-table">
    <thead><tr><th>Address</th><th>Type</th><th>Actions</th></tr></thead>
    <tbody>${rows.join("") || '<tr><td colspan="3">No resource_changes in plan JSON.</td></tr>'}</tbody>
  </table>`;
}

async function loadPlanJson(
  buildClient: BuildRestClient,
  project: string,
  buildId: number,
): Promise<TerraformPlanJson> {
  console.log(`[TF] Fetching attachments type=${TF_PLAN_ATTACHMENT_TYPE} for build ${buildId}`);
  const attachments = await buildClient.getAttachments(project, buildId, TF_PLAN_ATTACHMENT_TYPE);
  console.log(`[TF] Found ${attachments.length} attachment(s)`);

  if (attachments.length === 0) {
    throw new Error(`No plan.json attachment on build ${buildId}. Run Terraform plan with publishPlanArtifact: true.`);
  }

  const att = attachments[0];
  const url = (att as unknown as { _links?: { self?: { href?: string } } })?._links?.self?.href;
  if (!url) throw new Error("Attachment has no download URL.");

  console.log(`[TF] Downloading attachment...`);
  const token = await SDK.getAccessToken();
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) throw new Error(`Attachment download failed: HTTP ${resp.status}`);

  const text = await resp.text();
  console.log(`[TF] ✓ plan.json (${text.length} chars)`);
  return JSON.parse(text) as TerraformPlanJson;
}

/**
 * Try every known method to get the build ID.
 * Logs everything so we can diagnose what ADO actually provides.
 */
async function resolveBuildId(): Promise<number> {
  // 1. SDK configuration (dump it all)
  const cfg = SDK.getConfiguration() as Record<string, unknown>;
  console.log("[TF] SDK.getConfiguration():", JSON.stringify(cfg, null, 2));

  // Check direct properties
  const fromObj = (o: unknown): number | undefined => {
    if (o && typeof o === "object" && "id" in o) {
      const id = (o as { id: unknown }).id;
      return typeof id === "number" ? id : undefined;
    }
    return undefined;
  };
  for (const key of ["build", "buildDetails"]) {
    const id = fromObj(cfg[key]);
    if (id !== undefined) { console.log(`[TF] buildId from cfg.${key}:`, id); return id; }
  }
  if (typeof cfg.buildId === "number") { console.log("[TF] buildId from cfg.buildId"); return cfg.buildId; }

  // 2. Parse from config JSON blob
  const blob = JSON.stringify(cfg);
  const blobMatch = blob.match(/"id"\s*:\s*(\d+)/);
  if (blobMatch) {
    const n = parseInt(blobMatch[1], 10);
    if (n > 0) { console.log("[TF] buildId from config blob:", n); return n; }
  }

  // 3. SDK host context / page context
  try {
    const pageCtx = SDK.getPageContext();
    console.log("[TF] SDK.getPageContext():", JSON.stringify(pageCtx, null, 2));
  } catch (e) { console.log("[TF] getPageContext() failed:", e); }

  try {
    const webCtx = SDK.getWebContext();
    console.log("[TF] SDK.getWebContext():", JSON.stringify(webCtx, null, 2));
  } catch (e) { console.log("[TF] getWebContext() failed:", e); }

  // 4. BuildPageDataService
  try {
    console.log("[TF] Trying BuildPageDataService...");
    const svc = await SDK.getService<IBuildPageDataService>(BuildServiceIds.BuildPageDataService);
    const data = svc.getBuildPageData();
    console.log("[TF] BuildPageData:", JSON.stringify(data, null, 2));
    if (data?.build?.id) return data.build.id;
  } catch (e) { console.log("[TF] BuildPageDataService failed:", e); }

  // 5. onBuildChanged callback (wait up to 5s)
  console.log("[TF] Trying onBuildChanged callback...");
  const fromCallback = await new Promise<number | undefined>((resolve) => {
    const timer = setTimeout(() => { console.log("[TF] onBuildChanged timed out"); resolve(undefined); }, 5000);
    try {
      SDK.register(SDK.getContributionId(), {
        onBuildChanged: (build: { id?: number }) => {
          console.log("[TF] onBuildChanged fired:", JSON.stringify(build));
          clearTimeout(timer);
          resolve(typeof build?.id === "number" ? build.id : undefined);
        },
      });
    } catch (e) {
      console.log("[TF] SDK.register failed:", e);
      clearTimeout(timer);
      resolve(undefined);
    }
  });
  if (fromCallback !== undefined) return fromCallback;

  // 6. URL parsing (parent frame, referrer, current)
  const urls = [window.location.href, document.referrer || ""];
  try { urls.push(window.parent.location.href); } catch { /* cross-origin */ }
  console.log("[TF] URLs to parse:", urls);
  for (const u of urls) {
    const m = u.match(/[?&#]buildId=(\d+)/i);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > 0) { console.log("[TF] buildId from URL:", n); return n; }
    }
  }

  throw new Error("Could not resolve build ID from any source. Check browser console for [TF] debug logs.");
}

async function renderDiagram(src: string): Promise<void> {
  const host = document.getElementById("tf-diagram-host");
  if (!host) return;
  try {
    const mermaid = (await import("mermaid")).default;
    mermaid.initialize({ startOnLoad: false, theme: "default", securityLevel: "strict", flowchart: { useMaxWidth: true, htmlLabels: true } });
    const el = document.createElement("div");
    el.className = "mermaid";
    el.textContent = src;
    host.innerHTML = "";
    host.appendChild(el);
    await mermaid.run({ nodes: [el] });
  } catch (e) {
    host.innerHTML = `<p class="muted">Diagram error: ${escapeHtml(e instanceof Error ? e.message : String(e))}</p>`;
  }
}

async function main(): Promise<void> {
  const app = document.getElementById("app");
  if (!app) return;

  try {
    await SDK.init({ loaded: false, applyTheme: true });
    await SDK.ready();
    await SDK.notifyLoadSucceeded();
    console.log("[TF] ✓ SDK ready");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    app.innerHTML = `<div class="error"><strong>SDK init failed</strong><p><code>${escapeHtml(msg)}</code></p></div>`;
    try { await SDK.notifyLoadFailed(msg); } catch { /* */ }
    return;
  }

  try {
    const project = SDK.getWebContext().project;
    if (!project?.name) throw new Error("No project context.");

    app.innerHTML = `<p class="muted">Resolving build context…</p>`;
    const buildId = await resolveBuildId();
    console.log(`[TF] ✓ buildId=${buildId}, project=${project.name}`);

    app.innerHTML = `<p class="muted">Loading plan for build ${buildId}…</p>`;
    const buildClient = getClient(BuildRestClient);
    const plan = await loadPlanJson(buildClient, project.name, buildId);

    const meta = [
      plan.terraform_version ? `Terraform ${escapeHtml(plan.terraform_version)}` : null,
      plan.format_version ? `format ${escapeHtml(String(plan.format_version))}` : null,
    ].filter(Boolean).join(" · ");

    app.innerHTML = `
      <div class="tf-header">
        <h2>Infrastructure plan</h2>
        <p class="muted">${meta || "From plan attachment."}</p>
        <p class="muted">Resources: <code>${(plan.resource_changes || []).length}</code></p>
      </div>
      <h3>Resource changes</h3>
      ${renderTable(plan)}
      <h3>Architecture sketch</h3>
      <div class="diagram-wrap" id="tf-diagram-host"><p class="muted">Rendering…</p></div>
    `;
    void renderDiagram(buildMermaid(plan));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : "";
    console.error("[TF] ERROR:", message);
    app.innerHTML = `<div class="error">
      <strong>Could not load plan</strong>
      <p><code>${escapeHtml(message)}</code></p>
      <details><summary>Debug</summary><pre style="font-size:.75rem;overflow:auto;max-height:200px">${escapeHtml(stack || "")}</pre></details>
      <p class="muted">• Run Terraform plan with publishPlanArtifact: true<br>• Check DevTools console for [TF] logs</p>
    </div>`;
  }
}

void main();
