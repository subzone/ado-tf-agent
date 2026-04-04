import * as tl from "azure-pipelines-task-lib/task";
import * as tr from "azure-pipelines-task-lib/toolrunner";
import * as tc from "azure-pipelines-tool-lib/tool";
import { spawnSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

function getWorkingDirectory(): string {
  const input = tl.getInput("workingDirectory");
  if (input && input.trim().length > 0) {
    return tl.resolve(tl.getVariable("System.DefaultWorkingDirectory") || process.cwd(), input);
  }
  return tl.getVariable("System.DefaultWorkingDirectory") || process.cwd();
}

function parseExtraArgs(raw: string): string[] {
  if (!raw || !raw.trim()) {
    return [];
  }
  const parts: string[] = [];
  let current = "";
  let inQuote: string | null = null;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (inQuote) {
      if (c === inQuote) {
        inQuote = null;
      } else {
        current += c;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      inQuote = c;
      continue;
    }
    if (/\s/.test(c)) {
      if (current.length) {
        parts.push(current);
        current = "";
      }
      continue;
    }
    current += c;
  }
  if (current.length) {
    parts.push(current);
  }
  return parts;
}

function terraformTool(): tr.ToolRunner {
  const tf = tl.which("terraform", true);
  return tl.tool(tf);
}

async function runInstall(version: string): Promise<void> {
  const clean = version.trim().replace(/^v/i, "");
  const platform = os.platform();
  const arch = os.arch() === "arm64" ? "arm64" : "amd64";
  let osName: string;
  if (platform === "win32") {
    osName = "windows";
  } else if (platform === "darwin") {
    osName = "darwin";
  } else {
    osName = "linux";
  }
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
    if (!inner) {
      throw new Error("Could not find terraform binary in downloaded archive.");
    }
    const binDir = path.dirname(inner);
    toolPath = await tc.cacheDir(binDir, "terraform", clean);
  }
  tl.prependPath(toolPath);
  tl.setVariable("TERRAFORM_CLI_PATH", toolPath);
  console.log(`Terraform ${clean} available at ${toolPath}`);
}

function buildBackendArgs(): string[] {
  const backendType = tl.getInput("backendType") || "local";
  const args: string[] = [];
  if (backendType === "local") {
    return args;
  }
  if (backendType === "custom") {
    const file = tl.getInput("backendConfigFile");
    if (file && file.trim()) {
      const abs = tl.resolve(getWorkingDirectory(), file.trim());
      args.push("-backend-config", abs);
    }
    return args;
  }
  if (backendType === "azurerm") {
    const rg = tl.getInput("azureResourceGroup");
    const sa = tl.getInput("azureStorageAccount");
    const container = tl.getInput("azureContainer");
    const key = tl.getInput("azureStateKey");
    if (rg) {
      args.push("-backend-config", `resource_group_name=${rg}`);
    }
    if (sa) {
      args.push("-backend-config", `storage_account_name=${sa}`);
    }
    if (container) {
      args.push("-backend-config", `container_name=${container}`);
    }
    if (key) {
      args.push("-backend-config", `key=${key}`);
    }
    return args;
  }
  if (backendType === "s3") {
    const bucket = tl.getInput("awsBucket");
    const key = tl.getInput("awsKey");
    const region = tl.getInput("awsRegion");
    const ddb = tl.getInput("awsDynamoDbTable");
    if (bucket) {
      args.push("-backend-config", `bucket=${bucket}`);
    }
    if (key) {
      args.push("-backend-config", `key=${key}`);
    }
    if (region) {
      args.push("-backend-config", `region=${region}`);
    }
    if (ddb) {
      args.push("-backend-config", `dynamodb_table=${ddb}`);
    }
    return args;
  }
  if (backendType === "gcs") {
    const bucket = tl.getInput("gcpBucket");
    const prefix = tl.getInput("gcpPrefix");
    if (bucket) {
      args.push("-backend-config", `bucket=${bucket}`);
    }
    if (prefix) {
      args.push("-backend-config", `prefix=${prefix}`);
    }
    return args;
  }
  return args;
}

async function runTerraform(command: string, cwd: string, extraFromInput: string[]): Promise<number> {
  const runner = terraformTool();
  runner.arg(command);
  const planFile = (tl.getInput("planFile") || "tfplan").trim();

  if (command === "init") {
    for (const a of buildBackendArgs()) {
      runner.arg(a);
    }
    for (const a of extraFromInput) {
      runner.arg(a);
    }
    return runner.execAsync({ cwd });
  }

  if (command === "validate") {
    for (const a of extraFromInput) {
      runner.arg(a);
    }
    return runner.execAsync({ cwd });
  }

  if (command === "plan") {
    runner.arg("-input=false");
    runner.arg("-out");
    runner.arg(planFile);
    for (const a of extraFromInput) {
      runner.arg(a);
    }
    return runner.execAsync({ cwd });
  }

  if (command === "apply") {
    runner.arg("-input=false");
    for (const a of extraFromInput) {
      runner.arg(a);
    }
    runner.arg(planFile);
    return runner.execAsync({ cwd });
  }

  if (command === "show") {
    runner.arg("-json");
    for (const a of extraFromInput) {
      runner.arg(a);
    }
    runner.arg(planFile);
    return runner.execAsync({ cwd });
  }

  throw new Error(`Unknown terraform command: ${command}`);
}

const TF_PLAN_ATTACHMENT_TYPE = "terraform.plan.json";

async function publishPlanJson(cwd: string, planFile: string): Promise<void> {
  const staging = path.join(tl.getVariable("Agent.TempDirectory") || os.tmpdir(), "tf-plan-publish");
  fs.mkdirSync(staging, { recursive: true });
  const jsonPath = path.join(staging, "plan.json");
  const tf = tl.which("terraform", true);
  const args = ["show", "-json", planFile];
  const outFd = fs.openSync(jsonPath, "w");
  try {
    const result = spawnSync(tf, args, {
      cwd,
      stdio: ["ignore", outFd, "pipe"],
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
      encoding: "utf8",
    });
    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      const errTail = (result.stderr || "").trim().slice(0, 2000);
      throw new Error(`terraform show -json failed with exit code ${result.status}. ${errTail}`);
    }
  } finally {
    fs.closeSync(outFd);
  }
  const json = fs.readFileSync(jsonPath, "utf8");
  if (!json.trim()) {
    throw new Error(
      "plan.json is empty after terraform show -json (file redirect produced no data).",
    );
  }
  // Attach to the build timeline record so the UI tab can read it via getAttachments()
  tl.addAttachment(TF_PLAN_ATTACHMENT_TYPE, "plan.json", jsonPath);
  console.log(`plan.json attached as type=${TF_PLAN_ATTACHMENT_TYPE}`);
}

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
      throw new Error(`Working directory does not exist: ${cwd}`);
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
        await publishPlanJson(cwd, planFile);
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
