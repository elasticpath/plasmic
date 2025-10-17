variable "environment" {
  type        = string
  description = "Environment name"
}

variable "aws_region" {
  type        = string
  description = "AWS region"
  default     = "us-west-2"
}

variable "enable_point_in_time_recovery" {
  type        = bool
  description = "Enable point-in-time recovery"
  default     = false
}
