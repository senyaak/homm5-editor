# The guard

[guard.mjs](guard.mjs) is a `PreToolUse` hook on the Bash and PowerShell tools.
It refuses a command that breaks one of the rules below before it runs, and
the refusal's reason tells the session what to do instead. A rule that lives
only in prose holds most of the time; these must hold every time.

The installer registers it in the project's `.claude/settings.json`:

```json
{ "matcher": "Bash|PowerShell",
  "hooks": [{ "type": "command", "command": "node",
              "args": ["${CLAUDE_PROJECT_DIR}/.claude/fleet/guard.mjs"], "timeout": 10 }] }
```

Exec form — `command` plus `args` — starts `node` directly, with no shell in
between, so the hook is the same on Windows and Linux: no shebang, no execute
bit, no Git Bash or `sh` quirks.

## In every session of the project

The owner's commit rules hold wherever the fleet is installed, the owner's
own sessions included:

| refused | why |
| - | - |
| `git add -A`, `--all`, `.`, `:/`, `-u` | other sessions leave work in progress in the tree; stage by name |
| `git commit`, `rebase`, `cherry-pick`, `revert`, `am`, `merge`, and a `git pull` that rebases (`--rebase`, `-r`, `-c pull.rebase=…`), without `GIT_COMMITTER_NAME="Claude …"` and `GIT_COMMITTER_EMAIL="noreply@anthropic.com"` | Claude is the committer of every commit it writes ([workflow.md](workflow.md) § Commit) |
| a `Co-Authored-By` trailer in `-m` or in the `-F` file | Claude is already the committer |
| `--no-verify`, `git commit -n` | the repo's own checks are fixed, not skipped |
| `gh pr merge`, and `gh api -X PUT …/pulls/<n>/merge` (or `--method PUT`) | a GitHub merge commits as GitHub; the merger fast-forwards |

`git merge --ff-only`, `git pull --no-rebase` / `--rebase=false`, and
`--abort`/`--skip`/`--quit` are not refused by this rule.

## In a fleet session

A session is a fleet session when `FLEET_SLOT` is set in its environment (a
slot's `.claude/settings.local.json` sets it under `env`, and a cloud
environment can set it too), when it runs in a slot directory
(`<name>-fleet-<n>`, or `slot-<n>/<checkout>`), or when the hook fires inside
a subagent of a fleet role (`planner`, `developer`, `reviewer`, `merger`,
`reader`), or when it is a cloud session (`CLAUDE_CODE_REMOTE=true`) and
`docs/fleet/project.md` has `cloud: fleet` in its front matter. Without that
key a cloud session is an owner session. There, also:

| refused | why |
| - | - |
| the PowerShell tool | slots pre-allow Bash only, and PowerShell mangles UTF-8 |
| any push to `master` or `main` but `git push origin <sha>:<base>` | only the merger moves the base, as a fast-forward of an approved head |
| a forced push to the base, `+<sha>:<base>`, deleting it | the base only moves forward |
| a plain `--force` / `-f` push | a fix rewrites its branch with `--force-with-lease=<branch>:<head>` only |
| `--mirror`, `--all` | a session pushes its own branch by name |

## The version check

[version-check.mjs](version-check.mjs) is registered beside the guard, once,
as a `SessionStart` hook in the same exec form:

```json
{ "matcher": "startup|resume",
  "hooks": [{ "type": "command", "command": "node",
              "args": ["${CLAUDE_PROJECT_DIR}/.claude/fleet/version-check.mjs"], "timeout": 10 }] }
```

In an owner session it asks the fleet repo for its tags (`git ls-remote`, at
most 3 seconds, never prompting for a credential) and, when a newer release
than the lock's is out, prints one line into the session's context. A fleet
session, as defined above, gets nothing; so does any failure. It never
updates anything ([updating.md](updating.md)).

## What it cannot see

It reads the command text. A command assembled at run time (`eval`, a script
that runs git) passes unseen, and so does a commit made by a tool other than
git. The rules stay in the roles; the guard is the net under them, not the
whole of them.

A refusal that blocks legitimate work is a `fleet-process` report, and the fix
lands in the fleet repo with a test (`test/guard.test.mjs` there).
