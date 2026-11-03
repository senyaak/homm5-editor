// The fleet's guard: a PreToolUse hook that refuses the commands the fleet's
// rules forbid, before they run. A rule written only as prose is followed most
// of the time; these are the ones that must hold every time.
//
// It runs in exec form — `node <project>/.claude/fleet/guard.mjs`, no shell —
// so it behaves the same on Windows and Linux, and needs no shebang and no
// execute bit. The rules are listed in guard.md beside this file.
//
// Two scopes. EVERY session in a project that has the fleet installed keeps the
// commit rules: they are the owner's rules wherever the fleet is. A FLEET
// session also keeps master to the merger's form and stays off PowerShell. A
// session is a fleet session when FLEET_SLOT is set, when it runs in a slot
// (`<anything>-fleet-<n>`), when the hook fires inside one of the fleet's
// role subagents, or when it is a cloud session (CLAUDE_CODE_REMOTE=true) of a
// project whose docs/fleet/project.md says `cloud: fleet`.
//
// A guard that fails must not stop the session: unreadable input is allowed
// through, and the rules are tested in the fleet repo instead.

import { existsSync, readFileSync } from 'node:fs'
import { basename, isAbsolute, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { frontMatter, PROJECT_FILE } from './doctor.mjs'

const BASES = new Set(['master', 'main'])
const ROLES = new Set(['planner', 'developer', 'reviewer', 'merger', 'reader'])
const COMMITTING = new Set(['commit', 'rebase', 'cherry-pick', 'revert', 'am', 'merge'])
// git's global options that take a value as the next word
const GIT_VALUE_OPTIONS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace'])

// Split a shell command into simple commands, each a list of words with the
// quotes removed. Enough of the shell for the commands agents write: quotes,
// backslash escapes, and the separators && || ; | & and newlines. Substitutions
// stay inside their word, which is all the rules below need.
export function simpleCommands(command) {
  const commands = []
  let words = []
  let word = ''
  let inWord = false
  let quote = null
  const endWord = () => {
    if (inWord) words.push(word)
    word = ''
    inWord = false
  }
  const endCommand = () => {
    endWord()
    if (words.length) commands.push(words)
    words = []
  }
  for (let i = 0; i < command.length; i++) {
    const c = command[i]
    if (quote === "'") {
      if (c === "'") quote = null
      else word += c
      continue
    }
    if (quote === '"') {
      if (c === '"') quote = null
      else if (c === '\\' && i + 1 < command.length && '"\\$`'.includes(command[i + 1])) word += command[++i]
      else word += c
      continue
    }
    if (c === "'" || c === '"') {
      quote = c
      inWord = true
    } else if (c === '\\' && i + 1 < command.length) {
      if (command[i + 1] !== '\n') {
        word += command[i + 1]
        inWord = true
      }
      i++
    } else if (c === ' ' || c === '\t') {
      endWord()
    } else if (c === '\n' || c === ';' || c === '|' || c === '&') {
      endCommand()
    } else {
      word += c
      inWord = true
    }
  }
  endCommand()
  return commands
}

// Leading NAME=value words and an `env` prefix are the command's environment.
function splitEnv(words) {
  const env = {}
  let i = 0
  if (words[0] === 'env') i = 1
  for (; i < words.length; i++) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s.exec(words[i])
    if (!m) break
    env[m[1]] = m[2]
  }
  return { env, rest: words.slice(i) }
}

// `git [global options] <subcommand> <args>` → { sub, args, config }, config
// the `-c name=value` settings of the call, names lower-cased
function gitCall(words) {
  if (words[0] !== 'git' && !/[\\/]git(\.exe)?$/.test(words[0] ?? '')) return null
  const config = {}
  let i = 1
  while (i < words.length && words[i].startsWith('-')) {
    if (words[i] === '-c') {
      const m = /^([^=]+)(?:=(.*))?$/s.exec(words[i + 1] ?? '')
      if (m) config[m[1].toLowerCase()] = m[2] ?? 'true'
    }
    i += GIT_VALUE_OPTIONS.has(words[i]) ? 2 : 1
  }
  if (i >= words.length) return null
  return { sub: words[i], args: words.slice(i + 1), config }
}

