variable "environment" {
  type        = string
  description = "Environment name"
}

variable "aws_region" {
  type        = string
  description = "AWS region"
  default     = "us-east-1"
}

variable "allowed_origins" {
  type        = list(string)
  description = "List of allowed CORS origins"
  default     = ["*"]
}
