import * as SDK from "azure-devops-extension-sdk";
import { getClient } from "azure-devops-extension-api/Common/Client";
import {
  BuildRestClient,
  BuildServiceIds,
  type IBuildPageDataService,
} from "azure-devops-extension-api/Build";
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

async function loadPlanJson(
  buildClient: BuildRestClient,
  project: string,
  buildId: number,
): Promise<TerraformPlanJson> {
  console.log(`[TF] Fetching attachments type=${TF_PLAN_ATTACHMENT_TYPE} build=${buildId}`);
  const attachments = await buildClient.getAttachments(project, buildId, TF_PLAN_ATTACHMENT_TYPE);
  console.log(`[TF] Found ${attachments.length} attachment(s)`);

  if (attachments.length === 0) {
    throw new Error(`No plan.json attachment on build ${buildId}. Run Terraform plan with publishPlanArtifact: true.`);
  }

  const url = (attachments[0] as unknown as { _links?: { self?: { href?: string } } })?._links?.self?.href;
  if (!url) throw new Error("Attachment has no download URL.");

  const token = await SDK.getAccessToken();
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) throw new Error(`Attachment download failed: HTTP ${resp.status}`);

  const text = await resp.text();
  console.log(`[TF] ✓ plan.json (${text.length} chars)`);
  return JSON.parse(text) as TerraformPlanJson;
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

async function showPlan(buildId: number): Promise<void> {
  const app = document.getElementById("app")!;
  const project = SDK.getWebContext().project;
  if (!project?.name) throw new Error("No project context.");

  console.log(`[TF] ✓ buildId=${buildId}, project=${project.name}`);
  app.innerHTML = `<p class="muted">Loading plan for build ${buildId}…</p>`;

  const buildClient = getClient(BuildRestClient);
  const plan = await loadPlanJson(buildClient, project.name, buildId);

  const meta = [
    plan.terraform_version ? `Terraform ${esc(plan.terraform_version)}` : null,
    plan.format_version ? `format ${esc(String(plan.format_version))}` : null,
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
}

async function resolveBuildId(): Promise<number> {
  // Strategy 1: onBuildChanged callback
  const fromCallback = new Promise<number | undefined>((resolve) => {
    try {
      SDK.register(CONTRIBUTION_ID, {
        onBuildChanged: (build: { id?: number }) => {
          console.log("[TF] onBuildChanged:", JSON.stringify(build));
          resolve(typeof build?.id === "number" ? build.id : undefined);
        },
      });
    } catch (e) {
      console.log("[TF] register failed:", e);
      resolve(undefined);
    }
  });

  // Strategy 2: BuildPageDataService polling (works once host SDK is active)
  const fromService = (async (): Promise<number | undefined> => {
    try {
      const svc = await SDK.getService<IBuildPageDataService>(BuildServiceIds.BuildPageDataService);
      for (let i = 0; i < 50; i++) {
        const data = svc.getBuildPageData();
        console.log(`[TF] BuildPageData attempt ${i}:`, JSON.stringify(data));
        if (data?.build?.id) return data.build.id;
        await new Promise(r => setTimeout(r, 200));
      }
    } catch (e) {
      console.log("[TF] BuildPageDataService error:", e);
    }
    return undefined;
  })();

  const timeout = new Promise<undefined>(r => setTimeout(() => r(undefined), 12000));
  const result = await Promise.race([fromCallback, fromService, timeout]);

  if (result !== undefined) return result;

  // Last resort: dump everything for diagnosis
  console.log("[TF] All strategies failed. Final state:");
  console.log("[TF] config:", JSON.stringify(SDK.getConfiguration()));
  try { console.log("[TF] pageContext:", JSON.stringify(SDK.getPageContext())); } catch { /* */ }
  throw new Error(
    `Could not get build ID after all strategies.\ncontributionId: ${CONTRIBUTION_ID}\nconfig: ${JSON.stringify(SDK.getConfiguration())}`
  );
}

async function main(): Promise<void> {
  const app = document.getElementById("app");
  if (!app) return;

  try {
    await SDK.init({ loaded: false, applyTheme: true });
    await SDK.ready();

    try {
      console.log("[TF] contributionId:", SDK.getContributionId());
    } catch { /* */ }

    await SDK.notifyLoadSucceeded();
    console.log("[TF] ✓ SDK ready, notified host");
    console.log("[TF] config:", JSON.stringify(SDK.getConfiguration()));

    app.innerHTML = `<p class="muted">Waiting for build context…</p>`;
    const buildId = await resolveBuildId();
    await showPlan(buildId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : "";
    console.error("[TF] ERROR:", message);
    app.innerHTML = `<div class="error">
      <strong>Could not load plan</strong>
      <p><code>${esc(message)}</code></p>
      <details><summary>Debug</summary><pre style="font-size:.75rem;overflow:auto;max-height:200px">${esc(stack || "")}</pre></details>
    </div>`;
    try { await SDK.notifyLoadFailed(message); } catch { /* */ }
  }
}

void main();
