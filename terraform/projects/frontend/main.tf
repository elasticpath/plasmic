# Frontend S3 bucket for hosting React app
resource "aws_s3_bucket" "frontend" {
  bucket = "plasmic-frontend-${var.environment}"

  tags = {
    Name        = "plasmic-frontend-${var.environment}"
    Environment = var.environment
  }
}

resource "aws_s3_bucket_public_access_block" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# CloudFront Origin Access Identity
resource "aws_cloudfront_origin_access_identity" "frontend" {
  comment = "OAI for Plasmic frontend ${var.environment}"
}

# S3 bucket policy to allow CloudFront access
resource "aws_s3_bucket_policy" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowCloudFrontAccess"
        Effect = "Allow"
        Principal = {
          AWS = aws_cloudfront_origin_access_identity.frontend.iam_arn
        }
        Action   = "s3:GetObject"
        Resource = "${aws_s3_bucket.frontend.arn}/*"
      }
    ]
  })
}

# Get ALB DNS from ECS cluster remote state
data "terraform_remote_state" "ecs_cluster" {
  backend = "s3"
  config = {
    bucket = "plasmic-terraform-state-${var.environment}-${var.aws_region}"
    key    = "${var.environment}/ecs-cluster/terraform.tfstate"
    region = var.aws_region
  }
}

locals {
  alb_dns_name          = data.terraform_remote_state.ecs_cluster.outputs.alb_dns_name
  use_custom_domain     = var.hosted_zone_id != null
  use_custom_host       = var.hosted_zone_id_host != null
  frontend_domain       = local.use_custom_domain ? "${var.environment}.${var.parent_domain}" : null
  host_domain           = local.use_custom_host ? "${var.environment}.host.${var.host_parent_domain}" : null
  alb_origin_domain     = local.use_custom_domain ? "alb-${var.environment}.${var.parent_domain}" : local.alb_dns_name
}

# ACM Certificate for CloudFront (must be in us-east-1)
resource "aws_acm_certificate" "cloudfront" {
  count    = local.use_custom_domain ? 1 : 0
  provider = aws.us_east_1

  domain_name       = local.frontend_domain
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = {
    Name        = "plasmic-cloudfront-${var.environment}"
    Environment = var.environment
  }
}

