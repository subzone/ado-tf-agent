# Policy Warnings

Built-in security checks run automatically against the plan JSON. No external tools or API keys needed.

## AWS checks

| Rule | Severity | Resource type | Condition |
|---|---|---|---|
| S3 Encryption | 🔴 High | `aws_s3_bucket_public_access_block` | Any block flag is `false` |
| Open Ingress | 🔴 High | `aws_security_group` | Port 22 or 3389 open to `0.0.0.0/0`; any port open to `0.0.0.0/0` (Medium) |
| RDS Encryption | 🔴 High | `aws_db_instance` | `storage_encrypted` is not `true` |
| RDS Public Access | 🔴 High | `aws_db_instance` | `publicly_accessible` is `true` |
| IAM Wildcard Action | 🔴 High | `aws_iam_role_policy` · `aws_iam_policy` | Policy contains `"Action": "*"` |
| IMDSv2 Not Enforced | 🟡 Medium | `aws_launch_template` | `http_tokens` is not `required` |
| EBS Encryption | 🟡 Medium | `aws_ebs_volume` | `encrypted` is not `true` |
| IAM Wildcard Resource | 🟡 Medium | `aws_iam_role_policy` · `aws_iam_policy` | Policy contains `"Resource": "*"` |
| S3 Versioning Disabled | 🔵 Low | `aws_s3_bucket_versioning` | Status is not `Enabled` |

## Azure checks

| Rule | Severity | Resource type | Condition |
|---|---|---|---|
| Azure Blob Public Access | 🔴 High | `azurerm_storage_account` | `allow_blob_public_access` is `true` |
| Azure HTTPS Only | 🔴 High | `azurerm_storage_account` | `enable_https_traffic_only` is `false` |

Checks only run on resources being **created or updated**.
