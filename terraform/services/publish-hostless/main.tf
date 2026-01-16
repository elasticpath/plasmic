# Publish Hostless Task Definition
#
# This creates a one-off ECS task for publishing hostless packages.
# Unlike other services, this is NOT a long-running service - it's triggered
# manually via `aws ecs run-task` from the GitHub Actions workflow.
#
# Usage:
#   aws ecs run-task \
#     --cluster plasmic-{environment} \
#     --task-definition plasmic-{environment}-publish-hostless \
#     --launch-type FARGATE \
#     --network-configuration "awsvpcConfiguration={subnets=[...],securityGroups=[...],assignPublicIp=DISABLED}"

# Get shared DATABASE_URI secret (created and populated by ecs-cluster project)
data "aws_secretsmanager_secret" "database_uri" {
  name = "plasmic/${var.environment}/app/database-uri"
}

# CloudWatch log group for task output
resource "aws_cloudwatch_log_group" "publish_hostless" {
  name              = "/ecs/plasmic-${var.environment}-publish-hostless"
  retention_in_days = var.log_retention_days

  tags = {
    Name = "plasmic-${var.environment}-publish-hostless-logs"
  }
}

# ECS Task Definition (not a service - just the task definition)
resource "aws_ecs_task_definition" "publish_hostless" {
  family                   = "plasmic-${var.environment}-publish-hostless"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = local.execution_role_arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([{
    name      = "publish-hostless"
    image     = var.container_image
    essential = true

    # Use shell to pass DATABASE_URI as --dburi argument
    # The script expects: node PublishHostless.ts --dburi <connection_string>
    entryPoint = ["/bin/sh", "-c"]
    command = [
      "node -r esbuild-register src/wab/server/db/PublishHostless.ts --dburi \"$DATABASE_URI\""
    ]

    environment = [
      { name = "NODE_ENV", value = "production" }
    ]

    secrets = [
      {
        name      = "DATABASE_URI"
        valueFrom = data.aws_secretsmanager_secret.database_uri.arn
      }
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.publish_hostless.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "ecs"
      }
    }
  }])

  tags = {
    Name = "plasmic-${var.environment}-publish-hostless"
  }
}
