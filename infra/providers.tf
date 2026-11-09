provider "github" {
  owner = var.organization

  # Authentication comes from the GITHUB_TOKEN environment variable:
  #   - locally:  export GITHUB_TOKEN="$(gh auth token)"
  #   - in CI:    a short-lived GitHub App installation token
  #               (see .github/workflows/*.yaml)
}
