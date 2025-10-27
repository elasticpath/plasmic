#!/bin/bash
# Master deployment script for Plasmic infrastructure
# Usage: ./deploy-all.sh [environment]

set -e

ENVIRONMENT="${1:-integration}"
AWS_REGION="${2:-us-east-2}"

echo "🚀 Deploying Plasmic infrastructure to: $ENVIRONMENT"
echo "Region: $AWS_REGION"
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
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

# Check prerequisites
step "Step 0: Checking prerequisites"
command -v aws >/dev/null 2>&1 || { echo "AWS CLI not found. Install it first."; exit 1; }
command -v terraform >/dev/null 2>&1 || { echo "Terraform not found. Install it first."; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "Docker not found. Install it first."; exit 1; }

aws sts get-caller-identity >/dev/null 2>&1 || { echo "AWS credentials not configured."; exit 1; }

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "✅ AWS Account: $ACCOUNT_ID"
echo "✅ All prerequisites met"

# 1. VPC
step "Step 1: Deploying VPC"
cd projects/vpc
terraform init -backend-config=config/${ENVIRONMENT}-backend.tfvars -reconfigure
terraform apply -var-file=config/${ENVIRONMENT}.tfvars -auto-approve
echo "✅ VPC deployed"

# 2. ECR (shared)
step "Step 2: Deploying ECR"
cd ../ecr
terraform init -backend-config=config/shared-backend.tfvars -reconfigure
terraform apply -var-file=config/shared.tfvars -auto-approve
echo "✅ ECR deployed"

# Save ECR repo URL
ECR_REPO=$(terraform output -raw repository_url)
echo "ECR Repository: $ECR_REPO"

# 3. Secrets
step "Step 3: Deploying Secrets"
cd ../secrets
terraform init -backend-config=config/${ENVIRONMENT}-backend.tfvars -reconfigure
terraform apply -var-file=config/${ENVIRONMENT}.tfvars -auto-approve
echo "✅ Secrets deployed"

# 4. Database
step "Step 4: Deploying Database"
cd ../database
terraform init -backend-config=config/${ENVIRONMENT}-backend.tfvars -reconfigure
terraform apply -var-file=config/${ENVIRONMENT}.tfvars -auto-approve
echo "✅ Database deployed"

DB_ENDPOINT=$(terraform output -raw db_endpoint)
echo "Database endpoint: $DB_ENDPOINT"

# 5. S3 Buckets
step "Step 5: Deploying S3 Buckets"

# 5a. Site Assets
echo "  → Deploying site-assets bucket..."
cd ../s3-site-assets
terraform init -backend-config=config/${ENVIRONMENT}-backend.tfvars -reconfigure
terraform apply -var-file=config/${ENVIRONMENT}.tfvars -auto-approve

# 5b. Clips
echo "  → Deploying clips bucket..."
cd ../s3-clips
terraform init -backend-config=config/${ENVIRONMENT}-backend.tfvars -reconfigure
terraform apply -var-file=config/${ENVIRONMENT}.tfvars -auto-approve

# 5c. Assets
echo "  → Deploying assets bucket..."
cd ../s3-assets
terraform init -backend-config=config/${ENVIRONMENT}-backend.tfvars -reconfigure
terraform apply -var-file=config/${ENVIRONMENT}.tfvars -auto-approve

echo "✅ S3 Buckets deployed"

# 6. DynamoDB
step "Step 6: Deploying DynamoDB"
cd ../dynamodb
terraform init -backend-config=config/${ENVIRONMENT}-backend.tfvars -reconfigure
terraform apply -var-file=config/${ENVIRONMENT}.tfvars -auto-approve
echo "✅ DynamoDB deployed"

# 7. Frontend (S3 + CloudFront)
step "Step 7: Deploying Frontend Infrastructure"
cd ../frontend
terraform init -backend-config=config/${ENVIRONMENT}-backend.tfvars -reconfigure
terraform apply -var-file=config/${ENVIRONMENT}.tfvars -auto-approve
echo "✅ Frontend Infrastructure deployed"

FRONTEND_URL=$(terraform output -raw frontend_url)
HOST_URL=$(terraform output -raw host_url)
FRONTEND_CF_ID=$(terraform output -raw frontend_cloudfront_distribution_id)
HOST_CF_ID=$(terraform output -raw host_cloudfront_distribution_id)
echo "Frontend URL: $FRONTEND_URL"
echo "Host URL: $HOST_URL"

