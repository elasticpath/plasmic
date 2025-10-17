# S3 bucket for clipboard data
resource "aws_s3_bucket" "clips" {
  bucket = "plasmic-elastic-path-clips-${var.environment}"

  tags = {
    Name        = "plasmic-elastic-path-clips-${var.environment}"
    Environment = var.environment
  }
}

# Block all public access
resource "aws_s3_bucket_public_access_block" "clips" {
  bucket = aws_s3_bucket.clips.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Bucket policy for SSL-only
resource "aws_s3_bucket_policy" "clips" {
  bucket = aws_s3_bucket.clips.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowSSLRequestsOnly"
        Effect = "Deny"
        Principal = "*"
        Action = "s3:*"
        Resource = [
          aws_s3_bucket.clips.arn,
          "${aws_s3_bucket.clips.arn}/*"
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
