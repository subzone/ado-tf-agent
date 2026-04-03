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

/** Azure DevOps build pages use `?buildId=` on the parent URL; the iframe URL often has none. */
function parseBuildIdFromAnyUrl(urlString: string): number | undefined {
  if (!urlString || !urlString.trim()) {
    return undefined;
  }
  try {
    const url = new URL(urlString, "https://dev.azure.com");
    for (const key of ["buildId", "buildID"]) {
      const v = url.searchParams.get(key);
      if (v) {
        const n = parseInt(v, 10);
        if (!Number.isNaN(n)) {
          return n;
        }
      }
    }
    const pathMatch = url.pathname.match(/\/results\/(\d+)(?:\/|$)/i);
    if (pathMatch) {
      const n = parseInt(pathMatch[1], 10);
      if (!Number.isNaN(n)) {
        return n;
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function extractBuildIdFromTextBlob(blob: string): number | undefined {
  if (!blob) {
    return undefined;
  }
  const patterns = [/"buildId"\s*:\s*(\d+)/gi, /"idBuild"\s*:\s*(\d+)/gi, /[?&#]buildId=(\d+)/gi];
  for (const re of patterns) {
    for (const m of blob.matchAll(re)) {
      const n = parseInt(m[1], 10);
      if (!Number.isNaN(n) && n > 0) {
        return n;
      }
    }
  }
  return undefined;
}

/** Handshake JSON often nests buildId even when getConfiguration() looks empty at the top level. */
function parseBuildIdFromHandshakeJson(): number | undefined {
  const parts: string[] = [];
  try {
    parts.push(JSON.stringify(SDK.getPageContext()));
  } catch {
    /* before ready — should not happen */
  }
  try {
    parts.push(JSON.stringify(SDK.getConfiguration()));
  } catch {
    /* ignore */
  }
  return extractBuildIdFromTextBlob(parts.join("\n"));
}

function parseBuildIdFromReferrer(): number | undefined {
  return document.referrer ? parseBuildIdFromAnyUrl(document.referrer) : undefined;
}

/** Walk parent windows until cross-origin; Azure sometimes embeds the tab one level under the build page. */
function parseBuildIdFromAncestorWindows(): number | undefined {
  let w: Window | null = window;
  for (let depth = 0; depth < 12 && w; depth++) {
    try {
      const href = w.location.href;
      const fromUrl = parseBuildIdFromAnyUrl(href);
      if (fromUrl !== undefined) {
        return fromUrl;
      }
      const fromBlob = extractBuildIdFromTextBlob(href);
      if (fromBlob !== undefined) {
        return fromBlob;
      }
    } catch {
      /* cross-origin */
    }
    try {
      if (!w.parent || w.parent === w) {
        break;
      }
      w = w.parent;
    } catch {
      break;
    }
  }
  return undefined;
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
    "Could not resolve build id. Open **Pipelines → Runs → select one finished run → Summary → Terraform**. This tab does not run on the project Dashboard or the pipeline list (there is no single build there). Install the latest ADO Terraform Agent if the problem continues.",
  );
}

async function tryBuildIdFromPageDataService(): Promise<number | undefined> {
  try {
    const buildPageService = await SDK.getService<IBuildPageDataService>(
      BuildServiceIds.BuildPageDataService,
    );
    for (let attempt = 0; attempt < 80; attempt++) {
      const pageData = buildPageService.getBuildPageData();
      const id = pageData?.build?.id;
      if (typeof id === "number" && !Number.isNaN(id)) {
        return id;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  } catch {
    /* service missing */
  }
  return undefined;
}

/** Some hosts expose the current build only through this callback. */
async function tryBuildIdFromOnBuildChanged(): Promise<number | undefined> {
  const cfg = SDK.getConfiguration() as {
    onBuildChanged?: (cb: (build: { id?: number }) => void) => void;
  };
  if (typeof cfg.onBuildChanged !== "function") {
    return undefined;
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (id: number | undefined) => {
      if (settled || id === undefined || Number.isNaN(id)) {
        return;
      }
      settled = true;
      resolve(id);
    };
    try {
      cfg.onBuildChanged!((build) => {
        finish(typeof build?.id === "number" ? build.id : undefined);
      });
    } catch {
      resolve(undefined);
      return;
    }
    setTimeout(() => {
      if (!settled) {
        resolve(undefined);
      }
    }, 3000);
  });
}

/**
 * Resolve build id from handshake JSON, URLs (iframe, referrer, ancestors), BuildPageDataService,
 * and host callbacks. Project Dashboard has no build context — use a single run’s Summary page.
 */
async function resolveBuildId(): Promise<number> {
  const fromHandshake = parseBuildIdFromHandshakeJson();
  if (fromHandshake !== undefined) {
    return fromHandshake;
  }

  const fromSurfaces = extractBuildIdFromTextBlob(
    [window.location.href, document.documentURI || "", document.referrer || ""].join("\n"),
  );
  if (fromSurfaces !== undefined) {
    return fromSurfaces;
  }

  const fromAncestors = parseBuildIdFromAncestorWindows();
  if (fromAncestors !== undefined) {
    return fromAncestors;
  }

  const fromRef = parseBuildIdFromReferrer();
  if (fromRef !== undefined) {
    return fromRef;
  }

  const fromWin = parseBuildIdFromWindow();
  if (fromWin !== undefined) {
    return fromWin;
  }

  const fromService = await tryBuildIdFromPageDataService();
  if (fromService !== undefined) {
    return fromService;
  }

  const fromCb = await tryBuildIdFromOnBuildChanged();
  if (fromCb !== undefined) {
    return fromCb;
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
  const startTime = performance.now();
  const timeoutMs = 30000;
  const timeoutHandle = setTimeout(() => {
    const app = document.getElementById("app");
    if (app) {
      app.innerHTML = `<div class="error"><strong>Loading timeout</strong><p>The Terraform plan is taking longer than expected to load. This usually means:</p><ul><li>The artifact is large or network is slow</li><li>Azure DevOps services are under heavy load</li><li>Try refreshing the page</li></ul></div>`;
    }
  }, timeoutMs);

  try {
    await SDK.init({ loaded: false, applyTheme: true });
    await SDK.ready();

    const project = SDK.getWebContext().project;
    if (!project?.name) {
      throw new Error("Project context is not available.");
    }
    const buildId = await resolveBuildId();
    const artifactName = resolveArtifactName();
    console.log(`[Terraform] Resolved buildId=${buildId}, artifactName=${artifactName}, project=${project.name}`);

    const buildClient = getClient(BuildRestClient);
    const plan = await loadPlanJsonFromArtifact(buildClient, project.name, buildId, artifactName);
    const artifactLoadTime = performance.now() - startTime;
    console.log(`[Terraform] Loaded plan with ${(plan.resource_changes || []).length} resources in ${artifactLoadTime.toFixed(0)}ms`);

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

    clearTimeout(timeoutHandle);
    await SDK.notifyLoadSucceeded();

    void renderDiagramWhenReady(diagramSource);
  } catch (err) {
    clearTimeout(timeoutHandle);
    throw err;
  }
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
