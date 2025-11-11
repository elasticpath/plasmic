data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  service_name = "wab"
}

# Get shared DATABASE_URI secret (created and populated by ecs-cluster project)
data "aws_secretsmanager_secret" "database_uri" {
  name = "plasmic/${var.environment}/app/database-uri"
}

# Get session secret
data "aws_secretsmanager_secret" "session_secret" {
  name = "plasmic/${var.environment}/app/session-secret"
}

module "wab_service" {
  source = "../../modules/backend-service"

  environment  = var.environment
  aws_region   = var.aws_region
  service_name = local.service_name

  # Container configuration
  container_image   = var.container_image
  container_port    = var.wab_container_port
  container_command = []

  # Resources
  cpu    = var.wab_cpu
  memory = var.wab_memory

  # Scaling
  desired_count = var.wab_desired_count

  # Health check
  health_check_path = var.health_check_path

  # Deployment - enable circuit breaker to stop retrying failed deployments
  enable_circuit_breaker = true

  # Environment variables - using WAB's expected variable names
  environment_variables = {
    NODE_ENV                     = "production"  # Always use production mode for deployed environments
    PORT                         = tostring(var.wab_container_port)
    HOST                         = local.frontend_url
    AWS_REGION                   = var.aws_region
    SITE_ASSETS_BUCKET           = local.site_assets_bucket_name
    SITE_ASSETS_BASE_URL         = var.site_assets_base_url
    CLIP_BUCKET                  = local.clips_bucket_name
    GENERIC_WORKER_POOL_SIZE     = tostring(var.generic_worker_pool_size)
    LOADER_WORKER_POOL_SIZE      = tostring(var.loader_worker_pool_size)
    REACT_APP_DEFAULT_HOST_URL   = local.react_app_default_host_url
    CODEGEN_HOST                 = local.codegen_url != null ? local.codegen_url : ""
    DATA_URL                     = local.data_url != null ? local.data_url : ""
    PINO_LOGGER_LEVEL            = var.log_level
    MAIL_CONFIG                  = var.mail_config
    ADMIN_EMAILS                 = var.admin_emails
    DEBUG                        = "connect:typeorm"
  }

  # Secrets - DATABASE_URI contains the full PostgreSQL connection string
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
              "s3:PutObject",
              "s3:GetObject",
              "s3:DeleteObject"
            ]
            Resource = [
              "${local.site_assets_bucket_arn}/*",
              "${local.clips_bucket_arn}/*"
            ]
          },
          {
            Effect = "Allow"
            Action = [
              "s3:ListBucket"
            ]
            Resource = [
              local.site_assets_bucket_arn,
              local.clips_bucket_arn
            ]
          }
        ]
      })
    }
  ]

  # ALB routing - WAB gets the default route (lowest priority / catch-all)
  path_pattern           = "/*"
  listener_rule_priority = 1000  # Lowest priority = catch-all
}
