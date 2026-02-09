# Get shared DATABASE_URI secret (created and populated by ecs-cluster project)
data "aws_secretsmanager_secret" "database_uri" {
  name = "plasmic/${var.environment}/app/database-uri"
}

module "codegen_service" {
  source = "../../modules/backend-service"

  environment  = var.environment
  aws_region   = var.aws_region
  service_name = "codegen"

  # Container configuration
  container_image = var.container_image
  container_port  = 3008
  container_command = [
    "node",
    "-r",
    "esbuild-register",
    "src/wab/server/codegen-backend.ts"
  ]

  # Resources
  cpu    = var.codegen_cpu
  memory = var.codegen_memory

  # Scaling
  desired_count = var.codegen_desired_count

  # Health check
  health_check_path = "/healthcheck"

  # Deployment
  enable_circuit_breaker = true

  # Environment variables - using production mode to ensure DATABASE_URI is used
  environment_variables = {
    NODE_ENV                 = "production" # Always use production mode for deployed environments
    AWS_REGION               = var.aws_region
    PINO_LOGGER_LEVEL        = var.log_level
    LOADER_WORKER_POOL_SIZE  = tostring(var.loader_worker_pool_size)
    BACKEND_PORT             = "3008"
    CODEGEN_HOST             = local.codegen_host_url
    DATA_HOST                = local.data_host_url # Data service URL for SSR prepass data queries
    HOST                     = local.host_url
    GENERIC_WORKER_POOL_SIZE = tostring(var.generic_worker_pool_size)
    LOADER_ASSETS_BUCKET     = local.loader_assets_bucket
    DEBUG                    = "connect:typeorm"
    DISABLE_BWRAP            = "1" # Disable bubblewrap sandboxing (not supported on Fargate)
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
  assign_public_ip      = var.assign_public_ip

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
              "s3:PutObject"
            ]
            Resource = "arn:aws:s3:::${local.loader_assets_bucket}/*"
          }
        ]
      })
    }
  ]

  # ALB routing - use host-based routing for codegen service
  # Accept both direct codegen domain and ALB domain (for CloudFront routing)
  host_header = [
    "codegen.${var.environment}.storefront.elasticpath.com",
    "alb-${var.environment}.storefront.elasticpath.com"
  ]
  listener_rule_priority = 110
}

# Additional ALB rules to route codegen endpoints from main domain
# These have higher priority than the host-based rule above

# Core code endpoints
resource "aws_lb_listener_rule" "main_domain_code_api" {
  listener_arn = local.alb_listener_arn
  priority     = 105 # Higher priority than host-based rule

  action {
    type             = "forward"
    target_group_arn = module.codegen_service.target_group_arn
  }

  condition {
    host_header {
      values = ["${var.environment}.storefront.elasticpath.com"]
    }
  }

  condition {
    path_pattern {
      values = ["/api/v1/code/*"]
    }
  }

  tags = {
    Name = "plasmic-${var.environment}-main-to-codegen-code"
  }
}

# Project-specific code endpoints
resource "aws_lb_listener_rule" "main_domain_project_code" {
  listener_arn = local.alb_listener_arn
  priority     = 106

  action {
    type             = "forward"
    target_group_arn = module.codegen_service.target_group_arn
  }

  condition {
    host_header {
      values = ["${var.environment}.storefront.elasticpath.com"]
    }
  }

  condition {
    path_pattern {
      values = ["/api/v1/projects/*/code/*"]
    }
  }

  tags = {
    Name = "plasmic-${var.environment}-main-to-codegen-projects"
  }
}

# Localization endpoints
resource "aws_lb_listener_rule" "main_domain_localization" {
  listener_arn = local.alb_listener_arn
  priority     = 107

  action {
    type             = "forward"
    target_group_arn = module.codegen_service.target_group_arn
  }

  condition {
    host_header {
      values = ["${var.environment}.storefront.elasticpath.com"]
    }
  }

  condition {
    path_pattern {
      values = ["/api/v1/localization/gen-texts"]
    }
  }

  tags = {
    Name = "plasmic-${var.environment}-main-to-codegen-localization"
  }
}

# Prefill endpoint - must be higher priority than loader/code rule (91)
resource "aws_lb_listener_rule" "codegen_domain_loader_prefill" {
  listener_arn = local.alb_listener_arn
  priority     = 85

  action {
    type             = "forward"
    target_group_arn = module.codegen_service.target_group_arn
  }

  condition {
    host_header {
      values = [
        "codegen.${var.environment}.storefront.elasticpath.com",
        "alb-${var.environment}.storefront.elasticpath.com"
      ]
    }
  }

  condition {
    path_pattern {
      values = ["/api/v1/loader/code/prefill/*"]
    }
  }

  tags = {
    Name = "plasmic-${var.environment}-codegen-to-codegen-prefill"
  }
}
