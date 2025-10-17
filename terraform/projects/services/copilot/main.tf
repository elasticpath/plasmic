# Get shared DATABASE_URI secret (created and populated by ecs-cluster project)
data "aws_secretsmanager_secret" "database_uri" {
  name = "plasmic/${var.environment}/app/database-uri"
}

module "copilot_service" {
  source = "../../../modules/backend-service"

  environment  = var.environment
  aws_region   = var.aws_region
  service_name = "copilot"

  # Container configuration
  container_image = var.copilot_container_image
  container_port  = 3009
  container_command = [
    "node",
    "-r",
    "esbuild-register",
    "src/wab/server/copilot-backend.ts"
  ]

  # Resources - Copilot needs more resources
  cpu    = var.copilot_cpu
  memory = var.copilot_memory

  # Scaling
  desired_count = var.copilot_desired_count

  # Health check
  health_check_path = "/healthcheck"

  # Deployment
  enable_circuit_breaker = true

  # Environment variables - using production mode to ensure DATABASE_URI is used
  environment_variables = {
    NODE_ENV                 = "production"  # Always use production mode for deployed environments
    AWS_REGION               = var.aws_region
    PINO_LOGGER_LEVEL        = var.log_level
    BACKEND_PORT             = "3009"
    CODEGEN_HOST             = var.codegen_host_url
    HOST                     = var.host_url
    GENERIC_WORKER_POOL_SIZE = tostring(var.generic_worker_pool_size)
    DEBUG                    = "connect:typeorm"
    DYNAMODB_REGION          = var.dynamodb_region
  }

  # Secrets - DATABASE_URI contains the full PostgreSQL connection string
  secrets = concat(
    [
      {
        name      = "DATABASE_URI"
        valueFrom = data.aws_secretsmanager_secret.database_uri.arn
      },
      {
        name      = "SESSION_SECRET"
        valueFrom = data.aws_secretsmanager_secret.session_secret.arn
      }
    ],
    var.enable_ai_features ? [
      {
        name      = "OPENAI_API_KEY"
        valueFrom = data.aws_secretsmanager_secret.openai_api_key[0].arn
      },
      {
        name      = "ANTHROPIC_API_KEY"
        valueFrom = data.aws_secretsmanager_secret.anthropic_api_key[0].arn
      }
    ] : [],
    var.enable_dynamodb_secrets ? [
      {
        name      = "DYNAMODB_ACCESS_KEY"
        valueFrom = data.aws_secretsmanager_secret.dynamodb_access_key[0].arn
      },
      {
        name      = "DYNAMODB_SECRET_KEY"
        valueFrom = data.aws_secretsmanager_secret.dynamodb_secret_key[0].arn
      }
    ] : []
  )

  # Networking
  cluster_id             = local.cluster_id
  cluster_name           = local.cluster_name
  vpc_id                 = local.vpc_id
  private_subnet_ids     = local.private_subnet_ids
  alb_arn                = local.alb_arn
  alb_listener_arn       = local.alb_listener_arn
  alb_security_group_id  = local.alb_security_group_id
  ecs_security_group_id  = local.ecs_security_group_id
  assign_public_ip       = var.assign_public_ip

  # IAM
  execution_role_arn = local.execution_role_arn
  create_task_role   = true

  task_role_inline_policies = [
    {
      name = "DynamoDBAccess"
      policy = jsonencode({
        Version = "2012-10-17"
        Statement = [
          {
            Effect = "Allow"
            Action = [
              "dynamodb:PutItem",
              "dynamodb:GetItem",
              "dynamodb:UpdateItem",
              "dynamodb:Query",
              "dynamodb:Scan"
            ]
            Resource = "arn:aws:dynamodb:${var.dynamodb_region}:*:table/plasmic-*"
          }
        ]
      })
    }
  ]

  # ALB routing
  path_pattern           = "/api/v1/copilot/*"
  listener_rule_priority = 102
}
