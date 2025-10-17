output "service_name" {
  description = "ECS service name"
  value       = aws_ecs_service.service.name
}

output "service_arn" {
  description = "ECS service ARN"
  value       = aws_ecs_service.service.id
}

output "task_definition_arn" {
  description = "Task definition ARN"
  value       = aws_ecs_task_definition.service.arn
}

output "task_role_arn" {
  description = "Task role ARN"
  value       = var.create_task_role ? aws_iam_role.task[0].arn : null
}

output "task_role_name" {
  description = "Task role name"
  value       = var.create_task_role ? aws_iam_role.task[0].name : null
}

output "target_group_arn" {
  description = "Target group ARN"
  value       = aws_lb_target_group.service.arn
}

output "cloudwatch_log_group" {
  description = "CloudWatch log group name"
  value       = aws_cloudwatch_log_group.service.name
}
