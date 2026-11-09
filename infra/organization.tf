# Organization-wide settings. Destroying this resource would reset the org to
# GitHub defaults, so it is protected against destruction. To stop managing it,
# remove it from state instead:  tofu state rm 'github_organization_settings.this[0]'
resource "github_organization_settings" "this" {
  count = local.manage_org_settings ? 1 : 0

  billing_email    = local.org_settings.billing_email
  name             = try(local.org_settings.name, null)
  description      = try(local.org_settings.description, null)
  company          = try(local.org_settings.company, null)
  blog             = try(local.org_settings.blog, null)
  email            = try(local.org_settings.email, null)
  location         = try(local.org_settings.location, null)
  twitter_username = try(local.org_settings.twitter_username, null)

  has_organization_projects     = try(local.org_settings.has_organization_projects, null)
  has_repository_projects       = try(local.org_settings.has_repository_projects, null)
  default_repository_permission = try(local.org_settings.default_repository_permission, null)

  members_can_create_repositories         = try(local.org_settings.members_can_create_repositories, null)
  members_can_create_public_repositories  = try(local.org_settings.members_can_create_public_repositories, null)
  members_can_create_private_repositories = try(local.org_settings.members_can_create_private_repositories, null)
  members_can_create_pages                = try(local.org_settings.members_can_create_pages, null)
  members_can_create_public_pages         = try(local.org_settings.members_can_create_public_pages, null)
  members_can_create_private_pages        = try(local.org_settings.members_can_create_private_pages, null)
  members_can_fork_private_repositories   = try(local.org_settings.members_can_fork_private_repositories, null)
  web_commit_signoff_required             = try(local.org_settings.web_commit_signoff_required, null)

  dependabot_alerts_enabled_for_new_repositories               = try(local.org_settings.dependabot_alerts_enabled_for_new_repositories, null)
  dependabot_security_updates_enabled_for_new_repositories     = try(local.org_settings.dependabot_security_updates_enabled_for_new_repositories, null)
  dependency_graph_enabled_for_new_repositories                = try(local.org_settings.dependency_graph_enabled_for_new_repositories, null)
  secret_scanning_enabled_for_new_repositories                 = try(local.org_settings.secret_scanning_enabled_for_new_repositories, null)
  secret_scanning_push_protection_enabled_for_new_repositories = try(local.org_settings.secret_scanning_push_protection_enabled_for_new_repositories, null)

  lifecycle {
    prevent_destroy = true
  }
}
