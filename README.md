# ADO Terraform Agent

Azure DevOps extension that adds a **Terraform** pipeline task and a **Terraform** tab on the build results page. The tab renders `plan.json` (from `terraform show -json`) as a change table and a high-level diagram derived from `resource_changes`.

## Prerequisites

- [Node.js 20+](https://nodejs.org/) for building
- An [Azure DevOps publisher](https://learn.microsoft.com/azure/devops/extend/publish/overview) (create one in the [Visual Studio Marketplace manage portal](https://marketplace.visualstudio.com/manage) if you do not have one)
- [Personal access token](https://learn.microsoft.com/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate) with **Marketplace (Manage)** scope for publishing

## Configure the manifest

1. Confirm `publisher` in `vss-extension.json` (currently **subzone**).
2. Update `repository.uri`, task `author` / `helpMarkDown` in `tasks/Terraform/task.json`, and branding as needed.
3. Replace `images/extension-icon.png` with a **128×128** PNG for the Marketplace.

## Build and package

```bash
npm install
npm run package
```

This produces `dist/subzone.ado-tf-agent-0.1.0.vsix`.

## Build and publish from GitHub Actions

Workflow: [`.github/workflows/extension.yml`](.github/workflows/extension.yml).

| Trigger | What happens |
|--------|----------------|
| Push / PR to `main` or `master` | Builds and uploads the **VSIX** as a workflow artifact (no Marketplace publish). |
| Push a **version tag** `v*` (e.g. `v0.1.1`) | Builds, then **publishes** that VSIX to the Marketplace. **Bump `version` in `vss-extension.json` before tagging** — each publish must use a new version. |
| **Run workflow** manually | Builds; set **Publish VSIX to Marketplace** to `true` to publish. |

**Repository secret** (Settings → Secrets and variables → Actions):

- **`AZURE_DEVOPS_EXT_TOKEN`** — Azure DevOps [PAT](https://learn.microsoft.com/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate) with **Marketplace (Manage)** scope, tied to the same identity that owns publisher **subzone**.

Publishing uses `tfx extension publish` with your public manifest (`"public": true`); you can still complete or adjust listing details in the [publisher portal](https://marketplace.visualstudio.com/manage) afterward.

Install dependencies for local iteration:

```bash
cd tasks/Terraform && npm install && npm run build
cd ../../ui && npm install && npm run build
```

## Publish to your organization today (no Marketplace review)

Private sharing is the fastest way to validate on real pipelines:

```bash
npx tfx-cli extension publish \
  --manifest-globs vss-extension.json \
  --token <PAT> \
  --share-with <your-org-name>
```

Or upload the `.vsix` under **Organization settings → Extensions → Shared → Upload extension**.

## Marketplace (public listing)

The manifest sets **`"public": true`** so the package is eligible for the public Marketplace. Publishing still requires:

- A valid **privacy policy** URL (often on your publisher profile or in the extension’s Marketplace listing).
- **Support** / contact information as required by the submission wizard.
- Microsoft **review** (not instant; timelines vary).

Publish with `tfx extension publish` **without** `--share-with`, then finish any remaining steps in the [publisher portal](https://marketplace.visualstudio.com/manage). You can keep using `--share-with` for private testing of the same or another version if needed.

## Example pipeline (YAML)

```yaml
pool:
  vmImage: ubuntu-latest

steps:
  - task: subzone.ado-tf-agent.terraform-task@0
    displayName: Install Terraform
    inputs:
      command: install
      terraformVersion: 1.7.5

  - task: subzone.ado-tf-agent.terraform-task@0
    displayName: Terraform init (Azure backend)
    inputs:
      command: init
      workingDirectory: infra
      backendType: azurerm
      azureResourceGroup: rg-terraform-state
      azureStorageAccount: tfstateacct
      azureContainer: tfstate
      azureStateKey: myapp.tfstate

  - task: subzone.ado-tf-agent.terraform-task@0
    displayName: Terraform plan
    inputs:
      command: plan
      workingDirectory: infra
      publishPlanArtifact: true
      planArtifactName: terraform-plan
```

Use **service connections** or **Azure CLI** / environment variables for provider credentials as you normally would for Terraform on hosted agents.

## Architecture notes

- **Task** — Node 20 handler (`azure-pipelines-task-lib`, `azure-pipelines-tool-lib`) for cross-platform agents.
- **UI** — `ms.vss-build-web.build-results-tab` loads `ui/dist/planTab.html`, uses `azure-devops-extension-sdk` and `BuildRestClient.getArtifactContentZip` to read the published artifact.
- **Diagram** — Mermaid `flowchart` with subgraphs per resource type prefix; a future iteration can parse `terraform graph` or dependency metadata for richer edges.

## Security

Request only the scopes you need. This manifest uses `vso.build` and `vso.build_execute`. Review with your security team before broad rollout.

## VSIX size (optional)

Before publishing, you can drop TypeScript from the packaged task folder:

```bash
cd tasks/Terraform && npm prune --omit=dev && cd ../..
npm run package
```

Re-run `npm install` in `tasks/Terraform` afterward if you need to compile again locally.
