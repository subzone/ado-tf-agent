import * as SDK from "azure-devops-extension-sdk";
import { getClient } from "azure-devops-extension-api/Common/Client";
import {
  BuildRestClient,
  BuildServiceIds,
  type IBuildPageDataService,
} from "azure-devops-extension-api/Build";
import JSZip from "jszip";
import "./planTab.css";

const DEFAULT_ARTIFACT = "terraform-plan";

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
  const h = seed.replace(/[^a-zA-Z0-9]/g, "_");
  return `n_${index}_${h.slice(0, 80)}`;
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
    if (!groups.has(prov)) {
      groups.set(prov, []);
    }
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
      const label = `${escapeMermaidLabel(addr)}\\n${escapeMermaidLabel(actions || "unknown")}`;
      lines.push(`    ${id}["${label}"]`);
    });
    lines.push("  end");
    gi++;
  }
  return lines.join("\n");
}

function renderTable(plan: TerraformPlanJson): string {
  const rows = (plan.resource_changes || []).map((rc) => {
    const actions = (rc.change?.actions || []).join(", ");
    return `<tr><td>${escapeHtml(rc.address || "")}</td><td>${escapeHtml(rc.type || "")}</td><td>${escapeHtml(
      actions,
    )}</td></tr>`;
  });
  return `
    <table class="tf-table">
      <thead><tr><th>Address</th><th>Type</th><th>Actions</th></tr></thead>
      <tbody>${rows.join("") || '<tr><td colspan="3">No resource_changes in plan JSON.</td></tr>'}</tbody>
    </table>`;
}

async function loadPlanJsonFromArtifact(
  buildClient: BuildRestClient,
  project: string,
  buildId: number,
  artifactName: string,
): Promise<TerraformPlanJson> {
  const buffer = await buildClient.getArtifactContentZip(project, buildId, artifactName);
  const zip = await JSZip.loadAsync(buffer);
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
  const planPath = names.find((n) => n.endsWith("plan.json")) || names.find((n) => n === "plan.json");
  if (!planPath) {
    throw new Error(`No plan.json found inside artifact "${artifactName}". Files: ${names.join(", ") || "(empty)"}`);
  }
  const text = await zip.files[planPath].async("string");
  return JSON.parse(text) as TerraformPlanJson;
}

function parseBuildIdFromWindow(): number | undefined {
  const tryParams = (raw: string): number | undefined => {
    const q = raw.startsWith("?") || raw.startsWith("#") ? raw.slice(1) : raw;
    if (!q.trim()) {
      return undefined;
    }
    const params = new URLSearchParams(q);
    for (const key of ["buildId", "buildID", "build", "id"]) {
      const v = params.get(key);
      if (v) {
        const n = parseInt(v, 10);
        if (!Number.isNaN(n)) {
          return n;
        }
      }
    }
    return undefined;
  };
  const fromSearch = tryParams(window.location.search);
  if (fromSearch !== undefined) {
    return fromSearch;
  }
  if (window.location.hash.length > 1) {
    return tryParams(window.location.hash);
  }
  return undefined;
}

function resolveBuildIdFromConfiguration(): number {
  const cfg = SDK.getConfiguration() as Record<string, unknown>;
  const fromObj = (o: unknown): number | undefined => {
    if (o && typeof o === "object" && "id" in o) {
      const id = (o as { id: unknown }).id;
      return typeof id === "number" && !Number.isNaN(id) ? id : undefined;
    }
    return undefined;
  };
  const candidates: Array<number | undefined> = [
    fromObj(cfg.build),
    fromObj(cfg.buildDetails),
    typeof cfg.buildId === "number" ? cfg.buildId : undefined,
    typeof cfg.id === "number" ? cfg.id : undefined,
  ];
  for (const c of candidates) {
    if (c !== undefined) {
      return c;
    }
  }
  for (const v of Object.values(cfg)) {
    const id = fromObj(v);
    if (id !== undefined) {
      return id;
    }
  }
  throw new Error(
    "Could not resolve build id. The build results host did not provide configuration; ensure you open this tab from a completed pipeline run.",
  );
}

/** `getConfiguration()` is often empty here; use the official build page service first. */
async function resolveBuildId(): Promise<number> {
  try {
    const buildPageService = await SDK.getService<IBuildPageDataService>(
      BuildServiceIds.BuildPageDataService,
    );
    const pageData = buildPageService.getBuildPageData();
    const id = pageData?.build?.id;
    if (typeof id === "number" && !Number.isNaN(id)) {
      return id;
    }
  } catch {
    /* Service not registered in this host — fall through. */
  }

  const fromUrl = parseBuildIdFromWindow();
  if (fromUrl !== undefined) {
    return fromUrl;
  }

  return resolveBuildIdFromConfiguration();
}

function resolveArtifactName(): string {
  const cfg = SDK.getConfiguration() as { artifactName?: string };
  return (cfg.artifactName && cfg.artifactName.trim()) || DEFAULT_ARTIFACT;
}

/** Mermaid is large; load it only after the host stops the loading spinner. */
async function renderDiagramWhenReady(diagramSource: string): Promise<void> {
  const host = document.getElementById("tf-diagram-host");
  if (!host) {
    return;
  }
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
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    host.innerHTML = `<p class="muted">Diagram could not be rendered: ${escapeHtml(msg)}</p><pre class="tf-mermaid-fallback">${escapeHtml(
      diagramSource,
    )}</pre>`;
  }
}

async function main(): Promise<void> {
  await SDK.init({ loaded: false, applyTheme: true });
  await SDK.ready();

  const project = SDK.getWebContext().project;
  if (!project?.name) {
    throw new Error("Project context is not available.");
  }
  const buildId = await resolveBuildId();
  const artifactName = resolveArtifactName();
  const buildClient = getClient(BuildRestClient);
  const plan = await loadPlanJsonFromArtifact(buildClient, project.name, buildId, artifactName);

  const app = document.getElementById("app");
  if (!app) {
    await SDK.notifyLoadFailed("Missing #app root element.");
    return;
  }

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
      <p class="muted">${meta || "Parsed from published plan artifact."}</p>
      <p class="muted">Artifact: <code>${escapeHtml(artifactName)}</code></p>
    </div>
    <h3>Resource changes</h3>
    ${renderTable(plan)}
    <h3>Architecture sketch (by provider prefix)</h3>
    <p class="muted">Grouped from <code>resource_changes</code>. Diagram loads after this page appears.</p>
    <div class="diagram-wrap" id="tf-diagram-host"><p class="muted">Rendering diagram…</p></div>
  `;

  await SDK.notifyLoadSucceeded();

  void renderDiagramWhenReady(diagramSource);
}

void main().catch(async (err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  const app = document.getElementById("app");
  if (app) {
    app.innerHTML = `<div class="error"><strong>Could not load plan</strong><p>${escapeHtml(message)}</p>
      <p class="muted">Run a pipeline with the <strong>Terraform</strong> task (plan) and enable <strong>Publish plan JSON artifact</strong>, or align the artifact name with this tab.</p></div>`;
  }
  await SDK.notifyLoadFailed(message);
});
