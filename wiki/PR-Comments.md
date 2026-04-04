# PR Comments

Automatically post a formatted plan summary as a pull request thread comment.

## Setup

### 1. Enable OAuth token access

In your pipeline settings, enable **Allow scripts to access the OAuth token**.

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

## What the comment looks like

```
🏗️ Terraform Plan — Build #42

🟢 20 to add · 🟡 3 to change · 🔴 1 to destroy

| | Resource | Action |
|---|---|---|
| 🟢 | aws_vpc.main | create |
| 🟢 | aws_subnet.public_a | create |
| 🟡 | aws_security_group.app | update |
| 🔴 | aws_instance.old | delete |

Posted by ADO Terraform Agent · View full plan
```

Up to 30 resources are listed. Comments are only posted on PR builds — silently skipped on branch builds.