// `git pull` rebases with --rebase / -r / --rebase=<not false>, or with
// pull.rebase set by -c; --no-rebase and --rebase=false merge.
function pullRebases(args, config) {
  let rebase = config['pull.rebase'] !== undefined && config['pull.rebase'] !== 'false'
  for (const a of args) {
    if (a === '--rebase' || a === '-r') rebase = true
    else if (a.startsWith('--rebase=')) rebase = a.slice(9) !== 'false'
    else if (a === '--no-rebase') rebase = false
  }
  return rebase
}

// `gh api <path> -X PUT` on `…/pulls/<n>/merge` is `gh pr merge` by another name.
function ghApiMerge(words) {
  if (words[0] !== 'gh' || words[1] !== 'api') return false
  let method = null
  const positional = []
  for (let i = 2; i < words.length; i++) {
    const a = words[i]
    if (a === '-X' || a === '--method') method = words[++i] ?? ''
    else if (a.startsWith('--method=')) method = a.slice(9)
    else if (/^-X./.test(a)) method = a.slice(2)
    else if (!a.startsWith('-')) positional.push(a)
  }
  return String(method).toUpperCase() === 'PUT' && positional.some((p) => /(^|\/)pulls\/[^/]+\/merge\/?(\?.*)?$/.test(p))
}

function messages(args, cwd) {
  const found = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '-m' || a === '--message') found.push(args[i + 1] ?? '')
    else if (a.startsWith('--message=')) found.push(a.slice(10))
    else if (/^-m./.test(a)) found.push(a.slice(2))
    else if (a === '-F' || a === '--file' || a.startsWith('--file=')) {
      const path = a.startsWith('--file=') ? a.slice(7) : args[i + 1]
      if (!path || path === '-') continue
      const full = isAbsolute(path) || !cwd ? path : join(cwd, path)
      try {
        if (existsSync(full)) found.push(readFileSync(full, 'utf8'))
      } catch {
        // an unreadable file is git's problem, not the guard's
      }
    }
  }
  return found
}

function committerReason(sub, args, config, env, processEnv) {
  if (sub === 'pull') {
    if (!pullRebases(args, config)) return null
    sub = 'pull --rebase'
  } else if (!COMMITTING.has(sub)) return null
  const passive = ['--abort', '--quit', '--skip', '--edit-todo', '--show-current-patch']
  if (args.some((a) => passive.includes(a))) return null
  if (sub === 'merge' && args.includes('--ff-only')) return null
  const name = env.GIT_COMMITTER_NAME ?? processEnv.GIT_COMMITTER_NAME
  const email = env.GIT_COMMITTER_EMAIL ?? processEnv.GIT_COMMITTER_EMAIL
  if (!name || !/^Claude\b/.test(name) || email !== 'noreply@anthropic.com') {
    return `git ${sub} writes commits, and every commit names Claude as the committer: prefix it with GIT_COMMITTER_NAME="Claude <the model actually running>" GIT_COMMITTER_EMAIL="noreply@anthropic.com" (.claude/fleet/workflow.md § Commit).`
  }
  return null
}

function pushReason(args) {
  const flags = args.filter((a) => a.startsWith('-'))
  const positional = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '-o' || a === '--push-option' || a === '--repo' || a === '--receive-pack') {
      i++
      continue
    }
    if (!a.startsWith('-')) positional.push(a)
  }
  if (flags.some((f) => f === '--mirror' || f === '--all')) {
    return 'git push --mirror/--all is never a fleet push: push your own branch by name.'
  }
  const plainForce = flags.some((f) => f === '--force' || f === '-f' || /^-[a-zA-Z]*f/.test(f) && !f.startsWith('--'))
  if (plainForce) {
    return 'A plain --force push is refused: use --force-with-lease=<branch>:<the head you expect>, and only while you hold the fix claim (.claude/fleet/workflow.md § Branch).'
  }
  const leased = flags.some((f) => f.startsWith('--force-with-lease') || f.startsWith('--force-if-includes'))
  const deleting = flags.some((f) => f === '--delete' || f === '-d')
  for (const spec of positional.slice(1)) {
    const plus = spec.startsWith('+')
    const [src, dst] = spec.replace(/^\+/, '').includes(':') ? spec.replace(/^\+/, '').split(':') : [spec, spec]
    const target = (dst || '').replace(/^refs\/heads\//, '')
    if (!BASES.has(target)) continue
    if (deleting || src === '') return `Deleting ${target} is refused.`
    if (plus || leased) return `${target} only ever moves forward: no forced push to it.`
    if (!/^[0-9a-f]{7,40}$/.test(src)) {
      return `Only the merger pushes ${target}, and only as a fast-forward of an approved head: git push origin <head-sha>:${target} (reviewer.md § Merger).`
    }
  }
  return null
}

