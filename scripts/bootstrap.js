#!/usr/bin/env node
/**
 * Generate the YAML config and import blocks from the live GitHub organization.
 *
 * Usage:
 *   node scripts/bootstrap.js            # write config/*.yaml and imports.tf
 *   node scripts/bootstrap.js --check    # only report what exists on GitHub but is
 *                                        # not in config/*.yaml (exit 1 if anything)
 *   node scripts/bootstrap.js --org other-org
 *
 * Requirements: Node.js 20+ and the GitHub CLI (`gh`), logged in as an
 * organization owner:  gh auth login && gh auth refresh -s admin:org
 * No npm packages are needed.
 */

'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const CONFIG = path.join(ROOT, 'config');
const INFRA = path.join(ROOT, 'infra');
const MEMBERS_FILE = path.join(CONFIG, 'members.yaml');

const ORG_SETTING_KEYS = [
  'billing_email', 'name', 'description', 'company', 'blog', 'email',
  'location', 'twitter_username',
  'has_organization_projects', 'has_repository_projects',
  'default_repository_permission',
  'members_can_create_repositories',
  'members_can_create_public_repositories',
  'members_can_create_private_repositories',
  'members_can_create_pages',
  'members_can_create_public_pages',
  'members_can_create_private_pages',
  'members_can_fork_private_repositories',
  'web_commit_signoff_required',
  'dependabot_alerts_enabled_for_new_repositories',
  'dependabot_security_updates_enabled_for_new_repositories',
  'dependency_graph_enabled_for_new_repositories',
  'secret_scanning_enabled_for_new_repositories',
  'secret_scanning_push_protection_enabled_for_new_repositories',
];

// Repository settings that get a shared value in `defaults` (most common value
// across non-archived repos) and are only repeated per repo when they differ.
const REPO_DEFAULTABLE_KEYS = [
  'visibility',
  'has_issues', 'has_projects', 'has_wiki', 'has_discussions',
  'allow_merge_commit', 'allow_squash_merge', 'allow_rebase_merge',
  'allow_auto_merge', 'allow_update_branch', 'delete_branch_on_merge',
  'merge_commit_title', 'merge_commit_message',
  'squash_merge_commit_title', 'squash_merge_commit_message',
  'web_commit_signoff_required',
];

const PERMISSION_MAP = { read: 'pull', write: 'push' };

const TEAM_RESOURCES = ['root', 'child', 'grandchild'];

const TRANSLITERATE = { ł: 'l', đ: 'd', ø: 'o', ß: 'ss', æ: 'ae', œ: 'oe' };

const byLower = (a, b) => a.toLowerCase().localeCompare(b.toLowerCase());
const fail = (message) => {
  console.error(`error: ${message}`);
  process.exit(1);
};

// ---------------------------------------------------------------------------
// GitHub API helpers
// ---------------------------------------------------------------------------

function runGh(args, label) {
  try {
    return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    if (err.code === 'ENOENT') fail('the GitHub CLI (gh) is not installed');
    fail(`gh api ${label} failed:\n${String(err.stderr || err.message).trim()}`);
  }
}

const jsonLines = (out) => out.split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line));

function gh(apiPath, paginate = false) {
  const args = ['api', '-H', 'Accept: application/vnd.github+json'];
  if (paginate) args.push('--paginate', '--jq', '.[]');
  args.push(apiPath);

  const out = runGh(args, apiPath);
  return paginate ? jsonLines(out) : JSON.parse(out);
}

const logins = (apiPath) => gh(apiPath, true).map((m) => m.login).sort(byLower);

const DIRECT_TEAM_MEMBERS = `
query($org: String!, $slug: String!, $endCursor: String) {
  organization(login: $org) {
    team(slug: $slug) {
      members(membership: IMMEDIATE, first: 100, after: $endCursor) {
        pageInfo { hasNextPage endCursor }
        edges { role node { login } }
      }
    }
  }
}`;

