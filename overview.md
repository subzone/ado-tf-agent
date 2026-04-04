# ADO Terraform Agent

**Terraform pipeline task + interactive plan visualizer for Azure DevOps.**

Run `init`, `plan`, `apply` and more — then open the **Terraform** tab on any build to explore your infrastructure changes with a color-coded diff table, expandable attribute diffs, and a real dependency graph.

---

## ✨ Features

| | |
|---|---|
| 🔧 **Pipeline task** | `install`, `init`, `validate`, `plan`, `apply`, `show` — all Terraform commands in one task |
| ☁️ **Multi-cloud backends** | Azure (azurerm), AWS (s3), GCP (gcs), custom HCL file, or local |
| 📊 **Plan summary bar** | At-a-glance `+12 add  ~3 change  −1 destroy` before you read a single line |
| 🎨 **Color-coded changes** | Green create · Yellow update/replace · Red destroy — spot risk instantly |
| 🔍 **Expandable attribute diff** | Click any resource row to see a before/after diff of every attribute |
| 🗺️ **Real dependency graph** | Edges parsed from `configuration.references` — not just provider grouping |
| 🔒 **Minimal scopes** | Only `vso.build` and `vso.build_execute` — nothing more |
| 🖥️ **Cross-platform** | Linux, macOS, Windows hosted and self-hosted agents (Node 20) |

---

## 🚀 Quick start

### 1. Install the extension

**Organization Settings** → **Extensions** → **Browse Marketplace** → search **ADO Terraform Agent** → **Install**.

### 2. Add to your pipeline

```yaml
pool:
  vmImage: ubuntu-latest

steps:
  - task: subzone.ado-tf-agent.terraform-task.Terraform@0
    displayName: Install Terraform
    inputs:
      command: install
      terraformVersion: 1.9.0

  - task: subzone.ado-tf-agent.terraform-task.Terraform@0
    displayName: Terraform init
    inputs:
      command: init
      workingDirectory: infra
      backendType: azurerm
      azureResourceGroup: rg-tfstate
      azureStorageAccount: mytfstateacct
      azureContainer: tfstate
      azureStateKey: myapp.tfstate

  - task: subzone.ado-tf-agent.terraform-task.Terraform@0
    displayName: Terraform plan
    inputs:
      command: plan
      workingDirectory: infra
      publishPlanArtifact: true

  - task: subzone.ado-tf-agent.terraform-task.Terraform@0
    displayName: Terraform apply
    inputs:
      command: apply
      workingDirectory: infra
```

### 3. Open the Terraform tab

After the plan step completes, navigate to the build run → click the **Terraform** tab.

---

## 📋 Plan visualization

### Summary bar

A single line shows the blast radius of your plan before you read anything:

```
+20 add   ~3 change   ±1 replace   −2 destroy
```

### Color-coded change table

Every resource that will change is listed with a color-coded action badge:

| Badge | Meaning |
|---|---|
| 🟢 `+ create` | New resource will be created |
| 🟡 `~ update` | Resource will be updated in-place |
| 🟡 `± replace` | Resource will be destroyed and recreated |
| 🔴 `− delete` | Resource will be destroyed |
| ⚪ `○ read` | Data source read |

`no-op` resources (unchanged) are hidden from the table automatically.

### Expandable attribute diff

Click any row to expand a full before/after diff:

- **Changed attributes** highlighted in yellow
- **Before** values in red, **after** values in green
- `(known after apply)` for computed values
- `(sensitive)` for masked values — never exposed in the UI

### Dependency graph

The diagram is built from actual `configuration.references` in the plan JSON — not just provider grouping. You see real edges:

```
aws_lb_listener → aws_lb_target_group → aws_autoscaling_group → aws_subnet
```

Nodes are color-coded by action kind, matching the table badges.

---

## ⚙️ Task reference

### Commands

| Command | Description |
|---|---|
| `install` | Download and cache Terraform on the agent, prepend to PATH |
| `init` | `terraform init` with optional backend config |
| `validate` | `terraform validate` |
| `plan` | `terraform plan -out tfplan` — optionally publishes plan attachment |
| `apply` | `terraform apply tfplan` |
| `show` | `terraform show -json` |

### Inputs

| Input | Command | Description |
|---|---|---|
| `terraformVersion` | `install` | Version to download, e.g. `1.9.0` |
| `workingDirectory` | all except `install` | Directory containing `.tf` files |
| `backendType` | `init` | `local` · `azurerm` · `s3` · `gcs` · `custom` |
| `publishPlanArtifact` | `plan` | Attach `plan.json` for the Terraform tab (default: `true`) |
| `planFile` | `plan` · `apply` · `show` | Plan file name (default: `tfplan`) |
| `additionalArguments` | all | Extra flags appended to the command |

### Backend examples

**Azure (`azurerm`)**
```yaml
backendType: azurerm
azureResourceGroup: rg-tfstate
azureStorageAccount: mytfstateacct
azureContainer: tfstate
azureStateKey: myapp.tfstate
```

**AWS (`s3`)**
```yaml
backendType: s3
awsBucket: my-tf-state-bucket
awsKey: prod/terraform.tfstate
awsRegion: us-east-1
awsDynamoDbTable: tf-lock-table   # optional
```

**GCP (`gcs`)**
```yaml
backendType: gcs
gcpBucket: my-tf-state-bucket
gcpPrefix: terraform/state        # optional
```

**Custom HCL file**
```yaml
backendType: custom
backendConfigFile: backend.hcl
```

---

## 🔑 YAML task name

The full four-part task name is required:

```
subzone.ado-tf-agent.terraform-task.Terraform@0
```

Using a shorter form (e.g. `subzone.ado-tf-agent.terraform-task@0`) will produce **"A task is missing"** even when the extension is installed.

---

## 🛠️ Troubleshooting

**"A task is missing" in YAML**
Use the full task name above. Verify the extension is installed on the same organization as the pipeline.

**Terraform tab does not appear**
Ensure `publishPlanArtifact: true` on the plan step and that the plan step completed successfully. The tab scans the 10 most recent builds for a plan attachment.

**Dependency graph has no edges**
The graph requires `configuration` data in the plan JSON, which is present when running `terraform plan` normally. Plans generated with `-refresh=false` or very old Terraform versions may omit it.

**Sensitive values visible**
They won't be — the UI reads the `*_sensitive` fields from the plan JSON and replaces them with `(sensitive)`.

---

## 🔗 Links

- [GitHub repository](https://github.com/subzone/ado-tf-agent)
- [Report an issue](https://github.com/subzone/ado-tf-agent/issues)
- [Terraform documentation](https://developer.hashicorp.com/terraform/docs)
- [Azure DevOps Extensions](https://learn.microsoft.com/azure/devops/extend/)
