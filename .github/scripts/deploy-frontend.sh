#!/bin/bash
# Frontend build and deployment script for Plasmic
# Usage: ./deploy-frontend.sh [environment]
#
# Required environment variables:
#   AWS_REGION - AWS region
#   FRONTEND_URL - CloudFront URL for frontend
#   HOST_URL - CloudFront URL for host
#   FRONTEND_CF_ID - CloudFront distribution ID for frontend
#   HOST_CF_ID - CloudFront distribution ID for host
#   FRONTEND_BUCKET - S3 bucket name for frontend
#   HOST_BUCKET - S3 bucket name for host

set -e

ENVIRONMENT="${1:-${ENVIRONMENT:-integration}}"
AWS_REGION="${AWS_REGION:-us-east-2}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "🎨 Building and deploying Plasmic frontend to: $ENVIRONMENT"
# Mask region for public repo security
echo "::add-mask::$AWS_REGION"
echo ""

# Validate required environment variables
for var in FRONTEND_URL HOST_URL FRONTEND_CF_ID HOST_CF_ID FRONTEND_BUCKET HOST_BUCKET; do
  if [ -z "${!var}" ]; then
    echo "❌ Required environment variable $var is not set"
    exit 1
  fi
done

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
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

# Navigate to platform directory (from repo root to platform/wab)
cd "$SCRIPT_DIR/../../platform/wab"

# Install dependencies
step "Step 1: Installing dependencies"
echo "Installing root dependencies..."
cd ../..
yarn install --frozen-lockfile

echo "Setting up monorepo packages..."
yarn setup
yarn setup:canvas-packages

echo "Installing wab dependencies..."
cd platform/wab
yarn install --frozen-lockfile

# Add missing dependencies if needed
yarn add --dev raw-loader 2>/dev/null || true

echo "✅ Dependencies installed"

# Generate required files
step "Step 2: Generating required files"
echo "Generating model classes and parsers..."
make
echo "✅ Generated required files"

# Build CSS files
step "Step 3: Building CSS files"
yarn build-css
echo "✅ CSS files built"

# Create .env file
step "Step 4: Creating environment configuration"
cat > .env << EOF
REACT_APP_DEFAULT_HOST_URL=${HOST_URL}
AMPLITUDE_API_KEY=placeholder
INTERCOM_APP_ID=placeholder
POSTHOG_API_KEY=placeholder
POSTHOG_HOST=placeholder
POSTHOG_REVERSE_PROXY_HOST=placeholder
SENTRY_DSN=placeholder
SENTRY_ORG_ID=placeholder
SENTRY_PROJECT_ID=placeholder
STRIPE_PUBLISHABLE_KEY=placeholder
EOF

echo "✅ Environment configuration created"

# Patch rsbuild.config.ts
step "Step 5: Patching build configuration"
cat > patch-rsbuild.js << 'PATCH_EOF'
const fs = require('fs');
const content = fs.readFileSync('rsbuild.config.ts', 'utf8');

// Add REACT_APP_DEFAULT_HOST_URL after STRIPE_PUBLISHABLE_KEY
const patched = content.replace(
  /(\s*)(STRIPE_PUBLISHABLE_KEY: OPTIONAL_VAR,)/,
  '$1$2\n$1REACT_APP_DEFAULT_HOST_URL: REQUIRED_VAR,'
);

if (patched === content) {
  console.error('Failed to patch rsbuild.config.ts - pattern not found');
  process.exit(1);
}

fs.writeFileSync('rsbuild.config.ts', patched);
console.log('✅ Patched rsbuild.config.ts to include REACT_APP_DEFAULT_HOST_URL');
PATCH_EOF

node patch-rsbuild.js
rm patch-rsbuild.js
echo "✅ Build configuration patched"

# Build frontend
step "Step 6: Building frontend"
NODE_ENV=production PUBLIC_URL=${FRONTEND_URL} STATIC_URL=${FRONTEND_URL} yarn build
echo "✅ Frontend built successfully"
ls -lh build/

# Deploy to S3
step "Step 7: Deploying to S3"

