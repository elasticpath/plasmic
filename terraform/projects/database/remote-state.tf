data "terraform_remote_state" "vpc" {
  backend = "s3"
  config = {
    bucket = "plasmic-terraform-state-${var.environment}-${var.aws_region}"
    key    = "${var.environment}/vpc/terraform.tfstate"
    region = var.aws_region
  }
}

locals {
  vpc_id                     = data.terraform_remote_state.vpc.outputs.vpc_id
  database_subnet_ids        = data.terraform_remote_state.vpc.outputs.database_subnet_ids
  database_subnet_group_name = data.terraform_remote_state.vpc.outputs.database_subnet_group_name
  vpc_cidr_block             = data.terraform_remote_state.vpc.outputs.vpc_cidr_block
}
