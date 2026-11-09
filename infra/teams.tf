# Teams are split into one resource per level so a nested team can reference its
# parent without a dependency cycle. Nesting deeper than three levels is not supported.

resource "github_team" "root" {
  for_each = local.root_teams

  name        = each.value.name
  description = each.value.description
  privacy     = each.value.privacy
}

resource "github_team" "child" {
  for_each = local.child_teams

  name           = each.value.name
  description    = each.value.description
  privacy        = "closed" # GitHub requires nested teams to be visible
  parent_team_id = github_team.root[each.value.parent].id
}

resource "github_team" "grandchild" {
  for_each = local.grandchild_teams

  name           = each.value.name
  description    = each.value.description
  privacy        = "closed" # GitHub requires nested teams to be visible
  parent_team_id = try(github_team.child[each.value.parent].id, null)

  lifecycle {
    precondition {
      condition     = contains(keys(local.child_teams), each.value.parent)
      error_message = "Team '${each.key}' has parent '${each.value.parent}', which is not a first- or second-level team in config/teams.yaml (at most three levels are supported)."
    }
  }
}

# Authoritative member list per team: anyone not listed is removed from the team.
resource "github_team_members" "this" {
  for_each = local.team_memberships

  team_slug = local.team_slugs[each.key]

  dynamic "members" {
    for_each = [for member in each.value : member if member.username != null]
    content {
      username = members.value.username
      role     = members.value.role
    }
  }

  lifecycle {
    precondition {
      condition     = alltrue([for member in each.value : member.username != null])
      error_message = "Team '${each.key}' lists member IDs that are not defined in config/members.yaml: ${join(", ", [for member in each.value : member.id if member.username == null])}."
    }
  }

  depends_on = [github_membership.this]
}

# Team access to repositories: pull | triage | push | maintain | admin
# (or the name of a custom repository role).
resource "github_team_repository" "this" {
  for_each = local.team_repositories

  team_id    = local.team_ids[each.value.team]
  repository = try(github_repository.this[each.value.repository].name, each.value.repository)
  permission = each.value.permission
}
