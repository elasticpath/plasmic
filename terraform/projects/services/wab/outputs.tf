output "service_name" {
  description = "ECS service name"
  value       = module.wab_service.service_name
}

output "service_arn" {
  description = "ECS service ARN"
  value       = module.wab_service.service_arn
}

output "task_definition_arn" {
  description = "Task definition ARN"
  value       = module.wab_service.task_definition_arn
}

output "log_group_name" {
  description = "CloudWatch log group name"
  value       = module.wab_service.cloudwatch_log_group
}

output "application_url" {
  description = "Application URL"
  value       = "http://${data.terraform_remote_state.ecs_cluster.outputs.alb_dns_name}"
}

# Expose ALB DNS for convenience
output "alb_dns_name" {
  description = "ALB DNS name"
  value       = data.terraform_remote_state.ecs_cluster.outputs.alb_dns_name
}
