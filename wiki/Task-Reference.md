# Task Reference

## Task name

Always use the full four-part name:

```
subzone.ado-tf-agent.terraform-task.Terraform@0
```

## Commands

### `install`
```yaml
- task: subzone.ado-tf-agent.terraform-task.Terraform@0
  inputs:
    command: install
    terraformVersion: 1.9.0
```

### `init`
```yaml
- task: subzone.ado-tf-agent.terraform-task.Terraform@0
  inputs:
    command: init
    workingDirectory: infra
    backendType: azurerm
    azureResourceGroup: rg-tfstate
    azureStorageAccount: mytfstateacct
    azureContainer: tfstate
    azureStateKey: myapp.tfstate
```

### `validate`
```yaml
- task: subzone.ado-tf-agent.terraform-task.Terraform@0
  inputs:
    command: validate
    workingDirectory: infra
```

### `plan`
```yaml
- task: subzone.ado-tf-agent.terraform-task.Terraform@0
  inputs:
    command: plan
    workingDirectory: infra
    publishPlanArtifact: true
    postPrComment: true
```

### `apply`
```yaml
- task: subzone.ado-tf-agent.terraform-task.Terraform@0
  inputs:
    command: apply
    workingDirectory: infra
```

## All inputs

| Input | Command | Default | Description |
|---|---|---|---|
| `terraformVersion` | `install` | `1.7.5` | Version to download, e.g. `1.9.0` |
| `workingDirectory` | all except `install` | agent default | Directory containing `.tf` files |
| `backendType` | `init` | `local` | `local` · `azurerm` · `s3` · `gcs` · `custom` |
| `backendConfigFile` | `init` (custom) | — | Path to HCL backend config file |
| `planFile` | `plan` · `apply` · `show` | `tfplan` | Plan file name |
| `publishPlanArtifact` | `plan` | `true` | Attach plan JSON for the Terraform tab |
| `postPrComment` | `plan` | `false` | Post plan summary as PR thread comment |
| `additionalArguments` | all | — | Extra flags appended to the command |

## Complete pipeline example

```yaml
pool:
  vmImage: ubuntu-latest

variables:
  tfDir: infra
  tfVersion: 1.9.0

steps:
  - task: subzone.ado-tf-agent.terraform-task.Terraform@0
    displayName: Install Terraform $(tfVersion)
    inputs:
      command: install
      terraformVersion: $(tfVersion)

  - task: subzone.ado-tf-agent.terraform-task.Terraform@0
    displayName: Terraform init
    inputs:
      command: init
      workingDirectory: $(tfDir)
      backendType: azurerm
      azureResourceGroup: rg-tfstate
      azureStorageAccount: mytfstateacct
      azureContainer: tfstate
      azureStateKey: $(Build.Repository.Name).tfstate

  - task: subzone.ado-tf-agent.terraform-task.Terraform@0
    displayName: Terraform validate
    inputs:
      command: validate
      workingDirectory: $(tfDir)

  - task: subzone.ado-tf-agent.terraform-task.Terraform@0
    displayName: Terraform plan
    inputs:
      command: plan
      workingDirectory: $(tfDir)
      publishPlanArtifact: true
      postPrComment: true

  - task: subzone.ado-tf-agent.terraform-task.Terraform@0
    displayName: Terraform apply
    inputs:
      command: apply
      workingDirectory: $(tfDir)
    condition: and(succeeded(), eq(variables['Build.SourceBranch'], 'refs/heads/main'))
```
