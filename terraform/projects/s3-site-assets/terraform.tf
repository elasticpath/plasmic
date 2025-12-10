terraform {
  required_version = ">= 1.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {}
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      created-by      = "paragon"
      project-name    = "plasmic"
      component       = "s3-site-assets"
      meaningful-name = "plasmic-${var.environment}"
    }
  }
}
