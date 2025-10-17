variable "environment" {
  type        = string
  description = "Environment name (dev, staging, prod)"
}

variable "aws_region" {
  type        = string
  description = "AWS region"
  default     = "us-east-1"
}

variable "image_retention_count" {
  type        = number
  description = "Number of images to retain"
  default     = 30
}
