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

output "service_port" {
  description = "Socket service port"
  value       = var.socket_container_port
}
