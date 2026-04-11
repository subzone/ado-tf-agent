import * as tl from "azure-pipelines-task-lib/task";
import * as tr from "azure-pipelines-task-lib/toolrunner";
import * as tc from "azure-pipelines-tool-lib/tool";
import { spawnSync } from "child_process";
import * as https from "https";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

// ── Security helpers ──────────────────────────────────────────────────────────

/** Strip newlines and control characters to prevent log injection. */
function sanitizeLog(s: string): string {
  return s.replace(/[\r\n\t\x00-\x1f\x7f]/g, " ").slice(0, 500);
}

/**
 * Resolve a user-supplied path and verify it stays within the allowed base.
 * Throws if the resolved path escapes the base directory (path traversal guard).
 */
function safeResolvePath(base: string, userInput: string): string {
  const resolved = path.resolve(base, userInput);
  if (!resolved.startsWith(path.resolve(base) + path.sep) && resolved !== path.resolve(base)) {
    throw new Error(`Path traversal detected: "${sanitizeLog(userInput)}" escapes the working directory.`);
  }
  return resolved;
}

// ── Working directory ─────────────────────────────────────────────────────────

function getWorkingDirectory(): string {
  const input = tl.getInput("workingDirectory");
  if (input && input.trim().length > 0) {
    return tl.resolve(tl.getVariable("System.DefaultWorkingDirectory") || process.cwd(), input);
  }
  return tl.getVariable("System.DefaultWorkingDirectory") || process.cwd();
}

function parseExtraArgs(raw: string): string[] {
  if (!raw || !raw.trim()) return [];
  const parts: string[] = [];
  let current = "";
  let inQuote: string | null = null;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (inQuote) {
      if (c === inQuote) { inQuote = null; } else { current += c; }
      continue;
    }
    if (c === '"' || c === "'") { inQuote = c; continue; }
    if (/\s/.test(c)) {
      if (current.length) { parts.push(current); current = ""; }
      continue;
    }
    current += c;
  }
  if (current.length) parts.push(current);
  return parts;
}

function terraformTool(): tr.ToolRunner {
  const tf = tl.which("terraform", true);
  return tl.tool(tf);
}

// ── Install ───────────────────────────────────────────────────────────────────

async function runInstall(version: string): Promise<void> {
  // Validate version is a safe semver string — no shell metacharacters
  const clean = version.trim().replace(/^v/i, "");
  if (!/^\d+\.\d+\.\d+$/.test(clean)) {
    throw new Error(`Invalid Terraform version format: "${sanitizeLog(clean)}". Expected x.y.z`);
  }

  const platform = os.platform();
  const arch = os.arch() === "arm64" ? "arm64" : "amd64";
  let osName: string;
  if (platform === "win32") { osName = "windows"; }
  else if (platform === "darwin") { osName = "darwin"; }
  else { osName = "linux"; }

  const fileName = `terraform_${clean}_${osName}_${arch}.zip`;
  const url = `https://releases.hashicorp.com/terraform/${clean}/${fileName}`;

  let toolPath = tc.findLocalTool("terraform", clean);
  if (!toolPath) {
    tl.debug(`Downloading Terraform from ${url}`);
    const zipPath = await tc.downloadTool(url);
    const extracted = await tc.extractZip(zipPath);
    const inner = fs
      .readdirSync(extracted)
      .map((f) => path.join(extracted, f))
      .find((p) => {
        const base = path.basename(p).toLowerCase();
        return base === "terraform" || base === "terraform.exe";
      });
    if (!inner) throw new Error("Could not find terraform binary in downloaded archive.");
    toolPath = await tc.cacheDir(path.dirname(inner), "terraform", clean);
  }
  tl.prependPath(toolPath);
  tl.setVariable("TERRAFORM_CLI_PATH", toolPath);
  console.log(`Terraform ${clean} available at ${toolPath}`);
}

// ── Backend args ──────────────────────────────────────────────────────────────

