# Service outputs for reference if needed by other modules

output "service_name" {
  description = "Name of the ECS service"
  value       = module.img_optimizer_service.service_name
}

output "target_group_arn" {
  description = "ARN of the ALB target group"
  value       = module.img_optimizer_service.target_group_arn
}

output "task_definition_arn" {
  description = "ARN of the ECS task definition"
  value       = module.img_optimizer_service.task_definition_arn
}