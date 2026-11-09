# Organization membership. This list is authoritative for everyone it names:
# adding a username sends an invitation, removing one REMOVES that person
# from the organization on the next apply.
#
# Members who are not listed in config/members.yaml are left alone, but the
# drift check (scripts/bootstrap.js --check) reports them.
resource "github_membership" "this" {
  for_each = local.members

  username = each.key
  role     = each.value
}
