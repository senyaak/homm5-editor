// Is everything the fleet needs in place? `fleet.mjs doctor [--fix]`.
//
// It checks the project — the copy against its lock, the hooks' registration,
// docs/fleet/project.md filled in, CLAUDE.md pointing at the fleet, CI running
// `verify` and the link check — and GitHub: the owner logged in to `gh`, every repo of the
// project reachable with its base branch, and every label the roles use. With
// --fix it registers the fleet's missing hooks (an update run by an older
// copy writes the new files but knows only its own hooks) and creates the
// missing labels; everything else it only reports, since each is a decision of
// the project's.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const PROJECT_FILE = 'docs/fleet/project.md'
export const TEMPLATE = '.claude/fleet/project-template.md'

// workflow.md § Priority: the order a worker takes items in, highest first.
// An item with no priority label is medium.
export const PRIORITIES = [
  ['priority:immediately', 'b60205', 'Taken before anything else, a fix in progress included'],
  ['priority:very-high', 'd93f0b', 'Taken before every lower priority'],
  ['priority:high', 'fbca04', 'Taken before medium and low'],
  ['priority:medium', '0e8a16', 'The default; the same as no priority label'],
  ['priority:low', 'c2e0c6', 'Taken when nothing higher is eligible'],
  ['priority:never', 'ededed', 'Parked by the owner: never taken'],
]

// The labels every repo of a fleet carries (lifecycle.md § Labels), with the
// colour and description `--fix` gives a missing one. The kinds come from
// project.md's front matter.
export const LABELS = [
  ['fleet', '5319e7', 'Work made or handled by the agent fleet'],
  ['ready', '0e8a16', 'Fleet: can be claimed'],
  ['in-progress', 'fbca04', 'Fleet: claimed by a worker'],
  ['blocked', 'b60205', 'Fleet: waits on another issue or on the owner'],
  ['changes-requested', 'd93f0b', 'Fleet: a verdict asks for fixes'],
  ['fix-in-progress', 'fbca04', 'Fleet: a worker holds the fix claim'],
  ['approved', '0e8a16', 'Fleet: reviewed, waiting for the merger'],
  ['needs-owner', 'b60205', 'Only the owner can answer, or a stranger wrote it'],
  ['answered', '1d76db', 'The owner answered; the planner records it'],
  ['needs-play', 'c5def5', 'Landed and visible: the owner should look'],
  ['fleet-process', '5319e7', 'A problem with how the fleet works'],
  ...PRIORITIES,
]
const KIND_COLOR = '1d76db'

// The project file's front matter: `key: value` and `key: [a, b]` lines.
export function frontMatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!m) return null
  const out = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z]+):\s*(.*)$/.exec(line.trim())
    if (!kv) continue
    const value = kv[2].trim()
    out[kv[1]] = value.startsWith('[') && value.endsWith(']')
      ? value.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean)
      : value
  }
  return out
}

