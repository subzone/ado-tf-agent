# ADO Terraform Agent

Pipeline task and build visualization for Terraform on Azure DevOps.

## What's included

- **Terraform Task** — Install, init, validate, plan, apply, show
- **Build Results Tab** — See plan changes as a table and architecture diagram
- **Multi-cloud support** — Azure (azurerm), AWS (s3), GCP (gcs), or local backend

## Quick start

1. **Install** this extension on your Azure DevOps organization (Organization Settings → Extensions).
2. **Create a pipeline** that uses the **Terraform** task:
   ```yaml
   steps:
     - task: subzone.ado-tf-agent.terraform-task.Terraform@0
       displayName: Terraform plan
       inputs:
         command: plan
         workingDirectory: infra
         publishPlanArtifact: true
   ```
3. **Run the pipeline** and wait for the plan to complete.
4. **Open the build run** → **Terraform** tab to see resource changes and a Mermaid diagram.

## Features

- **Commands**: `install`, `init`, `validate`, `plan`, `apply`, `show`
- **Backends**: Azure (azurerm), AWS (s3), GCP (gcs), custom, or local
- **Plan visualization**: Resource changes table + provider-grouped architecture diagram
- **Cross-platform**: Linux, macOS, Windows agents via Node 20 runtime
- **Secure**: Uses `vso.build` and `vso.build_execute` scopes only

## Where to find help

- **Task configuration** — See task input descriptions in the UI or scroll down.
- **Troubleshooting** — [GitHub issues](https://github.com/subzone/ado-tf-agent/issues)
- **Examples** — [Repository README](https://github.com/subzone/ado-tf-agent)

## Step-by-step usage

### 1. Use the "Terraform" task

Example YAML for a complete Terraform workflow:

```yaml
pool:
  vmImage: ubuntu-latest

steps:
  - task: subzone.ado-tf-agent.terraform-task.Terraform@0
    displayName: Install Terraform
    inputs:
      command: install
      terraformVersion: 1.7.5

  - task: subzone.ado-tf-agent.terraform-task.Terraform@0
    displayName: Terraform init
    inputs:
      command: init
      workingDirectory: infra
      backendType: local

  - task: subzone.ado-tf-agent.terraform-task.Terraform@0
    displayName: Terraform validate
    inputs:
      command: validate
      workingDirectory: infra

  - task: subzone.ado-tf-agent.terraform-task.Terraform@0
    displayName: Terraform plan
    inputs:
      command: plan
      workingDirectory: infra
      publishPlanArtifact: true
      planArtifactName: terraform-plan

  - task: subzone.ado-tf-agent.terraform-task.Terraform@0
    displayName: Terraform apply
    inputs:
      command: apply
      workingDirectory: infra
```

### 2. View the plan in Azure DevOps

After a successful **plan**:
1. Navigate to your pipeline run (Pipelines → recent run).
2. Scroll to the **Summary** tab.
3. Look for the **"Terraform"** button (it appears after plan completes).
4. Click to see:
   - **Resource changes** table (address, type, actions—create, update, delete)
   - **Architecture sketch** — Mermaid diagram grouped by provider (e.g., `azurerm`, `aws`, `google`)

### 3. Configure backends (optional)

Replace `backendType: local` with one of the following:

**Azure (`azurerm`):**
```yaml
backendType: azurerm
azureResourceGroup: my-rg
azureStorageAccount: mystg
azureContainer: tfstate
azureStateKey: my.tfstate
```

**AWS (`s3`):**
```yaml
backendType: s3
awsBucket: my-bucket
awsKey: terraform.tfstate
awsRegion: us-east-1
awsDynamoDbTable: tf-locks  # optional
```

**GCP (`gcs`):**
```yaml
backendType: gcs
gcpBucket: my-bucket
gcpPrefix: terraform/state  # optional
```

## Troubleshooting

- **"A task is missing" in YAML** — Ensure you use the full 4-part task name: `subzone.ado-tf-agent.terraform-task.Terraform@0`
- **Terraform tab does not appear** — Ensure `publishPlanArtifact: true` in the plan step and the plan completed successfully.
- **Diagram looks strange** — Large plans may take a few seconds to render. Refresh the page.

## Learn more

- [Terraform documentation](https://www.terraform.io/docs)
- [Azure DevOps extensions](https://learn.microsoft.com/azure/devops/extend/)
- [GitHub repository](https://github.com/subzone/ado-tf-agent)
