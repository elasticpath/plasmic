#!/bin/bash
# Generate .tfvars files from .example files using environment variables
#
# Usage:
#   Local: Export variables then run ./generate-configs.sh
#   CI:    Variables are already exported by GitHub Actions

set -e

# Required environment variables
REQUIRED_VARS=(
  "AWS_ACCOUNT_ID"
  "TERRAFORM_STATE_BUCKET"
  "TERRAFORM_LOCKS_TABLE"
  "HOSTED_ZONE_ID"
)

# Optional variables with defaults
: "${ALB_DNS_NAME:=placeholder-alb.us-east-2.elb.amazonaws.com}"
: "${CLOUDFRONT_DISTRIBUTION_URL:=placeholder.cloudfront.net}"
: "${INTERNAL_DOMAIN:=example.com}"
: "${LOADER_ASSETS_BUCKET:=placeholder-bucket}"
: "${DB_USERNAME:=plasmicadmin}"

# Check required variables
missing=()
for var in "${REQUIRED_VARS[@]}"; do
  if [ -z "${!var}" ]; then
    missing+=("$var")
  fi
done

if [ ${#missing[@]} -gt 0 ]; then
  echo "❌ Error: Missing required environment variables:"
  printf '   - %s\n' "${missing[@]}"
  echo ""
  echo "Example usage:"
  echo "  export AWS_ACCOUNT_ID=123456789012"
  echo "  export TERRAFORM_STATE_BUCKET=my-terraform-state"
  echo "  export TERRAFORM_LOCKS_TABLE=my-terraform-locks"
  echo "  export HOSTED_ZONE_ID=Z1234567890ABC"
  echo "  ./generate-configs.sh"
  exit 1
fi

echo "Generating config files from examples..."
echo " AWS Account: ${AWS_ACCOUNT_ID}"
echo " Region: us-east-2"
echo ""

count=0
find projects -name "*.tfvars.example" -type f | while read -r example_file; do
  output_file="${example_file%.example}"

  sed -e "s|<AWS_ACCOUNT_ID>|${AWS_ACCOUNT_ID}|g" \
      -e "s|<TERRAFORM_STATE_BUCKET>|${TERRAFORM_STATE_BUCKET}|g" \
      -e "s|<TERRAFORM_LOCKS_TABLE>|${TERRAFORM_LOCKS_TABLE}|g" \
      -e "s|<ALB_DNS_NAME>|${ALB_DNS_NAME}|g" \
      -e "s|<CLOUDFRONT_DISTRIBUTION_URL>|${CLOUDFRONT_DISTRIBUTION_URL}|g" \
      -e "s|<INTERNAL_DOMAIN>|${INTERNAL_DOMAIN}|g" \
      -e "s|<LOADER_ASSETS_BUCKET>|${LOADER_ASSETS_BUCKET}|g" \
      -e "s|<DB_USERNAME>|${DB_USERNAME}|g" \
      -e "s|<HOSTED_ZONE_ID>|${HOSTED_ZONE_ID}|g" \
      "$example_file" > "$output_file"

  echo "Generated: $output_file"
  count=$((count + 1))
done
