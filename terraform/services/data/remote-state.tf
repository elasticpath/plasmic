data "terraform_remote_state" "vpc" {
  backend = "s3"
  config = {
    bucket = "plasmic-terraform-state-${var.environment}-${var.aws_region}"
    key    = "${var.environment}/vpc/terraform.tfstate"
    region = var.aws_region
  }
}

data "terraform_remote_state" "ecs_cluster" {
  backend = "s3"
  config = {
    bucket = "plasmic-terraform-state-${var.environment}-${var.aws_region}"
    key    = "${var.environment}/ecs-cluster/terraform.tfstate"
    region = var.aws_region
  }
}

data "terraform_remote_state" "database" {
  backend = "s3"
  config = {
    bucket = "plasmic-terraform-state-${var.environment}-${var.aws_region}"
    key    = "${var.environment}/database/terraform.tfstate"
    region = var.aws_region
  }
}

data "terraform_remote_state" "frontend" {
  backend = "s3"
  config = {
    bucket = "plasmic-terraform-state-${var.environment}-${var.aws_region}"
    key    = "${var.environment}/frontend/terraform.tfstate"
    region = var.aws_region
  }
}

# Secrets
data "aws_secretsmanager_secret" "session_secret" {
  name = "plasmic/${var.environment}/app/session-secret"
}

locals {
  # VPC
  vpc_id             = data.terraform_remote_state.vpc.outputs.vpc_id
  private_subnet_ids = data.terraform_remote_state.vpc.outputs.private_subnet_ids

  # ECS Cluster
  cluster_id   = data.terraform_remote_state.ecs_cluster.outputs.cluster_id
  cluster_name = data.terraform_remote_state.ecs_cluster.outputs.cluster_name

  # Database
  db_address  = data.terraform_remote_state.database.outputs.db_address
  db_port     = data.terraform_remote_state.database.outputs.db_port
  db_name     = data.terraform_remote_state.database.outputs.db_name
  db_username = data.terraform_remote_state.database.outputs.db_username

  # ECS Cluster (includes ALB, security groups, execution role)
  alb_arn                = data.terraform_remote_state.ecs_cluster.outputs.alb_arn
  alb_listener_arn       = data.terraform_remote_state.ecs_cluster.outputs.alb_https_listener_arn
  alb_security_group_id  = data.terraform_remote_state.ecs_cluster.outputs.alb_security_group_id
  ecs_security_group_id  = data.terraform_remote_state.ecs_cluster.outputs.ecs_security_group_id
  execution_role_arn     = data.terraform_remote_state.ecs_cluster.outputs.execution_role_arn

  # Frontend URLs
  host_url = data.terraform_remote_state.frontend.outputs.host_url
}
