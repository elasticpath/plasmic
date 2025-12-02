# Image Optimizer Testing Guide

This guide explains how to test the image optimizer service using the existing test infrastructure.

## ⚠️ Isolated Test Setup

The img-optimizer tests are **excluded from standard platform test runs** because they require:
- LocalStack S3 service running
- Standalone img-optimizer server running  
- Special environment configuration
- External test images

These tests must be run in isolation following the setup instructions below.

## Test Types Available

### 1. Unit Tests (`img-optimizer.spec.ts`)

- **Purpose**: Test individual functions with mocked dependencies
- **Run**: `npm test img-optimizer.spec.ts`
- **Coverage**: Parameter validation, caching logic, image processing, error handling
- **Dependencies**: None (uses mocks)

### 2. E2E Tests (`cypress/e2e/img-optimizer/img-optimizer.spec.ts`)

- **Purpose**: End-to-end integration tests with real HTTP requests
- **Run**: `yarn cypress:open` and select the img-optimizer tests
- **Run headless**: `yarn cypress run --spec "cypress/e2e/img-optimizer/img-optimizer.spec.ts"`
- **Coverage**: Full API testing with real S3 operations
- **Dependencies**: LocalStack or AWS S3 running, standalone server running
- **⚠️ Note**: These tests are **excluded from standard platform test runs** and require isolated setup

### 3. Standalone Server (`img-optimizer-standalone.ts`)

- **Purpose**: Manual testing and debugging
- **Run**: `npm run run-ts -- src/wab/server/test/img-optimizer/img-optimizer-standalone.ts`
- **Coverage**: HTTP API testing, browser testing
- **Dependencies**: LocalStack or AWS S3

## Quick Start

### Step 1: Start LocalStack

```bash
# From platform/wab directory
docker-compose -f cypress/e2e/img-optimizer/docker-compose.localstack.yml up -d
```

### Step 2: Set up test environment

```bash
# From platform/wab directory
cd cypress/e2e/img-optimizer
./setup-img-optimizer-test.sh
```

### Step 3: Start the standalone img-optimizer server

```bash
# From platform/wab directory
npm run run-ts -- cypress/e2e/img-optimizer/img-optimizer-standalone.ts
```

The server will start on port 3005 by default.

### Step 4: Run tests

#### Option A: E2E Tests with Cypress (Recommended for integration testing)

```bash
# Make sure the standalone server is running first (Step 3)
# Then in another terminal:

# IMPORTANT: These tests are excluded from standard Cypress runs.
# To run them, you must temporarily remove the exclusion:

# 1. Edit cypress.config.ts and remove this line from excludeSpecPattern:
#    "cypress/e2e/img-optimizer/**/*.spec.ts"

# 2. Run Cypress in interactive mode
yarn cypress:open

# Or run headless
yarn cypress run --spec "cypress/e2e/img-optimizer/img-optimizer.spec.ts" --config baseUrl=http://localhost:3005

# 3. Remember to add the exclusion back to cypress.config.ts when done
```

#### Option B: Unit Tests

```bash
# Run unit tests (no S3 required)
npm test img-optimizer.spec.ts
```

#### Option C: Manual Testing with curl

```bash
# Make sure the standalone server is running (Step 3)
# Test in browser or with curl:
curl "http://localhost:3005/img-optimizer/v1/img?src=http://localhost:4566/test-bucket/test-image.jpg&w=640&f=webp"
```

## Environment Variables

Create a `.env` file in the `platform/wab` directory for LocalStack testing:

```bash
# LocalStack S3 configuration
S3_ENDPOINT=http://localhost:4566
SITE_ASSETS_BUCKET=test-bucket
SITE_ASSETS_BASE_URL=http://localhost:4566/test-bucket/
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
AWS_REGION=us-east-1

# Optional: Standalone server port
IMG_OPTIMIZER_PORT=3005
```

## API Testing Examples

With the standalone server running, test these endpoints:

### Basic Resize

```bash
# Width only (preserves aspect ratio)
curl "http://localhost:3005/img-optimizer/v1/img?src=http://localhost:4566/test-bucket/test-image.jpg&w=640"

# Height only (preserves aspect ratio)
curl "http://localhost:3005/img-optimizer/v1/img?src=http://localhost:4566/test-bucket/test-image.jpg&h=480"

# Both dimensions (fits within bounds)
curl "http://localhost:3005/img-optimizer/v1/img?src=http://localhost:4566/test-bucket/test-image.jpg&w=640&h=480"
```

### Format Conversion

```bash
# Convert to WebP with quality
curl "http://localhost:3005/img-optimizer/v1/img?src=http://localhost:4566/test-bucket/test-image.jpg&w=640&f=webp&q=85"
```

### Static Handler

```bash
# Direct access by image ID
curl "http://localhost:3005/img-optimizer/v1/img/test-image.jpg?w=500&f=webp"
```

### Health Check

```bash
curl "http://localhost:3005/health"
```

## Test Images Available

After running `setup-img-optimizer-test.sh`, these test images are available:

- `test-image.jpg` - Standard test image (1000x800)
- `large-image.jpg` - Large image for resize testing (2000x1500)
- `small-image.jpg` - Small image (400x300)
- `test-image.png` - PNG with transparency (800x600)

## Cleaning Up

```bash
# Stop LocalStack
docker-compose -f src/wab/server/test/img-optimizer/docker-compose.localstack.yml down

# Remove test files
rm -rf /tmp/img-optimizer-test
```

## Troubleshooting

### LocalStack Issues

- Ensure Docker is running
- Check port 4566 is available: `lsof -i :4566`
- Restart LocalStack: `docker-compose down && docker-compose up -d`

### Test Failures

- Check environment variables are set correctly
- Verify LocalStack is running and accessible
- Check test images exist in S3 bucket

### Integration Test Skipped

- Ensure `RUN_IMG_OPTIMIZER_INTEGRATION_TESTS=true` is set
- Check that the environment variable is loaded in your shell
