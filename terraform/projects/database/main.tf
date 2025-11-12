locals {
  identifier = "plasmic-${var.environment}-db"
}

# Get database password from Secrets Manager
data "aws_secretsmanager_secret" "db_password" {
  name = "plasmic/${var.environment}/db/master-password"
}

data "aws_secretsmanager_secret_version" "db_password" {
  secret_id = data.aws_secretsmanager_secret.db_password.id
}

# Security group for RDS
resource "aws_security_group" "rds" {
  name_prefix = "${local.identifier}-"
  description = "Security group for RDS database"
  vpc_id      = local.vpc_id

  lifecycle {
    create_before_destroy = true
  }

  tags = {
    Name = "${local.identifier}-sg"
  }
}

# Ingress rule - will be added by ECS service
# (ECS service will add ingress rule to allow its security group)

# Egress not needed for RDS

# RDS Instance
resource "aws_db_instance" "main" {
  identifier = local.identifier

  engine               = "postgres"
  engine_version       = "15.14"
  instance_class       = var.db_instance_class
  allocated_storage    = var.db_allocated_storage
  max_allocated_storage = var.db_max_allocated_storage
  storage_type         = "gp3"
  storage_encrypted    = false  # Match existing unencrypted database

  username = var.db_username
  password = data.aws_secretsmanager_secret_version.db_password.secret_string

  multi_az               = var.multi_az
  db_subnet_group_name   = local.database_subnet_group_name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false

  backup_retention_period = var.backup_retention_period
  backup_window          = "03:00-04:00"  # UTC
  maintenance_window     = "mon:04:00-mon:05:00"  # UTC

  skip_final_snapshot       = var.skip_final_snapshot
  final_snapshot_identifier = var.skip_final_snapshot ? null : "${local.identifier}-final"

  deletion_protection = var.environment == "prod" ? true : false

  tags = {
    Name = local.identifier
  }
}
