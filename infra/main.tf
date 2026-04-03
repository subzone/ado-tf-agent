# Sample stack for testing ADO Terraform Agent — no cloud credentials required.
# Uses the null provider only; safe to plan/apply on hosted agents.

terraform {
  required_version = ">= 1.3.0"

  required_providers {
    null = {
      source  = "hashicorp/null"
      version = "~> 3.2"
    }
  }

  # Default local backend; swap to azurerm/s3/gcs via the pipeline task when you are ready.
  backend "local" {}
}

variable "demo_label" {
  type        = string
  description = "Changes force a null_resource replace on apply."
  default     = "ado-tf-agent-demo"
}

resource "null_resource" "demo" {
  triggers = {
    label = var.demo_label
  }
}

output "demo_id" {
  value = null_resource.demo.id
}
