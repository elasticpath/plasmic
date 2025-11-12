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

variable "codegen_cpu" {
  type        = number
  description = "Task CPU units"
  default     = 1024
}

variable "codegen_memory" {
  type        = number
  description = "Task memory in MB"
  default     = 3072
}

variable "codegen_desired_count" {
  type        = number
  description = "Desired number of tasks"
  default     = 1
}

variable "loader_worker_pool_size" {
  type        = number
  description = "Loader worker pool size"
  default     = 4
}

variable "generic_worker_pool_size" {
  type        = number
  description = "Generic worker pool size"
  default     = 2
}

variable "assign_public_ip" {
  type        = bool
  description = "Assign public IP to tasks"
  default     = false
}

variable "log_level" {
  type        = string
  description = "Application log level"
  default     = "info"
}

