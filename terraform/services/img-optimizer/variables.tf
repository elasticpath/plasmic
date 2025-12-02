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

variable "img_optimizer_cpu" {
  type        = number
  description = "Task CPU units for image optimizer"
  default     = 512
}

variable "img_optimizer_memory" {
  type        = number
  description = "Task memory in MB for image optimizer"
  default     = 1024
}

variable "img_optimizer_desired_count" {
  type        = number
  description = "Desired number of image optimizer tasks"
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

variable "log_level" {
  type        = string
  description = "Application log level"
  default     = "info"
}