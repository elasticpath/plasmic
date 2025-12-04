variable "environment" {
  type        = string
  description = "Environment name"
}

variable "aws_region" {
  type        = string
  description = "AWS region"
}

variable "container_image" {
  type        = string
  description = "Docker image URL for socket backend service"
}

# Socket service configuration
variable "socket_cpu" {
  type        = number
  description = "CPU units for socket backend service"
  default     = 512
}

variable "socket_memory" {
  type        = number
  description = "Memory in MB for socket backend service"
  default     = 1024
}

variable "socket_desired_count" {
  type        = number
  description = "Desired number of socket backend tasks (must be 1 for current architecture)"
  default     = 1
}

variable "socket_container_port" {
  type        = number
  description = "Socket service container port"
  default     = 3020
}

variable "health_check_path" {
  type        = string
  description = "Health check endpoint for socket service"
  default     = "/healthcheck"
}

# Logging
variable "log_level" {
  type        = string
  description = "Log level for the application"
  default     = "info"
}

# Worker configuration
variable "generic_worker_pool_size" {
  type        = number
  description = "Generic worker pool size"
  default     = 1
}

variable "loader_worker_pool_size" {
  type        = number
  description = "Loader worker pool size"
  default     = 1
}