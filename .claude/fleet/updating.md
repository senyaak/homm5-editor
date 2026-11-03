# Taking a new version

The fleet is a dependency of the project, pinned to one released version of
`senyaak/claude-fleet` in `fleet.lock.json`: the version, its commit, and a
hash of every file it put here.

```bash
node .claude/fleet/fleet.mjs check
node .claude/fleet/fleet.mjs update
node .claude/fleet/fleet.mjs verify
node .claude/fleet/fleet.mjs doctor --fix
```

- **`check`** says whether a newer version is out.
- **`update [vX.Y.Z]`** takes it (default: the newest). It rewrites the copied
  files, removes the ones the fleet dropped, keeps the guard and the version
  check registered, and
  prints the changelog between the two versions. It refuses when a copied
  file was edited here. Review the diff and commit it as one change, `Fleet
  <version>`, through a PR like any other.
- **`verify`** checks every copied file against the lock and the hooks'
  registration (the guard and the version check), and exits 1 on a
  difference. The project's CI runs it.
- **`doctor`** checks everything else the fleet needs: `docs/fleet/project.md`
  filled in (its front matter and every section of
  [project-template.md](project-template.md)), `CLAUDE.md` pointing at the
  fleet, CI running `verify`, `gh` logged in as the owner, every repo reachable
  with its base branch, and every label the roles use. `--fix` registers the
  fleet's missing hooks and creates the missing labels; the rest it reports.
  Run it after every update — a new version may bring a new label or hook,
  and `update` runs the old copy's code, which knows only its own hooks.

**At session start** an owner session is told, in one line, when a newer
version is out: the version check hook ([guard.md](guard.md) § The version
check). It only says so; the owner decides when to `update`. A fleet session
is not told, and an offline session or one without access to the fleet repo
starts as if nothing were out.

A **major** version changes what the roles expect of `docs/fleet/project.md`;
its changelog entry says what to add or rename there, in the same commit as
the update. A minor or patch version needs nothing from the project for the
roles to work; `doctor` may still list something new to do.

## Changing the rules

The copied files are never edited in the project — a local edit would be lost
on the next update, and `verify` fails CI on it. A change goes to the fleet
repo instead:

- a `fleet-process` report whose fix is **shared** — a rule every project's
  fleet follows — becomes an issue and a PR in `senyaak/claude-fleet`, then a
  version;
- one whose fix is **this project's own** — its checks, repos, traps — changes
  `docs/fleet/project.md`, in the project, like any doc.

To try a change to the fleet before it is released, install it from a
checkout: `node <fleet checkout>/bin/fleet.mjs install . --from <fleet
checkout>`. The lock then names a `dev-<sha>` version; do not commit that.
