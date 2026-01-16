output "task_definition_arn" {
  description = "ARN of the publish-hostless task definition"
  value       = aws_ecs_task_definition.publish_hostless.arn
}

output "task_definition_family" {
  description = "Family name of the task definition"
  value       = aws_ecs_task_definition.publish_hostless.family
}

output "log_group_name" {
  description = "CloudWatch log group name"
  value       = aws_cloudwatch_log_group.publish_hostless.name
}

output "cluster_name" {
  description = "ECS cluster name (for run-task command)"
  value       = local.cluster_name
}

output "private_subnet_ids" {
  description = "Private subnet IDs (for run-task network config)"
  value       = local.private_subnet_ids
}

output "ecs_security_group_id" {
  description = "ECS security group ID (for run-task network config)"
  value       = local.ecs_security_group_id
}
