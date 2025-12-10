terraform {
  backend "s3" {}

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
  required_version = ">= 1.9"
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      created-by      = "paragon"
      project-name    = "plasmic"
      component       = "ecr"
      meaningful-name = "plasmic-${var.environment}"
    }
  }
}
