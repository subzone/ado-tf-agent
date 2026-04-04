# Changelog

## 1.0.0 — 2025-04-04

First production release.

### Pipeline task
- `install`, `init`, `validate`, `plan`, `apply`, `show` commands
- Multi-cloud backends: Azure, AWS, GCP, custom HCL, local
- `publishPlanArtifact` — attaches plan JSON for the Terraform tab
- `postPrComment` — posts plan summary as PR thread comment
- Security hardening: path traversal protection, version validation, log sanitization, native HTTPS

### Plan visualization tab
- Summary bar: `+N add ~N change ±N replace −N destroy`
- Color-coded change table with expandable attribute diffs
- Filter and search by address, type, or action kind
- Policy warnings: 12 built-in AWS and Azure security checks
- Real dependency graph from `configuration.references`
