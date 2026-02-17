# S3 bucket for loader error diagnostics
# Bucket name matches the hardcoded name in error-handler.ts
resource "aws_s3_bucket" "errors" {
  bucket = "plasmic-errors"

  tags = {
    Name        = "plasmic-errors"
    Environment = var.environment
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
