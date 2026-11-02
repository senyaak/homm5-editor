# The game, its installs, and the owner's part

The owner plays; agents build, test and read. Everything here follows from
that split.

## Nothing that opens a window is launched by an agent

Not the game (`H5_Game*.exe`), not the editor with a window, not the packaged
app. Not "just for twelve seconds", and not after asking: asking to launch is
the same takeover of the owner's machine with one extra turn. A launch of ours
puts a window over the owner's work, sends the owner's next action into the
wrong install, rotates the logs, and costs an hour of working out who started
what where (31.07, 07.08 and twice on 09.09.2026).

The one exception is the **batch map editor** (`H5_MapEditor_H5E.exe --rmg`,
`tools/rmg-batch.ts`): it shows nothing and closes by itself, so it is run
without asking. Kill the previous process before each run — a single-instance
editor silently hands the arguments to the old one, and a live editor holds
the DLL, so an install beside it fails without a word.

A broad "do it yourself" about something nearby never extends to the game.

## Handing a check to the owner

Bring the work to "it only needs pressing", then hand over:

- what to start and WHERE — the full path, because the installs differ;
- one or two things to SEE in the game (the morale hint, the AI's turn without
  a crash, such-and-such a window). Never "look for these lines in the log":
  logs are the agent's to read, and the owner's attention belongs on the
  screen (19.09.2026);
- that the install is already prepared — DLL, config lines, the map — so
  nothing has to be looked for.

Afterwards the agent opens the fresh log itself and reports. While the owner
plays, the agent goes on with the plan rather than waiting.

When a meaning cannot be derived from the data, ask for ONE reading from the
game ("open town X and say what is built") instead of trying a fifth indirect
way — and pin the answer down in a test that goes red if the layout is broken.

Objects put on a probe map to be LOOKED at stand on the hero's line, to his
left, nearest first (hero at 28,34 → 24, 20, 16, 12 along y=34). A row
eighteen tiles to the side is not found, and two launches went on that.

## Installs

- **A worktree isolates the code, not the game.** `bin/` (the DLL,
  `H5_Game_H5E.exe`, the extension's config files), `H5E/` and `data/` are
  shared by every session that points at that install. A session never
  installs into an install another session is using — that is how a branch's
  DLL once broke a parallel session (31.07.2026).
- **A branch that needs an installed build gets its own copy of the game**
  (about 3 GB, robocopy in half a minute) and every tool runs with
  `--game <copy>` / `HOMM5_GAME`. Other sessions' copies are not borrowed.
  Repositories do not live inside an install either.
- **A copy isolates the binaries and `data/`, not the profile**: settings and
  saves sit in `Documents\My Games\…` for every install on the machine (the
  mod's `own-profile` flag is the cure, [docs/QOL.md](../QOL.md)).
- **An install of one's own is expendable.** A test resets it wholesale —
  remove `H5E/homm5-editor.h5u`, the executable, the extension, build again —
  with a copy beside it (`_tmp/mod-backup/`) so a rollback is one copy. No
  careful extraction lists: a skipped reset is worse than a crude one. A crash
  of the game during reverse engineering is expendable too; probe first only
  when the probe is cheaper than the attempt.
- **The ceiling and the archive are one pair.** "Empty pointer to creature
  # 180" at start-up means the executable's ceiling was raised and
  `homm5-editor.h5u`, which defines those ids, is not mounted. A copy that
  keeps the patched `bin/` and drops `H5E/` does not start; a vanilla copy
  needs the ceilings put back (`setCreatureLimit` / `setArtifactLimit`).
- **The game starts with `bin/` as its working directory** — exactly what a
  double click gives. With the install's root it starts, plays, writes maps
  where it should, and quietly breaks creature models (29.07.2026). Any launch
  from our code sets `cwd = <game>/bin`.

Where the patched build reads and writes (`H5E/`, the five mount masks, the
generator's output) is [engineInternals/MODS_AND_MAPS.md](../engineInternals/MODS_AND_MAPS.md).
