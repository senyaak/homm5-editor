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

- **Dialog scenes — the cutscenes a campaign plays — open and play in the
  editor.** `Scenes…` on the launcher lists what the game ships (251 of them,
  the original campaigns' unpacked out of their archive the way a shipped map
  is) and opens one in a window of its own: the arena it is staged on, the
  props it brings, its actors on their ARENA rigs rather than their adventure
  models, and the shots down the side. Pick a shot and the camera goes exactly
  where that shot's camera is; press play and it walks the move, actors playing
  the clips the scene names on them.

  The game's own editor cannot make these — its manual says outright that
  script-based movies are "not a process intended for an unprepared user" — so
  the format had to be measured rather than read: `docs/DIALOG_SCENES.md` has
  what a scene is made of, how often each field is actually used, and how the
  camera's angles turned out to be meant (`npm run camera-shape`).

  Editing is not here yet: a scene opens, plays and closes without being
  written back. What it already proves is the whole risky half — that a scene
  resolves, draws and frames the way the game frames it.

### Fixed

- **A scene now runs on one clock, so a quarter of what it does stops being
  dropped.** A cue's delay is measured from the shot that writes it and nothing
  keeps it inside that shot: of the 7296 cues and effects the shipped scenes
  schedule, 1034 start after their shot has ended and 870 before it begins.
  Played a shot at a time, none of those ever happened — which is why the
  marksman in C1M1's opening never shot (his cue is 6.7 seconds into a
  three-second shot) and the priest's blessing was cut off after a third of a
  second. Everything is placed on the scene's own clock now, and a clip that
  runs out hands the actor back to idling instead of freezing on its last frame.

- **An actor's animation brings its own effect.** A clip names an `<Effect>`
  beside its Granny file, and that is where a caster's fire lives — the blue
  glow that runs up a knight's sword as he casts is his `buff` clip's, named
  nowhere in the scene. 45 of the 132 cues in C1M1's opening play a clip that
  carries one, so a third of what the scene did was happening in silence.

- **A spell's geometry moves, and then goes away.** Every model an effect places
  carries a skeletal clip of its own — the ice bolt falls now instead of hanging
  in the air — and that clip is also what ends it. Without one nothing did: the
  praying hands of a Prayer stayed standing inside the soldier they were cast on
  for the rest of the scene.

- **A shot's camera no longer laps its subject.** `Direction` on a camera set
  says which way the heading travels, not "go the long way round" — read the
  wrong way, 583 of the shipped moves swung most of a circle instead of 150.
  Agrael's first cast, a straight pull-back from his face to his whole army,
  orbited him.
