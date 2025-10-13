# ALB Security Group
resource "aws_security_group" "alb" {
  name_prefix = "${local.cluster_name}-alb-"
  description = "Security group for Application Load Balancer"
  vpc_id      = local.vpc_id

  lifecycle {
    create_before_destroy = true
  }

  tags = {
    Name = "${local.cluster_name}-alb-sg"
  }
}

resource "aws_vpc_security_group_ingress_rule" "alb_http" {
  security_group_id = aws_security_group.alb.id
  description       = "HTTP from internet"
  from_port         = 80
  to_port           = 80
  ip_protocol       = "tcp"
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_ingress_rule" "alb_https" {
  security_group_id = aws_security_group.alb.id
  description       = "HTTPS from internet"
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "alb_to_ecs" {
  security_group_id            = aws_security_group.alb.id
  description                  = "To ECS tasks"
  ip_protocol                  = "-1"
  referenced_security_group_id = aws_security_group.ecs_tasks.id
}

# ECS Tasks Security Group (shared by all services)
resource "aws_security_group" "ecs_tasks" {
  name_prefix = "${local.cluster_name}-ecs-"
  description = "Security group for ECS tasks"
  vpc_id      = local.vpc_id

  lifecycle {
    create_before_destroy = true
  }

  tags = {
    Name = "${local.cluster_name}-ecs-sg"
  }
}

resource "aws_vpc_security_group_ingress_rule" "ecs_from_alb" {
  security_group_id            = aws_security_group.ecs_tasks.id
  description                  = "From ALB"
  ip_protocol                  = "-1"
  referenced_security_group_id = aws_security_group.alb.id
}

resource "aws_vpc_security_group_egress_rule" "ecs_to_rds" {
  security_group_id            = aws_security_group.ecs_tasks.id
  description                  = "To RDS"
  from_port                    = local.db_port
  to_port                      = local.db_port
  ip_protocol                  = "tcp"
  referenced_security_group_id = local.db_security_group_id
}

resource "aws_vpc_security_group_egress_rule" "ecs_to_internet" {
  security_group_id = aws_security_group.ecs_tasks.id
  description       = "To internet (HTTPS)"
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
  cidr_ipv4         = "0.0.0.0/0"
}

# Allow ECS to reach RDS (add rule to RDS security group)
resource "aws_vpc_security_group_ingress_rule" "rds_from_ecs" {
  security_group_id            = local.db_security_group_id
  description                  = "From ECS tasks"
  from_port                    = local.db_port
  to_port                      = local.db_port
  ip_protocol                  = "tcp"
  referenced_security_group_id = aws_security_group.ecs_tasks.id
}