function buildBackendArgs(): string[] {
  const backendType = tl.getInput("backendType") || "local";
  const args: string[] = [];
  if (backendType === "local") return args;

  if (backendType === "custom") {
    const file = tl.getInput("backendConfigFile");
    if (file && file.trim()) {
      // FIX: path traversal — validate the resolved path stays within cwd
      const abs = safeResolvePath(getWorkingDirectory(), file.trim());
      args.push("-backend-config", abs);
    }
    return args;
  }

  if (backendType === "azurerm") {
    const rg = tl.getInput("azureResourceGroup");
    const sa = tl.getInput("azureStorageAccount");
    const container = tl.getInput("azureContainer");
    const key = tl.getInput("azureStateKey");
    if (rg) args.push("-backend-config", `resource_group_name=${rg}`);
    if (sa) args.push("-backend-config", `storage_account_name=${sa}`);
    if (container) args.push("-backend-config", `container_name=${container}`);
    if (key) args.push("-backend-config", `key=${key}`);
    return args;
  }

  if (backendType === "s3") {
    const bucket = tl.getInput("awsBucket");
    const key = tl.getInput("awsKey");
    const region = tl.getInput("awsRegion");
    const ddb = tl.getInput("awsDynamoDbTable");
    if (bucket) args.push("-backend-config", `bucket=${bucket}`);
    if (key) args.push("-backend-config", `key=${key}`);
    if (region) args.push("-backend-config", `region=${region}`);
    if (ddb) args.push("-backend-config", `dynamodb_table=${ddb}`);
    return args;
  }

  if (backendType === "gcs") {
    const bucket = tl.getInput("gcpBucket");
    const prefix = tl.getInput("gcpPrefix");
    if (bucket) args.push("-backend-config", `bucket=${bucket}`);
    if (prefix) args.push("-backend-config", `prefix=${prefix}`);
    return args;
  }

  return args;
}

// ── Terraform runner ──────────────────────────────────────────────────────────

async function runTerraform(command: string, cwd: string, extraFromInput: string[]): Promise<number> {
  const runner = terraformTool();
  runner.arg(command);
  const planFile = (tl.getInput("planFile") || "tfplan").trim();

  if (command === "init") {
    for (const a of buildBackendArgs()) runner.arg(a);
    for (const a of extraFromInput) runner.arg(a);
    return runner.execAsync({ cwd });
  }
  if (command === "validate") {
    for (const a of extraFromInput) runner.arg(a);
    return runner.execAsync({ cwd });
  }
  if (command === "plan") {
    runner.arg("-input=false");
    runner.arg("-out");
    runner.arg(planFile);
    for (const a of extraFromInput) runner.arg(a);
    return runner.execAsync({ cwd });
  }
  if (command === "apply") {
    runner.arg("-input=false");
    for (const a of extraFromInput) runner.arg(a);
    runner.arg(planFile);
    return runner.execAsync({ cwd });
  }
  if (command === "show") {
    runner.arg("-json");
    for (const a of extraFromInput) runner.arg(a);
    runner.arg(planFile);
    return runner.execAsync({ cwd });
  }

  throw new Error(`Unknown terraform command: ${command}`);
}

// ── Plan attachment ───────────────────────────────────────────────────────────

const TF_PLAN_ATTACHMENT_TYPE = "terraform.plan.json";

