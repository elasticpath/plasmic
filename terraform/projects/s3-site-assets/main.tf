# S3 bucket for site assets (images, files, etc.)
resource "aws_s3_bucket" "site_assets" {
  bucket = "plasmic-elastic-path-site-assets-${var.environment}"

  tags = {
    Name        = "plasmic-elastic-path-site-assets-${var.environment}"
    Environment = var.environment
  }
}

# Public access configuration - allow public read for CDN/CloudFront
resource "aws_s3_bucket_public_access_block" "site_assets" {
  bucket = aws_s3_bucket.site_assets.id

  block_public_acls       = false
  block_public_policy     = false
  ignore_public_acls      = false
  restrict_public_buckets = false
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

# Bucket policy for public read and SSL-only
resource "aws_s3_bucket_policy" "site_assets" {
  bucket = aws_s3_bucket.site_assets.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "PublicReadGetObject"
        Effect    = "Allow"
        Principal = "*"
        Action    = "s3:GetObject"
        Resource  = "${aws_s3_bucket.site_assets.arn}/*"
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
