output "service_name" {
  description = "ECS service name"
  value       = module.copilot_service.service_name
}

output "service_arn" {
  description = "ECS service ARN"
  value       = module.copilot_service.service_arn
}

output "task_definition_arn" {
  description = "Task definition ARN"
  value       = module.copilot_service.task_definition_arn
}

output "task_role_arn" {
  description = "Task role ARN"
  value       = module.copilot_service.task_role_arn
}

output "target_group_arn" {
  description = "Target group ARN"
  value       = module.copilot_service.target_group_arn
}

output "cloudwatch_log_group" {
  description = "CloudWatch log group name"
  value       = module.copilot_service.cloudwatch_log_group
}
