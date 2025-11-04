#!/bin/bash
# bootstrap-env.sh
# Usage: ./bootstrap-env.sh <environment> [region]
# Example: ./bootstrap-env.sh dev us-east-1

set -euo pipefail

ENVIRONMENT="${1:?Environment required (integration|staging|prod-us|prod-eu)}"
AWS_REGION="${2:-us-east-2}"

# Validate environment
if [[ ! "$ENVIRONMENT" =~ ^(integration|staging|prod-us|prod-eu)$ ]]; then
  echo "❌ Invalid environment. Use: integration, dev, staging, prod-us, or prod-eu"
  exit 1
fi

echo "🚀 Bootstrapping ${ENVIRONMENT} in ${AWS_REGION}"

# Check if resource exists
check_bucket_exists() {
  aws s3 ls "s3://$1" &>/dev/null 2>&1
}

# Create S3 bucket
BUCKET_NAME="plasmic-terraform-state-${ENVIRONMENT}-${AWS_REGION}"
echo "📦 Creating S3 bucket: ${BUCKET_NAME}..."

if check_bucket_exists "${BUCKET_NAME}"; then
  echo "⏭️  Bucket already exists"
else
  aws s3 mb "s3://${BUCKET_NAME}" --region ${AWS_REGION}
  echo "✅ Created bucket"
fi

# Configure bucket (in parallel for speed)
echo "⚙️  Configuring bucket..."

aws s3api put-bucket-versioning \
  --bucket "${BUCKET_NAME}" \
  --versioning-configuration Status=Enabled &
PID_VERSIONING=$!

aws s3api put-bucket-encryption \
  --bucket "${BUCKET_NAME}" \
  --server-side-encryption-configuration '{
    "Rules": [{
      "ApplyServerSideEncryptionByDefault": {
        "SSEAlgorithm": "AES256"
      },
      "BucketKeyEnabled": true
    }]
  }' &
PID_ENCRYPTION=$!

aws s3api put-public-access-block \
  --bucket "${BUCKET_NAME}" \
  --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true &
PID_PUBLIC_BLOCK=$!

wait $PID_VERSIONING $PID_ENCRYPTION $PID_PUBLIC_BLOCK
echo "✅ Bucket configured"

echo ""
echo "🎉 Bootstrap complete for ${ENVIRONMENT}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Environment:  ${ENVIRONMENT}"
echo "  Region:       ${AWS_REGION}"
echo "  State bucket: ${BUCKET_NAME}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"