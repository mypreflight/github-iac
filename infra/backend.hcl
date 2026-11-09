bucket                      = "mypreflight-github-iac-tofu-state"
region                      = "us-east-1"
endpoints                   = { s3 = "https://fra1.digitaloceanspaces.com" }
skip_credentials_validation = true
skip_requesting_account_id  = true
skip_metadata_api_check     = true
skip_s3_checksum            = true
