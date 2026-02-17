data "aws_secretsmanager_secret" "database_uri" {
  name = "plasmic/${var.environment}/app/database-uri"
}

module "loader_service" {
  source = "../../modules/backend-service"

  environment  = var.environment
  aws_region   = var.aws_region
  service_name = "loader"

  container_image = var.container_image
  container_port  = 3008
  container_command = [
    "node",
    "-r",
    "esbuild-register",
    "src/wab/server/loader-backend.ts"
  ]

  cpu    = var.loader_cpu
  memory = var.loader_memory

  desired_count = var.loader_desired_count

  health_check_path      = "/healthcheck"
  enable_circuit_breaker = true

  environment_variables = {
    NODE_ENV                 = "production"
    AWS_REGION               = var.aws_region
    PINO_LOGGER_LEVEL        = var.log_level
    LOADER_WORKER_POOL_SIZE  = tostring(var.loader_worker_pool_size)
    BACKEND_PORT             = "3008"
    CODEGEN_HOST             = local.codegen_host_url
    HOST                     = local.host_url
    GENERIC_WORKER_POOL_SIZE = tostring(var.generic_worker_pool_size)
    LOADER_ASSETS_BUCKET     = local.loader_assets_bucket
    LOADER_ERRORS_BUCKET     = local.errors_bucket
    S3_ENDPOINT              = "https://s3.${var.aws_region}.amazonaws.com"
    DEBUG                    = "connect:typeorm"
    DISABLE_BWRAP            = "1"
  }

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

  cluster_id            = local.cluster_id
  cluster_name          = local.cluster_name
  vpc_id                = local.vpc_id
  private_subnet_ids    = local.private_subnet_ids
  alb_arn               = local.alb_arn
  alb_listener_arn      = local.alb_listener_arn
  alb_security_group_id = local.alb_security_group_id
  ecs_security_group_id = local.ecs_security_group_id
  assign_public_ip      = var.assign_public_ip

  execution_role_arn = local.execution_role_arn
  create_task_role   = true

  # Service Connect configuration for internal communication
  enable_service_connect         = true
  service_connect_namespace_arn  = local.service_discovery_namespace_arn
  service_connect_discovery_name = "loader"
  service_connect_port_name      = "loader-api"

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
          },
          {
            Effect = "Allow"
            Action = [
              "s3:PutObject"
            ]
            Resource = "arn:aws:s3:::${local.errors_bucket}/*"
          }
        ]
      })
    }
  ]

  # Primary rule: codegen subdomain + loader/code path
  host_header = [
    "codegen.${var.environment}.storefront.elasticpath.com",
    "alb-${var.environment}.storefront.elasticpath.com"
  ]
  path_patterns          = ["/api/v1/loader/code/*"]
  listener_rule_priority = 91
}

# Additional path rules for codegen subdomain
resource "aws_lb_listener_rule" "codegen_domain_loader_chunks" {
  listener_arn = local.alb_listener_arn
  priority     = 92

  action {
    type             = "forward"
    target_group_arn = module.loader_service.target_group_arn
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
      values = ["/api/v1/loader/chunks"]
    }
  }

  tags = {
    Name = "plasmic-${var.environment}-codegen-to-loader-chunks"
  }
}

resource "aws_lb_listener_rule" "codegen_domain_loader_repr" {
  listener_arn = local.alb_listener_arn
  priority     = 93

  action {
    type             = "forward"
    target_group_arn = module.loader_service.target_group_arn
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
      values = ["/api/v1/loader/repr-v*"]
    }
  }

  tags = {
    Name = "plasmic-${var.environment}-codegen-to-loader-repr"
  }
}

resource "aws_lb_listener_rule" "codegen_domain_loader_hydrate" {
  listener_arn = local.alb_listener_arn
  priority     = 94

  action {
    type             = "forward"
    target_group_arn = module.loader_service.target_group_arn
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
      values = ["/static/js/loader-hydrate*"]
    }
  }

  tags = {
    Name = "plasmic-${var.environment}-codegen-to-loader-hydrate"
  }
}
