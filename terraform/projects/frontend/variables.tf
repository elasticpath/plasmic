variable "environment" {
  type        = string
  description = "Environment name"
}

variable "aws_region" {
  type        = string
  description = "AWS region"
}

variable "hosted_zone_id" {
  type        = string
  description = "Route53 hosted zone ID for storefront.elasticpath.com"
  default     = null
}

variable "parent_domain" {
  type        = string
  description = "Parent domain name (e.g., storefront.elasticpath.com)"
  default     = "storefront.elasticpath.com"
}

variable "host_parent_domain" {
  type        = string
  description = "Parent domain for host (e.g., elasticpathdev.com)"
  default     = "elasticpathdev.com"
}

variable "hosted_zone_id_host" {
  type        = string
  description = "Route53 hosted zone ID for host domain (optional, separate from frontend zone)"
  default     = null
}