variable "environment" {
  type        = string
  description = "Environment name"
}

variable "aws_region" {
  type        = string
  description = "AWS region"
  default     = "us-east-1"
}

variable "container_image" {
  type        = string
  description = "Docker image URL for container"
  default     = ""
}

variable "task_cpu" {
  type        = number
  description = "Task CPU units"
  default     = 1024
}

variable "task_memory" {
  type        = number
  description = "Task memory in MB"
  default     = 2048
}

variable "log_retention_days" {
  type        = number
  description = "CloudWatch log retention in days"
  default     = 7
}
