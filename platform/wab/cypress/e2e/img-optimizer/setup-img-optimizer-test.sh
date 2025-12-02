#!/bin/bash

# Script to set up and upload test images for img-optimizer testing

echo "🚀 Setting up Image Optimizer Test Environment"
echo "=============================================="
echo ""

# Set AWS CLI to use LocalStack endpoint
export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test
export AWS_DEFAULT_REGION=us-east-1
AWS_ENDPOINT_URL="--endpoint-url=http://localhost:4566"

# Check if LocalStack is running
echo "🔍 Checking if LocalStack is running..."
if curl -s http://localhost:4566/health > /dev/null 2>&1; then
    echo "✅ LocalStack is running"
else
    echo "❌ LocalStack not running. Start it with:"
    echo "   docker-compose -f cypress/e2e/img-optimizer/docker-compose.localstack.yml up -d"
    exit 1
fi

# Check if bucket exists, create if not
echo "🔍 Checking if test-bucket exists..."
if aws $AWS_ENDPOINT_URL s3 ls s3://test-bucket 2>/dev/null; then
    echo "✅ Bucket exists"
else
    echo "🪣 Creating test-bucket..."
    aws $AWS_ENDPOINT_URL s3 mb s3://test-bucket
fi

# Generate test images using ImageMagick if available
if command -v convert &> /dev/null; then
    echo "🎨 Creating test images with ImageMagick..."
    
    # Create test images directory
    mkdir -p /tmp/img-optimizer-test
    
    # Large image for resize testing (2000x1500)
    convert -size 2000x1500 xc:blue -pointsize 144 -fill white -gravity center \
        -annotate +0+0 'Large Test\n2000x1500' \
        /tmp/img-optimizer-test/large-image.jpg
    
    # Medium image (1000x800)  
    convert -size 1000x800 xc:red -pointsize 72 -fill white -gravity center \
        -annotate +0+0 'Medium Test\n1000x800' \
        /tmp/img-optimizer-test/medium-image.jpg
    
    # Small image (400x300)
    convert -size 400x300 xc:green -pointsize 36 -fill white -gravity center \
        -annotate +0+0 'Small Test\n400x300' \
        /tmp/img-optimizer-test/small-image.jpg
    
    # PNG with transparency
    convert -size 800x600 xc:transparent -fill 'rgba(255,165,0,0.8)' \
        -draw 'circle 400,300 400,100' -pointsize 48 -fill black -gravity center \
        -annotate +0+0 'PNG Test\n800x600' \
        /tmp/img-optimizer-test/test-image.png
    
    # Also create a standard test image
    cp /tmp/img-optimizer-test/medium-image.jpg /tmp/img-optimizer-test/test-image.jpg
    
    # Upload images
    echo "⬆️ Uploading generated test images..."
    # Upload to root for manual testing
    aws $AWS_ENDPOINT_URL s3 cp /tmp/img-optimizer-test/large-image.jpg s3://test-bucket/large-image.jpg
    aws $AWS_ENDPOINT_URL s3 cp /tmp/img-optimizer-test/medium-image.jpg s3://test-bucket/medium-image.jpg
    aws $AWS_ENDPOINT_URL s3 cp /tmp/img-optimizer-test/small-image.jpg s3://test-bucket/small-image.jpg
    aws $AWS_ENDPOINT_URL s3 cp /tmp/img-optimizer-test/test-image.png s3://test-bucket/test-image.png
    aws $AWS_ENDPOINT_URL s3 cp /tmp/img-optimizer-test/test-image.jpg s3://test-bucket/test-image.jpg
    
    # Upload to test-images/ folder for integration tests
    aws $AWS_ENDPOINT_URL s3 cp /tmp/img-optimizer-test/medium-image.jpg s3://test-bucket/test-images/sample.jpg
    aws $AWS_ENDPOINT_URL s3 cp /tmp/img-optimizer-test/test-image.png s3://test-bucket/test-images/sample.png
    
else
    echo "⚠️ ImageMagick not found. Please install it to generate test images:"
    echo "   macOS: brew install imagemagick"
    echo "   Ubuntu/Debian: apt-get install imagemagick"
    echo "   Or manually upload test images to the bucket"
fi

# List uploaded files
echo ""
echo "📋 Files in test-bucket:"
aws $AWS_ENDPOINT_URL s3 ls s3://test-bucket/

echo ""
echo "✅ Test environment setup complete!"
echo ""
echo "🧪 Next steps:"
echo "1. Start standalone server:"
echo "   npm run run-ts -- cypress/e2e/img-optimizer/img-optimizer-standalone.ts"
echo ""
echo "2. Run E2E tests with Cypress:"
echo "   yarn cypress run --spec \"cypress/e2e/img-optimizer/img-optimizer.spec.ts\" --config baseUrl=http://localhost:3005"
echo ""
echo "3. Or run unit tests:"
echo "   npm test img-optimizer.spec.ts"