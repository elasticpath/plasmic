output "application_url" {
  description = "Application URL"
  value       = "http://${data.terraform_remote_state.ecs_cluster.outputs.alb_dns_name}"
}
