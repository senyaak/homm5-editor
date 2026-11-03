// The fleet as a dependency: installs a released version of senyaak/claude-fleet
// into a project, and keeps it there.
//
//   node .claude/fleet/fleet.mjs check            is a newer version out?
//   node .claude/fleet/fleet.mjs update [vX.Y.Z]  take it (default: the newest)
//   node .claude/fleet/fleet.mjs verify           the copy matches its lock (CI)
//   node .claude/fleet/fleet.mjs doctor [--fix]   everything the fleet needs is in
//                                                 place, GitHub labels included
//   node bin/fleet.mjs install <project> [--ref vX.Y.Z] [--from <dir>]
//                                                 first install, from a fleet checkout
//
// A version is a git tag of the fleet repo. Installing copies the repo's
// `payload/` tree into the project at the same paths, records the version and a
// hash of every file in .claude/fleet/fleet.lock.json, registers the guard and
// the version check as hooks in .claude/settings.json, and writes docs/fleet/project.md from the template
// (.claude/fleet/project-template.md) the first time (it is the project's own file from then on). The copied files
// are not edited in the project: a change goes to the fleet repo and comes back
// as a version, and `verify` fails CI on a local edit.
//
// Plain Node, run as `node <file>`: no shell, no shebang, no execute bit, so the
// same command works on Windows and Linux.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { doctor, TEMPLATE } from './doctor.mjs'

export const DEFAULT_SOURCE = 'https://github.com/senyaak/claude-fleet.git'
export const LOCK = '.claude/fleet/fleet.lock.json'
export const PROJECT_FILE = 'docs/fleet/project.md'
const GUARD_ARG = '${CLAUDE_PROJECT_DIR}/.claude/fleet/guard.mjs'
const VERSION_CHECK_ARG = '${CLAUDE_PROJECT_DIR}/.claude/fleet/version-check.mjs'

// The hooks the fleet registers once in .claude/settings.json: the event, the
// entry it adds, and what `verify` calls it when it is missing.
export const HOOKS = [
  {
    event: 'PreToolUse',
    arg: GUARD_ARG,
    name: 'the guard hook',
    entry: { matcher: 'Bash|PowerShell', hooks: [{ type: 'command', command: 'node', args: [GUARD_ARG], timeout: 10 }] },
  },
  {
    event: 'SessionStart',
    arg: VERSION_CHECK_ARG,
    name: 'the version check hook',
    entry: { matcher: 'startup|resume', hooks: [{ type: 'command', command: 'node', args: [VERSION_CHECK_ARG], timeout: 10 }] },
  },
]

const posix = (p) => p.split(sep).join('/')

// Line endings are the checkout's business (core.autocrlf), not a change.
export function hash(text) {
  return createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex').slice(0, 16)
}

function walk(dir, base = dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walk(full, base))
    else out.push(posix(relative(base, full)))
  }
  return out.sort()
}

export function semverTags(lines) {
  const parse = (t) => t.slice(1).split('.').map(Number)
  return lines
    .map((l) => /refs\/tags\/(v\d+\.\d+\.\d+)$/.exec(l.trim())?.[1])
    .filter(Boolean)
    .sort((a, b) => {
      const [x, y] = [parse(a), parse(b)]
      return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]
    })
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function latestTag(source) {
  const tags = semverTags(git(['ls-remote', '--tags', '--refs', source]).split('\n'))
  if (!tags.length) throw new Error(`no vX.Y.Z tag in ${source}`)
  return tags.at(-1)
}

