output "frontend_bucket_name" {
  description = "Frontend S3 bucket name"
  value       = aws_s3_bucket.frontend.id
}

output "frontend_cloudfront_distribution_id" {
  description = "Frontend CloudFront distribution ID"
  value       = aws_cloudfront_distribution.frontend.id
}

output "frontend_url" {
  description = "Frontend URL"
  value       = local.use_custom_domain ? "https://${local.frontend_domain}" : "https://${aws_cloudfront_distribution.frontend.domain_name}"
}

output "host_bucket_name" {
  description = "Host static files S3 bucket name"
  value       = aws_s3_bucket.host.id
}

output "host_cloudfront_distribution_id" {
  description = "Host CloudFront distribution ID"
  value       = aws_cloudfront_distribution.host.id
}

output "host_url" {
  description = "Host static files URL"
  value       = local.use_custom_host ? "https://${local.host_domain}/static/host.html" : "https://${aws_cloudfront_distribution.host.domain_name}/static/host.html"
}