variable "environment" {
  type        = string
  description = "Environment name"
}

variable "aws_region" {
  type        = string
  description = "AWS region"
  default     = "us-east-1"
}

variable "recovery_window_in_days" {
  type        = number
  description = "Number of days to recover deleted secrets"
  default     = 7
  validation {
    condition     = var.recovery_window_in_days >= 7 && var.recovery_window_in_days <= 30
    error_message = "recovery_window_in_days must be between 7 and 30 days"
  }
}

# Secret values - should be provided via tfvars or environment variables
# Leave empty to create secret placeholders without values
variable "database_uri" {
  type        = string
  description = "PostgreSQL database connection URI"
  default     = ""
  sensitive   = true
}

variable "session_secret" {
  type        = string
  description = "Session secret for authentication"
  default     = ""
  sensitive   = true
}

variable "openai_api_key" {
  type        = string
  description = "OpenAI API key"
  default     = ""
  sensitive   = true
}

variable "anthropic_api_key" {
  type        = string
  description = "Anthropic API key"
  default     = ""
  sensitive   = true
}

variable "dynamodb_access_key" {
  type        = string
  description = "DynamoDB access key"
  default     = ""
  sensitive   = true
}

variable "dynamodb_secret_key" {
  type        = string
  description = "DynamoDB secret key"
  default     = ""
  sensitive   = true
}
