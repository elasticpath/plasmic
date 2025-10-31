variable "environment" {
  type        = string
  description = "Environment name"
}

variable "aws_region" {
  type        = string
  description = "AWS region"
  default     = "us-east-1"
}

variable "db_instance_class" {
  type        = string
  description = "RDS instance class"
  default     = "db.t3.small"
}

variable "db_allocated_storage" {
  type        = number
  description = "Allocated storage in GB"
  default     = 20
}

variable "db_max_allocated_storage" {
  type        = number
  description = "Maximum storage for autoscaling"
  default     = 0
}

variable "db_name" {
  type        = string
  description = "Database name"
  default     = "wab"
}

variable "db_username" {
  type        = string
  description = "Master username"
  default     = "postgres"
}

variable "multi_az" {
  type        = bool
  description = "Enable multi-AZ"
  default     = false
}

variable "backup_retention_period" {
  type        = number
  description = "Backup retention in days"
  default     = 1
}

variable "skip_final_snapshot" {
  type        = bool
  description = "Skip final snapshot on destroy"
  default     = false
}
