terraform {
  required_version = ">= 1.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    # Backend configuration provided via backend config file
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      created-by      = "paragon"
      project-name    = "plasmic"
      component       = "codegen"
      meaningful-name = "plasmic-${var.environment}"
    }
  }
}
