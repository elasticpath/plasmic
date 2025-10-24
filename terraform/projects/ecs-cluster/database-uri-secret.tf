# Get DB password from Secrets Manager
data "aws_secretsmanager_secret_version" "db_password" {
  secret_id = "plasmic/${var.environment}/db/master-password"
}

# Get the database-uri secret (created by secrets project)
data "aws_secretsmanager_secret" "database_uri" {
  name = "plasmic/${var.environment}/app/database-uri"
}

# Populate the database-uri secret with the full connection string
resource "aws_secretsmanager_secret_version" "database_uri" {
  secret_id     = data.aws_secretsmanager_secret.database_uri.id
  secret_string = "postgresql://${local.db_username}:${data.aws_secretsmanager_secret_version.db_password.secret_string}@${local.db_address}:${local.db_port}/${local.db_name}?sslmode=no-verify"
}