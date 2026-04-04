import * as SDK from "azure-devops-extension-sdk";
import { getClient } from "azure-devops-extension-api/Common/Client";
import { BuildRestClient } from "azure-devops-extension-api/Build";
import "./planTab.css";

const TF_PLAN_ATTACHMENT_TYPE = "terraform.plan.json";

interface ResourceChange {
  address?: string;
  mode?: string;
  type?: string;
  name?: string;
  provider_name?: string;
  change?: {
    actions?: string[];
    before?: unknown;
    after?: unknown;
  };
}

interface TerraformPlanJson {
  resource_changes?: ResourceChange[];
  terraform_version?: string;
  format_version?: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toNodeId(seed: string, index: number): string {
  return `n_${index}_${seed.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 80)}`;
}

function escapeMermaidLabel(text: string): string {
  return text.replace(/"/g, "'").replace(/\n/g, " ").slice(0, 120);
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
    lines.push(`  subgraph g${gi}["${escapeMermaidLabel(prov)}"]`);
    list.forEach((rc, idx) => {
      const addr = rc.address || `${prov}.${idx}`;
      const id = toNodeId(addr, gi * 1000 + idx);
      const actions = (rc.change?.actions || []).join(",");
      lines.push(`    ${id}["${escapeMermaidLabel(addr)}\\n${escapeMermaidLabel(actions || "unknown")}"]`);
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
  return `
    <table class="tf-table">
      <thead><tr><th>Address</th><th>Type</th><th>Actions</th></tr></thead>
      <tbody>${rows.join("") || '<tr><td colspan="3">No resource_changes in plan JSON.</td></tr>'}</tbody>
    </table>`;
}

async function loadPlanJson(
  buildClient: BuildRestClient,
  project: string,
  buildId: number,
): Promise<TerraformPlanJson> {
  console.log(`[Terraform] Fetching attachments for build ${buildId}, type=${TF_PLAN_ATTACHMENT_TYPE}`);
  const attachments = await buildClient.getAttachments(project, buildId, TF_PLAN_ATTACHMENT_TYPE);
  console.log(`[Terraform] Found ${attachments.length} attachment(s)`);

  if (attachments.length === 0) {
    throw new Error(
      `No plan.json attachment found on build ${buildId}. Ensure the Terraform plan step ran with publishPlanArtifact: true.`,
    );
  }

  const att = attachments[0];
  const url = (att as unknown as { _links?: { self?: { href?: string } } })?._links?.self?.href;
  if (!url) {
    throw new Error("Attachment found but has no download URL.");
  }

  console.log(`[Terraform] Downloading attachment...`);
  const token = await SDK.getAccessToken();
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    throw new Error(`Attachment download failed: HTTP ${resp.status}`);
  }

  const text = await resp.text();
  console.log(`[Terraform] ✓ plan.json fetched (${text.length} chars)`);
  return JSON.parse(text) as TerraformPlanJson;
}

async function renderDiagram(diagramSource: string): Promise<void> {
  const host = document.getElementById("tf-diagram-host");
  if (!host) return;
  try {
    const mermaid = (await import("mermaid")).default;
    mermaid.initialize({
      startOnLoad: false,
      theme: "default",
      securityLevel: "strict",
      flowchart: { useMaxWidth: true, htmlLabels: true },
    });
    const graph = document.createElement("div");
    graph.className = "mermaid";
    graph.textContent = diagramSource;
    host.innerHTML = "";
    host.appendChild(graph);
    await mermaid.run({ nodes: [graph] });
    console.log("[Terraform] ✓ Diagram rendered");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    host.innerHTML = `<p class="muted">Diagram could not be rendered: ${escapeHtml(msg)}</p><pre class="tf-mermaid-fallback">${escapeHtml(diagramSource)}</pre>`;
  }
}

/** Called when ADO provides the build context via onBuildChanged callback. */
async function onBuildReady(buildId: number): Promise<void> {
  const app = document.getElementById("app")!;
  try {
    const context = SDK.getWebContext();
    const project = context.project;
    if (!project?.name) {
      throw new Error("Project context not available.");
    }

    console.log(`[Terraform] buildId=${buildId}, project=${project.name}`);
    app.innerHTML = `<p class="muted">Loading plan for build ${buildId}…</p>`;

    const buildClient = getClient(BuildRestClient);
    const plan = await loadPlanJson(buildClient, project.name, buildId);

    const meta = [
      plan.terraform_version ? `Terraform ${escapeHtml(plan.terraform_version)}` : null,
      plan.format_version ? `format ${escapeHtml(String(plan.format_version))}` : null,
    ]
      .filter(Boolean)
      .join(" · ");

    const diagramSource = buildMermaid(plan);

    app.innerHTML = `
      <div class="tf-header">
        <h2>Infrastructure plan</h2>
        <p class="muted">${meta || "Parsed from published plan attachment."}</p>
        <p class="muted">Resources: <code>${(plan.resource_changes || []).length}</code></p>
      </div>
      <h3>Resource changes</h3>
      ${renderTable(plan)}
      <h3>Architecture sketch (by provider prefix)</h3>
      <p class="muted">Grouped from <code>resource_changes</code>.</p>
      <div class="diagram-wrap" id="tf-diagram-host"><p class="muted">Rendering diagram…</p></div>
    `;

    void renderDiagram(diagramSource);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : "";
    console.error("[Terraform] ERROR:", message);

    app.innerHTML = `<div class="error">
      <strong>Could not load plan</strong>
      <p><code>${escapeHtml(message)}</code></p>
      <details style="margin-top: 12px; cursor: pointer;">
        <summary>Debug details</summary>
        <pre style="background: #f3f2f1; padding: 8px; border-radius: 4px; font-size: 0.8rem; overflow: auto; max-height: 200px;">${escapeHtml(stack || "")}</pre>
      </details>
      <p class="muted" style="margin-top: 12px;">
        • Ensure the Terraform plan step ran with <strong>publishPlanArtifact: true</strong><br>
        • Open DevTools (F12) → Console for details
      </p>
    </div>`;
  }
}

async function main(): Promise<void> {
  const app = document.getElementById("app");
  if (!app) return;

  try {
    // Register the onBuildChanged callback via SDK configuration BEFORE init.
    // ADO calls this callback with the current build object once the host is ready.
    const buildReady = new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Timed out waiting for build context from Azure DevOps host.")),
        15000,
      );

      SDK.register(SDK.getContributionId(), {
        onBuildChanged: (build: { id?: number }) => {
          console.log("[Terraform] onBuildChanged fired:", JSON.stringify(build));
          clearTimeout(timeout);
          if (typeof build?.id === "number") {
            resolve(build.id);
          } else {
            reject(new Error("onBuildChanged called but build.id is missing."));
          }
        },
      });
    });

    await SDK.init({ loaded: false, applyTheme: true });
    await SDK.ready();
    await SDK.notifyLoadSucceeded();
    console.log("[Terraform] ✓ SDK handshake complete, waiting for onBuildChanged...");

    const buildId = await buildReady;
    await onBuildReady(buildId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[Terraform] FATAL:", msg);
    app.innerHTML = `<div class="error"><strong>Could not load plan</strong><p><code>${escapeHtml(msg)}</code></p>
      <p class="muted" style="margin-top: 8px;">Open this tab from a completed build run (Pipelines → Runs → select run → Terraform tab).</p></div>`;
    try { await SDK.notifyLoadFailed(msg); } catch { /* ignore */ }
  }
}

void main();
