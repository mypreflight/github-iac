locals {
  # ---------------------------------------------------------------------------
  # Raw YAML configuration (config/*.yaml is the single source of truth)
  # ---------------------------------------------------------------------------
  organization_config = yamldecode(file("${path.module}/../config/organization.yaml"))
  members_file        = file("${path.module}/../config/members.yaml")
  members_config      = yamldecode(local.members_file)
  teams_config        = yamldecode(file("${path.module}/../config/teams.yaml"))
  repositories_config = yamldecode(file("${path.module}/../config/repositories.yaml"))

  # Note: `try([for ...], [])` is used throughout so that empty YAML keys
  # (which decode to null) behave like empty lists/maps.

  # ---------------------------------------------------------------------------
  # Organization
  # ---------------------------------------------------------------------------
  manage_org_settings = try(local.organization_config.manage_settings, false) == true
  org_settings        = try({ for k, v in local.organization_config.settings : k => v }, {})
  org_ruleset         = try({ for k, v in local.organization_config.default_branch_ruleset : k => v }, {})
  org_ruleset_enabled = try(local.org_ruleset.enabled, false) == true

  # ---------------------------------------------------------------------------
  # Members: username => role ("admin" | "member")
  # ---------------------------------------------------------------------------
  admin_entries  = try(local.members_config.admins, {})
  member_entries = try(local.members_config.members, {})

  admins       = [for person in local.admin_entries : person.user]
  plain_member = [for person in local.member_entries : person.user]

  declared_member_ids = [
    for match in regexall("(?m)^ +([^\\s#:'\"][^:#]*?)\\s*:", local.members_file) : match[0]
    if !contains(["name", "user"], match[0])
  ]

  people = {
    for id in local.declared_member_ids :
    id => try(local.admin_entries[id], local.member_entries[id])
  }

  unnamed_members = [for id, person in local.people : id if try(trimspace(person.name), "") == ""]

  members = merge(
    { for user in local.plain_member : user => "member" },
    { for user in local.admins : user => "admin" },
  )

  # ---------------------------------------------------------------------------
  # Teams (three levels: root teams, their child teams, and grandchild teams)
  # ---------------------------------------------------------------------------
  teams = try({
    for slug, team in local.teams_config.teams : slug => {
      name         = try(team.name, slug)
      description  = try(team.description, null)
      privacy      = try(team.privacy, "closed")
      parent       = try(team.parent, null)
      maintainers  = try([for id in team.maintainers : id], [])
      members      = try([for id in team.members : id], [])
      repositories = try({ for repo, permission in team.repositories : repo => permission }, {})
    }
  }, {})

  root_teams       = { for slug, team in local.teams : slug => team if team.parent == null }
  nested_teams     = { for slug, team in local.teams : slug => team if team.parent != null }
  child_teams      = { for slug, team in local.nested_teams : slug => team if contains(keys(local.root_teams), team.parent) }
  grandchild_teams = { for slug, team in local.nested_teams : slug => team if !contains(keys(local.root_teams), team.parent) }

  team_ids = merge(
    { for slug, team in github_team.root : slug => team.id },
    { for slug, team in github_team.child : slug => team.id },
    { for slug, team in github_team.grandchild : slug => team.id },
  )

  team_slugs = merge(
    { for slug, team in github_team.root : slug => team.slug },
    { for slug, team in github_team.child : slug => team.slug },
    { for slug, team in github_team.grandchild : slug => team.slug },
  )

  team_memberships = {
    for slug, team in local.teams : slug => concat(
      [for id in team.maintainers : { id = id, username = try(lower(local.people[id].user), null), role = "maintainer" }],
      [for id in team.members : { id = id, username = try(lower(local.people[id].user), null), role = "member" }],
    )
    if length(team.maintainers) + length(team.members) > 0
  }

  team_repositories = merge(concat([{}], [
    for slug, team in local.teams : {
      for repo, permission in team.repositories : "${slug}/${repo}" => {
        team       = slug
        repository = repo
        permission = permission
      }
    }
  ])...)

  # ---------------------------------------------------------------------------
  # Repositories: per-repo values override `defaults`
  # (merge() skips null, so `repo-name: {}` and `repo-name:` both work)
  # ---------------------------------------------------------------------------
  repository_defaults = try({ for k, v in local.repositories_config.defaults : k => v }, {})

  repositories = try({
    for name, repo in local.repositories_config.repositories :
    name => merge(local.repository_defaults, repo)
  }, {})

  github_actions_integration_id = 15368

  protected_repositories = {
    for name, repo in local.repositories : name => {
      required_checks = try([for check in repo.required_checks : check], [])
      merge_methods = concat(
        try(repo.allow_merge_commit, true) ? ["merge"] : [],
        try(repo.allow_squash_merge, true) ? ["squash"] : [],
        try(repo.allow_rebase_merge, true) ? ["rebase"] : [],
      )
    }
    if try(repo.branch_protection, false) == true && try(repo.archived, false) != true
  }
}
