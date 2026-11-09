# Every repository listed in config/repositories.yaml.
#
# Safety: repositories can never be deleted by OpenTofu (prevent_destroy).
#   - To archive a repo:       set `archived: true`
#   - To stop managing a repo: remove it from YAML AND run
#       tofu state rm 'github_repository.this["<name>"]'
#   - To rename a repo:        rename the key and add a `moved` block
resource "github_repository" "this" {
  for_each = local.repositories

  name         = each.key
  description  = try(each.value.description, null)
  homepage_url = try(each.value.homepage_url, null)
  visibility   = try(each.value.visibility, "public")
  topics       = try(each.value.topics, [])

  has_issues      = try(each.value.has_issues, true)
  has_projects    = try(each.value.has_projects, false)
  has_wiki        = try(each.value.has_wiki, false)
  has_discussions = try(each.value.has_discussions, false)
  is_template     = try(each.value.is_template, false)
  allow_forking   = try(each.value.allow_forking, null)
  archived        = try(each.value.archived, false)

  allow_merge_commit          = try(each.value.allow_merge_commit, true)
  allow_squash_merge          = try(each.value.allow_squash_merge, true)
  allow_rebase_merge          = try(each.value.allow_rebase_merge, true)
  allow_auto_merge            = try(each.value.allow_auto_merge, false)
  allow_update_branch         = try(each.value.allow_update_branch, false)
  delete_branch_on_merge      = try(each.value.delete_branch_on_merge, false)
  merge_commit_title          = try(each.value.merge_commit_title, "MERGE_MESSAGE")
  merge_commit_message        = try(each.value.merge_commit_message, "PR_TITLE")
  squash_merge_commit_title   = try(each.value.squash_merge_commit_title, "COMMIT_OR_PR_TITLE")
  squash_merge_commit_message = try(each.value.squash_merge_commit_message, "COMMIT_MESSAGES")
  web_commit_signoff_required = try(each.value.web_commit_signoff_required, false)

  # Only used when OpenTofu CREATES a repository (ignored for existing ones).
  auto_init          = try(each.value.auto_init, true)
  gitignore_template = try(each.value.gitignore_template, null)
  license_template   = try(each.value.license_template, null)

  dynamic "template" {
    for_each = try(each.value.from_template, null) == null ? [] : [each.value.from_template]
    content {
      owner      = var.organization
      repository = template.value
    }
  }

  lifecycle {
    prevent_destroy = true
    ignore_changes  = [auto_init, gitignore_template, license_template, template]
  }
}
