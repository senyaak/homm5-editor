// The fleet's version check: a SessionStart hook that tells an owner session
// when a newer release of senyaak/claude-fleet is out. What it prints goes
// into the session's context, one line; it never updates anything itself.
//
// It runs in exec form — `node <project>/.claude/fleet/version-check.mjs` —
// like the guard. A fleet session (the guard's own test) gets nothing: the
// owner decides when the project updates. Every failure — offline, no
// credential for the private repo, a slow remote, an odd lock — is silent and
// exits 0, and the remote is given at most TIMEOUT_MS, so a session start is
// never blocked.

import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { readLock, semverTags } from './fleet.mjs'
import { isFleetSession } from './guard.mjs'

export const TIMEOUT_MS = 3000
const VERSION = /^v(\d+)\.(\d+)\.(\d+)$/

function newer(a, b) {
  const [x, y] = [VERSION.exec(a).slice(1).map(Number), VERSION.exec(b).slice(1).map(Number)]
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]
}

// The remote's tags, without ever asking anyone for a credential.
export function lsRemote(source) {
  return execFileSync('git', ['ls-remote', '--tags', '--refs', source], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: TIMEOUT_MS,
    windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
  })
}

// The line for the session, or null. `list(source)` returns `git ls-remote`'s
// output, or throws; it is passed in so tests need no network.
export function versionNotice(input, processEnv, project, list = lsRemote) {
  try {
    if (isFleetSession(input, processEnv)) return null
    const lock = readLock(project)
    if (!lock || !VERSION.test(lock.version) || !lock.source) return null
    const latest = semverTags(list(lock.source).split('\n')).at(-1)
    if (!latest || newer(latest, lock.version) <= 0) return null
    return `claude-fleet ${latest} is out (this project has ${lock.version}): node .claude/fleet/fleet.mjs update`
  } catch {
    return null
  }
}

async function main() {
  let input = {}
  try {
    let text = ''
    for await (const chunk of process.stdin) text += chunk
    input = JSON.parse(text)
  } catch {
    // no input is still a session start
  }
  const here = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
  const line = versionNotice(input, process.env, process.env.CLAUDE_PROJECT_DIR || here)
  if (line) process.stdout.write(`${line}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main()
  } catch {
    // a check that fails says nothing
  }
  process.exitCode = 0
}