function directTeamMembers(org, slug) {
  const out = runGh([
    'api', 'graphql', '--paginate',
    '-f', `query=${DIRECT_TEAM_MEMBERS}`, '-f', `org=${org}`, '-f', `slug=${slug}`,
    '--jq', '.data.organization.team.members.edges[] | {role, login: .node.login}',
  ], `graphql (members of team ${slug})`);
  const edges = jsonLines(out);
  const withRole = (role) => edges.filter((e) => e.role === role).map((e) => e.login).sort(byLower);
  return { maintainers: withRole('MAINTAINER'), members: withRole('MEMBER') };
}

// ---------------------------------------------------------------------------
// Minimal YAML writer (keeps the script dependency-free)
// ---------------------------------------------------------------------------

const PLAIN = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
const RESERVED = new Set(['true', 'false', 'null', 'yes', 'no', 'on', 'off', 'y', 'n', '~']);

class Quoted {
  constructor(text) {
    this.text = String(text);
  }
}

class BlockList {
  constructor(items) {
    this.items = items;
  }
}

const singleQuoted = (text) => `'${String(text).replaceAll("'", "''")}'`;

function yamlScalar(value) {
  if (value === null || value === undefined) return 'null';
  if (value instanceof Quoted) return singleQuoted(value.text);
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  const text = String(value);
  if (PLAIN.test(text) && !RESERVED.has(text.toLowerCase())) return text;
  return JSON.stringify(text); // a JSON string is a valid double-quoted YAML string
}

