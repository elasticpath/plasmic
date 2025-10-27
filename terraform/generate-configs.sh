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

count=0
find projects -name "*.tfvars.example" -type f | while read -r example_file; do
  output_file="${example_file%.example}"

  sed -e "s|<AWS_ACCOUNT_ID>|${AWS_ACCOUNT_ID}|g" \
      -e "s|<TERRAFORM_STATE_BUCKET>|${TERRAFORM_STATE_BUCKET}|g" \
      -e "s|<TERRAFORM_LOCKS_TABLE>|${TERRAFORM_LOCKS_TABLE}|g" \
      -e "s|<HOSTED_ZONE_ID>|${HOSTED_ZONE_ID}|g" \
      "$example_file" > "$output_file"

  echo "Generated: $output_file"
  count=$((count + 1))
done
