locals {
  full_service_name = "plasmic-${var.environment}-${var.service_name}"
}

# CloudWatch Log Group
resource "aws_cloudwatch_log_group" "service" {
  name              = "/ecs/${local.full_service_name}"
  retention_in_days = var.log_retention_days

  tags = {
    Name = "${local.full_service_name}-logs"
  }
}

# ECS Task Definition
resource "aws_ecs_task_definition" "service" {
  family                   = local.full_service_name
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = var.execution_role_arn
  task_role_arn            = var.create_task_role ? aws_iam_role.task[0].arn : null

  # Use ARM64 (Graviton) for ~20% cost savings
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  container_definitions = jsonencode([{
    name      = var.service_name
    image     = var.container_image
    essential = true
    command   = var.container_command

    portMappings = [{
      containerPort = var.container_port
      protocol      = "tcp"
    }]

    environment = [
      for key, value in var.environment_variables : {
        name  = key
        value = value
      }
    ]

    secrets = var.secrets

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.service.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "ecs"
      }
    }

    healthCheck = {
      command     = ["CMD-SHELL", "wget --no-verbose --tries=1 --spider http://localhost:${var.container_port}${var.health_check_path} || exit 1"]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 60
    }
  }])

  tags = {
    Name = "${local.full_service_name}-task"
  }
}

# ECS Service
resource "aws_ecs_service" "service" {
  name            = local.full_service_name
  cluster         = var.cluster_id
  task_definition = aws_ecs_task_definition.service.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    security_groups  = [var.ecs_security_group_id]
    subnets          = var.private_subnet_ids
    assign_public_ip = var.assign_public_ip
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.service.arn
    container_name   = var.service_name
    container_port   = var.container_port
  }

  health_check_grace_period_seconds = 60

  deployment_maximum_percent         = 200
  deployment_minimum_healthy_percent = 100

  # Circuit breaker - automatically rollback failed deployments
  deployment_circuit_breaker {
    enable   = var.enable_circuit_breaker
    rollback = var.enable_circuit_breaker
  }

  enable_ecs_managed_tags = true
  propagate_tags          = "SERVICE"

  lifecycle {
    ignore_changes = [desired_count]
  }

  depends_on = [
    aws_lb_listener_rule.service
  ]

  tags = {
    Name = "${local.full_service_name}-service"
  }
}

