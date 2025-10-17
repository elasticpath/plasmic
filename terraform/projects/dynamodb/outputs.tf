output "table_name" {
  description = "Name of the DynamoDB table"
  value       = aws_dynamodb_table.copilot_data.name
}

output "table_arn" {
  description = "ARN of the DynamoDB table"
  value       = aws_dynamodb_table.copilot_data.arn
}

output "table_id" {
  description = "ID of the DynamoDB table"
  value       = aws_dynamodb_table.copilot_data.id
}
