#!/bin/bash
# Services deployment script for Plasmic
# Usage: ./deploy-services.sh [environment] [aws-region]
#
# This script deploys all ECS services with terraform apply -auto-approve.
# Services are always auto-deployed without manual approval.

set -e

ENVIRONMENT="${1:-integration}"
AWS_REGION="${2:-us-east-2}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TERRAFORM_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

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
    local backend_config="$3"
    local var_file="$4"
    local extra_flags="$5"

    echo ""
    info "Deploying service: $service_name"
    cd "$TERRAFORM_ROOT/$service_path"

    # Initialize terraform
    terraform init -backend-config="$backend_config" -reconfigure >/dev/null 2>&1

    # Apply with auto-approve
    if terraform apply -var-file="$var_file" -auto-approve $extra_flags; then
        echo "✅ Deployed: $service_name"
    else
        error "Deployment failed for $service_name"
        exit 1
    fi
}

# 1. Deploy WAB Service
step "Step 1: Deploying WAB Service"
deploy_service "wab" "services/wab" \
    "config/${ENVIRONMENT}-backend.tfvars" \
    "config/${ENVIRONMENT}.tfvars" \
    "-lock=false"

# Save WAB URL for summary
cd "$TERRAFORM_ROOT/services/wab"
APP_URL=$(terraform output -raw application_url 2>/dev/null || echo "N/A")
LOG_GROUP=$(terraform output -raw log_group_name 2>/dev/null || echo "N/A")

# 2. Deploy Codegen Service
step "Step 2: Deploying Codegen Service"
deploy_service "codegen" "services/codegen" \
    "config/${ENVIRONMENT}-backend.tfvars" \
    "config/${ENVIRONMENT}.tfvars"

# 3. Deploy Copilot Service - DISABLED for cost savings
# Uncomment to enable
# step "Step 3: Deploying Copilot Service"
# deploy_service "copilot" "services/copilot" \
#     "config/${ENVIRONMENT}-backend.tfvars" \
#     "config/${ENVIRONMENT}.tfvars"
info "Copilot service deployment skipped (disabled for cost savings)"

# 4. Deploy Data Service
step "Step 4: Deploying Data Service"
deploy_service "data" "services/data" \
    "config/${ENVIRONMENT}-backend.tfvars" \
    "config/${ENVIRONMENT}.tfvars"

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
