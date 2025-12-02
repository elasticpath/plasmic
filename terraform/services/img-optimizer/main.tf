# Get shared secrets
data "aws_secretsmanager_secret" "database_uri" {
  name = "plasmic/${var.environment}/app/database-uri"
}

data "aws_secretsmanager_secret" "session_secret" {
  name = "plasmic/${var.environment}/app/session-secret"
}

module "img_optimizer_service" {
  source = "../../modules/backend-service"

  environment  = var.environment
  aws_region   = var.aws_region
  service_name = "imgopt"

  # Container configuration
  container_image = var.container_image
  container_port  = 3009
  container_command = [
    "node",
    "-r",
    "esbuild-register",
    "src/wab/server/img-optimizer-backend.ts"
  ]

  # Resources - optimized for image processing
  cpu    = var.img_optimizer_cpu
  memory = var.img_optimizer_memory

  # Scaling
  desired_count = var.img_optimizer_desired_count

  # Health check
  health_check_path = "/healthcheck"

  # Deployment
  enable_circuit_breaker = true

  # Environment variables
  environment_variables = {
    NODE_ENV                 = "production"
    PORT                     = "3009"
    HOST                     = local.host_url
    AWS_REGION               = var.aws_region
    SITE_ASSETS_BUCKET       = local.site_assets_bucket_name
    SITE_ASSETS_BASE_URL     = local.site_assets_base_url
    S3_ENDPOINT              = "https://s3.${var.aws_region}.amazonaws.com"
    PINO_LOGGER_LEVEL        = var.log_level
    GENERIC_WORKER_POOL_SIZE = tostring(var.generic_worker_pool_size)
    LOADER_WORKER_POOL_SIZE  = tostring(var.loader_worker_pool_size)
    DEBUG                    = "connect:typeorm"
  }

  # Secrets - Required for application startup
  secrets = [
    {
      name      = "DATABASE_URI"
      valueFrom = data.aws_secretsmanager_secret.database_uri.arn
    },
    {
      name      = "SESSION_SECRET"
      valueFrom = data.aws_secretsmanager_secret.session_secret.arn
    }
  ]

  # Networking
  cluster_id            = local.cluster_id
  cluster_name          = local.cluster_name
  vpc_id                = local.vpc_id
  private_subnet_ids    = local.private_subnet_ids
  alb_arn               = local.alb_arn
  alb_listener_arn      = local.alb_listener_arn
  alb_security_group_id = local.alb_security_group_id
  ecs_security_group_id = local.ecs_security_group_id
  assign_public_ip      = false

  # IAM
  execution_role_arn = local.execution_role_arn
  create_task_role   = true

  task_role_inline_policies = [
    {
      name = "S3Access"
      policy = jsonencode({
        Version = "2012-10-17"
        Statement = [
          {
            Effect = "Allow"
            Action = [
              "s3:GetObject",
              "s3:PutObject",
              "s3:HeadObject"
            ]
            Resource = "${local.site_assets_bucket_arn}/*"
          },
          {
            Effect = "Allow"
            Action = [
              "s3:ListBucket"
            ]
            Resource = local.site_assets_bucket_arn
          }
        ]
      })
    }
  ]

  # ALB routing - path-based routing for image optimizer
  path_pattern           = "/img-optimizer/*"
  listener_rule_priority = 200 # Between codegen (110) and wab (1000)
}