# Task Role
resource "aws_iam_role" "task" {
  count = var.create_task_role ? 1 : 0

  name = "plasmic-${var.environment}-${var.service_name}-task-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
    }]
  })

  tags = {
    Name = "plasmic-${var.environment}-${var.service_name}-task-role"
  }
}

# Attach managed policies to task role
resource "aws_iam_role_policy_attachment" "task_policies" {
  count = var.create_task_role ? length(var.task_role_policies) : 0

  role       = aws_iam_role.task[0].name
  policy_arn = var.task_role_policies[count.index]
}

# Attach inline policies to task role
resource "aws_iam_role_policy" "task_inline" {
  count = var.create_task_role ? length(var.task_role_inline_policies) : 0

  name   = var.task_role_inline_policies[count.index].name
  role   = aws_iam_role.task[0].id
  policy = var.task_role_inline_policies[count.index].policy
}