# 8. ECS Cluster
step "Step 8: Deploying ECS Cluster"
cd ../ecs-cluster
terraform init -backend-config=config/${ENVIRONMENT}-backend.tfvars -reconfigure
terraform apply -var-file=config/${ENVIRONMENT}.tfvars -auto-approve
echo "✅ ECS Cluster deployed"

# 9. Check if Docker image exists
step "Step 9: Checking Docker image"
IMAGE_EXISTS=$(aws ecr describe-images \
    --repository-name plasmic/wab \
    --image-ids imageTag=${ENVIRONMENT}-latest \
    --region ${AWS_REGION} 2>/dev/null || echo "not_found")

if [[ "$IMAGE_EXISTS" == "not_found" ]]; then
    warn "Docker image not found in ECR"
    warn "You need to build and push the image first:"
    echo ""
    echo "  # Login to ECR"
    echo "  aws ecr get-login-password --region ${AWS_REGION} | \\"
    echo "    docker login --username AWS --password-stdin ${ECR_REPO}"
    echo ""
    echo "  # Build and push"
    echo "  cd ../../.."
    echo "  docker build -t plasmic-wab -f platform/wab/Dockerfile platform/"
    echo "  docker tag plasmic-wab:latest ${ECR_REPO}:${ENVIRONMENT}-latest"
    echo "  docker push ${ECR_REPO}:${ENVIRONMENT}-latest"
    echo ""
    read -p "Press Enter after you've pushed the image, or Ctrl+C to cancel..."
else
    echo "✅ Docker image found: ${ENVIRONMENT}-latest"
fi

# 10. Update config with ECR URL
step "Step 10: Updating config with ECR URL"
cd ../services/wab

# Backup original config
cp config/${ENVIRONMENT}.tfvars config/${ENVIRONMENT}.tfvars.bak 2>/dev/null || true

# Update ECR URL
sed -i.tmp "s|wab_container_image = \".*\"|wab_container_image = \"${ECR_REPO}:${ENVIRONMENT}-latest\"|g" config/${ENVIRONMENT}.tfvars
rm -f config/${ENVIRONMENT}.tfvars.tmp

echo "✅ Config updated"

# 11. Deploy WAB Service
step "Step 11: Deploying WAB Service"
terraform init -backend-config=config/${ENVIRONMENT}-backend.tfvars -reconfigure
terraform apply -var-file=config/${ENVIRONMENT}.tfvars -auto-approve -lock=false
echo "✅ WAB Service deployed"

# 12. Deploy Codegen Service
step "Step 12: Deploying Codegen Service"
cd ../codegen
terraform init -backend-config=config/${ENVIRONMENT}-backend.tfvars -reconfigure
terraform apply -var-file=config/${ENVIRONMENT}.tfvars -auto-approve
echo "✅ Codegen Service deployed"

# 13. Deploy Copilot Service - DISABLED for cost savings
# step "Step 13: Deploying Copilot Service"
# cd ../copilot
# terraform init -backend-config=config/${ENVIRONMENT}-backend.tfvars -reconfigure
# terraform apply -var-file=config/${ENVIRONMENT}.tfvars -auto-approve
# echo "✅ Copilot Service deployed"

# 14. Deploy Data Service
step "Step 14: Deploying Data Service"
cd ../data
terraform init -backend-config=config/${ENVIRONMENT}-backend.tfvars -reconfigure
terraform apply -var-file=config/${ENVIRONMENT}.tfvars -auto-approve
echo "✅ Data Service deployed"

# 15. Get outputs
step "Step 15: Deployment Summary"
cd ../wab
APP_URL=$(terraform output -raw application_url)
LOG_GROUP=$(terraform output -raw log_group_name)

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎉 Deployment Complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Wait for services to stabilize
echo "Waiting for all services to stabilize (this may take 2-3 minutes)..."
aws ecs wait services-stable \
    --cluster plasmic-${ENVIRONMENT} \
    --services plasmic-${ENVIRONMENT}-wab plasmic-${ENVIRONMENT}-codegen plasmic-${ENVIRONMENT}-data \
    --region ${AWS_REGION}

echo ""
echo "✅ All services are stable!"
echo ""

# Test health endpoint
echo "Testing health endpoint..."
sleep 10  # Give ALB a moment
if curl -f -s -o /dev/null ${APP_URL}/api/v1/health; then
    echo "✅ Health check passed!"
else
    warn "Health check failed. Check logs:"
    echo "   aws logs tail $LOG_GROUP --follow"
fi

echo ""
echo "🚀 Deployment successful!"
