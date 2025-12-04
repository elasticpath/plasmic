terraform {
  backend "s3" {
    # Note: Backend configuration cannot use variables
    # These values will be provided via terraform init -backend-config
    # or environment-specific backend configs
    encrypt = true
  }
}