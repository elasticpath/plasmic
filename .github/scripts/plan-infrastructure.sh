#!/bin/bash
# Infrastructure planning script for Plasmic
# Usage: ./plan-infrastructure.sh [environment]
#
# This script runs terraform plan for all infrastructure components
# and saves the plans for later manual approval and application.
#
# Required environment variables:
#   AWS_REGION - AWS region
#   TERRAFORM_STATE_BUCKET - S3 bucket for terraform state
#   TERRAFORM_LOCKS_TABLE - DynamoDB table for state locks
#   TF_VAR_* - All terraform variables as needed

set -e

ENVIRONMENT="${1:-${TF_VAR_environment:-integration}}"
AWS_REGION="${AWS_REGION:-us-east-2}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TERRAFORM_ROOT="$(cd "$SCRIPT_DIR/../../terraform" && pwd)"
PLANS_DIR="${TERRAFORM_ROOT}/plans/${ENVIRONMENT}"

echo "📋 Planning Plasmic infrastructure for: $ENVIRONMENT"
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

# Create plans directory
mkdir -p "$PLANS_DIR"

# Check prerequisites
step "Step 0: Checking prerequisites"
command -v aws >/dev/null 2>&1 || { error "AWS CLI not found. Install it first."; exit 1; }
command -v terraform >/dev/null 2>&1 || { error "Terraform not found. Install it first."; exit 1; }

aws sts get-caller-identity >/dev/null 2>&1 || { error "AWS credentials not configured."; exit 1; }

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "✅ AWS Account: $ACCOUNT_ID"
echo "✅ All prerequisites met"

# Track if any plans have changes
HAS_CHANGES=false
PLAN_SUMMARY=""

# Function to run terraform plan for a project
plan_project() {
    local project_name="$1"
    local project_path="$2"
    local state_key="$3"

    echo ""
    info "Planning: $project_name"
    cd "$TERRAFORM_ROOT/$project_path"

    # Initialize terraform with backend config
    terraform init \
        -backend-config="bucket=${TERRAFORM_STATE_BUCKET}" \
        -backend-config="key=${state_key}" \
        -backend-config="dynamodb_table=${TERRAFORM_LOCKS_TABLE}" \
        -backend-config="region=${AWS_REGION}" \
        -reconfigure >/dev/null 2>&1

    # Run plan and save to file (variables come from TF_VAR_* environment variables)
    local plan_file="$PLANS_DIR/${project_name}.tfplan"
    local plan_output="$PLANS_DIR/${project_name}.txt"

    if terraform plan -out="$plan_file" | tee "$plan_output"; then
        echo "✅ Plan saved: $plan_file"

        # Check if plan has changes
        if grep -q "No changes" "$plan_output"; then
            PLAN_SUMMARY="${PLAN_SUMMARY}\n  ✓ ${project_name}: No changes"
        else
            PLAN_SUMMARY="${PLAN_SUMMARY}\n  ⚡ ${project_name}: Has changes"
            HAS_CHANGES=true
        fi
    else
        error "Plan failed for $project_name"
        exit 1
    fi
}

# 1. VPC
step "Step 1: Planning VPC"
plan_project "vpc" "projects/vpc" \
    "${ENVIRONMENT}/vpc/terraform.tfstate"

# 2. ECR (shared)
step "Step 2: Planning ECR"
plan_project "ecr" "projects/ecr" \
    "shared/ecr/terraform.tfstate"

# 3. Secrets
step "Step 3: Planning Secrets"
plan_project "secrets" "projects/secrets" \
    "${ENVIRONMENT}/secrets/terraform.tfstate"

# 4. Database
step "Step 4: Planning Database"
plan_project "database" "projects/database" \
    "${ENVIRONMENT}/database/terraform.tfstate"

# 5. S3 Buckets
step "Step 5: Planning S3 Buckets"

echo "  → Planning site-assets bucket..."
plan_project "s3-site-assets" "projects/s3-site-assets" \
    "${ENVIRONMENT}/s3-site-assets/terraform.tfstate"

echo "  → Planning clips bucket..."
plan_project "s3-clips" "projects/s3-clips" \
    "${ENVIRONMENT}/s3-clips/terraform.tfstate"

echo "  → Planning assets bucket..."
plan_project "s3-assets" "projects/s3-assets" \
    "${ENVIRONMENT}/s3-assets/terraform.tfstate"

# 6. DynamoDB
step "Step 6: Planning DynamoDB"
plan_project "dynamodb" "projects/dynamodb" \
    "${ENVIRONMENT}/dynamodb/terraform.tfstate"

# 7. Frontend (S3 + CloudFront)
step "Step 7: Planning Frontend Infrastructure"
plan_project "frontend" "projects/frontend" \
    "${ENVIRONMENT}/frontend/terraform.tfstate"

# 8. ECS Cluster
step "Step 8: Planning ECS Cluster"
plan_project "ecs-cluster" "projects/ecs-cluster" \
    "${ENVIRONMENT}/ecs-cluster/terraform.tfstate"

# Summary
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📋 Planning Complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Environment: $ENVIRONMENT"
echo "Region: $AWS_REGION"
echo ""
echo "📊 Plan Summary:"
echo -e "$PLAN_SUMMARY"
echo ""
echo "📁 Plans saved to: $PLANS_DIR"
echo ""

if [ "$HAS_CHANGES" = true ]; then
    warn "Infrastructure changes detected!"
    echo ""
    echo "To apply these changes, run:"
    echo "  ./scripts/apply-infrastructure.sh $ENVIRONMENT"
    echo ""
    exit 1  # Exit with error code for CI to catch
else
    echo "✅ No infrastructure changes needed"
    echo ""
fi
