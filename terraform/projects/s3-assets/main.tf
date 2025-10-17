# S3 bucket for loader assets
resource "aws_s3_bucket" "loader_assets" {
  bucket = "plasmic-elastic-path-loader-assets-${var.environment}"

  tags = {
    Name        = "plasmic-elastic-path-loader-assets-${var.environment}"
    Environment = var.environment
  }
}

# Block public access
resource "aws_s3_bucket_public_access_block" "loader_assets" {
  bucket = aws_s3_bucket.loader_assets.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# CORS configuration for web access
resource "aws_s3_bucket_cors_configuration" "loader_assets" {
  bucket = aws_s3_bucket.loader_assets.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "HEAD"]
    allowed_origins = var.allowed_origins
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}

# Bucket policy for SSL-only
resource "aws_s3_bucket_policy" "loader_assets" {
  bucket = aws_s3_bucket.loader_assets.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowSSLRequestsOnly"
        Effect = "Deny"
        Principal = "*"
        Action = "s3:*"
        Resource = [
          aws_s3_bucket.loader_assets.arn,
          "${aws_s3_bucket.loader_assets.arn}/*"
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
