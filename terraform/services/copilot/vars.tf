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

variable "copilot_cpu" {
  type        = number
  description = "Task CPU units"
  default     = 2048
}

variable "copilot_memory" {
  type        = number
  description = "Task memory in MB"
  default     = 4096
}

variable "copilot_desired_count" {
  type        = number
  description = "Desired number of tasks"
  default     = 1
}

variable "generic_worker_pool_size" {
  type        = number
  description = "Generic worker pool size"
  default     = 2
}

variable "dynamodb_region" {
  type        = string
  description = "DynamoDB region"
  default     = "us-west-2"
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

variable "enable_ai_features" {
  type        = bool
  description = "Enable AI features (requires OpenAI and Anthropic API keys)"
  default     = false
}

variable "enable_dynamodb_secrets" {
  type        = bool
  description = "Enable DynamoDB access using secret credentials"
  default     = false
}
