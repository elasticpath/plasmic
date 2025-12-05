# ALB deny rules for internal endpoints
# These endpoints should only be accessible via Service Connect, not public ALB

resource "aws_lb_listener_rule" "deny_broadcast" {
  listener_arn = local.alb_listener_arn
  priority     = 140 # Higher priority than socket WebSocket rule (150)

  action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "Forbidden - Internal endpoint not accessible via public ALB"
      status_code  = "403"
    }
  }

  condition {
    path_pattern {
      values = ["/api/v1/projects/broadcast"]
    }
  }

  tags = {
    Name = "socket-deny-broadcast-${var.environment}"
  }
}

resource "aws_lb_listener_rule" "deny_disconnect" {
  listener_arn = local.alb_listener_arn
  priority     = 141 # Higher priority than socket WebSocket rule (150)

  action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "Forbidden - Internal endpoint not accessible via public ALB"
      status_code  = "403"
    }
  }

  condition {
    path_pattern {
      values = ["/api/v1/disconnect"]
    }
  }

  tags = {
    Name = "socket-deny-disconnect-${var.environment}"
  }
}

resource "aws_lb_listener_rule" "deny_cli_emit_token" {
  listener_arn = local.alb_listener_arn
  priority     = 142 # Higher priority than socket WebSocket rule (150)

  action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "Forbidden - Internal endpoint not accessible via public ALB"
      status_code  = "403"
    }
  }

  condition {
    path_pattern {
      values = ["/api/v1/cli/emit-token"]
    }
  }

  tags = {
    Name = "socket-deny-cli-emit-token-${var.environment}"
  }
}