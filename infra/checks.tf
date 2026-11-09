# Sanity checks on the YAML configuration. They show up as warnings in plan.

check "members_not_listed_twice" {
  assert {
    condition     = length(setintersection(toset(local.admins), toset(local.plain_member))) == 0
    error_message = "These users are listed as both admin and member in config/members.yaml: ${join(", ", setintersection(toset(local.admins), toset(local.plain_member)))}"
  }
}

check "members_have_names" {
  assert {
    condition     = length(local.unnamed_members) == 0
    error_message = "These members have no name in config/members.yaml: ${join(", ", local.unnamed_members)}"
  }
}

check "team_repositories_are_managed" {
  assert {
    condition = alltrue([
      for key, access in local.team_repositories : contains(keys(local.repositories), access.repository)
    ])
    error_message = "Some team repository grants reference repositories that are not in config/repositories.yaml."
  }
}

check "valid_repository_visibility" {
  assert {
    condition = alltrue([
      for name, repo in local.repositories : contains(["public", "private", "internal"], try(repo.visibility, "public"))
    ])
    error_message = "Repository visibility must be public, private or internal."
  }
}
