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
echo "Region: $AWS_REGION"
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

# Check prerequisites
step "Step 0: Checking prerequisites"
command -v aws >/dev/null 2>&1 || { error "AWS CLI not found. Install it first."; exit 1; }
command -v terraform >/dev/null 2>&1 || { error "Terraform not found. Install it first."; exit 1; }

aws sts get-caller-identity >/dev/null 2>&1 || { error "AWS credentials not configured."; exit 1; }

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "✅ AWS Account: $ACCOUNT_ID"
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
    terraform init \
        -backend-config="bucket=${TERRAFORM_STATE_BUCKET}" \
        -backend-config="key=${state_key}" \
        -backend-config="dynamodb_table=${TERRAFORM_LOCKS_TABLE}" \
        -backend-config="region=${AWS_REGION}" \
        -reconfigure >/dev/null 2>&1

    # Apply with auto-approve (variables come from TF_VAR_* environment variables)
    if terraform apply -auto-approve $extra_flags; then
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

# Save WAB URL for summary
cd "$TERRAFORM_ROOT/services/wab"
APP_URL=$(terraform output -raw application_url 2>/dev/null || echo "N/A")
LOG_GROUP=$(terraform output -raw log_group_name 2>/dev/null || echo "N/A")

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
echo "Region: $AWS_REGION"
echo ""
echo "📍 Application URL:"
echo "   Backend API: $APP_URL"
echo ""
echo "📊 Deployed Services:"
echo "   ✓ plasmic-${ENVIRONMENT}-wab"
echo "   ✓ plasmic-${ENVIRONMENT}-codegen"
echo "   ✓ plasmic-${ENVIRONMENT}-data"
echo "   ✗ plasmic-${ENVIRONMENT}-copilot (disabled for cost savings)"
echo ""
echo "📝 CloudWatch Logs:"
echo "   aws logs tail $LOG_GROUP --follow --region $AWS_REGION"
echo ""
echo "🔍 Check service status:"
echo "   aws ecs describe-services \\"
echo "     --cluster plasmic-${ENVIRONMENT} \\"
echo "     --services plasmic-${ENVIRONMENT}-wab \\"
echo "     --region $AWS_REGION"
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
echo "✅ All services are stable!"
echo ""

# Test health endpoint
info "Testing health endpoint..."
sleep 10  # Give ALB a moment
if curl -f -s -o /dev/null ${APP_URL}/api/v1/health; then
    echo "✅ Health check passed!"
else
    warn "Health check failed. Check logs:"
    echo "   aws logs tail $LOG_GROUP --follow --region $AWS_REGION"
fi

echo ""
echo "🚀 Services deployment successful!"
