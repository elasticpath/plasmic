output "service_name" {
  description = "Socket backend service name"
  value       = module.socket_backend_service.service_name
}

output "task_definition_arn" {
  description = "Socket backend task definition ARN"
  value       = module.socket_backend_service.task_definition_arn
}

output "target_group_arn" {
  description = "Socket backend target group ARN"
  value       = module.socket_backend_service.target_group_arn
}

output "internal_hostname" {
  description = "Internal hostname for socket service (used by main WAB service)"
  # Use the ALB's custom domain that has valid SSL certificate
  # The ALB will route to socket backend based on path patterns (/api/v1/projects/broadcast, etc.)
  value       = "https://alb-${var.environment}.storefront.elasticpath.com"
}

output "service_port" {
  description = "Socket service port"
  value       = var.socket_container_port
}