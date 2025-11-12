# Application Load Balancer (shared by all services)
resource "aws_lb" "main" {
  name_prefix        = substr(var.environment, 0, 6)
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = local.public_subnet_ids

  enable_deletion_protection = var.environment == "prod"
  enable_http2               = true

  tags = {
    Name = "${local.cluster_name}-alb"
  }
}

locals {
  use_custom_domain = var.hosted_zone_id != null
  alb_domain        = local.use_custom_domain ? "alb-${var.environment}.${var.parent_domain}" : null
  codegen_domain    = local.use_custom_domain ? "codegen.${var.environment}.${var.parent_domain}" : null
  data_domain       = local.use_custom_domain ? "data.${var.environment}.${var.parent_domain}" : null
}

# ACM Certificate for ALB (real certificate)
# Includes all service domains: ALB, Codegen, and Data
resource "aws_acm_certificate" "alb" {
  count = local.use_custom_domain ? 1 : 0

  domain_name = local.alb_domain
  subject_alternative_names = [
    local.codegen_domain,
    local.data_domain
  ]
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = {
    Name        = "${local.cluster_name}-alb-cert"
    Environment = var.environment
  }
}

# DNS validation records for ACM certificate
resource "aws_route53_record" "alb_cert_validation" {
  for_each = local.use_custom_domain ? {
    for dvo in aws_acm_certificate.alb[0].domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  } : {}

  allow_overwrite = true
  name            = each.value.name
  records         = [each.value.record]
  ttl             = 60
  type            = each.value.type
  zone_id         = var.hosted_zone_id
}

# Wait for certificate validation to complete
resource "aws_acm_certificate_validation" "alb" {
  count                   = local.use_custom_domain ? 1 : 0
  certificate_arn         = aws_acm_certificate.alb[0].arn
  validation_record_fqdns = [for record in aws_route53_record.alb_cert_validation : record.fqdn]
}

# Route53 A record for ALB
resource "aws_route53_record" "alb" {
  count   = local.use_custom_domain ? 1 : 0
  zone_id = var.hosted_zone_id
  name    = local.alb_domain
  type    = "A"

  alias {
    name                   = aws_lb.main.dns_name
    zone_id                = aws_lb.main.zone_id
    evaluate_target_health = false
  }
}

# NOTE: Codegen DNS record moved to frontend project (CloudFront distribution)
# The codegen service is now accessed via CloudFront instead of direct ALB access

# Route53 A record for Data service
resource "aws_route53_record" "data" {
  count   = local.use_custom_domain ? 1 : 0
  zone_id = var.hosted_zone_id
  name    = local.data_domain
  type    = "A"

  alias {
    name                   = aws_lb.main.dns_name
    zone_id                = aws_lb.main.zone_id
    evaluate_target_health = false
  }
}

# Self-signed certificate for HTTPS listener (fallback when no custom domain)
resource "tls_private_key" "alb_self_signed" {
  count     = local.use_custom_domain ? 0 : 1
  algorithm = "RSA"
  rsa_bits  = 2048
}

resource "tls_self_signed_cert" "alb_self_signed" {
  count           = local.use_custom_domain ? 0 : 1
  private_key_pem = tls_private_key.alb_self_signed[0].private_key_pem

  subject {
    common_name  = aws_lb.main.dns_name
    organization = "Plasmic ${var.environment}"
  }

  validity_period_hours = 87600 # 10 years

  allowed_uses = [
    "key_encipherment",
    "digital_signature",
    "server_auth",
  ]
}

resource "aws_acm_certificate" "alb_self_signed" {
  count            = local.use_custom_domain ? 0 : 1
  private_key      = tls_private_key.alb_self_signed[0].private_key_pem
  certificate_body = tls_self_signed_cert.alb_self_signed[0].cert_pem

  lifecycle {
    create_before_destroy = true
  }

  tags = {
    Name = "${local.cluster_name}-alb-cert-self-signed"
  }
}

# HTTPS Listener with default 404 response
# Services will add their own listener rules
resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.main.arn
  port              = "443"
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = local.use_custom_domain ? aws_acm_certificate_validation.alb[0].certificate_arn : aws_acm_certificate.alb_self_signed[0].arn

  default_action {
    type = "fixed-response"

    fixed_response {
      content_type = "text/plain"
      message_body = "Service not found"
      status_code  = "404"
    }
  }
}