function yamlLines(data, indent = 0) {
  const pad = '  '.repeat(indent);
  const lines = [];
  for (const [key, value] of Object.entries(data)) {
    const k = yamlScalar(key);
    if (value instanceof BlockList) {
      if (value.items.length) {
        lines.push(`${pad}${k}:`, ...value.items.map((item) => `${pad}  - ${singleQuoted(item)}`));
      } else {
        lines.push(`${pad}${k}: []`);
      }
    } else if (Array.isArray(value)) {
      if (value.some((item) => typeof item === 'object' && item !== null)) {
        throw new Error(`nested lists are not supported (${key})`);
      }
      lines.push(`${pad}${k}: [${value.map(yamlScalar).join(', ')}]`);
    } else if (value !== null && typeof value === 'object' && !(value instanceof Quoted)) {
      if (Object.keys(value).length) {
        lines.push(`${pad}${k}:`, ...yamlLines(value, indent + 1));
      } else {
        lines.push(`${pad}${k}: {}`);
      }
    } else {
      lines.push(`${pad}${k}: ${yamlScalar(value)}`);
    }
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Collect live state
// ---------------------------------------------------------------------------

function collect(org) {
  console.error(`reading organization ${org} ...`);
  const orgData = gh(`/orgs/${org}`);

  const admins = logins(`/orgs/${org}/members?role=admin&per_page=100`);
  const members = logins(`/orgs/${org}/members?role=member&per_page=100`);

  const repos = {};
  const repoNames = gh(`/orgs/${org}/repos?type=all&per_page=100`, true).map((r) => r.name).sort(byLower);
  for (const name of repoNames) {
    console.error(`  repo ${name}`);
    repos[name] = gh(`/repos/${org}/${name}`);
  }

  const teams = {};
  const teamList = gh(`/orgs/${org}/teams?per_page=100`, true).sort((a, b) => a.slug.localeCompare(b.slug));
  for (const team of teamList) {
    const slug = team.slug;
    console.error(`  team ${slug}`);
    const teamRepos = {};
    for (const r of gh(`/orgs/${org}/teams/${slug}/repos?per_page=100`, true)) teamRepos[r.name] = r.role_name;
    teams[slug] = {
      raw: team,
      ...directTeamMembers(org, slug),
      repos: teamRepos,
    };
  }
  dropInheritedRepos(teams);

  return { org: orgData, admins, members, repos, teams };
}

function dropInheritedRepos(teams) {
  const withParentRepos = Object.values(teams).map((team) => [team, teams[team.raw.parent?.slug]?.repos ?? {}]);
  for (const [team, parentRepos] of withParentRepos) {
    team.repos = Object.fromEntries(Object.entries(team.repos).filter(([repo, role]) => parentRepos[repo] !== role));
  }
}

// ---------------------------------------------------------------------------
// Build config documents
// ---------------------------------------------------------------------------

function buildOrganization(live) {
  const settings = {};
  for (const key of ORG_SETTING_KEYS) {
    const value = live.org[key];
    if (value === null || value === undefined || value === '') continue;
    settings[key] = value;
  }
  return {
    manage_settings: 'billing_email' in settings,
    settings,
    default_branch_ruleset: {
      enabled: false,
      enforcement: 'active',
      required_approvals: 1,
      dismiss_stale_reviews: true,
      require_code_owner_review: false,
      require_conversation_resolution: false,
      exclude_repositories: [],
      bypass_teams: [],
    },
  };
}

const slugify = (text) => text
  .toLowerCase()
  .replace(/[łđøßæœ]/g, (c) => TRANSLITERATE[c])
  .normalize('NFKD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '');

function identifyMembers(users) {
  const known = new Map(loadMembers(MEMBERS_FILE).filter((p) => p.user).map((p) => [p.user, p]));
  const taken = new Set([...known.values()].map((p) => p.id).filter(Boolean));
  const people = {};
  for (const user of users) {
    const existing = known.get(user) ?? {};
    const name = existing.name ?? (gh(`/users/${user}`).name || null);
    let id = existing.id;
    if (!id) {
      id = `user_${slugify(name ?? '') || slugify(user)}`;
      if (taken.has(id)) id = `${id}_${slugify(user)}`;
    }
    taken.add(id);
    people[user] = { id, name, user };
  }
  return people;
}

function buildMembers(live, people) {
  const section = (users) => Object.fromEntries(
    users
      .map((user) => people[user])
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(({ id, name, user }) => [id, { name: name === null ? null : new Quoted(name), user: new Quoted(user) }]),
  );
  return { admins: section(live.admins), members: section(live.members) };
}

function teamDepth(live, slug) {
  let depth = 1;
  for (let parent = live.teams[slug].raw.parent; parent; parent = live.teams[parent.slug]?.raw?.parent) depth += 1;
  return depth;
}

function buildTeams(live, people) {
  const memberIds = (users) => new BlockList(
    users.map((user) => people[user]?.id ?? fail(`team member ${user} is not an organization member`)),
  );
  const slugById = Object.fromEntries(Object.entries(live.teams).map(([slug, t]) => [t.raw.id, slug]));
  const teams = {};
  for (const [slug, team] of Object.entries(live.teams)) {
    const raw = team.raw;
    const parent = raw.parent;
    const depth = teamDepth(live, slug);
    if (depth > TEAM_RESOURCES.length) {
      fail(`team ${slug} is nested ${depth} levels deep; at most ${TEAM_RESOURCES.length} levels are supported`);
    }
    const entry = { name: raw.name };
    if (raw.description) entry.description = raw.description;
    if (parent) entry.parent = slugById[parent.id] ?? parent.slug;
    else entry.privacy = raw.privacy ?? 'closed';
    entry.maintainers = memberIds(team.maintainers);
    entry.members = memberIds(team.members);
    entry.repositories = Object.fromEntries(
      Object.keys(team.repos).sort().map((repo) => [repo, PERMISSION_MAP[team.repos[repo]] ?? team.repos[repo]]),
    );
    teams[slug] = entry;
  }
  return { teams };
}

function mostCommon(values) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best;
  let bestCount = 0;
  for (const [v, c] of counts) if (c > bestCount) [best, bestCount] = [v, c];
  return best;
}

function buildRepositories(live) {
  const all = Object.values(live.repos);
  const active = all.filter((r) => !r.archived);
  const pool = active.length ? active : all;

  const defaults = {};
  for (const key of REPO_DEFAULTABLE_KEYS) {
    const values = pool.map((r) => r[key]).filter((v) => v !== null && v !== undefined);
    if (values.length) defaults[key] = mostCommon(values);
  }

  const repositories = {};
  for (const [name, repo] of Object.entries(live.repos)) {
    const entry = {};
    if (repo.description) entry.description = repo.description;
    if (repo.homepage) entry.homepage_url = repo.homepage;
    if (repo.topics?.length) entry.topics = [...repo.topics].sort();
    if (repo.is_template) entry.is_template = true;
    if (repo.archived) entry.archived = true;
    for (const key of REPO_DEFAULTABLE_KEYS) {
      const value = repo[key];
      if (value !== null && value !== undefined && value !== defaults[key]) entry[key] = value;
    }
    repositories[name] = entry;
  }
  return { defaults, repositories };
}

function buildImports(org, live) {
  const out = [
    '# Generated by scripts/bootstrap.js — adopts EXISTING GitHub objects into state.',
    '# Delete this file after the first successful `tofu apply`.',
    '',
  ];
  const key = (text) => JSON.stringify(text);
  const block = (to, id) => out.push('import {', `  to = ${to}`, `  id = ${JSON.stringify(String(id))}`, '}', '');

  if (live.org.billing_email) block('github_organization_settings.this[0]', live.org.id);

  for (const user of [...live.admins, ...live.members]) {
    block(`github_membership.this[${key(user)}]`, `${org}:${user}`);
  }

  for (const name of Object.keys(live.repos)) {
    block(`github_repository.this[${key(name)}]`, name);
  }

  for (const [slug, team] of Object.entries(live.teams)) {
    const teamId = String(team.raw.id);
    const resource = TEAM_RESOURCES[teamDepth(live, slug) - 1];
    block(`github_team.${resource}[${key(slug)}]`, teamId);
    if (team.maintainers.length || team.members.length) {
      block(`github_team_members.this[${key(slug)}]`, teamId);
    }
    for (const repo of Object.keys(team.repos).sort()) {
      block(`github_team_repository.this[${key(`${slug}/${repo}`)}]`, `${teamId}:${repo}`);
    }
  }

  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Drift check: things on GitHub that the YAML does not know about
// ---------------------------------------------------------------------------

const unquote = (text) => {
  if (text.startsWith('"')) return JSON.parse(text);
  if (text.startsWith("'")) return text.slice(1, -1).replaceAll("''", "'");
  return text;
};

/** Very small reader: collect the keys directly under `section:`. */
function loadYamlKeys(file, section) {
  const keys = new Set();
  let inside = false;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (!line.startsWith(' ')) {
      inside = line.split(':', 1)[0].trim() === section;
      continue;
    }
    if (inside && /^ {2}\S/.test(line)) {
      keys.add(unquote(line.trim().split(/:(?=\s|$)/)[0]));
    }
  }
  return keys;
}

const MEMBER_KEY = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s:#'"][^:#]*?):(?:\s+(.*))?$/;
const MEMBER_FIELD = /(?:^|[\s{,])(name|user):\s*("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s,}#](?:[^,}#]*[^\s,}#])?)/g;

/** Read the `<id>: {name, user}` entries under `admins:` and `members:`, in block or flow style. */
function loadMembers(file) {
  if (!fs.existsSync(file)) return [];
  const people = [];
  let inside = false;
  let entryIndent = null;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;
    if (indent === 0) {
      inside = ['admins', 'members'].includes(line.split(':', 1)[0].trim());
      entryIndent = null;
      continue;
    }
    if (!inside || line.trimStart().startsWith('-')) continue;
    entryIndent ??= indent;
    let fields = line;
    if (indent === entryIndent) {
      const key = line.trim().match(MEMBER_KEY);
      if (!key) continue;
      people.push({ id: unquote(key[1]) });
      fields = key[2] ?? '';
    }
    const person = people.at(-1);
    if (!person) continue;
    for (const [, field, value] of fields.matchAll(MEMBER_FIELD)) {
      person[field] = /^(null|~)$/.test(value) ? null : unquote(value);
    }
  }
  return people;
}

function check(org) {
  const live = collect(org);
  const knownRepos = loadYamlKeys(path.join(CONFIG, 'repositories.yaml'), 'repositories');
  const knownTeams = loadYamlKeys(path.join(CONFIG, 'teams.yaml'), 'teams');
  const knownMembers = new Set(loadMembers(MEMBERS_FILE).map((person) => person.user).filter(Boolean));

  const problems = {
    repositories: Object.keys(live.repos).filter((n) => !knownRepos.has(n)).sort(),
    teams: Object.keys(live.teams).filter((s) => !knownTeams.has(s)).sort(),
    members: [...live.admins, ...live.members].filter((u) => !knownMembers.has(u)).sort(byLower),
  };

  let found = false;
  for (const [kind, names] of Object.entries(problems)) {
    if (names.length) {
      found = true;
      console.log(`Unmanaged ${kind} (exist on GitHub, missing from config): ${names.join(', ')}`);
    }
  }
  if (!found) console.log('Everything on GitHub is described in config/*.yaml.');
  return found ? 1 : 0;
}

// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { org: 'mypreflight', check: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--check') args.check = true;
    else if (arg === '--org') args.org = argv[(i += 1)];
    else if (arg.startsWith('--org=')) args.org = arg.slice('--org='.length);
    else if (arg === '-h' || arg === '--help') {
      console.log('usage: node scripts/bootstrap.js [--org <login>] [--check]');
      process.exit(0);
    } else fail(`unknown argument: ${arg}`);
  }
  if (!args.org) fail('--org needs a value');
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.check) return check(args.org);

  const live = collect(args.org);
  const people = identifyMembers([...live.admins, ...live.members]);

  const documents = [
    ['organization.yaml', `\
# Organization-wide settings.
# manage_settings: false  -> OpenTofu ignores org settings entirely.
# default_branch_ruleset  -> optional ruleset protecting every repo's default branch.`,
    buildOrganization(live)],

    ['members.yaml', `\
# Organization members (authoritative for listed users).
# Add an entry to invite someone; remove it to remove them from the org.
# Never remove the last admin, or the account your CI token belongs to.`,
    buildMembers(live, people)],

    ['teams.yaml', `\
# Teams, keyed by slug. Up to three levels of nesting (use \`parent: <slug>\`).
# maintainers/members: member IDs from config/members.yaml, one per line; authoritative per team.
# repositories: <repo>: pull | triage | push | maintain | admin | <custom role>`,
    buildTeams(live, people)],

    ['repositories.yaml', `\
# Repositories, keyed by name. Values under \`defaults\` apply to every repo
# unless the repo sets its own value. \`my-repo: {}\` uses defaults only.
# Creation-only options: auto_init, gitignore_template, license_template,
# from_template (name of a template repo in this org).`,
    buildRepositories(live)],
  ].map(([file, header, data]) => [file, `${header.trimEnd()}\n\n${yamlLines(data).join('\n')}\n`]);
  const imports = buildImports(args.org, live);

  fs.mkdirSync(CONFIG, { recursive: true });
  for (const [file, content] of documents) {
    fs.writeFileSync(path.join(CONFIG, file), content, 'utf8');
    console.log(`wrote config/${file}`);
  }
  fs.writeFileSync(path.join(INFRA, 'imports.tf'), imports, 'utf8');
  console.log('wrote infra/imports.tf');
  console.log(
    `\n${Object.keys(live.repos).length} repositories, ${live.admins.length + live.members.length} members, `
      + `${Object.keys(live.teams).length} teams.\nNext: cd infra && tofu init -backend-config=backend.hcl && tofu plan`,
  );
  return 0;
}

process.exitCode = main();
