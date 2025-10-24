#!/bin/bash
# Create a secret in AWS Secrets Manager
# Usage: ./create-secret.sh <environment> <key> <secret-value>

set -e

if [ $# -ne 3 ]; then
    echo "Usage: $0 <environment> <key> <secret-value>"
    echo ""
    echo "Example:"
    echo "  $0 integration openai-api-key sk-proj-xxxxx"
    exit 1
fi

ENVIRONMENT="$1"
KEY="$2"
SECRET_VALUE="$3"
AWS_REGION="${AWS_REGION:-us-east-2}"

# Validate environment
VALID_ENVS="integration staging prod-us prod-eu"
if [[ ! " $VALID_ENVS " =~ " $ENVIRONMENT " ]]; then
    echo "❌ Invalid environment: $ENVIRONMENT"
    echo "Valid environments: integration, staging, prod-us, prod-eu"
    exit 1
fi

# Validate key
VALID_KEYS="openai-api-key anthropic-api-key dynamodb-access-key dynamodb-secret-key app/session-secret app/jwt-secret db/master-password"
if [[ ! " $VALID_KEYS " =~ " $KEY " ]]; then
    echo "❌ Invalid key: $KEY"
    echo "Valid keys:"
    echo "  openai-api-key"
    echo "  anthropic-api-key"
    echo "  dynamodb-access-key"
    echo "  dynamodb-secret-key"
    echo "  app/session-secret"
    echo "  app/jwt-secret"
    echo "  db/master-password"
    exit 1
fi

SECRET_NAME="plasmic/${ENVIRONMENT}/${KEY}"

echo "Creating secret: ${SECRET_NAME}"

# Check if secret exists
if aws secretsmanager describe-secret --secret-id "$SECRET_NAME" --region "$AWS_REGION" &>/dev/null; then
    # Update existing
    aws secretsmanager put-secret-value \
        --secret-id "$SECRET_NAME" \
        --secret-string "$SECRET_VALUE" \
        --region "$AWS_REGION" >/dev/null
    echo "✅ Secret updated"
else
    # Create new
    ARN=$(aws secretsmanager create-secret \
        --name "$SECRET_NAME" \
        --secret-string "$SECRET_VALUE" \
        --region "$AWS_REGION" \
        --output text \
        --query 'ARN')
    echo "✅ Secret created: ${ARN}"
fi