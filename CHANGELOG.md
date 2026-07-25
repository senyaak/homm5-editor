# Changelog

What changed in each released build. The version here is the one the packaged
app reports and the one a `v*` tag publishes; `release.yml` lifts the matching
section into the release notes, so this file is what people read on GitHub.

Written for someone deciding whether to update: what was wrong, and what they
would have seen.

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
