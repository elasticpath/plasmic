variable "environment" {
  type        = string
  description = "Environment name"
}

variable "aws_region" {
  type        = string
  description = "AWS region"
  default     = "us-east-1"
}

# Container Configuration
variable "container_image" {
  type        = string
  description = "Docker image URL for container"
  default     = ""
}

variable "wab_container_port" {
  type        = number
  default     = 3004
  description = "Container port"
}

# ECS Configuration
variable "wab_cpu" {
  type        = number
  description = "Task CPU units"
  default     = 1024
}

variable "wab_memory" {
  type        = number
  description = "Task memory in MB"
  default     = 2048
}

variable "wab_desired_count" {
  type        = number
  description = "Desired number of tasks"
  default     = 1
}

# Health Check
variable "health_check_path" {
  type        = string
  default     = "/api/v1/health"
  description = "Health check endpoint"
}

# S3 Configuration
variable "site_assets_base_url" {
  type        = string
  description = "Base URL for site assets (CloudFront CDN URL)"
  default     = ""
}

# NOTE: host_url and react_app_default_host_url are automatically pulled from frontend CloudFront via remote state

variable "generic_worker_pool_size" {
  type        = number
  description = "Generic worker pool size"
  default     = 2
}

variable "loader_worker_pool_size" {
  type        = number
  description = "Loader worker pool size"
  default     = 2
}

variable "log_level" {
  type        = string
  description = "Pino logger level (trace, debug, info, warn, error, fatal)"
  default     = "info"
}

variable "mail_config" {
  type        = string
  description = "Mail configuration JSON"
  default     = "{\"mailFrom\":\"Plasmic <noreply@yourdomain.com>\",\"mailUserOps\":\"ops@yourdomain.com\"}"
}

variable "admin_emails" {
  type        = string
  description = "Admin emails JSON array"
  default     = "[]"
}
