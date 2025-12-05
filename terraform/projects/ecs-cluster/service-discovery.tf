# Service Discovery namespace for ECS Service Connect internal communication
resource "aws_service_discovery_private_dns_namespace" "internal" {
  name        = "plasmic-${var.environment}.internal"
  description = "Private DNS namespace for Service Connect internal communication"
  vpc         = local.vpc_id

  tags = {
    Name        = "plasmic-${var.environment}-internal"
    Environment = var.environment
  }
}
