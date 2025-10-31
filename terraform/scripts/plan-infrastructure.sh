#!/bin/bash
# Infrastructure planning script for Plasmic
# Usage: ./plan-infrastructure.sh [environment]
#
# This script runs terraform plan for all infrastructure components
# and saves the plans for later manual approval and application.

set -e

ENVIRONMENT="${1:-integration}"
AWS_REGION="${2:-us-east-2}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TERRAFORM_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
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
    local backend_config="$3"
    local var_file="$4"

    echo ""
    info "Planning: $project_name"
    cd "$TERRAFORM_ROOT/$project_path"

    # Initialize terraform
    terraform init -backend-config="$backend_config" -reconfigure >/dev/null 2>&1

    # Run plan and save to file
    local plan_file="$PLANS_DIR/${project_name}.tfplan"
    local plan_output="$PLANS_DIR/${project_name}.txt"

    if terraform plan -var-file="$var_file" -out="$plan_file" | tee "$plan_output"; then
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
    "config/${ENVIRONMENT}-backend.tfvars" \
    "config/${ENVIRONMENT}.tfvars"

# 2. ECR (shared)
step "Step 2: Planning ECR"
plan_project "ecr" "projects/ecr" \
    "config/shared-backend.tfvars" \
    "config/shared.tfvars"

# 3. Secrets
step "Step 3: Planning Secrets"
plan_project "secrets" "projects/secrets" \
    "config/${ENVIRONMENT}-backend.tfvars" \
    "config/${ENVIRONMENT}.tfvars"

# 4. Database
step "Step 4: Planning Database"
plan_project "database" "projects/database" \
    "config/${ENVIRONMENT}-backend.tfvars" \
    "config/${ENVIRONMENT}.tfvars"

# 5. S3 Buckets
step "Step 5: Planning S3 Buckets"

echo "  → Planning site-assets bucket..."
plan_project "s3-site-assets" "projects/s3-site-assets" \
    "config/${ENVIRONMENT}-backend.tfvars" \
    "config/${ENVIRONMENT}.tfvars"

echo "  → Planning clips bucket..."
plan_project "s3-clips" "projects/s3-clips" \
    "config/${ENVIRONMENT}-backend.tfvars" \
    "config/${ENVIRONMENT}.tfvars"

echo "  → Planning assets bucket..."
plan_project "s3-assets" "projects/s3-assets" \
    "config/${ENVIRONMENT}-backend.tfvars" \
    "config/${ENVIRONMENT}.tfvars"

# 6. DynamoDB
step "Step 6: Planning DynamoDB"
plan_project "dynamodb" "projects/dynamodb" \
    "config/${ENVIRONMENT}-backend.tfvars" \
    "config/${ENVIRONMENT}.tfvars"

# 7. Frontend (S3 + CloudFront)
step "Step 7: Planning Frontend Infrastructure"
plan_project "frontend" "projects/frontend" \
    "config/${ENVIRONMENT}-backend.tfvars" \
    "config/${ENVIRONMENT}.tfvars"

# 8. ECS Cluster
step "Step 8: Planning ECS Cluster"
plan_project "ecs-cluster" "projects/ecs-cluster" \
    "config/${ENVIRONMENT}-backend.tfvars" \
    "config/${ENVIRONMENT}.tfvars"

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
