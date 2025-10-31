#!/bin/bash
# create-secrets.sh
# Usage: ./create-secrets.sh <environment> [region]
# Example: ./create-secrets.sh dev us-east-1

set -euo pipefail

ENVIRONMENT="${1:?Environment required (integration|staging|prod-us|prod-eu)}"
AWS_REGION="${2:-us-east-1}"

# Validate environment
if [[ ! "$ENVIRONMENT" =~ ^(integration|staging|prod-us|prod-eu)$ ]]; then
  echo "❌ Invalid environment. Use: integration, staging, prod-us, or prod-eu"
  exit 1
fi


echo "🔐 Creating secrets for ${ENVIRONMENT} in ${AWS_REGION}"

# Create secret only if it doesn't exist (never updates existing secrets)
create_secret_if_not_exists() {
  local name=$1
  local description=$2
  local value=$3

  if aws secretsmanager describe-secret --secret-id "${name}" --region ${AWS_REGION} &>/dev/null; then
    echo "⏭️  ${name} already exists, skipping"
    aws secretsmanager get-secret-value --secret-id "${name}" --region ${AWS_REGION} --query 'ARN' --output text
  else
    echo "📝 Creating ${name}"
    aws secretsmanager create-secret \
      --name "${name}" \
      --description "${description}" \
      --secret-string "${value}" \
      --region ${AWS_REGION} \
      --query 'ARN' \
      --output text
  fi
}

# Generate secrets
echo "🎲 Generating secrets..."
DB_MASTER_PASSWORD=$(openssl rand -base64 64 | tr -dc 'a-zA-Z0-9' | head -c 64)
DB_APP_PASSWORD=$(openssl rand -base64 64 | tr -dc 'a-zA-Z0-9' | head -c 64)
SESSION_SECRET=$(openssl rand -base64 64 | tr -dc 'a-zA-Z0-9' | head -c 64)
JWT_SECRET=$(openssl rand -base64 64 | tr -dc 'a-zA-Z0-9' | head -c 64)

# Create secrets in parallel (only creates, never updates)
echo "📦 Storing in AWS Secrets Manager..."

create_secret_if_not_exists \
  "plasmic/${ENVIRONMENT}/db/master-password" \
  "RDS master password for Plasmic ${ENVIRONMENT}" \
  "${DB_MASTER_PASSWORD}" &
PID_DB_MASTER=$!

create_secret_if_not_exists \
  "plasmic/${ENVIRONMENT}/app/session-secret" \
  "Session encryption key for Plasmic ${ENVIRONMENT}" \
  "${SESSION_SECRET}" &
PID_SESSION=$!

create_secret_if_not_exists \
  "plasmic/${ENVIRONMENT}/app/jwt-secret" \
  "JWT signing key for Plasmic ${ENVIRONMENT}" \
  "${JWT_SECRET}" &
PID_JWT=$!

wait $PID_DB_MASTER $PID_DB_APP $PID_SESSION $PID_JWT

echo ""
echo "🎉 Secrets created for ${ENVIRONMENT}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Secret ARNs:"

aws secretsmanager list-secrets \
  --region ${AWS_REGION} \
  --query "SecretList[?starts_with(Name, 'plasmic/${ENVIRONMENT}/')].{Name: Name, ARN: ARN}" \
  --output table

echo ""
echo "💡 Use these ARN values in your Terraform tfvars files"