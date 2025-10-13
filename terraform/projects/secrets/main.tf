# Database URI secret - shared across all services
# The actual connection string is constructed and populated by the database project
resource "aws_secretsmanager_secret" "database_uri" {
  name        = "plasmic/${var.environment}/app/database-uri"
  description = "PostgreSQL database connection URI for all services"

  recovery_window_in_days = var.recovery_window_in_days

  tags = {
    Name        = "plasmic-${var.environment}-database-uri"
    Environment = var.environment
  }
}

# Session secret
resource "aws_secretsmanager_secret" "session_secret" {
  name        = "plasmic/session-secret"
  description = "Session secret for authentication"

  recovery_window_in_days = var.recovery_window_in_days

  tags = {
    Name        = "plasmic-session-secret"
    Environment = var.environment
  }
}

resource "aws_secretsmanager_secret_version" "session_secret" {
  count = var.session_secret != "" ? 1 : 0

  secret_id     = aws_secretsmanager_secret.session_secret.id
  secret_string = var.session_secret
}

# OpenAI API key
resource "aws_secretsmanager_secret" "openai_api_key" {
  name        = "plasmic/openai-api-key"
  description = "OpenAI API key for copilot service"

  recovery_window_in_days = var.recovery_window_in_days

  tags = {
    Name        = "plasmic-openai-api-key"
    Environment = var.environment
  }
}

resource "aws_secretsmanager_secret_version" "openai_api_key" {
  count = var.openai_api_key != "" ? 1 : 0

  secret_id     = aws_secretsmanager_secret.openai_api_key.id
  secret_string = var.openai_api_key
}

# Anthropic API key
resource "aws_secretsmanager_secret" "anthropic_api_key" {
  name        = "plasmic/anthropic-api-key"
  description = "Anthropic API key for copilot service"

  recovery_window_in_days = var.recovery_window_in_days

  tags = {
    Name        = "plasmic-anthropic-api-key"
    Environment = var.environment
  }
}

resource "aws_secretsmanager_secret_version" "anthropic_api_key" {
  count = var.anthropic_api_key != "" ? 1 : 0

  secret_id     = aws_secretsmanager_secret.anthropic_api_key.id
  secret_string = var.anthropic_api_key
}

# DynamoDB access key
resource "aws_secretsmanager_secret" "dynamodb_access_key" {
  name        = "plasmic/dynamodb-access-key"
  description = "DynamoDB access key for copilot service"

  recovery_window_in_days = var.recovery_window_in_days

  tags = {
    Name        = "plasmic-dynamodb-access-key"
    Environment = var.environment
  }
}

resource "aws_secretsmanager_secret_version" "dynamodb_access_key" {
  count = var.dynamodb_access_key != "" ? 1 : 0

  secret_id     = aws_secretsmanager_secret.dynamodb_access_key.id
  secret_string = var.dynamodb_access_key
}

# DynamoDB secret key
resource "aws_secretsmanager_secret" "dynamodb_secret_key" {
  name        = "plasmic/dynamodb-secret-key"
  description = "DynamoDB secret key for copilot service"

  recovery_window_in_days = var.recovery_window_in_days

  tags = {
    Name        = "plasmic-dynamodb-secret-key"
    Environment = var.environment
  }
}

resource "aws_secretsmanager_secret_version" "dynamodb_secret_key" {
  count = var.dynamodb_secret_key != "" ? 1 : 0

  secret_id     = aws_secretsmanager_secret.dynamodb_secret_key.id
  secret_string = var.dynamodb_secret_key
}
