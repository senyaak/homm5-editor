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

- **Every map lights like itself.** The editor used to light every map with one
  built-in daylight; now it reads the map's own `AmbientLight` preset — sun
  colour and direction, ambient and shade — and applies it per floor, so a
  night map opens dark, an underground floor stops looking like noon, and the
  burnt Griffin Empire opens under the sombre light its designers chose. The
  ground and the building mounds on it are lit with the game's own formula in
  the game's own colour space; two things had to be learned for the picture to
  come out right rather than as a permanent dusk: the game multiplies colours
  in gamma space (so its ×2 is three.js's ×4.6), and the preset's sun angle
  counts from the zenith, not the horizon. Written up in docs/LIGHTING.md,
  including why the preset's "Sky" is a set of reflection blobs and not a sky.

- **The designers' point lights pool on the ground.** The violet glow under an
  underground crystal, the torch light on a mine wall, the red wash of a lava
  chamber — that light was never in the lighting preset or the effects: every
  placed object in a map file can carry its own point lights, and the shipped
  maps carry about ten thousand eight hundred of them. The editor bakes each
  floor's lights into a lightmap the ground is lit through, in the same colour
  space as the rest of the game's formula, so an underground floor now looks
  like the cave the designers lit rather than a uniformly dark room. The pools
  follow their object when it is dragged and die with it when it is deleted.
  Objects standing in a pool are not yet tinted by it — the ground is.

- **Particle effects play.** Campfires burn, mana crystals spark, portals
  shimmer — every effect a placed object references is drawn and moving, not
  as an approximation but as the game's own frames: `bin/effects` — the last
  unknown format between the editor and the game's full picture — turned out
  to be a baked simulation. The effects were authored as Maya particle
  systems, and what shipped is the recording: 1.69 million particles with 41.8
  million keyframes for position, rotation, size, colour and texture frame.
  Nothing to simulate, only keys to interpolate, so playback is exact by
  construction. The parser reads the entire library with every byte accounted
  for (docs/EFFECTS_FORMAT.md, `npm run test-effects`); the static glow cards
  that used to stand in stay as fallbacks. Known simplifications (blending is
  inferred from the art, loop windows and wind are ignored) are written up in
  the format doc.

- **Creatures play their own effects.** The ghost dragon stands in its swirling
  cloud mist with glowing eyes, the fire elemental burns, the water elemental
  churns. These effects were invisible to the editor because they hang off a
  different hook than an object's: every monster's own effect slot is empty,
  and the real one rides the idle animation clip. Two discoveries along the
  way: an instance can be glued to a skeleton bone (the eyes are two particles
  around the head bone's origin — the bone's rest pose, read from the
  animation file, is folded in; a bone that can't be found drops the instance
  rather than drawing it at the creature's feet), and the baked particle
  colours are authored around 128-is-full-brightness — the same era's
  modulate-×2 the terrain lighting uses — so the mist rendered near-black
  until the colour stage doubled it. The doubling clamps where effects were
  already saturated, so campfires stay campfires.

- **Effects and Light join the view toggles.** Next to Idle stance the bar now
  carries **Effects: on/off** (stop the particles moving and drawing) and
  **Light: map/flat** — the floor lit as the game lights it, or the editor's
  flat neutral look, because a designer-lit underground is atmospheric and
  nearly black, and editing it means wanting the lights off. Both choices
  stick between sessions, cost nothing to flip, and touch nothing but the
  view: effects keep arriving and keep following their objects while hidden.

### Fixed

- **`npm start` ran a stale renderer.** The build script's am-I-being-run-
  directly check compared a file URL (spaces as `%20`) against a plain path
  (spaces literal), never matched under this repo's path, and quietly built
  nothing — every `npm start` since the bundle was last built by the test
  suite ran old renderer code. Developer-facing only; releases were built by
  CI and unaffected.

## 0.2.0 — 2026-07-27

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

  Every switch takes effect on the spot. Turning it on for a map that was opened
  without it briefly says *loading animations…* while the missing data is
  fetched and grafted onto the open scene; nothing is reopened and nothing else
  moves.

  Reading the animations meant working out two formats the editor had never
  touched: the animation files are not the game's own container but RAD's Granny
  GR2, and most of them are packed with RAD's Oodle1 codec, which is now decoded
  here rather than handed to the 32-bit DLL the game ships. The port is
  byte-for-byte identical to that DLL on every packed file in the game — checked
  against all 2839 — so every idle the game references plays, including the one
  Orc building (`ShamanOfNommads`) whose idle resisted until its quirk was read
  out of the DLL itself. Anything that ever fails to read falls back to the
  frozen mesh rather than disappearing.

  Three kinds of object needed their own rule before they looked right. A model
  is skinned against its OWN skeleton — the one inside an animation file holds
  the pose that clip starts from, not the pose the mesh was bound in, and the
  addon creatures' stances sit far enough from bind (167° for the Combat Mage)
  that the Air Elemental came apart into chunks. A model that declares no
  skeleton stays still no matter what its animation set says — the Gold Mine
  ships an idle clip it never uses, and playing it scattered the gold across
  the hill. And a clip whose bones outrun the sampling grid (the Air
  Elemental's vortex turns 171° between two default samples) is resampled
  faster until it moves smoothly instead of stuttering.

### Known limitations

- Only the idle clip is played. Creatures also ship combat animations (attack,
  move, hit, death) and those are read correctly, but nothing on the adventure
  map has a reason to play them yet.
- Rotations are sampled from their curves rather than evaluated exactly as the
  engine does — fast bones are sampled densely enough to stay smooth, but it is
  still a sampling. On an idle loop seen from the map camera there is nothing to
  see; it is written down as the one place in the chain that is close rather
  than measured.

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
