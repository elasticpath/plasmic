#!/bin/bash
# Infrastructure apply script for Plasmic
# Usage: ./apply-infrastructure.sh [environment]
#
# This script applies previously saved terraform plans for infrastructure.
# Plans must be generated first using plan-infrastructure.sh
# This script should only be run after manual approval.
#
# Required environment variables:
#   AWS_REGION - AWS region
#   TERRAFORM_STATE_BUCKET - S3 bucket for terraform state
#   TERRAFORM_LOCKS_TABLE - DynamoDB table for state locks

set -e

ENVIRONMENT="${1:-${TF_VAR_environment:-integration}}"
AWS_REGION="${AWS_REGION:-us-east-2}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TERRAFORM_ROOT="$(cd "$SCRIPT_DIR/../../terraform" && pwd)"
PLANS_DIR="${TERRAFORM_ROOT}/plans/${ENVIRONMENT}"

echo "🚀 Applying Plasmic infrastructure for: $ENVIRONMENT"
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

# Check if plans directory exists
if [ ! -d "$PLANS_DIR" ]; then
    error "Plans directory not found: $PLANS_DIR"
    error "Run plan-infrastructure.sh first to generate plans"
    exit 1
fi

# Check prerequisites
step "Step 0: Checking prerequisites"
command -v aws >/dev/null 2>&1 || { error "AWS CLI not found. Install it first."; exit 1; }
command -v terraform >/dev/null 2>&1 || { error "Terraform not found. Install it first."; exit 1; }

aws sts get-caller-identity >/dev/null 2>&1 || { error "AWS credentials not configured."; exit 1; }

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
# Mask account ID for public repo security
echo "::add-mask::$ACCOUNT_ID"
echo "✅ All prerequisites met"

# Function to apply terraform plan for a project
apply_project() {
    local project_name="$1"
    local project_path="$2"
    local state_key="$3"
    local plan_file="$PLANS_DIR/${project_name}.tfplan"

    echo ""
    info "Applying: $project_name"

    if [ ! -f "$plan_file" ]; then
        warn "Plan file not found: $plan_file (skipping)"
        return
    fi

    cd "$TERRAFORM_ROOT/$project_path"

    # Initialize terraform with backend config (must match the init from plan)
    terraform init \
        -backend-config="bucket=${TERRAFORM_STATE_BUCKET}" \
        -backend-config="key=${state_key}" \
        -backend-config="dynamodb_table=${TERRAFORM_LOCKS_TABLE}" \
        -backend-config="region=${AWS_REGION}" \
        -reconfigure >/dev/null 2>&1

    # Apply the saved plan with masked output
    if terraform apply "$plan_file" 2>&1 | mask_sensitive_output; then
        echo "✅ Applied: $project_name"
    else
        error "Apply failed for $project_name"
        exit 1
    fi
}

# 1. VPC
step "Step 1: Applying VPC"
apply_project "vpc" "projects/vpc" \
    "${ENVIRONMENT}/vpc/terraform.tfstate"

# 2. ECR
step "Step 2: Applying ECR"
apply_project "ecr" "projects/ecr" \
    "${ENVIRONMENT}/ecr/terraform.tfstate"

# 3. Secrets
step "Step 3: Applying Secrets"
apply_project "secrets" "projects/secrets" \
    "${ENVIRONMENT}/secrets/terraform.tfstate"

# 4. Database
step "Step 4: Applying Database"
apply_project "database" "projects/database" \
    "${ENVIRONMENT}/database/terraform.tfstate"

# 5. S3 Buckets
step "Step 5: Applying S3 Buckets"

echo "  → Applying site-assets bucket..."
apply_project "s3-site-assets" "projects/s3-site-assets" \
    "${ENVIRONMENT}/s3-site-assets/terraform.tfstate"

echo "  → Applying clips bucket..."
apply_project "s3-clips" "projects/s3-clips" \
    "${ENVIRONMENT}/s3-clips/terraform.tfstate"

echo "  → Applying assets bucket..."
apply_project "s3-assets" "projects/s3-assets" \
    "${ENVIRONMENT}/s3-assets/terraform.tfstate"

# 6. DynamoDB
step "Step 6: Applying DynamoDB"
apply_project "dynamodb" "projects/dynamodb" \
    "${ENVIRONMENT}/dynamodb/terraform.tfstate"

# 7. Frontend (S3 + CloudFront)
step "Step 7: Applying Frontend Infrastructure"
apply_project "frontend" "projects/frontend" \
    "${ENVIRONMENT}/frontend/terraform.tfstate"

# 8. ECS Cluster
step "Step 8: Applying ECS Cluster"
apply_project "ecs-cluster" "projects/ecs-cluster" \
    "${ENVIRONMENT}/ecs-cluster/terraform.tfstate"

# Summary
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎉 Infrastructure Apply Complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Environment: $ENVIRONMENT"
echo ""
echo "✅ All infrastructure components applied successfully"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Clean up old plan files
echo "🧹 Cleaning up plan files..."
rm -rf "$PLANS_DIR"
echo "✅ Cleanup complete"
