# Getting Started

## Prerequisites

- An Azure DevOps organization
- A pipeline with a Terraform working directory
- No other tools required — Terraform itself is downloaded by the `install` command

## Step 1 — Install the extension

1. Go to your Azure DevOps organization
2. Click **Organization Settings** (⚙ bottom-left)
3. Click **Extensions** → **Browse Marketplace**
4. Search for **ADO Terraform Agent**
5. Click **Install**

## Step 2 — Add to your pipeline

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

> **Important:** The full four-part task name is required:
> `subzone.ado-tf-agent.terraform-task.Terraform@0`

## Step 3 — Open the Terraform tab

Navigate to the completed build run → click the **Terraform** tab.

![Plan overview showing resource list](images/plan-tab-overview.png)

You will see a summary bar, color-coded resource list, policy warnings, and a dependency graph.

## Next steps

- [Configure a remote backend](Backend-Configuration)
- [Enable PR comments](PR-Comments)
- [Understand the plan visualization](Plan-Visualization)
