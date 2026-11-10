resource "github_repository_vulnerability_alerts" "this" {
  for_each = {
    for name, repo in local.repositories : name => repo.vulnerability_alerts
    if try(repo.vulnerability_alerts, null) != null
  }

  repository = github_repository.this[each.key].name
  enabled    = each.value
}

resource "github_repository_dependabot_security_updates" "this" {
  for_each = {
    for name, repo in local.repositories : name => repo.dependabot_security_updates
    if try(repo.dependabot_security_updates, null) != null
  }

  repository = github_repository.this[each.key].name
  enabled    = each.value

  depends_on = [github_repository_vulnerability_alerts.this]
}

resource "github_workflow_repository_permissions" "this" {
  for_each = {
    for name, repo in local.repositories : name => repo.actions
    if try(repo.actions.default_token_permissions, null) != null
  }

  repository                       = github_repository.this[each.key].name
  default_workflow_permissions     = each.value.default_token_permissions
  can_approve_pull_request_reviews = false
}

resource "github_actions_repository_permissions" "this" {
  for_each = {
    for name, repo in local.repositories : name => repo.actions
    if try(repo.actions.sha_pinning_required, null) != null || try(repo.actions.allowed, null) != null
  }

  repository           = github_repository.this[each.key].name
  enabled              = true
  allowed_actions      = try(each.value.allowed, null) == null ? "all" : "selected"
  sha_pinning_required = try(each.value.sha_pinning_required, false)

  dynamic "allowed_actions_config" {
    for_each = try(each.value.allowed, null) == null ? [] : [each.value.allowed]
    content {
      github_owned_allowed = true
      verified_allowed     = false
      patterns_allowed     = allowed_actions_config.value
    }
  }
}