function sections(text) {
  const out = new Map()
  for (const part of text.replace(/\r\n/g, '\n').split(/^(?=## )/m)) {
    const m = /^## (.+)\n([\s\S]*)$/.exec(part)
    if (m) out.set(m[1].trim(), m[2].replace(/\s+/g, ' ').trim())
  }
  return out
}

// What is wrong with a project file against the template: missing sections,
// sections still holding the template's text, and the front matter.
export function projectFileProblems(text, template) {
  const problems = []
  const meta = frontMatter(text)
  if (!meta) problems.push('no front matter (owner, base, repos, kinds) at the top')
  else {
    for (const key of ['owner', 'base', 'repos', 'kinds']) {
      const v = meta[key]
      if (!v || (Array.isArray(v) && !v.length)) problems.push(`front matter: ${key} is missing`)
      else if (JSON.stringify(v).includes('<')) problems.push(`front matter: ${key} is still the template's placeholder`)
    }
    for (const repo of Array.isArray(meta.repos) ? meta.repos : []) {
      if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) problems.push(`front matter: repo "${repo}" is not owner/name`)
    }
  }
  const ours = sections(text)
  for (const [name, body] of sections(template)) {
    if (!ours.has(name)) problems.push(`§ ${name} is missing`)
    else if (ours.get(name) === body) problems.push(`§ ${name} still holds the template's text`)
  }
  return problems
}

// Every check, as { ok, what, fix? } findings. `gh(args)` runs the GitHub CLI
// and returns its stdout, or throws; it is passed in so tests need no network.
// `registerHooks()` adds the fleet's hooks missing from the settings.
export function diagnose(project, { gh, verifyProblems, registerHooks }) {
  const findings = []
  const ok = (what) => findings.push({ ok: true, what })
  const bad = (what, fix) => findings.push({ ok: false, what, fix })

  const verify = verifyProblems()
  const hookFix = registerHooks && (() => registerHooks())
  verify.length
    ? verify.forEach((p) => bad(p, p.endsWith(' is not registered') ? hookFix : undefined))
    : ok('the copy matches its lock, and the guard and the version check are registered')

  const file = join(project, PROJECT_FILE)
  const template = join(project, TEMPLATE)
  let meta = null
  if (!existsSync(file)) bad(`${PROJECT_FILE} is missing`)
  else {
    const text = readFileSync(file, 'utf8')
    meta = frontMatter(text)
    const problems = existsSync(template) ? projectFileProblems(text, readFileSync(template, 'utf8')) : []
    problems.length ? problems.forEach((p) => bad(`${PROJECT_FILE}: ${p}`)) : ok(`${PROJECT_FILE} is filled in`)
  }

  const claude = join(project, 'CLAUDE.md')
  const claudeText = existsSync(claude) ? readFileSync(claude, 'utf8') : ''
  if (/\.claude\/fleet|docs\/fleet/.test(claudeText)) ok('CLAUDE.md points at the fleet')
  else bad('CLAUDE.md does not point at the fleet (.claude/fleet/README.md or docs/fleet/)')
  // The working rules need no pointer: Claude Code loads .claude/rules/ into
  // every session by itself.

  const workflows = join(project, '.github/workflows')
  const ciText = existsSync(workflows)
    ? readdirSync(workflows)
        .filter((f) => /\.ya?ml$/.test(f))
        .map((f) => readFileSync(join(workflows, f), 'utf8'))
        .join('\n')
    : ''
  ciText.includes('fleet.mjs verify') ? ok('CI runs fleet.mjs verify') : bad('no workflow under .github/workflows runs `node .claude/fleet/fleet.mjs verify`')
  // .claude/rules/docs.md: CI checks every relative link, directly or through
  // a package script that runs links.mjs
  const pkg = join(project, 'package.json')
  const scripts = existsSync(pkg) ? JSON.parse(readFileSync(pkg, 'utf8')).scripts ?? {} : {}
  const linkScripts = Object.entries(scripts).filter(([, cmd]) => String(cmd).includes('links.mjs')).map(([name]) => name)
  const linked = ciText.includes('links.mjs') || linkScripts.some((name) => ciText.split(/\s+/).join(' ').includes(`npm run ${name}`))
  linked ? ok('CI checks the markdown links') : bad('no workflow checks the markdown links (`node .claude/fleet/links.mjs`, .claude/rules/docs.md)')

  let login = null
  try {
    login = gh(['api', 'user', '--jq', '.login']).trim()
    ok(`gh is logged in as ${login}`)
  } catch {
    bad('gh is not logged in (gh auth login, then gh auth setup-git)')
  }
  if (meta?.owner && login && meta.owner !== login) {
    bad(`gh is logged in as ${login}, but the fleet acts for ${meta.owner}: its comments would not count`)
  }

  const repos = Array.isArray(meta?.repos) ? meta.repos.filter((r) => !r.includes('<')) : []
  const kinds = Array.isArray(meta?.kinds) ? meta.kinds.filter((k) => !k.includes('<')) : []
  const wanted = [...LABELS, ...kinds.map((k) => [k, KIND_COLOR, `Fleet issue kind: ${k}`])]
  for (const repo of repos) {
    try {
      gh(['api', `repos/${repo}`, '--jq', '.full_name'])
    } catch {
      bad(`${repo}: not reachable with this gh login`)
      continue
    }
    if (meta.base) {
      try {
        gh(['api', `repos/${repo}/branches/${meta.base}`, '--jq', '.name'])
        ok(`${repo}: base branch ${meta.base} exists`)
      } catch {
        bad(`${repo}: no branch ${meta.base}`)
      }
    }
    let have = []
    try {
      have = gh(['label', 'list', '--repo', repo, '--limit', '500', '--json', 'name', '--jq', '.[].name']).split('\n').map((s) => s.trim())
    } catch {
      bad(`${repo}: cannot list labels`)
      continue
    }
    const missing = wanted.filter(([name]) => !have.includes(name))
    if (!missing.length) ok(`${repo}: all ${wanted.length} labels`)
    for (const [name, color, description] of missing) {
      bad(`${repo}: label ${name} is missing`, () =>
        gh(['label', 'create', name, '--repo', repo, '--color', color, '--description', description]),
      )
    }
  }
  return findings
}

// Print the findings, applying the fixable ones when asked. Returns the number
// of problems left.
export function doctor(project, { gh, verifyProblems, registerHooks, fix = false, log = console.log }) {
  let left = 0
  for (const f of diagnose(project, { gh, verifyProblems, registerHooks })) {
    if (f.ok) {
      log(`  ok    ${f.what}`)
      continue
    }
    if (fix && f.fix) {
      try {
        f.fix()
        log(`  fixed ${f.what}`)
        continue
      } catch (error) {
        log(`  FAIL  ${f.what} (fix failed: ${String(error.message).split('\n')[0]})`)
        left++
        continue
      }
    }
    log(`  TODO  ${f.what}${f.fix ? ' (--fix creates it)' : ''}`)
    left++
  }
  log(left ? `${left} thing(s) to do` : 'everything the fleet needs is in place')
  return left
}
