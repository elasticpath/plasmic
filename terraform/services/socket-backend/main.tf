# Get shared secrets
data "aws_secretsmanager_secret" "database_uri" {
  name = "plasmic/${var.environment}/app/database-uri"
}

data "aws_secretsmanager_secret" "session_secret" {
  name = "plasmic/${var.environment}/app/session-secret"
}

module "socket_backend_service" {
  source = "../../modules/backend-service"

  environment  = var.environment
  aws_region   = var.aws_region
  service_name = "socket"

  # Container configuration
  container_image = var.container_image
  container_port  = var.socket_container_port
  container_command = [
    "node",
    "-r",
    "esbuild-register",
    "src/wab/server/app-socket-backend-real.ts"
  ]

  # Resources - lightweight service for WebSocket management
  cpu    = var.socket_cpu
  memory = var.socket_memory

  # Scaling - MUST be 1 for current architecture (single instance requirement)
  desired_count = var.socket_desired_count

  # Health check
  health_check_path = var.health_check_path

  # Deployment
  enable_circuit_breaker = true

  # Environment variables
  environment_variables = {
    NODE_ENV                 = "production"
    SOCKET_PORT              = tostring(var.socket_container_port)
    HOST                     = local.frontend_url
    AWS_REGION               = var.aws_region
    PINO_LOGGER_LEVEL        = var.log_level
    GENERIC_WORKER_POOL_SIZE = tostring(var.generic_worker_pool_size)
    LOADER_WORKER_POOL_SIZE  = tostring(var.loader_worker_pool_size)
    DEBUG                    = "connect:typeorm"
  }

  # Secrets - Required for database connectivity and session validation
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
  alb_dns_name          = local.alb_dns_name
  alb_listener_arn      = local.alb_listener_arn
  alb_security_group_id = local.alb_security_group_id
  ecs_security_group_id = local.ecs_security_group_id
  assign_public_ip      = false

  # IAM
  execution_role_arn = local.execution_role_arn
  create_task_role   = false # Socket service doesn't need additional permissions beyond execution

  # Service Connect configuration for internal communication
  enable_service_connect         = true
  service_connect_namespace_arn  = local.service_discovery_namespace_arn
  service_connect_discovery_name = "socket-backend-internal"
  service_connect_port_name      = "socket-api"

  # ALB routing - Only expose WebSocket endpoints publicly
  # Server-to-server endpoints (disconnect, broadcast, cli/emit-token) should be internal-only
  path_patterns = [
    "/api/v1/socket*" # Covers WebSocket endpoint and socket.io paths
  ]
  listener_rule_priority = 150 # Between codegen (110) and img-optimizer (200)
}
