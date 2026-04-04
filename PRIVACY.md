# Privacy Policy — ADO Terraform Agent

**Last updated: April 2025**

## Summary

ADO Terraform Agent does not collect, store, transmit, or share any personal data or telemetry. It runs entirely within your Azure DevOps organization.

---

## What the extension does

ADO Terraform Agent is an Azure DevOps extension consisting of two components:

1. **Pipeline task** — runs Terraform CLI commands (`init`, `plan`, `apply`, etc.) on your build agent and optionally attaches the plan JSON as a build attachment.
2. **Build results tab** — reads that plan attachment from your own Azure DevOps organization and renders it in your browser as a change table, attribute diff, and dependency graph.

---

## Data collection

**We collect nothing.**

- No analytics, no telemetry, no crash reporting.
- No data is sent to any server operated by the publisher.
- No personal information (names, email addresses, IP addresses) is read, stored, or transmitted.

---

## Data flow

All data stays within your Azure DevOps organization:

| Data | Where it goes |
|---|---|
| Terraform plan JSON | Written to the build agent temp directory, attached to the build record in your ADO organization via `##vso[task.addattachment]`. Never leaves your organization. |
| PR comment (if enabled) | Posted to your own ADO Git repository's pull request thread via the ADO REST API using your pipeline's `System.AccessToken`. Never sent externally. |
| Plan visualization | Rendered in your browser by reading the attachment from your own ADO organization. No external requests except to load the Mermaid.js diagram library (bundled — no CDN calls). |

---

## Third-party services

The extension downloads the **Terraform CLI binary** from `releases.hashicorp.com` during the `install` command. This is a direct download from HashiCorp's public distribution endpoint. No data about your infrastructure or pipelines is sent to HashiCorp — only a standard HTTPS GET request for the binary file.

No other third-party services are contacted.

---

## OAuth scopes

The extension requests the following Azure DevOps OAuth scopes:

| Scope | Purpose |
|---|---|
| `vso.build` | Read build records and attachments to display the plan tab |
| `vso.build_execute` | Queue builds (used by the pipeline task) |
| `vso.code_write` | Post plan summary comments to pull requests (only used when `postPrComment: true`) |

These scopes are the minimum required for the extension to function. `vso.code_write` is only exercised when you explicitly enable the `postPrComment` input.

---

## Open source

The full source code is available at [https://github.com/subzone/ado-tf-agent](https://github.com/subzone/ado-tf-agent). You can audit exactly what the extension does before installing it.

---

## Contact

For questions about this privacy policy or the extension, open an issue at [https://github.com/subzone/ado-tf-agent/issues](https://github.com/subzone/ado-tf-agent/issues).
