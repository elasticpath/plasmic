terraform {
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
      component       = "socket-backend"
      meaningful-name = "plasmic-${var.environment}"
    }
  }
}