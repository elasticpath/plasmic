# Target Group
resource "aws_lb_target_group" "service" {
  name        = "plasmic-${var.environment}-${var.service_name}-tg"
  port        = var.container_port
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    enabled             = true
    healthy_threshold   = 2
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 30
    path                = var.health_check_path
    protocol            = "HTTP"
    matcher             = "200"
  }

  deregistration_delay = 30

  tags = {
    Name = "plasmic-${var.environment}-${var.service_name}-tg"
  }
}

# Listener Rule
resource "aws_lb_listener_rule" "service" {
  listener_arn = var.alb_listener_arn
  priority     = var.listener_rule_priority

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.service.arn
  }

  dynamic "condition" {
    for_each = var.host_header != null ? [1] : []
    content {
      host_header {
        values = [var.host_header]
      }
    }
  }

  dynamic "condition" {
    for_each = var.path_pattern != null ? [1] : []
    content {
      path_pattern {
        values = [var.path_pattern]
      }
    }
  }

  tags = {
    Name = "plasmic-${var.environment}-${var.service_name}-rule"
  }
}
