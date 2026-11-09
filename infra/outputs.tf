output "repository_count" {
  description = "Number of managed repositories."
  value       = length(github_repository.this)
}

output "member_count" {
  description = "Number of managed organization members."
  value       = length(github_membership.this)
}

output "teams" {
  description = "Managed teams: slug => team ID."
  value       = local.team_ids
}
