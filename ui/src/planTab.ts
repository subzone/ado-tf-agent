import * as SDK from "azure-devops-extension-sdk";
import { getClient } from "azure-devops-extension-api/Common/Client";
import { BuildRestClient } from "azure-devops-extension-api/Build";
import "./planTab.css";

const TF_PLAN_ATTACHMENT_TYPE = "terraform.plan.json";
const CONTRIBUTION_ID = "subzone.ado-tf-agent.terraform-plan-tab";

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

function esc(s: string): string {
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
    const e = (s: string) => s.replace(/"/g, "'").slice(0, 120);
    lines.push(`  subgraph g${gi}["${e(prov)}"]`);
    list.forEach((rc, idx) => {
      const addr = rc.address || `${prov}.${idx}`;
      const actions = (rc.change?.actions || []).join(",");
      lines.push(`    n_${gi}_${idx}["${e(addr)}\\n${e(actions || "unknown")}"]`);
    });
    lines.push("  end");
    gi++;
  }
  return lines.join("\n");
}

function renderTable(plan: TerraformPlanJson): string {
  const rows = (plan.resource_changes || []).map((rc) => {
    const actions = (rc.change?.actions || []).join(", ");
    return `<tr><td>${esc(rc.address || "")}</td><td>${esc(rc.type || "")}</td><td>${esc(actions)}</td></tr>`;
  });
  return `<table class="tf-table">
    <thead><tr><th>Address</th><th>Type</th><th>Actions</th></tr></thead>
    <tbody>${rows.join("") || '<tr><td colspan="3">No resource_changes in plan JSON.</td></tr>'}</tbody>
  </table>`;
}

async function downloadAttachment(url: string): Promise<string> {
  const token = await SDK.getAccessToken();
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) throw new Error(`Attachment download failed: HTTP ${resp.status}`);
  return resp.text();
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
    host.innerHTML = `<p class="muted">Diagram error: ${esc(e instanceof Error ? e.message : String(e))}</p>`;
  }
}

/** Try to get build ID from SDK config or onBuildChanged — fast, no waiting if not available. */
function getBuildIdFromSDK(): Promise<number | undefined> {
  // Check config first
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
      if (id) { console.log(`[TF] buildId from cfg.${key}:`, id); return Promise.resolve(id); }
    }
    if (typeof cfg.buildId === "number") return Promise.resolve(cfg.buildId);
  } catch { /* */ }

  // Try onBuildChanged with short timeout
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), 3000);
    try {
      SDK.register(CONTRIBUTION_ID, {
        onBuildChanged: (build: { id?: number }) => {
          console.log("[TF] onBuildChanged:", build?.id);
          clearTimeout(timer);
          resolve(typeof build?.id === "number" ? build.id : undefined);
        },
      });
    } catch {
      clearTimeout(timer);
      resolve(undefined);
    }
  });
}

/** Find the most recent build in this project that has our plan attachment. */
async function findBuildWithAttachment(
  buildClient: BuildRestClient,
  project: string,
  hintBuildId?: number,
): Promise<{ buildId: number; attachmentUrl: string }> {
  // If we have a hint, try it first
  const candidates: number[] = hintBuildId ? [hintBuildId] : [];

  // Also fetch the 10 most recent builds
  const recentBuilds = await buildClient.getBuilds(project, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 10);
  for (const b of recentBuilds) {
    if (b.id && !candidates.includes(b.id)) candidates.push(b.id);
  }

  console.log(`[TF] Checking ${candidates.length} builds for attachment...`);

  for (const buildId of candidates) {
    try {
      const attachments = await buildClient.getAttachments(project, buildId, TF_PLAN_ATTACHMENT_TYPE);
      if (attachments.length > 0) {
        const url = (attachments[0] as unknown as { _links?: { self?: { href?: string } } })?._links?.self?.href;
        if (url) {
          console.log(`[TF] Found attachment on build ${buildId}`);
          return { buildId, attachmentUrl: url };
        }
      }
    } catch { /* build may not have timeline */ }
  }

  throw new Error(
    `No Terraform plan attachment found in the last ${candidates.length} builds. ` +
    `Run a pipeline with the Terraform plan step and publishPlanArtifact: true.`
  );
}

async function main(): Promise<void> {
  const app = document.getElementById("app");
  if (!app) return;

  try {
    await SDK.init({ loaded: false, applyTheme: true });
    await SDK.ready();
    await SDK.notifyLoadSucceeded();
    console.log("[TF] ✓ SDK ready");

    const project = SDK.getWebContext().project;
    if (!project?.name) throw new Error("No project context.");

    app.innerHTML = `<p class="muted">Finding latest Terraform plan…</p>`;

    const buildClient = getClient(BuildRestClient);

    // Try to get build ID from SDK (fast path), then fall back to scanning recent builds
    const hintBuildId = await getBuildIdFromSDK();
    console.log("[TF] hintBuildId:", hintBuildId);

    const { buildId, attachmentUrl } = await findBuildWithAttachment(buildClient, project.name, hintBuildId);

    app.innerHTML = `<p class="muted">Loading plan for build ${buildId}…</p>`;
    const text = await downloadAttachment(attachmentUrl);
    const plan = JSON.parse(text) as TerraformPlanJson;
    console.log(`[TF] ✓ plan.json loaded (${(plan.resource_changes || []).length} resources)`);

    const meta = [
      plan.terraform_version ? `Terraform ${esc(plan.terraform_version)}` : null,
      plan.format_version ? `format ${esc(String(plan.format_version))}` : null,
    ].filter(Boolean).join(" · ");

    app.innerHTML = `
      <div class="tf-header">
        <h2>Infrastructure plan</h2>
        <p class="muted">${meta || "From plan attachment."} · Build <code>#${buildId}</code></p>
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
      <p><code>${esc(message)}</code></p>
      <details><summary>Debug</summary><pre style="font-size:.75rem;overflow:auto;max-height:200px">${esc(stack || "")}</pre></details>
      <p class="muted">• Run Terraform plan with <strong>publishPlanArtifact: true</strong></p>
    </div>`;
    try { await SDK.notifyLoadFailed(message); } catch { /* */ }
  }
}

void main();
