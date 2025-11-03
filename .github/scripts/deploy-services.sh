#!/bin/bash
# Services deployment script for Plasmic
# Usage: ./deploy-services.sh [environment]
#
# This script deploys all ECS services with terraform apply -auto-approve.
# Services are always auto-deployed without manual approval.
#
# Required environment variables:
#   AWS_REGION - AWS region
#   TERRAFORM_STATE_BUCKET - S3 bucket for terraform state
#   TERRAFORM_LOCKS_TABLE - DynamoDB table for state locks
#   TF_VAR_environment - Environment name
#   TF_VAR_aws_region - AWS region for terraform
#   TF_VAR_container_image - Docker image URL (for wab service)
#   TF_VAR_* - Other terraform variables as needed

set -e

ENVIRONMENT="${1:-${TF_VAR_environment:-integration}}"
AWS_REGION="${AWS_REGION:-us-east-2}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TERRAFORM_ROOT="$(cd "$SCRIPT_DIR/../../terraform" && pwd)"

echo "🚀 Deploying Plasmic services to: $ENVIRONMENT"
# Mask region for public repo security
echo "::add-mask::$AWS_REGION"
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

step() {
    echo ""
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}▶ $1${NC}"
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

warn() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

error() {
    echo -e "${RED}❌ $1${NC}"
}

info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

# Function to mask sensitive AWS identifiers in output
mask_sensitive_output() {
    sed -E \
        -e 's/arn:aws:[a-zA-Z0-9_-]+:[a-z0-9-]*:[0-9]{12}:[^ "]+/[ARN-MASKED]/g' \
        -e 's/vpc-[a-f0-9]{8,17}/[VPC-ID]/g' \
        -e 's/subnet-[a-f0-9]{8,17}/[SUBNET-ID]/g' \
        -e 's/sg-[a-f0-9]{8,17}/[SG-ID]/g' \
        -e 's/eni-[a-f0-9]{8,17}/[ENI-ID]/g' \
        -e 's/igw-[a-f0-9]{8,17}/[IGW-ID]/g' \
        -e 's/nat-[a-f0-9]{8,17}/[NAT-ID]/g' \
        -e 's/rtb-[a-f0-9]{8,17}/[RTB-ID]/g' \
        -e 's/i-[a-f0-9]{8,17}/[INSTANCE-ID]/g' \
        -e 's/vol-[a-f0-9]{8,17}/[VOLUME-ID]/g' \
        -e 's/snap-[a-f0-9]{8,17}/[SNAPSHOT-ID]/g' \
        -e 's/ami-[a-f0-9]{8,17}/[AMI-ID]/g' \
        -e 's/eipalloc-[a-f0-9]{8,17}/[EIP-ID]/g' \
        -e 's/[A-Z0-9]{20,}/[ACCESS-KEY]/g' \
        -e 's/[0-9]{12}/[ACCOUNT-ID]/g'
}

# Check prerequisites
step "Step 0: Checking prerequisites"
command -v aws >/dev/null 2>&1 || { error "AWS CLI not found. Install it first."; exit 1; }
command -v terraform >/dev/null 2>&1 || { error "Terraform not found. Install it first."; exit 1; }

aws sts get-caller-identity >/dev/null 2>&1 || { error "AWS credentials not configured."; exit 1; }

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
# Mask account ID for public repo security
echo "::add-mask::$ACCOUNT_ID"
echo "✅ All prerequisites met"

# Function to deploy a service
deploy_service() {
    local service_name="$1"
    local service_path="$2"
    local state_key="$3"
    local extra_flags="$4"

    echo ""
    info "Deploying service: $service_name"
    cd "$TERRAFORM_ROOT/$service_path"

    # Initialize terraform with backend config
    if ! terraform init \
        -backend-config="bucket=${TERRAFORM_STATE_BUCKET}" \
        -backend-config="key=${state_key}" \
        -backend-config="dynamodb_table=${TERRAFORM_LOCKS_TABLE}" \
        -backend-config="region=${AWS_REGION}" \
        -reconfigure 2>&1 | mask_sensitive_output; then
        error "Terraform init failed for $service_name"
        exit 1
    fi

    # Apply with auto-approve (variables come from TF_VAR_* environment variables)
    echo "Applying terraform changes..."
    if terraform apply -auto-approve $extra_flags 2>&1 | mask_sensitive_output; then
        echo "✅ Deployed: $service_name"
    else
        error "Deployment failed for $service_name"
        exit 1
    fi
}

# 1. Deploy WAB Service
step "Step 1: Deploying WAB Service"
deploy_service "wab" "services/wab" \
    "${ENVIRONMENT}/services/wab/terraform.tfstate" \
    "-lock=false"

# 2. Deploy Codegen Service
step "Step 2: Deploying Codegen Service"
deploy_service "codegen" "services/codegen" \
    "${ENVIRONMENT}/services/codegen/terraform.tfstate"

# 3. Deploy Copilot Service - DISABLED for cost savings
# Uncomment to enable
# step "Step 3: Deploying Copilot Service"
# deploy_service "copilot" "services/copilot" \
#     "${ENVIRONMENT}/services/copilot/terraform.tfstate"
info "Copilot service deployment skipped (disabled for cost savings)"

# 4. Deploy Data Service
step "Step 4: Deploying Data Service"
deploy_service "data" "services/data" \
    "${ENVIRONMENT}/services/data/terraform.tfstate"

# Summary
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎉 Services Deployment Complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Environment: $ENVIRONMENT"
echo ""
echo "📊 Deployed Services:"
echo "   ✓ wab"
echo "   ✓ codegen"
echo "   ✓ data"
echo "   ✗ copilot (disabled)"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Wait for services to stabilize
info "Waiting for services to stabilize (this may take 2-3 minutes)..."
aws ecs wait services-stable \
    --cluster plasmic-${ENVIRONMENT} \
    --services plasmic-${ENVIRONMENT}-wab plasmic-${ENVIRONMENT}-codegen plasmic-${ENVIRONMENT}-data \
    --region ${AWS_REGION}

echo ""
echo "✅ All services are stable and healthy!"
echo ""
