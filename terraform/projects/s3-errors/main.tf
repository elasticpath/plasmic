# S3 bucket for loader error diagnostics
resource "aws_s3_bucket" "errors" {
  bucket = "plasmic-errors-${var.environment}"

  tags = {
    Name        = "plasmic-errors-${var.environment}"
    Environment = var.environment
  }
}

# Expire error files after 30 days
resource "aws_s3_bucket_lifecycle_configuration" "errors" {
  bucket = aws_s3_bucket.errors.id

  rule {
    id     = "expire-bundling-errors"
    status = "Enabled"

    filter {
      prefix = "bundling-errors/"
    }

    expiration {
      days = 30
    }
  }
}

# Block all public access
resource "aws_s3_bucket_public_access_block" "errors" {
  bucket = aws_s3_bucket.errors.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Bucket policy for SSL-only
resource "aws_s3_bucket_policy" "errors" {
  bucket = aws_s3_bucket.errors.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowSSLRequestsOnly"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource = [
          aws_s3_bucket.errors.arn,
          "${aws_s3_bucket.errors.arn}/*"
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