- **An effect brings its own geometry.** Nine of the twelve effects C1M1's
  opening fires carry `<Models>` — the ice crystal of an ice bolt, the burning
  gate an arch devil steps through — and only their sparks were drawn. (Two
  pieces are still missing: a model that carries its own skeletal animation is
  drawn in the pose it starts in, and an effect's `<Lights>` are not drawn.)
- **The fallen stay down.** A clip played once was wrapped like a loop, so
  clamping it to its own length landed on frame zero — a corpse standing to
  attention — and a death was forgotten when its shot ended, so the swordsmen
  cut down in one shot were on their feet in the next.
- **A scene's armies move, and there is one of each hero.** Three things were
  wrong at once and each hid the others. A cue usually says WHICH clip by a
  number — a position in that actor's own animation set — and only sometimes by
  name; reading names alone left the heroes still through half of C1M1's
  opening and its armies still through all of it. An actor was taken to be
  whoever speaks, so the sixteen creatures saluting Isabell's speech were never
  rigged to play anything. And a hero the scene both lists and speaks through
  was placed twice, which put a second, unblinking copy of every hero inside the
  first — two demon lords in every close-up of one.
- **A shot's camera stayed put between shots.** The orbit controls rebuild the
  camera from their own state every frame, and switching them off does not stop
  that, so any shot that was not actively playing was aimed and then thrown away
  a frame later: stepping through a scene showed the map's viewpoint each time,
  with the spellwork and the animations going off out of frame.
- A cue that has not fired yet no longer shows: an actor idles until their
  delay is up instead of standing in the first frame of the clip to come, and an
  effect stays hidden instead of holding its opening flash on the field.
- Baked effects no longer need an open map. `bin/effects/<uid>` is a global
  asset, but the handler that serves it demanded a map session, so every
  campfire and firefly in a dialog scene asked for its keys and was told "no
  map loaded".

- **A dialog scene now draws its cast where they stand.** C1M1's opening played
  its eight speaking actors on an empty field: the two armies and 600-odd pieces
  of set dressing were being drawn on top of each other at the corner of the
  arena. An object's transform was fetched by its `<Item id>`, and a scene's
  objects have none — three.js starts an instance buffer at identity, so the
  ones that never got a transform were not missing, they were at the origin.

- The armies in a scene move. Idle animation is a map setting and off by
  default; a scene turns it on for as long as it is up, instead of showing the
  crowd frozen in the bind pose with their arms straight out.

- Undo no longer shrinks every creature on the map. Rebuilding a floor's objects
  left the display scale off the handles it made, so a hero who had been
  three-quarter height came back full size.

- **A scene's camera was on the wrong side of its own rod**, so every close-up
  filmed the back of somebody's head — Isabell's hood for twelve shots running,
  Godric from behind his horse, the listener instead of the speaker. C1M1's
  opening now plays the frames the game plays. Four shots whose rod is exactly
  zero, which left the camera pointing wherever it last pointed, aim properly.

- **A shot fires its own effects**, which is most of what a scene does: the
  Prayer over Isabell's line of soldiers, the Bloodlust that turns Agrael's army
  red, the ice bolt that lands on it, the gating of the arch devil. They start
  at their own delay from the line and go away with the shot.

- **A scene is lit by itself**, not by the arena it borrows. The scene names a
  preset and a shot can override it — the battle that opens C1M1 is lit by
  `InfernoArena`, the parley that follows by daylight — and the sun, the shading
  and the tint on the particles all follow it.

## 0.6.0 — 2026-07-31

### Added

- **Buildings — everything a hero walks up to, made in a window.** Mines,
  dwellings, banks, shrines, border guards, garrisons, prisons, sphinxes: the
  fifteen classes the game has anything to say about, each with a tab of its own.
  The class is the first thing you pick because it decides the rest — whether the
  building chooses one of the 128 behaviours the game has compiled in or IS one,
  what fields it adds, how many lines it shows. Start from a shipped object with
  **Use preset…** and edit the difference, or fill the form from nothing.

  A building you make borrows nothing. Its model, textures, animation, effects,
  sound, icon and every word it says are copies inside the mod, so you can
  repaint it with the same brush the creature list has, swap its mesh, or
  translate it, and the game's own files stay as they are. A building from the
  town screen can be brought down to map scale on the way in, which is how a
  dwelling gets art for a tier the adventure map never had.

  The form marks what it cannot do without — the identifier, the model, the name,
  and whatever the class needs (a dwelling hires nobody without creatures) — and
  Save stays down until those are in, saying what is still missing rather than
  refusing after the fact.

  What it will not do yet: say what a PLACED building needs. A shrine put on a
  map teaches the spell that placement names, and a fresh one names none — so it
  stands there and does nothing, and nothing marks the field the way the
  building's own form marks its own. Same for a sign with no message, a seer hut
  with no quest and a shipyard with no water tile. All four can be filled in —
  the sign's message through the panel's New, the quest and the ship tile
  through Edit… into the tree — and the map the test suite builds now has them
  filled, bay included.

- **A way back out of a map, and a bar that shows one thing at a time.** The top
  bar had been carrying both of the window's jobs at once — the editors that
  build content for the game, and the tools that work on the open map — in a
  single row of two dozen controls that had simply grown until it scrolled
  sideways. It now shows one face or the other.

  With no map open you get the launcher: **Campaigns**, **Units**, **Artifacts**
  and **Heroes** stand out in the open, because they are what that screen is for.
  With a map open you get its tools, grouped under **View** (what the window
  draws — the plan view, the idle stance, effects, light, cliffs, the grid) and
  **Properties** (what the map carries — its settings, its tree, regions,
  scripts, texts). Undo and Redo stay out in the open next to them: they are
  worked, not chosen from a list. So do the three panel toggles — **Objects**,
  **Objects+** and **Terrain** — which are held down through a whole session and
  double as the readout of which brush is live.

  **Map** is the one menu on both screens, and it now holds **Close map**. That
  was the missing door: a map could be opened and never put down, so the list of
  maps was somewhere you passed through once at startup and could not get back
  to. Closing tears the scene down for real and lets go of the map in the main
  process too — the file watcher stops, which matters because a watcher left
  running keeps pushing "changed on disk" at a window that no longer holds the
  map, and on Windows its open handle alone is enough to stop that folder being
  replaced by the next thing you open. Unsaved work is asked about first, in a
  dialog of ours, and Cancel means the map stays.

  Panels you had open are hidden, not closed: whether the terrain palette is up
  is your standing choice, and it comes back the way you left it on the next map
  rather than being quietly forgotten every time one is put away.
- **A ▶ Play button in the bar**, beside **Pack**, because the two are a pair:
  build the archive, then go and look at it. It starts *our* copy of the game —
  `bin/H5_Game_H5E.exe`, the only one that reads your `H5E` folder — and says
  which file is missing if the install has not been prepared yet. The game runs
  on its own and outlives the editor, and nothing is saved on the way out: what
  it shows is what was last packed.

  It launches with `bin/` as the working directory, which is not a detail. Given
  the install root instead, the game came up, played, found its archives, wrote a
  generated map exactly where it should — and broke creature models while doing
  it. Started by hand from `bin/` it never did, which is how that was found.
- **`run-test-and-keep.bat`** runs the five mod stages against the install this
  checkout sits in and sweeps up nothing, so the creature, the artifacts, the set
  and a map to see them in are left in `H5E/` for you to play. An ordinary test
  run does the same work in a throwaway install and deletes it, which is what
  makes the suite say something about the code rather than about one machine.
- **The first run prepares the whole install, and it is tested.** Four things
  have to be true before the editor is any use: the archives unpacked, a
  readable copy of the game's executable, our extension loaded by it, and that
  copy reading our own mod folder. Only the first was ever done for anybody —
  the other three were `npm run` commands typed by hand, so they had happened
  once, on the machine of whoever wrote them, and nothing exercised them again.
  The setup screen now does all four, shows which are already true, and only
  offers **Open the editor** when none are left; the steps are idempotent, so a
  second run writes nothing. `--setup` reopens the screen at any time.
- **`.env` beside the checkout** (`.env.example` says what goes in it) fills the
  setup window's two fields in. It decides nothing: the picker in that window is
  the only place an install is ever chosen. The e2e suite pointedly does not
  read it — there `HOMM5_ROOT` means "the install to play in", and its default is
  a throwaway one so a run cannot leave test maps in a real game folder.
- **Every form outside the map says what it needs before you press Save.** The
  buildings window learned this first; creatures, artifacts, artifact sets,
  heroes, campaigns and New Map now do the same. What a build refuses to go without is
  marked with a star, Save stays down while one of those is empty, and the ones
  still missing are named under the form — instead of a rebuild ending in a line
  of red about a field nothing ever pointed at.

  The preset is the one worth knowing about: a creature and a hero are COPIES of
  a shipped one, so with none picked the build got as far as the channel and came
  back "cannot resolve the donor (none)". It is marked now. Editing one already
  in the mod does not ask again — it keeps the documents it was built from.

- **The artifact-set window explains itself.** Making a set worked and reading
  the form did not: three controls in a row with nothing over them, an amount in
  no stated unit, and the sentence the player will read typed a second time by
  hand. Now the row says what its columns are and that a hero's own stats are
  not among them (the engine has no hook — a script row does those), the unit
  sits beside the amount (necromancy in percentage points, dark energy in
  ceiling points), and **Draft from the effects** writes a first version of every
  tooltip from the rows — cumulative, the way the shipped sets word theirs, and
  only into boxes nobody has written in. This was the last thing the test suite
  still marked unfinished.

  A set's **script starts written**, too. The editor used to open on an empty
  box, and everything above the author's first line was knowledge they had no
  way to have: that the members arrive as `<Set>_MEMBERS`, that the walk over
  the eight players is theirs to write, that `EditorHeroWearing` is the question
  to ask — and that a file which never calls `Trigger` does nothing at all. It
  now opens on that shape, named after the set, with the worn count as a knob
  (`local x = 3`) rather than a number buried in a call: a second behaviour at
  another count is that function copied with another x. What it does not do is
  decide WHEN the set acts — "once a day" fits a granting effect and fits
  nothing else — so the hook is a line of commented shapes to pick from, and the
  starter as it stands runs nothing on purpose. Written once, when a set has no
  script; after that it is yours like any other text.

### Changed

- **A map of ours is a `.h5m` again**, not a `.mod`. The extension was ours to
  choose and choosing a new one bought nothing: the game mounts every archive
  the same way, and every tool, wiki and habit around Heroes 5 says `.h5m`.
  Existing maps in `<game>/H5E/` need renaming — the archives themselves are
  unchanged — and `npm run mod-paths -- --set ours` writes the new pattern into
  `bin/H5_Game_H5E.exe`.
- **Maps the game generates land in our folder.** The random map generator saves
  to `<install>/Maps/`, which our build stopped mounting in 0.5.0, so a
  generated map was written to disk and then never seen again — it played that
  once and was gone from the list next launch. That folder is now patched with
  the same switch, so the generator writes into `<game>/H5E/` like everything
  else. `npm run mod-paths` lists it beside the five it already showed.

### Fixed

- **A creature opened for editing remembers what it was copied from.** The form
  never put the preset back, so Save either failed outright or — if a preset had
  been picked for something else since — quietly rebuilt the creature from THAT
  one's art. The creature records its donor now, the way a hero has always
  recorded his, and one made before that keeps the documents it already has.
- **An artifact set opened for editing keeps its file stem.** The stem was not
  among the fields the list handed back, so the box held whatever the last set
  put there — or nothing — and saving wrote the set's texts under that name.
- **New creature / New artifact / New set clear the form.** Every box kept the
  last one's contents, so the quickest way to lose ten minutes was to author one,
  press New, and be refused for an identifier that was already taken.
- **The campaign's name box does something.** It showed the name, took typing,
  and wrote nothing back: renaming a campaign in it changed nothing and said
  nothing. It is saved now. Create with an empty name is refused visibly rather
  than by doing nothing at all.
- **Edit… on a deep structure opens a tree that shows it.** A shipyard's ship
  tile and a seer hut's quest are marked advanced, and the tree hides those
  until they are asked for — so the panel's own Edit… button led to a tree
  without the field it named. Naming it is asking for it: the switch goes on.
- **A building says the line the class means, not the line that happened to be
  next.** `messagesFileRef` is read by POSITION, and the lists differ by class:
  a shipyard has five entries and the fifth is what it says when there is no
  water to build on, a seer hut's fifth is its extra message, a shrine has six.
  The editor wrote the same four for everything and skipped the ones left blank,
  so the fifth line of a shipyard did not exist — a hero walking up to one with
  no water got an empty box — and a blank third line silently promoted the
  fourth into its place. Every class now has its own list, read off the shipped
  documents, and a line with nothing to say is written as the empty entry the
  game's own Garrison and Sphinx use. Buildings made from a preset pick up the
  words the shipped object had in those slots, which they had been dropping.

## 0.5.0 — 2026-07-28

### Changed

- **Our build reads one folder, `<game>/H5E/`, and nothing anyone else
  installed.** The game scans five patterns for archives to mount —
  `Maps/*.h5m`, `DuelPresets/*.h5p`, `UserCampaigns/*.h5c`, `UserMODs/*.h5u`,
  `UserMODs/*.zip` — and every mod anyone ever installed sits in them. Our copy
  of the executable now scans `H5E/*` instead, so a stranger's `.h5u` or a map
  dropped into `Maps/` is not read at all. A map of ours is `H5E/<name>.mod`;
  campaigns, duel presets and mods keep their extensions beside it. The shipped
  executable is untouched and still reads all five, which is the way back —
  or `npm run mod-paths -- --set shipped`.
- **The patched executable is `bin/H5_Game_H5E.exe`** (was `H5_Game_NCF.exe`).
  The copy is ours end to end — our ceilings, our import, our folder — and is
  named for what makes it.
- **Everything the editor installs goes there too:** the mod, packed maps,
  campaigns. The Units and Artifacts dialogs read `H5E/` when they list what is
  installed.
- **New Map creates a file, not just a folder.** It writes
  `<game>/H5E/<name>.mod` at once and Save goes back into it, so there is no
  state where a map exists only as a working folder nothing ships from.
- **The map picker lists maps out of the install, never out of the unpacked
  data.** Ours, packed, under "Ours"; the game's own read straight from its
  `.pak` archives under "The game's" — 42 of them, in about 50 ms, without
  reading the 1.4 GB archive itself. Opening one of the game's maps unpacks a
  copy to start from and never writes to the archive it came from. The old list
  walked the whole unpacked `Maps` tree, stat-ing every file of every shipped
  map, and was the standing suspect for the lag on the first screen.
- **Open… starts in our folder** — where the maps are files — and then follows
  the last map opened, as before.

### Upgrading

Everything of yours moves into `<game>/H5E/`: maps as `.mod` (the archives
themselves are unchanged — rename or repack), campaigns as `.h5c`, and the
editor's mod, which **Units…**/**Artifacts…** reinstall there in one press.
Nothing is migrated for you, and nothing is deleted: `bin/H5_Game.exe` still
reads the old folders, so the game as it was is one launch away.

### Fixed

- **An error from a mod form was written where nobody could see it.**
  `id="um-err"` (and `am-err`) existed twice in the page — once in the list,
  once in the form on top of it — and `getElementById` answers with the first,
  so every message the form raised landed on the dialog behind it. The forms
  have their own lines now, and a build's "installed …" note stays with the
  list the form closes back to.
- **Placing two of the same object in a row placed one.** A palette swatch
  toggles; arming what is already armed puts it down, and the next click on the
  map went nowhere.
- **Painting straight after picking a new tile went nowhere, silently.**
  Choosing a tile the map has no layer for adds one in the background, and the
  brush was armed and the tile named on screen before that landed — so a stroke
  in between had nothing to paint into and was dropped without a word, the
  ground looking untouched and the file keeping its zeroes. The bigger the map,
  the longer the window: rebuilding C1M1 lost three complete texture layers
  this way. The brush now says when a tile is not paintable yet, and reports
  itself unready until the layer is really there.

## 0.4.0 — 2026-07-28

### Fixed

- **Effects that were slowed down no longer play twice over.** The retrigger
  period turned out to be measured in the instance's own clock — the one
  `<Speed>` scales — and not in wall seconds. Read the wrong way, any effect
  authored slow retriggered far too often: the Fountain of Fortune grew a
  second rainbow arcing over the first while it was still at full strength
  (208 alive particles against the recording's own peak of 131, now 136), and
  the shipped library asked for up to 36 copies of a single fog recording at
  once. It shows on the 154 instances whose `<Speed>` is not 1 — fog, forge
  smoke, tavern flames, the town splashes.
- **A creature's glued effects follow the animation.** The shadow dragon's eye
  glow hangs off its Head bone; it was placed against the bind pose when the
  scene was built and then never moved again, so the head turned through its
  idle clip and the eyes stayed behind, floating where the head had been. The
  glued instances now keep their transform in the BONE's frame and are re-hung
  off the live bone each frame — measured, the glow travels a third of a unit
  over a beat of the clip where the unglued mist around the same dragon moves
  exactly zero.
- **Fires no longer die and relight — the effect loop was the wrong model.**
  The baked effect files turned out to be one-shots, not loops: the particle
  population ramps up from nothing and dies back to nothing (1911 of the 1921
  files). Playing one copy on repeat — what 0.3.0 shipped — makes every
  campfire visibly gutter to a single ember and flare up again every few
  seconds. The game instead RETRIGGERS the recording on a fixed period
  (`EndCycle`, misleadingly named — the value is seconds), overlapping copies
  so the die-out of one hides under the ramp-in of the next: the campfire
  now holds a steady 35–45 particles where a single loop dipped to one. The
  same reading fixes rhythm the other way round: a 1.1-second wisp with a
  7-second period is a puff of smoke every seven seconds, which used to
  replay six times too often. One-burst instances (`CycleCount 1` — the
  phoenix's wing-whoosh of 1118 particles) fire once per idle-animation
  cycle, the way the game times them, rather than looping continuously —
  the clip length gave the mechanism away: the phoenix's looping fire is
  authored with period 3.16666 and its idle clip is 3.1666667 seconds long.

- **An object placed from the palette now gets its effects on the spot.** The
  campfire used to land cold and only start burning after a save and reopen;
  the palette path grafted the mesh and the idle animation onto the live
  scene but never the particle systems.

### Added

- **New creatures and new artifacts, from the window.** Two toolbar buttons —
  **Units…** and **Artifacts…** — build and install a mod without the command
  line. Pick a shipped creature or artifact as a **preset** and its every field
  loads: stats, name, description, the hire dialog's ability line, the engine
  abilities, the home town, the four art documents; or for an artifact its slot,
  rank, prices, the six hero stats and its icon. Then edit the difference. The
  ids spell themselves from the file name, every enum is a select, and the four
  art rows are the copy handles — point one at another file and only that piece
  changes. The mod is always the one in `UserMODs`, found rather than asked
  about, because two creature mods conflict outright. Installing writes the
  archive and the executable's ceiling as one action, as it must. Dwellings and
  whole creature sets stay on the command line.
  See [docs/UNITS_AND_ARTIFACTS.md](docs/UNITS_AND_ARTIFACTS.md).
- **Recolour a mod creature's textures, by palette.** A **Recolor** button per
  creature opens its textures with their dominant colours as swatches — each
  remappable on its own, so the cloak goes grey and the skin stays skin. A pixel
  keeps its own lightness, which is where the drawing lives; alpha is never
  touched, being the silhouette. Global hue/saturation/lightness/tint apply on
  top, with a one-click Grey. The previews are not an approximation: preview and
  rewrite run the same arithmetic. It repaints the mod's own copies, so nothing
  shipped is touched. Seen in the running game: the Sharpshooter with its cloak
  remapped to steel grey — and its skin left alone, which is the point, since
  skin and gold trim share one hue cluster and the sliders would have taken the
  face too. **First cut** all the same: the recoloured surface is written
  uncompressed, which quadruples the texture and drops its mipmap chain.
  Recompressing to DXT3 is the first thing in the plan.
- **The last three real "cannot decode" objects decode.** Of the objects that
  refused to mesh, three turned out to be real and each hid a different
  mechanism: the unshipped Hill_Castle town declares an EMPTY exterior, which
  starved the town path of the plain `<Model>` it actually has; the
  ghost-mode hero (the wisp you steer in multiplayer while waiting out a
  turn) carries no model in its own document — its body is wired per class in
  the GhostMode tables, every class pointing at the same Ghost character; and
  Fire_glow is the palette's one pure light — no particles, no model, just an
  animated fire light — which now stands in as a warm glow card. The
  seventeen still refused are the game's own dead stubs: empty `<Model/>`
  documents that nothing in the original editor's palette links to (its
  working Sunflowers, snow Alchemist Lab and subterranean rails are different
  documents), verified against the original editor on a showcase map.

- **Scene light reaches the particles marked for it.** Effect instances are
  authored `L_LIT` (lit by the scene — mostly the falling leaves of oaks and
  pines) or `L_NORMAL` (self-lit — fire, glows). Lit instances now darken
  under the map's lighting preset: on a night map the leaves dim into the
  scene while the campfire beside them keeps burning. Daylight presets leave
  everything as it was. (Two neighbouring fields turned out to be dead ends,
  written up in the format doc: `WindAffected` is false on every effect the
  game ships, and the presets' `ParticlesColor` is the same 0.25 grey in all
  of them — an engine constant, not a per-map knob.)

### Known limitations

- **A recoloured texture is written uncompressed.** The shipped creature
  textures are DXT3 with a mipmap chain; a repaint writes the surface back as
  plain 32-bit with a single level, which the game reads (a recoloured
  Sharpshooter was checked in play) but which costs four times the VRAM and
  leaves nothing to fall back to when the creature is drawn small.
  Recompressing is the next thing in the plan.
- **Dwellings and whole creature sets are still command-line only** — the
  dialogs author one creature or one artifact at a time (`npm run units-mod`
  builds a set from a project's `units.json`).

## 0.3.0 — 2026-07-27

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

- **Creatures stand at the game's size, and fire actually burns — in the right
  colour.** The phoenix used to tower over its tile and burn without flames;
  three format truths hid behind that. The size: a creature's idle-clip
  skeleton carries a display scale on its root bone (the phoenix is shown at
  0.37 of its authored mesh, the devil at 0.7) — the editor now applies it to
  the placed model while the effect stays full-size, which is the game's own
  look: a small bird inside towering fire. The missing fire: fire art ships
  with NO alpha channel — that IS the era's blend convention (a texel's
  colour adds, its alpha occludes, one mode: ONE/ONE_MINUS_SRC_ALPHA with
  straight colour) — and it hit two traps at once: a blend-guessing heuristic
  classified zero-alpha fire as smoke and discarded every flame fragment,
  and the browser canvas the atlas is built through premultiplies, turning
  colour-under-zero-alpha black in transit, so each frame now travels as a
  colour image plus its alpha as a separate grayscale. And the colour itself:
  the baked colour bytes are stored in the era's B,G,R,A order, so every
  flame in the editor was quietly tinted BLUE and every water swirl beige —
  the campfire got away with it only because its tint is nearly white. With
  all three fixed, the phoenix, the arch devil, the infernal succubus and
  the fire elemental burn orange, and the water elemental churns in blue.
  (The base devil, base succubus and the earth elemental carry no idle
  effect in the game's data — the fire belongs to the upgrades.)

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