# DNS validation records for ACM certificate
resource "aws_route53_record" "cert_validation" {
  for_each = local.use_custom_domain ? {
    for dvo in aws_acm_certificate.cloudfront[0].domain_validation_options : dvo.domain_name => {
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
resource "aws_acm_certificate_validation" "cloudfront" {
  count                   = local.use_custom_domain ? 1 : 0
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.cloudfront[0].arn
  validation_record_fqdns = [for record in aws_route53_record.cert_validation : record.fqdn]
}

# Response headers policy for CORS and security headers
resource "aws_cloudfront_response_headers_policy" "plasmic_cors" {
  name    = "plasmic-host-cors-policy-${var.environment}"
  comment = "CORS and security headers policy for Plasmic ${var.environment}"

  cors_config {
    access_control_allow_credentials = false

    access_control_allow_headers {
      items = ["*"]
    }

    access_control_allow_methods {
      items = ["ALL"]
    }

    access_control_allow_origins {
      items = ["*"]
    }

    access_control_max_age_sec = 86400
    origin_override            = true
  }

  security_headers_config {
    content_type_options {
      override = true
    }

    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = false
      preload                    = false
      override                   = true
    }
  }
}

# CloudFront distribution for frontend
resource "aws_cloudfront_distribution" "frontend" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "Plasmic frontend ${var.environment}"
  default_root_object = "index.html"
  price_class         = "PriceClass_100"

  # S3 origin for static frontend assets
  origin {
    domain_name = aws_s3_bucket.frontend.bucket_regional_domain_name
    origin_id   = "S3-plasmic-frontend"

    s3_origin_config {
      origin_access_identity = aws_cloudfront_origin_access_identity.frontend.cloudfront_access_identity_path
    }
  }

  # ALB origin for backend API
  origin {
    domain_name = local.alb_origin_domain
    origin_id   = "ALB-plasmic-backend"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  # Default behavior - serve static files from S3
  default_cache_behavior {
    allowed_methods  = ["GET", "HEAD", "OPTIONS"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "S3-plasmic-frontend"

    cache_policy_id            = "658327ea-f89d-4fab-a63d-7e88639e58f6"  # Managed-CachingOptimized
    origin_request_policy_id   = "88a5eaf4-2fd4-4709-b370-b4c650ea3fcf"  # Managed-CORS-S3Origin
    response_headers_policy_id = aws_cloudfront_response_headers_policy.plasmic_cors.id

    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 0
    default_ttl            = 0
    max_ttl                = 0
    compress               = true
  }

  # API routes - forward to backend ALB (no caching)
  ordered_cache_behavior {
    path_pattern     = "/api/*"
    allowed_methods  = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "ALB-plasmic-backend"

    cache_policy_id          = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"  # Managed-CachingDisabled
    origin_request_policy_id = "33f36d7e-f396-46d9-90e0-52428a34d9dc"  # Managed-AllViewerAndCloudFrontHeaders-2022-06

    viewer_protocol_policy = "redirect-to-https"
    compress               = false
  }
  # Custom domain aliases (only if custom domain is configured)
  aliases = local.use_custom_domain ? [local.frontend_domain] : []

  # Custom error responses for SPA routing
  # When user navigates to /projects, S3 returns 403/404, so redirect to index.html
  custom_error_response {
    error_code         = 403
    response_code      = 200
    response_page_path = "/index.html"
  }

  custom_error_response {
    error_code         = 404
    response_code      = 200
    response_page_path = "/index.html"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = !local.use_custom_domain
    acm_certificate_arn            = local.use_custom_domain ? aws_acm_certificate_validation.cloudfront[0].certificate_arn : null
    ssl_support_method             = local.use_custom_domain ? "sni-only" : null
    minimum_protocol_version       = local.use_custom_domain ? "TLSv1.2_2021" : null
  }

  tags = {
    Name        = "plasmic-frontend-${var.environment}"
    Environment = var.environment
  }
}

# Route53 alias record for CloudFront distribution
resource "aws_route53_record" "frontend" {
  count   = local.use_custom_domain ? 1 : 0
  zone_id = var.hosted_zone_id
  name    = local.frontend_domain
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.frontend.domain_name
    zone_id                = aws_cloudfront_distribution.frontend.hosted_zone_id
    evaluate_target_health = false
  }
}

# Host S3 bucket for host.html and static files
resource "aws_s3_bucket" "host" {
  bucket = "plasmic-host-static-${var.environment}"

  tags = {
    Name        = "plasmic-host-static-${var.environment}"
    Environment = var.environment
  }
}

resource "aws_s3_bucket_public_access_block" "host" {
  bucket = aws_s3_bucket.host.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# CloudFront Origin Access Identity for host
resource "aws_cloudfront_origin_access_identity" "host" {
  comment = "OAI for Plasmic host static ${var.environment}"
}

# S3 bucket policy for host
resource "aws_s3_bucket_policy" "host" {
  bucket = aws_s3_bucket.host.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowCloudFrontAccess"
        Effect = "Allow"
        Principal = {
          AWS = aws_cloudfront_origin_access_identity.host.iam_arn
        }
        Action   = "s3:GetObject"
        Resource = "${aws_s3_bucket.host.arn}/*"
      }
    ]
  })
}

# ACM Certificate for Host CloudFront (must be in us-east-1)
resource "aws_acm_certificate" "host" {
  count    = local.use_custom_host ? 1 : 0
  provider = aws.us_east_1

  domain_name       = local.host_domain
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = {
    Name        = "plasmic-host-cloudfront-${var.environment}"
    Environment = var.environment
  }
}

