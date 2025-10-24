output "bucket_name" {
  description = "Name of the S3 bucket"
  value       = aws_s3_bucket.site_assets.id
}

output "bucket_arn" {
  description = "ARN of the S3 bucket"
  value       = aws_s3_bucket.site_assets.arn
}

output "bucket_regional_domain_name" {
  description = "Regional domain name of the S3 bucket"
  value       = aws_s3_bucket.site_assets.bucket_regional_domain_name
}
