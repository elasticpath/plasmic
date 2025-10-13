output "database_uri_arn" {
  description = "ARN of the database URI secret"
  value       = aws_secretsmanager_secret.database_uri.arn
}

output "session_secret_arn" {
  description = "ARN of the session secret"
  value       = aws_secretsmanager_secret.session_secret.arn
}

output "openai_api_key_arn" {
  description = "ARN of the OpenAI API key secret"
  value       = aws_secretsmanager_secret.openai_api_key.arn
}

output "anthropic_api_key_arn" {
  description = "ARN of the Anthropic API key secret"
  value       = aws_secretsmanager_secret.anthropic_api_key.arn
}

output "dynamodb_access_key_arn" {
  description = "ARN of the DynamoDB access key secret"
  value       = aws_secretsmanager_secret.dynamodb_access_key.arn
}

output "dynamodb_secret_key_arn" {
  description = "ARN of the DynamoDB secret key secret"
  value       = aws_secretsmanager_secret.dynamodb_secret_key.arn
}
