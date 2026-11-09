# Optional organization-wide ruleset protecting the default branch of every
# repository. Enable it in config/organization.yaml (default_branch_ruleset).
#
# Note: on the GitHub Free plan, organization rulesets only apply to public
# repositories; private repos need GitHub Team (free for verified nonprofits).
resource "github_organization_ruleset" "default_branch" {
  count = local.org_ruleset_enabled ? 1 : 0

  name        = "default-branch-protection"
  target      = "branch"
  enforcement = try(local.org_ruleset.enforcement, "active")

  conditions {
    ref_name {
      include = ["~DEFAULT_BRANCH"]
      exclude = []
    }

    repository_name {
      include = ["~ALL"]
      exclude = try([for repo in local.org_ruleset.exclude_repositories : repo], [])
    }
  }

  dynamic "bypass_actors" {
    for_each = try([for team in local.org_ruleset.bypass_teams : team], [])
    content {
      actor_id    = tonumber(local.team_ids[bypass_actors.value])
      actor_type  = "Team"
      bypass_mode = "always"
    }
  }

  rules {
    deletion         = true
    non_fast_forward = true

    pull_request {
      required_approving_review_count   = try(local.org_ruleset.required_approvals, 1)
      dismiss_stale_reviews_on_push     = try(local.org_ruleset.dismiss_stale_reviews, true)
      require_code_owner_review         = try(local.org_ruleset.require_code_owner_review, false)
      require_last_push_approval        = false
      required_review_thread_resolution = try(local.org_ruleset.require_conversation_resolution, false)
    }
  }
}
