# Remote state for shared infrastructure
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

data "terraform_remote_state" "frontend" {
  backend = "s3"
  config = {
    bucket = "plasmic-terraform-state-${var.environment}-${var.aws_region}"
    key    = "${var.environment}/frontend/terraform.tfstate"
    region = var.aws_region
  }
}

# Local values from remote state
locals {
  # VPC
  vpc_id             = data.terraform_remote_state.vpc.outputs.vpc_id
  private_subnet_ids = data.terraform_remote_state.vpc.outputs.private_subnet_ids

  # ECS Cluster
  cluster_id            = data.terraform_remote_state.ecs_cluster.outputs.cluster_id
  cluster_name          = data.terraform_remote_state.ecs_cluster.outputs.cluster_name
  alb_arn               = data.terraform_remote_state.ecs_cluster.outputs.alb_arn
  alb_listener_arn      = data.terraform_remote_state.ecs_cluster.outputs.alb_https_listener_arn
  alb_dns_name          = data.terraform_remote_state.ecs_cluster.outputs.alb_dns_name
  alb_security_group_id = data.terraform_remote_state.ecs_cluster.outputs.alb_security_group_id
  ecs_security_group_id = data.terraform_remote_state.ecs_cluster.outputs.ecs_security_group_id
  execution_role_arn    = data.terraform_remote_state.ecs_cluster.outputs.execution_role_arn

  # Frontend URL for HOST environment variable
  frontend_url = data.terraform_remote_state.frontend.outputs.frontend_url

  # Service Discovery for Service Connect
  service_discovery_namespace_arn = data.terraform_remote_state.ecs_cluster.outputs.service_discovery_namespace_arn
}
