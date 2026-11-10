# mypreflight as code

OpenTofu configuration for the [mypreflight](https://github.com/mypreflight) GitHub organization.
Everything is described in four YAML files; OpenTofu turns them into GitHub settings.

| File | What it controls |
|---|---|
| `config/organization.yaml` | Org profile, member privileges, security defaults for new repos, optional default-branch ruleset |
| `config/members.yaml` | Who is in the org and who is an owner |
| `config/teams.yaml` | Teams (up to 3 levels), their maintainers/members (by member ID), and their repository access |
| `config/repositories.yaml` | Every repository: description, topics, visibility, features, merge settings, archived, default-branch ruleset and its required checks |

Changes go through pull requests: the **plan** workflow comments the exact diff on the PR,
merging to `main` runs **apply**, and a nightly **drift** job fails if anyone changed the org by hand.

## Layout

```
config/*.yaml                ← the only files you normally edit
scripts/bootstrap.js         import the live org → config/*.yaml + infra/imports.tf; --check for drift
infra/                       OpenTofu root module — run every tofu command from here
  locals.tf                  YAML → OpenTofu data
  organization.tf            github_organization_settings
  members.tf                 github_membership
  teams.tf                   github_team, github_team_members, github_team_repository
  repositories.tf            github_repository
  security.tf                Dependabot, Actions permissions
  rulesets.tf                github_repository_ruleset per repository, github_organization_ruleset (optional)
  checks.tf                  config sanity checks (warnings in plan)
  versions.tf                provider, S3 backend, state encryption
  backend.hcl                state bucket and region (not secret, committed)
  .opentofu-version          OpenTofu version used by CI
.github/workflows/           plan (PR), apply (main), drift (nightly)
```

## One-time setup

### 1. Create the repository
Create a **public** repo `mypreflight/github-iac` (no README, no licence) and push these files:

```bash
gh repo create mypreflight/github-iac --public
git remote add origin git@github.com:mypreflight/github-iac.git
git push -u origin main
```

Public, because the organization is on GitHub Free, where repository rulesets only apply to public
repositories, and github-iac's ruleset, which requires the `plan` check, is what keeps unplanned
changes out of `main`. Everything in `config/` (the billing email included) and every plan comment is
therefore public.

### 2. State bucket
State lives in the DigitalOcean Spaces bucket `mypreflight-github-iac-tofu-state` (`fra1`, versioning
on), next to the other MyPreflight buckets; `infra/backend.hcl` points the S3 backend at it. The
Spaces key `github-iac` can read and write only this bucket.

Spaces ignores conditional writes, so the lock file (`use_lockfile`) does not actually stop two runs
at once, and a run that overlaps another fails when it releases the lock. Only `apply` writes state, so
only the apply workflow takes the lock, and it never runs twice in parallel (`concurrency`). The plan
and drift workflows run `tofu plan -lock=false`; do the same locally, and don't apply locally while
the apply workflow runs.

State is encrypted client-side with a passphrase before upload. **Losing the passphrase means losing
the state.** The passphrase and the Spaces key are in the macOS login keychain (account
`mypreflight-github-iac`, items `state-passphrase`, `state-access-key-id`, `state-secret-access-key`)
and in the repository secrets below; keep a copy of the passphrase in your password manager.

### 3. GitHub App for CI
Create a GitHub App owned by the org (Settings → Developer settings → GitHub Apps), no webhook,
with these permissions, and install it on **all repositories**:

| Scope | Permission | Why |
|---|---|---|
| Organization → Administration | Read & write | org settings, teams, rulesets |
| Organization → Members | Read & write | memberships, team members |
| Repository → Administration | Read & write | repo settings, team access |
| Repository → Metadata | Read | required |

### 4. Secrets and variables (in the new repo)
| Name | Kind | Value |
|---|---|---|
| `GH_APP_CLIENT_ID` | variable | the App's Client ID (`Iv23…`, on the App's settings page) |
| `GH_APP_PRIVATE_KEY` | secret | the App's private key (.pem contents) |
| `TOFU_STATE_PASSPHRASE` | secret | the state encryption passphrase |
| `STATE_ACCESS_KEY_ID` / `STATE_SECRET_ACCESS_KEY` | secret | bucket credentials |

Every change reaches `main` through a pull request with a passing plan (repository ruleset). No
approving review is required, because the organization has a single member. Required reviewers on
the `github-org` environment are free on public repositories if you want a manual gate before apply.

### 5. Import the current organization (locally, as an org owner)

```bash
gh auth login && gh auth refresh -s admin:org
node scripts/bootstrap.js             # writes config/*.yaml and infra/imports.tf

cd infra
export GITHUB_TOKEN="$(gh auth token)"
export TF_VAR_state_passphrase="$(security find-generic-password -a mypreflight-github-iac -s state-passphrase -w)"
export AWS_ACCESS_KEY_ID="$(security find-generic-password -a mypreflight-github-iac -s state-access-key-id -w)"
export AWS_SECRET_ACCESS_KEY="$(security find-generic-password -a mypreflight-github-iac -s state-secret-access-key -w)"
tofu init -backend-config=backend.hcl
tofu plan -lock=false
```

