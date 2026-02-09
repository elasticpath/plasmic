data "aws_secretsmanager_secret" "database_uri" {
  name = "plasmic/${var.environment}/app/database-uri"
}

module "loader_html_service" {
  source = "../../modules/backend-service"

  environment  = var.environment
  aws_region   = var.aws_region
  service_name = "loaderhtml"

  container_image = var.container_image
  container_port  = 3008
  container_command = [
    "node",
    "-r",
    "esbuild-register",
    "src/wab/server/loader-html-backend.ts"
  ]

  cpu    = var.loader_html_cpu
  memory = var.loader_html_memory

  desired_count = var.loader_html_desired_count

  health_check_path      = "/healthcheck"
  enable_circuit_breaker = true

  environment_variables = {
    NODE_ENV               = "production"
    AWS_REGION             = var.aws_region
    PINO_LOGGER_LEVEL      = var.log_level
    BACKEND_PORT           = "3008"
    CODEGEN_HOST           = local.codegen_host_url
    HOST                   = local.host_url
    DEBUG                  = "connect:typeorm"
    DISABLE_BWRAP          = "1"
    HTML_PREVIEW_POOL_SIZE = tostring(var.html_preview_pool_size)
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

  # Codegen subdomain + loader/html path (highest priority for loader paths)
  host_header = [
    "codegen.${var.environment}.storefront.elasticpath.com",
    "alb-${var.environment}.storefront.elasticpath.com"
  ]
  path_patterns          = ["/api/v1/loader/html/*"]
  listener_rule_priority = 80
}