async function publishPlanJson(cwd: string, planFile: string): Promise<string> {
  const staging = path.join(tl.getVariable("Agent.TempDirectory") || os.tmpdir(), "tf-plan-publish");
  fs.mkdirSync(staging, { recursive: true });
  const jsonPath = path.join(staging, "plan.json");
  const tf = tl.which("terraform", true);
  const outFd = fs.openSync(jsonPath, "w");
  try {
    const result = spawnSync(tf, ["show", "-json", planFile], {
      cwd,
      stdio: ["ignore", outFd, "pipe"],
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
      encoding: "utf8",
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      const errTail = (result.stderr || "").trim().slice(0, 2000);
      throw new Error(`terraform show -json failed with exit code ${result.status}. ${errTail}`);
    }
  } finally {
    fs.closeSync(outFd);
  }
  const json = fs.readFileSync(jsonPath, "utf8");
  if (!json.trim()) throw new Error("plan.json is empty after terraform show -json.");
  tl.addAttachment(TF_PLAN_ATTACHMENT_TYPE, "plan.json", jsonPath);
  console.log(`plan.json attached as type=${TF_PLAN_ATTACHMENT_TYPE}`);
  return jsonPath;
}

// ── PR comment ────────────────────────────────────────────────────────────────

interface PlanSummary {
  add: number; change: number; destroy: number; replace: number;
  resources: Array<{ address: string; action: string }>;
}

function parsePlanSummary(jsonPath: string): PlanSummary {
  const plan = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as {
    resource_changes?: Array<{ address?: string; change?: { actions?: string[] } }>;
  };
  const summary: PlanSummary = { add: 0, change: 0, destroy: 0, replace: 0, resources: [] };
  for (const rc of plan.resource_changes || []) {
    const actions = rc.change?.actions || [];
    const addr = rc.address || "";
    if (actions.includes("create") && actions.includes("delete")) {
      summary.replace++; summary.resources.push({ address: addr, action: "replace" });
    } else if (actions.includes("create")) {
      summary.add++; summary.resources.push({ address: addr, action: "create" });
    } else if (actions.includes("delete")) {
      summary.destroy++; summary.resources.push({ address: addr, action: "delete" });
    } else if (actions.includes("update")) {
      summary.change++; summary.resources.push({ address: addr, action: "update" });
    }
  }
  return summary;
}

function buildPrComment(summary: PlanSummary, buildId: string, buildUrl: string): string {
  // FIX: sanitize all user-derived values before embedding in the comment
  const safeBuildId = sanitizeLog(buildId).replace(/[^0-9]/g, "");
  const safeBuildUrl = buildUrl.replace(/[^\w\-.:/?=&%#]/g, "");

  const badge = (n: number, label: string, emoji: string) =>
    n > 0 ? `${emoji} **${n} ${label}**` : null;

  const counts = [
    badge(summary.add,     "to add",     "🟢"),
    badge(summary.change,  "to change",  "🟡"),
    badge(summary.replace, "to replace", "🟡"),
    badge(summary.destroy, "to destroy", "🔴"),
  ].filter(Boolean).join(" · ") || "✅ No changes";

  const rows = summary.resources
    .slice(0, 30)
    .map(r => {
      // Sanitize resource address — strip backticks and newlines to prevent markdown injection
      const safeAddr = r.address.replace(/[`\r\n]/g, "").slice(0, 200);
      const safeAction = ["create", "update", "delete", "replace"].includes(r.action) ? r.action : "unknown";
      const icon = safeAction === "create" ? "🟢" : safeAction === "delete" ? "🔴" : "🟡";
      return `| ${icon} | \`${safeAddr}\` | ${safeAction} |`;
    })
    .join("\n");

  const overflow = summary.resources.length > 30
    ? `\n_…and ${summary.resources.length - 30} more resources_`
    : "";

  return [
    `## 🏗️ Terraform Plan — Build [#${safeBuildId}](${safeBuildUrl})`,
    "",
    counts,
    "",
    "| | Resource | Action |",
    "|---|---|---|",
    rows,
    overflow,
    "",
    `<sub>Posted by ADO Terraform Agent · [View full plan](${safeBuildUrl})</sub>`,
  ].join("\n");
}

/**
 * Post a PR thread comment using the ADO REST API via Node's native https module.
 * FIX: replaced spawnSync("curl", ...) which was vulnerable to shell injection
 * when the Bearer token or URL contained special characters.
 */
async function postPrComment(comment: string): Promise<void> {
  const collectionUri = tl.getVariable("System.CollectionUri") || "";
  const project       = tl.getVariable("System.TeamProject") || "";
  let repoId          = tl.getVariable("Build.Repository.ID") || "";
  const repoName      = tl.getVariable("Build.Repository.Name") || "";
  const prId          = tl.getVariable("System.PullRequest.PullRequestId");
  const token         = tl.getVariable("System.AccessToken") || "";

  if (!prId) {
    console.log("Not a PR build — skipping comment.");
    return;
  }

  // Fix: Build.Repository.ID may contain slashes (e.g., "org/repo") in some ADO configs
  // Extract just the repository name (last part after slash)
  if (repoId.includes("/")) {
    const parts = repoId.split("/");
    const extractedName = parts[parts.length - 1];
    console.log(`Repository ID contains slash (${sanitizeLog(repoId)}), extracting name: ${sanitizeLog(extractedName)}`);
    repoId = extractedName;
  }

  // Debug logging to help diagnose path construction issues
  console.log(`PR comment debug: collectionUri=${sanitizeLog(collectionUri)}`);
  console.log(`PR comment debug: project=${sanitizeLog(project)}`);
  console.log(`PR comment debug: repoId=${sanitizeLog(repoId)}`);
  console.log(`PR comment debug: prId=${sanitizeLog(prId)}`);

  // FIX: validate the ADO collection URI is a trusted hostname before making the request
  const parsedUri = new URL(collectionUri);
  const trustedHosts = /^([a-z0-9-]+\.)?(visualstudio\.com|dev\.azure\.com|azure\.com)$/i;
  if (!trustedHosts.test(parsedUri.hostname)) {
    throw new Error(`Untrusted ADO host: ${sanitizeLog(parsedUri.hostname)}`);
  }

  // Construct the API path correctly for both dev.azure.com and on-prem ADO Server
  // The collectionUri already contains the base path, so we only add the project if needed
  const basePath = parsedUri.pathname.replace(/\/$/, "");
  const apiPath = `${basePath}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repoId)}/pullRequests/${encodeURIComponent(prId)}/threads?api-version=7.1`;
  
  console.log(`PR comment debug: full API path=${sanitizeLog(apiPath)}`);

  const body = JSON.stringify({
    comments: [{ parentCommentId: 0, content: comment, commentType: 1 }],
    status: 1,
  });

  await new Promise<void>((resolve, reject) => {
    const req = https.request(
      {
        hostname: parsedUri.hostname,
        path: apiPath,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk: string) => { data += chunk; });
        res.on("end", () => {
          try {
            const resp = JSON.parse(data) as { id?: number };
            if (resp.id) {
              // FIX: log injection — sanitize before logging
              console.log(`PR comment posted (thread id ${sanitizeLog(String(resp.id))}).`);
            } else {
              console.log("PR comment posted (no thread id in response).");
            }
            resolve();
          } catch {
            reject(new Error(`Failed to parse PR comment response: ${sanitizeLog(data.slice(0, 200))}`));
          }
        });
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  try {
    const command = (tl.getInput("command", true) || "").trim();
    const cwd = getWorkingDirectory();
    const extra = parseExtraArgs(tl.getInput("additionalArguments") || "");

    if (command === "install") {
      const ver = tl.getInput("terraformVersion") || "1.7.5";
      await runInstall(ver);
      tl.setResult(tl.TaskResult.Succeeded, "Terraform installed.");
      return;
    }

    if (!fs.existsSync(cwd)) {
      throw new Error(`Working directory does not exist: ${sanitizeLog(cwd)}`);
    }

    if (command === "init") {
      const code = await runTerraform("init", cwd, extra);
      tl.setResult(code === 0 ? tl.TaskResult.Succeeded : tl.TaskResult.Failed, "init");
      return;
    }

    if (command === "validate") {
      const code = await runTerraform("validate", cwd, extra);
      tl.setResult(code === 0 ? tl.TaskResult.Succeeded : tl.TaskResult.Failed, "validate");
      return;
    }

    if (command === "plan") {
      const code = await runTerraform("plan", cwd, extra);
      if (code !== 0) {
        tl.setResult(tl.TaskResult.Failed, "terraform plan failed.");
        return;
      }
      const publish = tl.getInput("publishPlanArtifact") !== "false";
      if (publish) {
        const planFile = (tl.getInput("planFile") || "tfplan").trim();
        const jsonPath = await publishPlanJson(cwd, planFile);
        const postComment = tl.getInput("postPrComment") === "true";
        if (postComment) {
          const buildId  = tl.getVariable("Build.BuildId") || "";
          const buildUrl = `${tl.getVariable("System.CollectionUri")}${tl.getVariable("System.TeamProject")}/_build/results?buildId=${buildId}`;
          const summary  = parsePlanSummary(jsonPath);
          const comment  = buildPrComment(summary, buildId, buildUrl);
          await postPrComment(comment);
        }
      }
      tl.setResult(tl.TaskResult.Succeeded, "terraform plan completed.");
      return;
    }

    if (command === "apply") {
      const code = await runTerraform("apply", cwd, extra);
      tl.setResult(code === 0 ? tl.TaskResult.Succeeded : tl.TaskResult.Failed, "apply");
      return;
    }

    if (command === "show") {
      const code = await runTerraform("show", cwd, extra);
      tl.setResult(code === 0 ? tl.TaskResult.Succeeded : tl.TaskResult.Failed, "show");
      return;
    }

    throw new Error(`Unsupported command: ${command}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    tl.setResult(tl.TaskResult.Failed, message);
  }
}

void main();