The committed `config/*.yaml` and `infra/imports.tf` were already generated this way, and
`github-iac` was added by hand. Running `bootstrap.js` again overwrites the YAML, so re-add the
`github-iac` entry (and its import block) if you do.

The plan should show only **imports** and, at most, small in-place updates. Read it carefully:
nothing should be destroyed or replaced, and no member should change role. If something looks
wrong, fix the YAML (it is the source of truth) and plan again. Then:

```bash
tofu apply
git rm imports.tf      # imports are one-time; keep them out of future plans
git add -A && git commit -m "Adopt mypreflight into OpenTofu" && git push
```

From now on, change things via pull requests.

## Day-to-day

**Invite someone** — add an entry to `members` in `config/members.yaml`
(and their ID to a team in `teams.yaml`, if any). Removing an entry removes them from the org.

```yaml
# config/members.yaml
members:
  user_jan_kowalski:
    name: 'Jan Kowalski'
    user: 'jkowalski'

# config/teams.yaml — one ID per line
teams:
  developers:
    name: developers
    privacy: closed
    members:
      - 'user_jan_kowalski'
    repositories:
      api: push
```

- The key (`user_jan_kowalski`) is the member's ID, and it is how everything else in the config refers
  to them: `user_` plus their name in lowercase snake_case, with Polish letters written without
  diacritics. It must be unique across `admins` and `members`; a duplicate fails the plan, and so does
  a team that lists an ID that is not in `members.yaml`.
- `user` is the GitHub username; OpenTofu uses it to manage the membership.
- `name` is for our own audit and is never sent to GitHub; the plan warns about entries without one.

The bootstrap script keeps IDs and names already in `members.yaml`. For new people it takes the
name from their GitHub profile (which may be empty or a nickname, so check it) and derives the ID
from it.

**New repository** — add it to `config/repositories.yaml`:

```yaml
  my-new-service:
    description: "What it does"
    topics: [product]
    from_template: some-template-repo   # optional
```

and, if it needs team access, give a team access in `teams.yaml` (`my-new-service: push`).

**Archive a repository** — set `archived: true`. OpenTofu can never delete a repository
(`prevent_destroy`); to stop managing one, remove it from YAML and run
`tofu state rm 'github_repository.this["name"]'`.

**Default-branch protection** — every repository gets the same `Main branch protection` ruleset
(`infra/rulesets.tf`): the branch can't be deleted or force-pushed, changes arrive through pull requests
with every conversation resolved and only the merge methods the repository allows, and the checks in
`required_checks` must pass on a branch that is up to date. `required_checks` defaults to
`[files, code]` and names GitHub Actions jobs, so set it per repository to the jobs its pull requests
report (a matrix job reports one check per entry, such as `code (seatmap)`). `branch_protection: false`
leaves a repository without one.

```yaml
  my-service:
    required_checks: [files, code, executable]
```

`default_branch_ruleset` in `organization.yaml` creates an organization ruleset on top, which needs
GitHub Team. On GitHub Free, setting `enabled: true` makes the apply fail.

**Harden a repository** — these optional keys in `config/repositories.yaml` are managed only for
repos that set them (all are free on public repositories):

```yaml
  my-service:
    vulnerability_alerts: true          # Dependabot alerts
    dependabot_security_updates: true   # Dependabot opens fix PRs for vulnerable dependencies
    actions:
      default_token_permissions: read   # GITHUB_TOKEN is read-only unless a workflow asks for more
      sha_pinning_required: true        # every action must be pinned to a full commit SHA
      allowed: ["mypreflight/*", "opentofu/setup-opentofu@*"]   # plus GitHub's own actions; nothing else
```

Setting `actions` also stops Actions from approving pull requests. When a workflow needs a new
third-party action, add it to `allowed` first. `allow_forking: false` only has an effect on private
repositories. Secret scanning and push protection are not managed here.

**Something was created by hand** — the drift job reports it. Add it to YAML, plus an
`import {}` block for it (same format as the generated `imports.tf`), plan, apply, remove the block.

## Good to know

- Lists in `members.yaml` and team member lists are **authoritative**: whoever is missing gets removed.
  `user_oskar_barcz` is the only owner; never remove them, and add a second owner to `admins` when
  someone else joins.
- Nested teams inherit their parent's repository access. A child team's `repositories` lists only
  what it gets on top of that (an extra repo, or a higher permission); revoking a repo from the parent
  revokes it from the children too.
- Outside collaborators, Actions secrets, webhooks and GitHub App installations (DigitalOcean) are not
  managed yet; the provider supports most of them (`github_repository_collaborators`,
  `github_actions_organization_secret`, `github_organization_webhook`) if you want to extend this.
- A rule added to a ruleset by hand is removed by the next apply, and so is any rule type the provider
  doesn't know yet, such as code quality.
- If applying `github_organization_settings` fails with the App token (some fields need an owner),
  set `manage_settings: false` or apply that part once locally with an owner's token.
