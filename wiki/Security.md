# Security

## OAuth scopes

| Scope | Purpose |
|---|---|
| `vso.build` | Read build records and attachments for the plan tab |
| `vso.build_execute` | Queue builds (pipeline task) |
| `vso.code_write` | Post PR thread comments (always requested; only used when `postPrComment: true`) |

## Data flow

All data stays within your Azure DevOps organization. No telemetry, no external servers.

See the full [Privacy Policy](https://github.com/subzone/ado-tf-agent/blob/main/PRIVACY.md).

## Reporting vulnerabilities

Do not open public issues for security vulnerabilities. Use [GitHub Security Advisories](https://github.com/subzone/ado-tf-agent/security/advisories/new) to report privately — see [SECURITY.md](https://github.com/subzone/ado-tf-agent/blob/main/SECURITY.md).
