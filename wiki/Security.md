# Security

## OAuth scopes

| Scope | Purpose |
|---|---|
| `vso.build` | Read build records and attachments for the plan tab |
| `vso.build_execute` | Queue builds (pipeline task) |
| `vso.code_write` | Post PR thread comments (only when `postPrComment: true`) |

## Data flow

All data stays within your Azure DevOps organization. No telemetry, no external servers.

See the full [Privacy Policy](https://github.com/subzone/ado-tf-agent/blob/main/PRIVACY.md).

## Reporting vulnerabilities

Do not open public issues for security vulnerabilities. Email **subzone@live.com** — see [SECURITY.md](https://github.com/subzone/ado-tf-agent/blob/main/SECURITY.md).