// A released version, checked out into a temp directory.
function fetchVersion(source, ref) {
  const dir = mkdtempSync(join(tmpdir(), 'claude-fleet-'))
  git(['-c', 'core.autocrlf=false', 'clone', '-q', '--depth', '1', '--branch', ref, source, dir])
  return { dir, version: ref, commit: git(['rev-parse', 'HEAD'], dir), cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

// A working checkout of the fleet repo, for trying a change before it is released.
function localVersion(dir) {
  const commit = git(['rev-parse', 'HEAD'], dir)
  const dirty = git(['status', '--porcelain'], dir) !== ''
  return { dir, version: `dev-${commit.slice(0, 7)}${dirty ? '-dirty' : ''}`, commit, cleanup: () => {} }
}

export function readLock(project) {
  const path = join(project, LOCK)
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null
}

// Files of the lock that are missing or edited in the project.
export function drift(project, lock) {
  const out = []
  for (const [file, sum] of Object.entries(lock.files)) {
    const path = join(project, file)
    if (!existsSync(path)) out.push(`${file}: missing`)
    else if (hash(readFileSync(path, 'utf8')) !== sum) out.push(`${file}: edited`)
  }
  return out
}

export function hookInstalled(settings, hook = HOOKS[0]) {
  return (settings.hooks?.[hook.event] ?? []).some((entry) =>
    (entry.hooks ?? []).some((h) => (h.args ?? []).includes(hook.arg)),
  )
}

// Adds the fleet's hooks that are not registered yet; returns their names.
export function registerHooks(project) {
  const path = join(project, '.claude/settings.json')
  const settings = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {}
  const added = HOOKS.filter((hook) => !hookInstalled(settings, hook))
  if (!added.length) return []
  settings.hooks ??= {}
  for (const hook of added) {
    settings.hooks[hook.event] ??= []
    settings.hooks[hook.event].push(hook.entry)
  }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(settings, null, 2) + '\n')
  return added.map((hook) => hook.name)
}

function changelogBetween(dir, from, to) {
  const path = join(dir, 'CHANGELOG.md')
  if (!existsSync(path)) return ''
  const text = readFileSync(path, 'utf8')
  const sections = text.split(/^(?=## )/m).filter((s) => s.startsWith('## '))
  const version = (s) => /^## (v\d+\.\d+\.\d+)/.exec(s)?.[1]
  const out = []
  for (const s of sections) {
    if (version(s) === from) break
    out.push(s.trim())
    if (version(s) === to && !from) break
  }
  return out.join('\n\n')
}

// Copy a fetched version into the project. Refuses over local edits unless forced.
export function apply(project, fetched, source, { force = false } = {}) {
  const old = readLock(project)
  if (old && !force) {
    const edited = drift(project, old).filter((d) => d.endsWith('edited'))
    if (edited.length) {
      throw new Error(
        `the fleet's files were edited in this project:\n  ${edited.join('\n  ')}\n` +
          'Move the change to the fleet repo, or re-run with --force to overwrite it.',
      )
    }
  }
  const payload = join(fetched.dir, 'payload')
  const files = {}
  for (const file of walk(payload)) {
    const text = readFileSync(join(payload, file), 'utf8')
    const target = join(project, file)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, text)
    files[file] = hash(text)
  }
  const removed = []
  for (const file of Object.keys(old?.files ?? {})) {
    if (files[file] || !existsSync(join(project, file))) continue
    rmSync(join(project, file))
    removed.push(file)
  }
  const lock = { source, version: fetched.version, commit: fetched.commit, files }
  writeFileSync(join(project, LOCK), JSON.stringify(lock, null, 2) + '\n')
  const hooked = registerHooks(project)
  let projectFile = false
  const template = join(fetched.dir, 'payload', TEMPLATE)
  if (!existsSync(join(project, PROJECT_FILE)) && existsSync(template)) {
    mkdirSync(dirname(join(project, PROJECT_FILE)), { recursive: true })
    writeFileSync(join(project, PROJECT_FILE), readFileSync(template, 'utf8'))
    projectFile = true
  }
  return { from: old?.version ?? null, to: lock.version, written: Object.keys(files), removed, hooked, projectFile, notes: changelogBetween(fetched.dir, old?.version, lock.version) }
}

// What `verify` reports: copied files missing or edited, a trial version, a
// hook of the fleet's not registered.
export function verifyProblems(project, lock) {
  const problems = drift(project, lock)
  if (!/^v\d+\.\d+\.\d+$/.test(lock.version)) problems.push(`${LOCK}: ${lock.version} is a trial install, not a released version`)
  const path = join(project, '.claude/settings.json')
  const settings = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {}
  for (const hook of HOOKS) {
    if (!hookInstalled(settings, hook)) problems.push(`.claude/settings.json: ${hook.name} is not registered`)
  }
  return problems
}

function report(result) {
  console.log(`fleet ${result.from ? `${result.from} -> ` : ''}${result.to}: ${result.written.length} files written`)
  for (const f of result.removed) console.log(`  removed ${f} (no longer in the fleet)`)
  for (const name of result.hooked) console.log(`  ${name} registered in .claude/settings.json`)
  if (result.projectFile) console.log(`  ${PROJECT_FILE} written from the template: fill it in, it is this project's own file`)
  if (result.notes) console.log(`\n${result.notes}\n`)
  console.log('Then `node .claude/fleet/fleet.mjs doctor --fix`, review the diff, and commit it as one change: "Fleet <version>".')
}

function option(args, name) {
  const i = args.indexOf(name)
  if (i < 0) return undefined
  const value = args[i + 1]
  args.splice(i, 2)
  return value
}

export async function main(argv) {
  const args = [...argv]
  const command = args.shift()
  const force = args.includes('--force')
  if (force) args.splice(args.indexOf('--force'), 1)
  const here = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

  if (command === 'install') {
    const from = option(args, '--from')
    const ref = option(args, '--ref')
    const source = option(args, '--source') ?? DEFAULT_SOURCE
    const project = resolve(args[0] ?? '.')
    const fetched = from ? localVersion(resolve(from)) : fetchVersion(source, ref ?? latestTag(source))
    try {
      report(apply(project, fetched, source, { force }))
    } finally {
      fetched.cleanup()
    }
    return 0
  }

  const project = here
  const lock = readLock(project)
  if (!lock) {
    console.error(`no ${LOCK} here: install the fleet first (README of senyaak/claude-fleet)`)
    return 1
  }

  if (command === 'verify') {
    const problems = verifyProblems(project, lock)
    for (const p of problems) console.log(p)
    console.log(problems.length ? `fleet ${lock.version}: ${problems.length} problem(s)` : `fleet ${lock.version}: intact`)
    return problems.length ? 1 : 0
  }

  if (command === 'doctor') {
    const gh = (ghArgs) => execFileSync('gh', ghArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    console.log(`fleet ${lock.version} in ${project}:`)
    const left = doctor(project, {
      gh,
      verifyProblems: () => verifyProblems(project, lock),
      registerHooks: () => registerHooks(project),
      fix: args.includes('--fix'),
    })
    return left ? 1 : 0
  }

  if (command === 'check') {
    const latest = latestTag(lock.source)
    console.log(latest === lock.version ? `fleet ${lock.version} is the newest` : `fleet ${lock.version} -> ${latest} is out: node ${LOCK.replace('fleet.lock.json', 'fleet.mjs')} update`)
    return 0
  }

  if (command === 'update') {
    const from = option(args, '--from')
    const fetched = from ? localVersion(resolve(from)) : fetchVersion(lock.source, args[0] ?? latestTag(lock.source))
    try {
      report(apply(project, fetched, lock.source, { force }))
    } finally {
      fetched.cleanup()
    }
    return 0
  }

  console.error('usage: fleet.mjs check | update [vX.Y.Z] | verify | doctor [--fix] | install <project> [--ref vX.Y.Z] [--from <dir>]')
  return 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = await main(process.argv.slice(2))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
