#!/bin/bash
# Infrastructure apply script for Plasmic
# Usage: ./apply-infrastructure.sh [environment]
#
# This script applies previously saved terraform plans for infrastructure.
# Plans must be generated first using plan-infrastructure.sh
# This script should only be run after manual approval.

set -e

ENVIRONMENT="${1:-integration}"
AWS_REGION="${2:-us-east-2}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TERRAFORM_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PLANS_DIR="${TERRAFORM_ROOT}/plans/${ENVIRONMENT}"

echo "🚀 Applying Plasmic infrastructure for: $ENVIRONMENT"
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
echo "✅ AWS Account: $ACCOUNT_ID"
echo "✅ All prerequisites met"

# Function to apply terraform plan for a project
apply_project() {
    local project_name="$1"
    local project_path="$2"
    local backend_config="$3"
    local plan_file="$PLANS_DIR/${project_name}.tfplan"

    echo ""
    info "Applying: $project_name"

    if [ ! -f "$plan_file" ]; then
        warn "Plan file not found: $plan_file (skipping)"
        return
    fi

    cd "$TERRAFORM_ROOT/$project_path"

    # Initialize terraform (must match the init from plan)
    terraform init -backend-config="$backend_config" -reconfigure >/dev/null 2>&1

    # Apply the saved plan
    if terraform apply "$plan_file"; then
        echo "✅ Applied: $project_name"
    else
        error "Apply failed for $project_name"
        exit 1
    fi
}

# 1. VPC
step "Step 1: Applying VPC"
apply_project "vpc" "projects/vpc" "config/${ENVIRONMENT}-backend.tfvars"

# 2. ECR (shared)
step "Step 2: Applying ECR"
apply_project "ecr" "projects/ecr" "config/shared-backend.tfvars"

# 3. Secrets
step "Step 3: Applying Secrets"
apply_project "secrets" "projects/secrets" "config/${ENVIRONMENT}-backend.tfvars"

# 4. Database
step "Step 4: Applying Database"
apply_project "database" "projects/database" "config/${ENVIRONMENT}-backend.tfvars"

# Save database endpoint for summary
cd "$TERRAFORM_ROOT/projects/database"
DB_ENDPOINT=$(terraform output -raw db_endpoint 2>/dev/null || echo "N/A")

# 5. S3 Buckets
step "Step 5: Applying S3 Buckets"

echo "  → Applying site-assets bucket..."
apply_project "s3-site-assets" "projects/s3-site-assets" "config/${ENVIRONMENT}-backend.tfvars"

echo "  → Applying clips bucket..."
apply_project "s3-clips" "projects/s3-clips" "config/${ENVIRONMENT}-backend.tfvars"

echo "  → Applying assets bucket..."
apply_project "s3-assets" "projects/s3-assets" "config/${ENVIRONMENT}-backend.tfvars"

# 6. DynamoDB
step "Step 6: Applying DynamoDB"
apply_project "dynamodb" "projects/dynamodb" "config/${ENVIRONMENT}-backend.tfvars"

# 7. Frontend (S3 + CloudFront)
step "Step 7: Applying Frontend Infrastructure"
apply_project "frontend" "projects/frontend" "config/${ENVIRONMENT}-backend.tfvars"

# Save frontend URLs for summary
cd "$TERRAFORM_ROOT/projects/frontend"
FRONTEND_URL=$(terraform output -raw frontend_url 2>/dev/null || echo "N/A")
HOST_URL=$(terraform output -raw host_url 2>/dev/null || echo "N/A")
FRONTEND_CF_ID=$(terraform output -raw frontend_cloudfront_distribution_id 2>/dev/null || echo "N/A")
HOST_CF_ID=$(terraform output -raw host_cloudfront_distribution_id 2>/dev/null || echo "N/A")

# 8. ECS Cluster
step "Step 8: Applying ECS Cluster"
apply_project "ecs-cluster" "projects/ecs-cluster" "config/${ENVIRONMENT}-backend.tfvars"

# Summary
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎉 Infrastructure Apply Complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Environment: $ENVIRONMENT"
echo "Region: $AWS_REGION"
echo ""
echo "📍 URLs:"
echo "   Frontend: $FRONTEND_URL"
echo "   Host URL: $HOST_URL"
echo ""
echo "📊 Resources:"
echo "   VPC: plasmic-${ENVIRONMENT}"
echo "   Database: $DB_ENDPOINT"
echo "   ECS Cluster: plasmic-${ENVIRONMENT}"
echo ""
echo "📝 CloudFront Distributions:"
echo "   Frontend CF ID: $FRONTEND_CF_ID"
echo "   Host CF ID: $HOST_CF_ID"
echo ""
echo "🔄 Next steps:"
echo "   1. Services can be deployed using: ./scripts/deploy-services.sh $ENVIRONMENT"
echo "   2. Frontend can be deployed using: ./scripts/deploy-frontend.sh $ENVIRONMENT"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Clean up old plan files
echo "🧹 Cleaning up plan files..."
rm -rf "$PLANS_DIR"
echo "✅ Cleanup complete"
