# Changelog

What changed in each released build. The version here is the one the packaged
app reports and the one a `v*` tag publishes; `release.yml` lifts the matching
section into the release notes, so this file is what people read on GitHub.

Written for someone deciding whether to update: what was wrong, and what they
would have seen.

`## Unreleased` collects what has landed since the last tag. `release.yml` finds
its section by version number, so this heading is inert until it is renamed to
one.

## Unreleased

### Added

- **Creatures and buildings can move.** The map has always drawn every object
  frozen in the pose its model was exported in — the pose the original editor
  shows too. The new **Idle stance** button plays what the game plays when
  nothing is happening: a gremlin fidgets, a dwelling's chains swing, a phoenix
  works its wings.

  It cycles three states, and starts at **off**, which is not a paused loop:
  with it off the scene is built without any of the animation data, so a map you
  are only editing costs exactly what it did before — the payload of an animated
  creature is otherwise about twice the size. **Visible** re-poses only what the
  camera can see; **all** keeps everything moving, on screen or not. An animated
  object also stops sharing a draw call with its identical neighbours, which is
  why there is a middle setting at all.

  Turning it on needs the map reopened — the scene it decides has to be built
  differently, not redrawn — and the button says so rather than appearing to do
  nothing. Between **visible** and **all** it switches at once.

  Reading the animations meant working out two formats the editor had never
  touched: the animation files are not the game's own container but RAD's Granny
  GR2, and most of them are packed with RAD's Oodle1 codec, which is now decoded
  here rather than handed to the 32-bit DLL the game ships. 2837 of the 2839
  packed files come apart, and 105 of the 106 idle clips the game references.

### Known limitations

- One building's idle — the Orc `ShamanOfNommads` — is among the two files that
  still do not decompress, so it stands as still as before. Anything that fails
  to read falls back to the frozen mesh rather than disappearing.
- Only the idle clip is played. Creatures also ship combat animations (attack,
  move, hit, death) and those are read correctly, but nothing on the adventure
  map has a reason to play them yet.
- Rotations are sampled from their curves rather than evaluated exactly as the
  engine does. On an idle loop seen from the map camera there is nothing to see;
  it is written down as the one place in the chain that is close rather than
  measured.

## 0.1.2 — 2026-07-26

### Fixed

- **The editor opened and then did nothing.** The window came up with its
  toolbar, the map list said "loading…" and never stopped, and no button did
  anything — including Open map and New map. On a machine whose graphics driver
  gives Chromium no 3D context, the first thing the editor sets up failed, and
  that stopped everything after it from loading: every button, and the map list
  itself. The window still looked fine, because the toolbar and that "loading…"
  are part of the page rather than signs of a working editor.

  It now says what happened, alongside what this machine's graphics report, and
  offers to restart drawing in software instead — several times slower, but it
  needs nothing from the driver. While that is on, the editor says so and offers
  the GPU back in one click. Any other failure this early gets the same
  treatment: a message you can copy, rather than a window that ignores you.

## 0.1.1 — 2026-07-25

### Fixed

- **Setup opened onto nothing.** Answering the first-run screen closed it and
  the app was gone; starting the exe a second time worked, because by then the
  answers were saved and setup no longer ran — so it looked like setup had not
  taken. Setup destroyed its own window, which leaves the app with no windows
  open for an instant, and Electron reads that as the app being finished. It
  now hides its window and hands over, and the editor's window is up before
  anything closes.

## 0.1.0 — 2026-07-25

The first build that can be handed to someone: a folder with `homm5-editor.exe`
in it, no installer, no Node, no checkout.

### Added

- **A standalone Windows build.** `npm run dist` bundles the main process, the
  preloads and the renderer, and packages them into
  `dist/homm5-editor-win32-x64/`. Nothing at runtime needs `node_modules` or a
  TypeScript loader.
- **A first-run setup screen.** A packaged editor has no checkout to take its
  bearings from, so it asks where the game is installed and where the unpacked
  data should go, then unpacks the archives itself with a progress bar. The
  answers live in `settings.json` under the user's app-data folder;
  `homm5-editor.exe --setup` reopens the screen when they go stale, and
  `HOMM5_ROOT` / `HOMM5_DATA` still win over what was remembered.
- **Releases built by GitHub.** A `v*` tag runs the typecheck and the tests
  that need no game data, packages, and publishes the zip.

### Fixed

- **Two thirds of the game went missing when unpacking.** A fresh unpack
  produced a data root with the geometry present and almost no object
  definitions — 16 files where there should be 5225 — so maps opened as
  "3557 objects, placed 0, no model 3557" and the palette offered seven
  objects. The end-of-central-directory record counts entries in sixteen bits,
  and `data.pak` holds 84,312 of them: its header says 18,776, the same number
  modulo 65536, with no ZIP64 record to correct it. Both archive readers
  believed that count. They now walk the directory to its end and never consult
  it.

### Known limitations

- The build is not code-signed, so Windows SmartScreen warns about an unknown
  publisher: *More info → Run anyway*. That needs a certificate from a
  certificate authority, not a packaging flag.
- The editor needs the game itself — it reads its models, textures and rosters,
  and ships none of them.
- Windows x64 only.
