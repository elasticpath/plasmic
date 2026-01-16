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

locals {
  # VPC
  vpc_id             = data.terraform_remote_state.vpc.outputs.vpc_id
  private_subnet_ids = data.terraform_remote_state.vpc.outputs.private_subnet_ids

  # ECS Cluster
  cluster_id            = data.terraform_remote_state.ecs_cluster.outputs.cluster_id
  cluster_name          = data.terraform_remote_state.ecs_cluster.outputs.cluster_name
  ecs_security_group_id = data.terraform_remote_state.ecs_cluster.outputs.ecs_security_group_id
  execution_role_arn    = data.terraform_remote_state.ecs_cluster.outputs.execution_role_arn
}