function bashReasons(command, cwd, fleet, processEnv) {
  const reasons = []
  for (const words of simpleCommands(command)) {
    const { env, rest } = splitEnv(words)
    if ((rest[0] === 'gh' && rest[1] === 'pr' && rest[2] === 'merge') || ghApiMerge(rest)) {
      reasons.push('A GitHub merge commits as GitHub, not as Claude: the merger fast-forwards instead (reviewer.md § Merger).')
      continue
    }
    const git = gitCall(rest)
    if (!git) continue
    const { sub, args, config } = git
    if (sub === 'add' && args.some((a) => ['-A', '--all', '.', ':/', '-u', '--update'].includes(a))) {
      reasons.push('Stage your own files by name: other sessions leave work in progress in this tree (.claude/fleet/workflow.md § Commit).')
    }
    if ((sub === 'commit' || sub === 'push' || sub === 'merge' || sub === 'rebase') && args.includes('--no-verify')) {
      reasons.push('--no-verify skips the repo\'s own checks: fix what they report instead.')
    }
    if (sub === 'commit' && args.includes('-n')) {
      reasons.push('git commit -n skips the repo\'s own checks: fix what they report instead.')
    }
    const committer = committerReason(sub, args, config, env, processEnv)
    if (committer) reasons.push(committer)
    if (sub === 'commit' && messages(args, cwd).some((m) => /co-authored-by:/i.test(m))) {
      reasons.push('No Co-Authored-By trailer: Claude is already the committer.')
    }
    if (fleet && sub === 'push') {
      const push = pushReason(args)
      if (push) reasons.push(push)
    }
  }
  return reasons
}

// A cloud session is a fleet session only where the project says so.
export function cloudIsFleet(dir) {
  try {
    const path = join(dir, PROJECT_FILE)
    return existsSync(path) && frontMatter(readFileSync(path, 'utf8'))?.cloud === 'fleet'
  } catch {
    return false
  }
}

export function isFleetSession(input, processEnv) {
  if (processEnv.FLEET_SLOT) return true
  if (input.agent_type && ROLES.has(String(input.agent_type).replace(/^.*:/, ''))) return true
  // the two slot layouts in use: `<name>-fleet-<n>`, and `slot-<n>/<checkout>`
  const dir = (processEnv.CLAUDE_PROJECT_DIR || input.cwd || '').replace(/[\\/]+$/, '')
  if (/-fleet-\d+$/.test(basename(dir)) || dir.split(/[\\/]/).some((part) => /^slot-\d+$/.test(part))) return true
  return processEnv.CLAUDE_CODE_REMOTE === 'true' && dir !== '' && cloudIsFleet(dir)
}

// The decision for one hook input: null to let the call through, or the reason
// it is refused.
export function decide(input, processEnv = process.env) {
  const fleet = isFleetSession(input, processEnv)
  if (input.tool_name === 'PowerShell') {
    return fleet ? 'Fleet sessions use the Bash tool only: the slot pre-allows Bash commands, and PowerShell mangles UTF-8 (.claude/fleet/workflow.md § Commands and waiting).' : null
  }
  if (input.tool_name !== 'Bash') return null
  const command = input.tool_input?.command
  if (typeof command !== 'string') return null
  const reasons = bashReasons(command, input.cwd, fleet, processEnv)
  return reasons.length ? [...new Set(reasons)].join(' ') : null
}

async function main() {
  let text = ''
  for await (const chunk of process.stdin) text += chunk
  let input
  try {
    input = JSON.parse(text)
  } catch {
    return
  }
  const reason = decide(input)
  if (!reason) return
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `[fleet guard] ${reason}`,
      },
    }),
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
