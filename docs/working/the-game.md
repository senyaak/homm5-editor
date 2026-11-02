# The game, its installs, and the owner's part

The owner plays; agents build, test and read.

## Launching

- Never launch anything that opens a window: not the game, not the editor with
  a window, not the packaged app. Do not ask to launch either. A "do it
  yourself" about something else never extends to this.
- The batch map editor (`H5_MapEditor_H5E.exe --rmg`, `tools/rmg-batch.ts`)
  shows nothing and exits by itself: run it without asking. Kill any previous
  editor process first — a running one takes the arguments and holds the DLL.

## Handing a check to the owner

- Prepare the install fully first (DLL, config lines, map).
- Hand over: what to start, the full path of the install, and one or two
  things to SEE in the game. Never "look for these lines in the log" — the
  agent reads the logs afterwards and reports.
- While the owner plays, continue with the plan.
- When the meaning of some data cannot be derived, ask for ONE observation in
  the game ("open town X, say what is built"), then pin the answer in a test.
- On a probe map, objects to LOOK at stand on the hero's line, to his left,
  nearest first.

## Installs

- An install is shared by every session pointing at it (`bin/`, `H5E/`,
  `data/`). Never install into an install another session may use.
- Work that needs an installed build gets its own copy of the game; every tool
  then runs with `--game <copy>` / `HOMM5_GAME`. Never use another session's
  copy. No repositories inside an install.
- A copy does not isolate the profile (`Documents\My Games\…`); the mod's
  `own-profile` flag does ([QOL.md](../QOL.md)).
- Your own install is expendable: reset it wholesale (remove
  `H5E/homm5-editor.h5u`, the executable, the extension; rebuild), keeping a
  copy in `_tmp/mod-backup/`. No careful per-item extraction.
- A raised creature/artifact ceiling and `homm5-editor.h5u` are one pair: never
  keep one without the other. "Empty pointer to creature # 180" at start-up
  means the archive is missing. A vanilla copy needs `setCreatureLimit` /
  `setArtifactLimit` back to shipped values.
- Launching the game from our code: `cwd = <game>/bin` — from the install root
  it runs but breaks creature models.

Where the patched build reads and writes: [engineInternals/MODS_AND_MAPS.md](../engineInternals/MODS_AND_MAPS.md).
