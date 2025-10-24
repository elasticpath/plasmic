terraform {
  required_version = ">= 1.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    # Configuration provided via backend-config file
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "plasmic"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

# Provider for ACM certificates (CloudFront requires us-east-1)
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = {
      Project     = "plasmic"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}