moved {
  from = github_repository_ruleset.github_iac_plan
  to   = github_repository_ruleset.default_branch["github-iac"]
}

import {
  to = github_repository_ruleset.default_branch["adsb-receiver-api"]
  id = "adsb-receiver-api:20952365"
}

import {
  to = github_repository_ruleset.default_branch["aerolopa-provider"]
  id = "aerolopa-provider:21036225"
}

import {
  to = github_repository_ruleset.default_branch["api"]
  id = "api:2856650"
}

import {
  to = github_repository_ruleset.default_branch["app"]
  id = "app:2843988"
}

import {
  to = github_repository_ruleset.default_branch["landing"]
  id = "landing:21995511"
}

import {
  to = github_repository_ruleset.default_branch["osm-provider"]
  id = "osm-provider:20548043"
}

import {
  to = github_repository_ruleset.default_branch["postcard-generator"]
  id = "postcard-generator:21585090"
}

import {
  to = github_repository_ruleset.default_branch["product"]
  id = "product:25468006"
}

import {
  to = github_repository_ruleset.default_branch["transponder-app"]
  id = "transponder-app:21283082"
}
