#!/bin/bash
# Build and push AMD64 Docker image to ECR for Fargate
# Usage: ./build-and-push.sh [environment] [aws-region]

set -e

ENVIRONMENT="${1:-integration}"
AWS_REGION="${2:-us-east-2}"

echo "🐳 Building and pushing AMD64 Docker image"
echo "Environment: $ENVIRONMENT"
echo "Region: $AWS_REGION"
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

step() {
    echo -e "${GREEN}▶ $1${NC}"
}

# Get AWS account ID
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_REPO="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/plasmic/wab"

step "1. Logging into ECR"
aws ecr get-login-password --region ${AWS_REGION} | \
    docker login --username AWS --password-stdin ${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com
echo "✅ Logged in to ECR"

step "2. Building AMD64 image"

# Check if buildx builder exists, create if not
if ! docker buildx inspect amd64-builder >/dev/null 2>&1; then
    echo "Creating buildx builder..."
    docker buildx create --name amd64-builder --use
else
    docker buildx use amd64-builder
fi

# Build for AMD64 platform
echo "Building for linux/amd64..."
docker buildx build \
    --platform linux/amd64 \
    --load \
    -t plasmic-wab:latest \
    -t ${ECR_REPO}:${ENVIRONMENT}-latest \
    -f platform/wab/Dockerfile \
    platform/

echo "✅ Image built successfully"

step "3. Pushing to ECR"
docker push ${ECR_REPO}:${ENVIRONMENT}-latest
echo "✅ Image pushed: ${ECR_REPO}:${ENVIRONMENT}-latest"

step "4. Verifying image in ECR"
IMAGE_DIGEST=$(aws ecr describe-images \
    --repository-name plasmic/wab \
    --image-ids imageTag=${ENVIRONMENT}-latest \
    --region ${AWS_REGION} \
    --query 'imageDetails[0].imageDigest' \
    --output text)

echo "✅ Image verified in ECR"
echo "   Digest: ${IMAGE_DIGEST}"
echo ""
echo "🎉 Done! Image ready for deployment."
echo ""
echo "Next steps:"
echo "  cd terraform/projects/services/wab"
echo "  terraform apply -var-file=config/${ENVIRONMENT}.tfvars"
