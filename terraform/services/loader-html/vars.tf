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

variable "loader_html_cpu" {
  type        = number
  description = "Task CPU units"
  default     = 1024
}

variable "loader_html_memory" {
  type        = number
  description = "Task memory in MB"
  default     = 4096
}

variable "loader_html_desired_count" {
  type        = number
  description = "Desired number of tasks"
  default     = 1
}

variable "html_preview_pool_size" {
  type        = number
  description = "Concurrent HTML preview subprocess limit"
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
