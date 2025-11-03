variable "environment" {
  type        = string
  description = "Environment name (dev, staging, prod)"
}

variable "aws_region" {
  type        = string
  description = "AWS region"
  default     = "us-east-1"
}

variable "vpc_cidr" {
  type        = string
  description = "VPC CIDR block"
  default     = "10.0.0.0/16"
}

variable "enable_nat_gateway" {
  type        = bool
  description = "Enable NAT Gateway for private subnets"
  default     = false
}

variable "single_nat_gateway" {
  type        = bool
  description = "Use a single NAT Gateway (cost savings for non-prod)"
  default     = false
}
