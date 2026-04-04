# Troubleshooting

## "A task is missing" in YAML

Use the full four-part task name: `subzone.ado-tf-agent.terraform-task.Terraform@0`

Verify the extension is installed: **Organization Settings** → **Extensions**.

## Terraform tab does not appear

1. Confirm the plan step completed successfully in the build logs
2. Confirm `publishPlanArtifact: true` is set
3. Check the build log for `plan.json attached as type=terraform.plan.json`
4. The tab scans the 10 most recent builds — open a build that ran after installing the current version

## PR comment not posted

1. Enable **Allow scripts to access the OAuth token** in pipeline settings
2. Confirm the build was triggered by a pull request (`System.PullRequest.PullRequestId` must be set)
3. Check the build log for `Not a PR build — skipping comment.`

## Dependency graph has no edges

The graph requires `configuration` data in the plan JSON. Run a standard `terraform plan` without unusual flags. Very old Terraform versions (< 0.12) may not include this data.

## Extension requires permission approval after update

Expected behavior when a new version adds OAuth scopes. Go to **Organization Settings** → **Extensions** → **ADO Terraform Agent** → accept the new permissions.

## Still stuck?

Open an issue at [github.com/subzone/ado-tf-agent/issues](https://github.com/subzone/ado-tf-agent/issues) with the error message, your pipeline YAML, and the extension version.
