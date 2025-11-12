# S3 bucket for site assets (images, files, etc.)
resource "aws_s3_bucket" "site_assets" {
  bucket = "plasmic-elastic-path-site-assets-${var.environment}"

  tags = {
    Name        = "plasmic-elastic-path-site-assets-${var.environment}"
    Environment = var.environment
  }
}

# Block all public access - only CloudFront can access via OAC
resource "aws_s3_bucket_public_access_block" "site_assets" {
  bucket = aws_s3_bucket.site_assets.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# CORS configuration for web uploads
resource "aws_s3_bucket_cors_configuration" "site_assets" {
  bucket = aws_s3_bucket.site_assets.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "HEAD", "PUT", "POST"]
    allowed_origins = var.allowed_origins
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}

# CloudFront Origin Access Control for secure S3 access
resource "aws_cloudfront_origin_access_control" "site_assets" {
  name                              = "plasmic-site-assets-oac-${var.environment}"
  description                       = "OAC for site assets bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# CloudFront distribution for site assets
resource "aws_cloudfront_distribution" "site_assets" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "Plasmic site assets CDN - ${var.environment}"
  default_root_object = ""
  price_class         = "PriceClass_100" # North America and Europe

  origin {
    domain_name              = aws_s3_bucket.site_assets.bucket_regional_domain_name
    origin_id                = "S3-site-assets"
    origin_access_control_id = aws_cloudfront_origin_access_control.site_assets.id
  }

  default_cache_behavior {
    allowed_methods  = ["GET", "HEAD", "OPTIONS"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "S3-site-assets"

    forwarded_values {
      query_string = false
      headers      = ["Origin", "Access-Control-Request-Headers", "Access-Control-Request-Method"]

      cookies {
        forward = "none"
      }
    }

    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 0
    default_ttl            = 86400   # 1 day
    max_ttl                = 31536000 # 1 year
    compress               = true
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  tags = {
    Name        = "plasmic-site-assets-cdn-${var.environment}"
    Environment = var.environment
  }
}

# Bucket policy - only CloudFront OAC can access
resource "aws_s3_bucket_policy" "site_assets" {
  bucket = aws_s3_bucket.site_assets.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowCloudFrontServicePrincipal"
        Effect = "Allow"
        Principal = {
          Service = "cloudfront.amazonaws.com"
        }
        Action   = "s3:GetObject"
        Resource = "${aws_s3_bucket.site_assets.arn}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.site_assets.arn
          }
        }
      },
      {
        Sid    = "AllowSSLRequestsOnly"
        Effect = "Deny"
        Principal = "*"
        Action = "s3:*"
        Resource = [
          aws_s3_bucket.site_assets.arn,
          "${aws_s3_bucket.site_assets.arn}/*"
        ]
        Condition = {
          Bool = {
            "aws:SecureTransport" = "false"
          }
        }
      }
    ]
  })
}
