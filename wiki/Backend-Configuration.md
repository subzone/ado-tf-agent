# Backend Configuration

## Azure (`azurerm`)

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

**Credentials:** Set `ARM_CLIENT_ID`, `ARM_CLIENT_SECRET`, `ARM_TENANT_ID`, `ARM_SUBSCRIPTION_ID` as pipeline variables.

## AWS (`s3`)

```yaml
- task: subzone.ado-tf-agent.terraform-task.Terraform@0
  inputs:
    command: init
    workingDirectory: infra
    backendType: s3
    awsBucket: my-tf-state-bucket
    awsKey: prod/myapp.tfstate
    awsRegion: us-east-1
    awsDynamoDbTable: tf-lock-table
```

**Credentials:** Set `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` as pipeline secret variables.

## GCP (`gcs`)

```yaml
- task: subzone.ado-tf-agent.terraform-task.Terraform@0
  inputs:
    command: init
    workingDirectory: infra
    backendType: gcs
    gcpBucket: my-tf-state-bucket
    gcpPrefix: terraform/state
```

**Credentials:** Set `GOOGLE_CREDENTIALS` as a pipeline secret variable.

## Custom HCL file

```yaml
- task: subzone.ado-tf-agent.terraform-task.Terraform@0
  inputs:
    command: init
    workingDirectory: infra
    backendType: custom
    backendConfigFile: backend.hcl
```

## Local (default)

No configuration needed. State is stored on the agent — suitable for testing only.
