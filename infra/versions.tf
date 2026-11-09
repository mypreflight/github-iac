terraform {
  required_version = ">= 1.10.0"

  required_providers {
    github = {
      source  = "integrations/github"
      version = "~> 6.8"
    }
  }

  # Any S3-compatible bucket works (AWS S3, Cloudflare R2, Hetzner, Scaleway...).
  # Bucket and region come from backend.hcl; credentials from the AWS_* environment variables.
  backend "s3" {
    key          = "github-org/terraform.tfstate"
    use_lockfile = true
  }

  # State is encrypted client-side before it ever reaches the bucket.
  # Keep the passphrase in a password manager AND in the CI secret:
  # losing it means losing the state.
  encryption {
    key_provider "pbkdf2" "main" {
      passphrase = var.state_passphrase
    }

    method "aes_gcm" "main" {
      keys = key_provider.pbkdf2.main
    }

    state {
      method   = method.aes_gcm.main
      enforced = true
    }
  }
}