# Sync all assets with cache headers (excluding HTML files)
echo "Uploading static assets..."
aws s3 sync build/ s3://${FRONTEND_BUCKET}/ \
  --delete \
  --cache-control "public, max-age=31536000, immutable" \
  --exclude "index.html" \
  --exclude "*.map" \
  --exclude "static/js/*.js" \
  --exclude "static/css/*.css" \
  --exclude "static/host.html" \
  --exclude "static/popup.html" \
  --exclude "static/sub/*" \
  --region ${AWS_REGION}

# Upload JS and CSS with specific cache headers
echo "Uploading JavaScript files..."
aws s3 sync build/static/js s3://${FRONTEND_BUCKET}/static/js \
  --cache-control "public, max-age=31536000, immutable" \
  --content-type "application/javascript" \
  --region ${AWS_REGION}

echo "Uploading CSS files..."
aws s3 sync build/static/css s3://${FRONTEND_BUCKET}/static/css \
  --cache-control "public, max-age=31536000, immutable" \
  --content-type "text/css" \
  --region ${AWS_REGION}

# Upload index.html with no-cache
echo "Uploading index.html..."
aws s3 cp build/index.html s3://${FRONTEND_BUCKET}/ \
  --cache-control "no-cache, no-store, must-revalidate" \
  --content-type "text/html" \
  --region ${AWS_REGION}

echo "✅ Frontend deployed to S3"

# Deploy Host Files
step "Step 8: Deploying host files"

# Create deployment directory
mkdir -p ../../host-deploy/static

# Copy host files - maintaining the /static/ structure
if [ -f build/static/host.html ]; then
  cp build/static/host.html ../../host-deploy/static/
  echo "✅ Copied host.html"
fi

if [ -d build/static/sub ]; then
  cp -r build/static/sub ../../host-deploy/static/
  echo "✅ Copied sub directory"
fi

if [ -f build/static/popup.html ]; then
  cp build/static/popup.html ../../host-deploy/static/
  echo "✅ Copied popup.html"
fi

if [ -d build/static/styles ]; then
  mkdir -p ../../host-deploy/static/styles
  cp -r build/static/styles/* ../../host-deploy/static/styles/ 2>/dev/null || true
  echo "✅ Copied styles"
fi

# Deploy to Host S3 bucket
echo "Uploading to host S3 bucket..."
aws s3 sync ../../host-deploy/ s3://${HOST_BUCKET}/ \
  --delete \
  --cache-control "public, max-age=31536000, immutable" \
  --exclude "*.html" \
  --region ${AWS_REGION}

# Upload HTML files with shorter cache
if [ -f ../../host-deploy/static/host.html ]; then
  aws s3 cp ../../host-deploy/static/host.html s3://${HOST_BUCKET}/static/host.html \
    --cache-control "public, max-age=300" \
    --content-type "text/html" \
    --region ${AWS_REGION}
fi

if [ -f ../../host-deploy/static/popup.html ]; then
  aws s3 cp ../../host-deploy/static/popup.html s3://${HOST_BUCKET}/static/popup.html \
    --cache-control "public, max-age=300" \
    --content-type "text/html" \
    --region ${AWS_REGION}
fi

# Cleanup
rm -rf ../../host-deploy

echo "✅ Host files deployed"

# Invalidate CloudFront
step "Step 9: Invalidating CloudFront caches"

echo "Invalidating frontend CloudFront..."
aws cloudfront create-invalidation \
  --distribution-id ${FRONTEND_CF_ID} \
  --paths "/index.html" "/*" \
  --region ${AWS_REGION} >/dev/null

echo "Invalidating host CloudFront..."
aws cloudfront create-invalidation \
  --distribution-id ${HOST_CF_ID} \
  --paths "/*" \
  --region ${AWS_REGION} >/dev/null

echo "✅ CloudFront invalidations created"

# Summary
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎉 Frontend Deployment Complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Environment: $ENVIRONMENT"
echo ""
echo "✅ Frontend and host files deployed successfully"
echo "⏱️  Note: CloudFront invalidations may take 5-10 minutes to complete"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
