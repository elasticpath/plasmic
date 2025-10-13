variable "environment" {
  type        = string
  description = "Environment name"
}

variable "aws_region" {
  type        = string
  description = "AWS region"
}

variable "service_name" {
  type        = string
  description = "Name of the backend service (e.g., 'codegen', 'data', 'copilot')"
}

variable "container_image" {
  type        = string
  description = "Docker image URL"
}

variable "container_port" {
  type        = number
  description = "Container port"
}

variable "container_command" {
  type        = list(string)
  description = "Command to run in container"
}

variable "cpu" {
  type        = number
  description = "Task CPU units"
}

variable "memory" {
  type        = number
  description = "Task memory in MB"
}

variable "desired_count" {
  type        = number
  description = "Desired number of tasks"
  default     = 1
}

variable "health_check_path" {
  type        = string
  default     = "/healthcheck"
  description = "Health check endpoint"
}

variable "enable_circuit_breaker" {
  type        = bool
  default     = false
  description = "Enable deployment circuit breaker"
}

# Environment variables
variable "environment_variables" {
  type = map(string)
  description = "Environment variables for the container"
  default     = {}
}

# Secrets
variable "secrets" {
  type = list(object({
    name      = string
    valueFrom = string
  }))
  description = "Secrets from Secrets Manager"
  default     = []
}

# Networking
variable "cluster_id" {
  type        = string
  description = "ECS cluster ID"
}

variable "cluster_name" {
  type        = string
  description = "ECS cluster name"
}

variable "vpc_id" {
  type        = string
  description = "VPC ID"
}

variable "private_subnet_ids" {
  type        = list(string)
  description = "Private subnet IDs for ECS tasks"
}

variable "alb_arn" {
  type        = string
  description = "Application Load Balancer ARN"
}

variable "alb_listener_arn" {
  type        = string
  description = "ALB Listener ARN"
}

variable "alb_security_group_id" {
  type        = string
  description = "ALB security group ID"
}

variable "ecs_security_group_id" {
  type        = string
  description = "ECS tasks security group ID"
}

# IAM
variable "execution_role_arn" {
  type        = string
  description = "ECS task execution role ARN"
}

variable "create_task_role" {
  type        = bool
  default     = true
  description = "Create a task role for this service"
}

variable "task_role_policies" {
  type        = list(string)
  description = "Additional IAM policy ARNs to attach to task role"
  default     = []
}

variable "task_role_inline_policies" {
  type = list(object({
    name   = string
    policy = string
  }))
  description = "Inline IAM policies for task role"
  default     = []
}

# Listener rules
variable "host_header" {
  type        = string
  description = "Host header for ALB listener rule"
  default     = null
}

variable "path_pattern" {
  type        = string
  description = "Path pattern for ALB listener rule"
  default     = null
}

variable "listener_rule_priority" {
  type        = number
  description = "Priority for ALB listener rule"
  default     = null
}

variable "assign_public_ip" {
  type        = bool
  default     = false
  description = "Assign public IP to tasks"
}

variable "log_retention_days" {
  type        = number
  default     = 7
  description = "CloudWatch Logs retention in days"
}
