# DynamoDB table for copilot data
resource "aws_dynamodb_table" "copilot_data" {
  name         = "plasmic-${var.environment}-copilot-data"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }

  point_in_time_recovery {
    enabled = var.enable_point_in_time_recovery
  }

  tags = {
    Name        = "plasmic-${var.environment}-copilot-data"
    Environment = var.environment
  }
}
