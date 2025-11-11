data "terraform_remote_state" "vpc" {
  backend = "s3"
  config = {
    bucket = "plasmic-terraform-state-${var.environment}-${var.aws_region}"
    key    = "${var.environment}/vpc/terraform.tfstate"
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

data "terraform_remote_state" "ecs_cluster" {
  backend = "s3"
  config = {
    bucket = "plasmic-terraform-state-${var.environment}-${var.aws_region}"
    key    = "${var.environment}/ecs-cluster/terraform.tfstate"
    region = var.aws_region
  }
}

data "terraform_remote_state" "s3_site_assets" {
  backend = "s3"
  config = {
    bucket = "plasmic-terraform-state-${var.environment}-${var.aws_region}"
    key    = "${var.environment}/s3-site-assets/terraform.tfstate"
    region = var.aws_region
  }
}

data "terraform_remote_state" "s3_clips" {
  backend = "s3"
  config = {
    bucket = "plasmic-terraform-state-${var.environment}-${var.aws_region}"
    key    = "${var.environment}/s3-clips/terraform.tfstate"
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

locals {
  # VPC
  vpc_id             = data.terraform_remote_state.vpc.outputs.vpc_id
  private_subnet_ids = data.terraform_remote_state.vpc.outputs.private_subnet_ids


  # ECS Cluster (includes ALB, security groups, execution role)
  cluster_id            = data.terraform_remote_state.ecs_cluster.outputs.cluster_id
  cluster_name          = data.terraform_remote_state.ecs_cluster.outputs.cluster_name
  alb_arn               = data.terraform_remote_state.ecs_cluster.outputs.alb_arn
  alb_listener_arn      = data.terraform_remote_state.ecs_cluster.outputs.alb_https_listener_arn
  alb_security_group_id = data.terraform_remote_state.ecs_cluster.outputs.alb_security_group_id
  ecs_security_group_id = data.terraform_remote_state.ecs_cluster.outputs.ecs_security_group_id
  execution_role_arn    = data.terraform_remote_state.ecs_cluster.outputs.execution_role_arn

  # S3 Buckets
  site_assets_bucket_name = data.terraform_remote_state.s3_site_assets.outputs.bucket_name
  site_assets_bucket_arn  = data.terraform_remote_state.s3_site_assets.outputs.bucket_arn
  clips_bucket_name       = data.terraform_remote_state.s3_clips.outputs.bucket_name
  clips_bucket_arn        = data.terraform_remote_state.s3_clips.outputs.bucket_arn

  # Frontend URLs (from CloudFront distributions)
  frontend_url                 = data.terraform_remote_state.frontend.outputs.frontend_url
  react_app_default_host_url   = data.terraform_remote_state.frontend.outputs.host_url

  # Service URLs for internal routing
  codegen_url = data.terraform_remote_state.ecs_cluster.outputs.codegen_url
  data_url    = data.terraform_remote_state.ecs_cluster.outputs.data_url
}
