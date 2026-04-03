# ADO Terraform Agent

Pipeline task and build visualization for Terraform on Azure DevOps.

## Task

- **install** — Download and cache Terraform (HashiCorp releases), prepend to `PATH`.
- **init** — Remote state via **azurerm**, **s3**, **gcs**, **custom** `-backend-config`, or local default.
- **validate**, **plan**, **apply**, **show** — Standard CLI flow; **plan** can publish a **terraform-plan** artifact containing `plan.json` (`terraform show -json`).

## Build tab

After a successful plan with **Publish plan JSON artifact** enabled, open the build run and select the **Terraform** tab to see resource changes and a Mermaid diagram grouped by provider prefix (for example `azurerm`, `aws`).

Publisher is set to **subzone** in `vss-extension.json`. Use your own 128×128 marketplace icon under `images/extension-icon.png`.
