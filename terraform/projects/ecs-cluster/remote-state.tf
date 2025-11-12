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

locals {
  # VPC
  vpc_id                 = data.terraform_remote_state.vpc.outputs.vpc_id
  public_subnet_ids      = data.terraform_remote_state.vpc.outputs.public_subnet_ids
  private_subnet_ids     = data.terraform_remote_state.vpc.outputs.private_subnet_ids
  nat_gateway_public_ips = data.terraform_remote_state.vpc.outputs.nat_gateway_public_ips

  # Database
  db_address           = data.terraform_remote_state.database.outputs.db_address
  db_port              = data.terraform_remote_state.database.outputs.db_port
  db_name              = data.terraform_remote_state.database.outputs.db_name
  db_username          = data.terraform_remote_state.database.outputs.db_username
  db_security_group_id = data.terraform_remote_state.database.outputs.db_security_group_id
}