# DNS validation records for Host ACM certificate
resource "aws_route53_record" "host_cert_validation" {
  for_each = local.use_custom_host ? {
    for dvo in aws_acm_certificate.host[0].domain_validation_options : dvo.domain_name => {
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
  zone_id         = var.hosted_zone_id_host
}

# Wait for Host certificate validation to complete
resource "aws_acm_certificate_validation" "host" {
  count                   = local.use_custom_host ? 1 : 0
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.host[0].arn
  validation_record_fqdns = [for record in aws_route53_record.host_cert_validation : record.fqdn]
}

# CloudFront distribution for host files
resource "aws_cloudfront_distribution" "host" {
  enabled         = true
  is_ipv6_enabled = true
  comment         = "Plasmic host static ${var.environment}"
  price_class     = "PriceClass_100"

  # Custom domain aliases (only if custom domain is configured)
  aliases = local.use_custom_host ? [local.host_domain] : []

  origin {
    domain_name = aws_s3_bucket.host.bucket_regional_domain_name
    origin_id   = "S3-plasmic-host"

    s3_origin_config {
      origin_access_identity = aws_cloudfront_origin_access_identity.host.cloudfront_access_identity_path
    }
  }

  default_cache_behavior {
    allowed_methods  = ["GET", "HEAD", "OPTIONS"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "S3-plasmic-host"

    cache_policy_id            = "658327ea-f89d-4fab-a63d-7e88639e58f6"  # Managed-CachingOptimized
    response_headers_policy_id = aws_cloudfront_response_headers_policy.plasmic_cors.id

    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 0
    default_ttl            = 0
    max_ttl                = 0
    compress               = true
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = !local.use_custom_host
    acm_certificate_arn            = local.use_custom_host ? aws_acm_certificate_validation.host[0].certificate_arn : null
    ssl_support_method             = local.use_custom_host ? "sni-only" : null
    minimum_protocol_version       = local.use_custom_host ? "TLSv1.2_2021" : null
  }

  tags = {
    Name        = "plasmic-host-static-${var.environment}"
    Environment = var.environment
  }
}

# Route53 alias record for Host CloudFront distribution
resource "aws_route53_record" "host" {
  count   = local.use_custom_host ? 1 : 0
  zone_id = var.hosted_zone_id_host
  name    = local.host_domain
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.host.domain_name
    zone_id                = aws_cloudfront_distribution.host.hosted_zone_id
    evaluate_target_health = false
  }
}

# ============================================================================
# Codegen CloudFront Distribution
# ============================================================================

locals {
  use_codegen_domain = var.hosted_zone_id != null
  codegen_domain     = local.use_codegen_domain ? "codegen.${var.environment}.${var.parent_domain}" : null
}

# ACM Certificate for Codegen CloudFront (must be in us-east-1)
resource "aws_acm_certificate" "codegen" {
  count    = local.use_codegen_domain ? 1 : 0
  provider = aws.us_east_1

  domain_name       = local.codegen_domain
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = {
    Name        = "plasmic-codegen-cloudfront-${var.environment}"
    Environment = var.environment
  }
}

# DNS validation records for Codegen ACM certificate
resource "aws_route53_record" "codegen_cert_validation" {
  for_each = local.use_codegen_domain ? {
    for dvo in aws_acm_certificate.codegen[0].domain_validation_options : dvo.domain_name => {
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

# Wait for Codegen certificate validation to complete
resource "aws_acm_certificate_validation" "codegen" {
  count                   = local.use_codegen_domain ? 1 : 0
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.codegen[0].arn
  validation_record_fqdns = [for record in aws_route53_record.codegen_cert_validation : record.fqdn]
}

# Response headers policy for Codegen CORS
resource "aws_cloudfront_response_headers_policy" "codegen_cors" {
  name    = "plasmic-codegen-cors-policy-${var.environment}"
  comment = "CORS policy for Plasmic codegen ${var.environment}"

  cors_config {
    access_control_allow_credentials = false

    access_control_allow_headers {
      items = ["*"]
    }

    access_control_allow_methods {
      items = ["GET", "HEAD", "OPTIONS", "POST"]
    }

    access_control_allow_origins {
      items = ["*"]
    }

    access_control_max_age_sec = 86400
    origin_override            = true
  }
}

# CloudFront distribution for codegen
resource "aws_cloudfront_distribution" "codegen" {
  enabled         = true
  is_ipv6_enabled = true
  comment         = "Plasmic codegen API ${var.environment}"
  price_class     = "PriceClass_100"

  # Custom domain alias
  aliases = local.use_codegen_domain ? [local.codegen_domain] : []

  # ALB origin
  origin {
    domain_name = local.alb_dns_name
    origin_id   = "ALB-codegen"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }

    # Forward the codegen Host header to ALB for proper routing
    custom_header {
      name  = "X-Forwarded-Host"
      value = local.codegen_domain
    }
  }

  default_cache_behavior {
    allowed_methods  = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "ALB-codegen"

    # Use CachingDisabled policy for API requests
    cache_policy_id = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad" # Managed-CachingDisabled

    # Forward all headers, query strings, and cookies to origin
    origin_request_policy_id = "216adef6-5c7f-47e4-b989-5492eafa07d3" # Managed-AllViewer

    response_headers_policy_id = aws_cloudfront_response_headers_policy.codegen_cors.id

    viewer_protocol_policy = "redirect-to-https"
    compress               = false
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = !local.use_codegen_domain
    acm_certificate_arn            = local.use_codegen_domain ? aws_acm_certificate_validation.codegen[0].certificate_arn : null
    ssl_support_method             = local.use_codegen_domain ? "sni-only" : null
    minimum_protocol_version       = local.use_codegen_domain ? "TLSv1.2_2021" : null
  }

  tags = {
    Name        = "plasmic-codegen-cdn-${var.environment}"
    Environment = var.environment
  }
}

# Route53 alias record for Codegen CloudFront distribution
resource "aws_route53_record" "codegen" {
  count   = local.use_codegen_domain ? 1 : 0
  zone_id = var.hosted_zone_id
  name    = local.codegen_domain
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.codegen.domain_name
    zone_id                = aws_cloudfront_distribution.codegen.hosted_zone_id
    evaluate_target_health = false
  }
}