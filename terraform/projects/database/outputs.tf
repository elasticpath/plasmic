output "db_endpoint" {
  description = "Database endpoint"
  value       = aws_db_instance.main.endpoint
}

output "db_address" {
  description = "Database address (without port)"
  value       = aws_db_instance.main.address
}

output "db_port" {
  description = "Database port"
  value       = aws_db_instance.main.port
}

output "db_name" {
  description = "Database name"
  value       = aws_db_instance.main.db_name
}

output "db_username" {
  description = "Database master username"
  value       = aws_db_instance.main.username
  sensitive   = true
}

output "db_security_group_id" {
  description = "Database security group ID"
  value       = aws_security_group.rds.id
}

output "db_instance_id" {
  description = "RDS instance ID"
  value       = aws_db_instance.main.id
}
