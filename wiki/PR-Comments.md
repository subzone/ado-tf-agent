# PR Comments

Automatically post a formatted plan summary as a pull request thread comment.

**Supports:** Azure Repos (Azure DevOps Git) and GitHub repositories.

## Setup

### 1. Enable OAuth token access

In your pipeline settings, enable **Allow scripts to access the OAuth token**.

**For GitHub repositories:** You also need to configure a GitHub service connection with the necessary permissions, or ensure the pipeline's `System.AccessToken` has access to post comments via GitHub API.

### 2. Add `postPrComment: true`

```yaml
- task: subzone.ado-tf-agent.terraform-task.Terraform@0
  displayName: Terraform plan
  inputs:
    command: plan
    workingDirectory: infra
    publishPlanArtifact: true
    postPrComment: true
```

## Supported Repository Providers

| Provider | What's needed |
|----------|--------------|
| **Azure Repos** | `System.AccessToken` with `vso.code_write` scope (enabled via "Allow scripts to access the OAuth token") |
| **GitHub** | `System.AccessToken` with GitHub API access, or GitHub App/PAT configured in the pipeline |

The task automatically detects the repository provider and uses the appropriate API.

## What the comment looks like

```markdown
## 🏗️ Terraform Plan — Build [#42](https://dev.azure.com/…/_build/results?buildId=42)

🟢 **20 to add** · 🟡 **3 to change** · 🔴 **1 to destroy**

| | Resource | Action |
|---|---|---|
| 🟢 | `aws_vpc.main` | create |
| 🟢 | `aws_subnet.public_a` | create |
| 🟡 | `aws_security_group.app` | update |
| 🔴 | `aws_instance.old` | delete |

<sub>Posted by ADO Terraform Agent · [View full plan](https://dev.azure.com/…/_build/results?buildId=42)</sub>
```

Up to 30 resources are listed. Comments are only posted on PR builds — silently skipped on branch builds.
