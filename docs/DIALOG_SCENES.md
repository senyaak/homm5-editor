# Dialog scenes

The cutscenes a campaign plays between missions and in the middle of them:
Isabell and Agrael talking on a patch of grass while the camera circles. This
is what the format is, measured against the 251 scenes the game ships — the
numbers below are printed by `npm run test-dialog-scene`, so they can be
re-checked rather than believed.

The game's own editor cannot make these. Its manual says so outright: creating
script-based movies "is not a process intended for an unprepared user", and
then declines to describe it.

## Three different things get called a cutscene

| | Where | Authored in | Us |
|---|---|---|---|
| **DialogScene** | `DialogScenes/<C>/<M>/<S>/DialogScene.xdb` | an in-house tool, never shipped | read, edit and play |
| **AnimScene** | `Maps/Cutscenes/*/_.(AnimScene).xdb` | Maya, baked | playable in principle, not authorable |
| camera moves in a mission | `MapScript.lua` | by hand | the script editor already |

Only the first is a data format an editor can offer. The second is a list of
roles — a model plus a baked clip each, the camera among them — exported from
Maya; the third is `MoveCamera` and friends in Lua (docs/SCRIPT_API.md).

## What a scene is made of

A scene is a **stage** and a list of **shots**.

The stage is an ordinary map used as scenery — `<Map>` points at an
`AdvMapDesc`, almost always one of the dozen arenas under
`Maps/SmallSpecialArenas/` (a few borrow a combat arena). It is a normal 72×72
map with terrain and objects, which is why the editor's viewport draws it with
no special case at all. **The arena is usually bare**: C1M1's opening stands on
an empty grass field, and all 659 props in shot come from the scene itself.

The shots are `<sentences>`. One item is one line of dialogue: who says it,
which camera pair frames it, how long it lasts, and everything else that
happens while it is spoken.

```
DialogScenes/C1/M1/D1/
  DialogScene.xdb          the scene
  Isabell.3.xdb  Agrael.xdb  …   actors, one file each
  Grass01.xdb  Sanctuary.xdb  …  set dressing, one file each
  DialogScene-Godric-58.txt      the lines (UTF-16LE, per language)
  *sound.xdb                     one per voice line
```

### The scene document

Fields in the order the game declares them (`DialogScene` in `types.xml`):

| Field | |
|---|---|
| `Map` | the stage |
| `SoundSet` | ambient sound bed |
| `Music`, `MusicVolume` | scene music |
| `CustomSceneAmbientLight` | an `AmbientLight` preset for the whole scene |
| `sentences` | the shots |
| `objects` | the set dressing, as hrefs at sibling files |
| `ModelsLOD` | declared "deprecated (Do not use!)" |
| `CameraShiftZ`, `Anim3DSoundVolume`, `Name` | |

### A shot

`DialogSentence`, with how many of the 2386 shipped shots fill each field in:

| Field | Used | |
|---|---|---|
| `text` | 2386 | the line, in a sibling `.txt` |
| `sound` | 1553 | the voice recording |
| `heroLink` / `monsterLink` | 1875 / 509 | who speaks |
| `NewCameraSet` | 2386 | the camera pair that frames it |
| `cameraSet` | 171 | the pre-ToE field; `NewCameraSet` wins |
| `duration`, `soundDuration` | always | seconds |
| `ActorAnimationIndex`, `AnimName`, `AnimationDelay` | 948 off default | the speaker's own clip |
| `CustomAnimations` | 1246 | what everyone ELSE does |
| `CustomEffects` | 259 | an effect at a place, with a delay |
| `CustomSounds` | 353 | extra sounds, with delays |
| `MusicOverride` | 1330 | music is steered per shot, not per scene |
| `AdditionalCameras` | 200 | a second camera pair, started late |
| `CustomAmbientLight` | 102 | light change mid-scene |
| `StopAmbient` / `StopMusic` | 45 / 188 | |
| `DynamicCamera` | never off | all 2386 leave it true |

`CustomAnimations` is what makes a scene move: an actor link, a clip, a delay,
and — for a walk — `MovePoints` in TILES with a `FinalAngle` to end on.
Corpus-wide there are 5578 of them and 769 placed effects.

### A scene is one clock

A delay is measured from the start of the shot that writes it, and **nothing
keeps it inside that shot.** Of the 7296 cues and effects the shipped scenes
schedule, **1034 start after their shot has ended and 870 before it begins** —
better than a quarter of everything a scene does. Shot 6 of C1M1's opening lasts
three seconds and tells a marksman to shoot at 6.7 (he shoots in shot 8); shot
14's gating flash is written at −0.3, which is in shot 13.

So a shot's `duration` decides only when the NEXT line starts. Everything else
runs on the scene's clock — the sum of the durations before it plus the delay —
and the player holds one time value for the whole scene. Read a scene as a row
of islands, as this one was at first, and every one of those cues is dropped on
the floor: the armies simply never act.

A clip **runs once and is over**; the actor goes back to idling. Two kinds hold
their last frame instead, until something cues that actor again (shot 23
resurrects a paladin killed in shot 15): death (`death*`, `defeat*`), and any
clip that ENDS somewhere the idle cannot follow — see "a clip that ends
somewhere else" below.

### Which clip, by name or by number

A cue says which clip two ways and the shipped scenes use both:

* `AnimName` — the kind, as the AnimSet spells it (`happy`, `stir01`);
* `ActorAnimationIndex` on the shot, `AnimationIndex` on a `CustomAnimation` —
  **a position in that actor's own AnimSet, counted in file order.**

The index is the commoner of the two by far. C1M1's opening writes a name in 40
of its cues and an index in all 132 of them, and every animation it hands to the
armies — sixteen creatures saluting Isabell's speech in one shot — is an index
with no name beside it. Reading names alone leaves the heroes still through half
the scene and the armies still through all of it.

**The name wins where both are written.** 590 cues carry a name and a non-zero
index; 534 of them agree with the set's file order (the runner-up reading,
alphabetical, gets 383). The 56 that disagree, and the 4008 more that write
index 0 beside a name that is not the set's first clip, are indices left behind
by an edit — the name is never stale.

A creature's set is reached the long way round. A hero's shared names
`HeroCharacterArena` outright; an `AdvMapMonsterShared` carries only the
adventure model and a `<Creature>` enum, and its arena body is four documents
on: `Creatures.xdb` → `Creature.Visual` → `CreatureVisual.AnimCharacter` →
`Character`.

## Actors

Three ways of naming one, all in heavy use, all to be preserved on save:

* **declared inline** (1814 links) — the whole `AdvMapHero`/`AdvMapMonster` is
  written INSIDE the link element, `href="#n:inline(AdvMapHero)"` with an `id`,
  the same convention a map uses for its objects;
* **mentioned by element id** (4621) —
  `href="#xpointer(id(item_48F7…)/AdvMapHero)"`, pointing at one of those;
* **a sibling file** (1443) — `href="Agrael.xdb#xpointer(/AdvMapHero)"`.

The addon's scenes prefer the first, the original campaigns' the last.

**A declaration is not only made in a sentence.** 1517 of the 1814 are inside a
`CustomAnimation` — the actor exists because something animates them and for no
other reason. Read only from `<objects>` and the sentences, as this did at
first, and most of a scene's cast is not on the field at all: A2C3/M4/S1 came
out with 9 figures instead of 138, and its marching army had nobody in it.

**The element id is the identity, not the href.** `#n:inline(AdvMapMonster)` is
the same four words for every inline actor in the file, so joining cues to
actors on the href puts a whole scene's cast onto whichever one was read first.
Everything downstream joins on one key (`actorRef`): the id where the element
has one, the path where that is all there is.

**A figure the scene lists AND speaks through is one figure.** All seven of
C1M1's file-backed actors are in `<objects>` as well as on a `heroLink`, and
read as two they are placed twice: the still adventure copy standing inside the
rig that can act, so every close-up has two of the same hero in it and one of
them never blinks. Only a PATH identifies, mind — `#n:inline(AdvMapStatic)` is
what 130 of that scene's props are written as and says nothing about which.

**An actor is anyone the scene MOVES, not only whoever speaks.** Most of what a
shot animates is the armies drawn up behind the two heroes, and a creature left
in the crowd can only ever loop its idle. C1M1's opening speaks through 8
figures and animates 45. They are read per CHARACTER rather than per figure —
six swordsmen of a kind are one mesh and one set of clips, shared by reference
all the way to the GPU, which is the difference between a 60 MB payload and a
140 MB one.

Two more things a player has to get right, both found by drawing it: the
DISPLAY SCALE rides on the clip skeleton's root the same way a creature's does
(without it an arena hero is ten times too big — a boot filling the frame), and
an actor's stored `z` is 0, so the ground has to come from the stage rather
than the file, or they stand buried to the waist.

**A scene actor is the ARENA model, not the adventure one.** The link resolves
to an `AdvMapHeroShared`, and what a scene plays comes from
`HeroCharacterArena` → `*.(Character).xdb` → `ArenaAnimSet` — 17 clips
(`move`, `moveEnd`, `attack00`, `cast`, `death`, `speech_knee`, …). The
adventure set beside it (`*_LOD-adv`) has two, `idle00` and `move`, and scenes
routinely name clips it does not have.

What the corpus actually asks for, most used first: `idle00` (1001), `move`
(903), `death` (741), `happy` (617), `attack00` (498), `spneutral` (334),
`rangeattack` (196), `hit` (173), `cast` (161).

**And a hero has NINE bodies, one per player colour.** Beside the character's
`<Model>` sits a `<ColourModels>` list:

```
<Model href="/_(Model)/Heroes/Knight.(Model).xdb"/>
<ColourModels>
  <Item href="/_(Model)/Heroes/Knight_White.xdb"/>
  <Item href="/_(Model)/Heroes/Knight_Red.xdb"/>
  <Item href="/_(Model)/Heroes/Knight_Blue.xdb"/>   …nine of them
```

They are whole models, not a palette: each names its own flag material and its
own texture (`Knight-flag_Blue` → `Flags/Heroes/Haven/Flag_dark_blue.dds`). The
top-level `<Model>` is the WHITE one, so drawing it flies a white banner over
every hero of every player — which under a warm preset reads as a washed-out
grey-blue, and was the visible symptom.

The index is the `PCOLOR_*` enum, and the data says so twice: `Types.xml`
declares nine values, and all 17 characters that carry the list carry exactly
nine entries in the same order (NEUTRAL/White, RED, BLUE, GREEN, YELLOW,
ORANGE, TEAL, PURPLE, BROWN/Tan — seven names match outright, the two that do
not are synonyms). Which colour a `PLAYER_n` flies comes from the map's own
player table where it names one; a dialog scene's ARENA names none — all eight
players are `PCOLOR_NEUTRAL` and inactive — so the player's number is what is
left, PLAYER_1 red and PLAYER_2 blue. C1M1's opening stages Agrael as PLAYER_1
and Isabell as PLAYER_2, and blue is the banner the game shows her carrying.

Not every hero has coloured bodies: `Isabel_Flagless`, `Godric_Flagless` and
`Beatrice_DS` are bespoke models with no list, and fall back to `<Model>`,
which is theirs.

**Still white on the adventure map — open, and on the roadmap.** The same list
hangs off the LOD (adventure) characters, and the map view does not read it: a
placed hero flies the colourless banner whoever owns him, and so do caravans and
entry points, which are placeable too. The lookup is already written
(`src/scene/colour-models.ts`); what is not is the geometry cache, which is
keyed by the shared href alone — colour turns one shared into up to nine meshes,
and `map:idle-skins` replays that index through a fresh resolver and silently
drops anything whose index moves. Roughly two hours, and that replay is the part
that earns them.

### Walking

922 cues carry `MovePoints` — a list of TILES the actor is to be at, in order.
What the file does **not** carry is either end of the arithmetic:

* **no pace.** Every one of the 922 writes `MovementSpeed` 0. The pace is on
  the CLIP: `<MovementSpeed>` on the `BasicSkelAnim` (5.7 world units a second
  for a footman, 5.95 for an archer, 9.29 for a demon lord), times its
  `<SpeedFactor>` — the rate the engine plays the clip at, which has to be in
  the product or the feet slide. A walk in C1M1's sister scene A2C3/M4/S1 then
  comes to 8–9 seconds across 60-odd units, inside its 12-second shot.
* **no starting point.** A walk begins wherever the actor is standing at that
  moment, which is where the walk before it left them. So the whole scene's
  walks are resolved in TIME order, once, in `buildScenePlay`.

`FinalAngle` is where they end up facing, **in degrees** — 341 of the values
exceed 7, and the largest is 355. It is the same angle `<Rot>` writes in
radians: over the 157 walks whose actor and cue both name a non-zero one, the
difference piles up at zero (69 of them within 15°), the actor having been
placed facing where the walk leaves them.

**A facing is zero along +y and grows toward +x** (`atan2(dx, dy)`). Measured,
not assumed: C1M1's two armies are drawn up across the field from each other,
and of the 42 figures with an enemy within 20 tiles, 40 face them under that
reading. The three other ways of arranging the same two numbers get 13, 11 and
2. A walking actor turns along each leg, and holds `FinalAngle` on arrival.

Where they end up is not a property of the shot: a walk in shot 3 is where the
actor stands in shot 8, so position comes off the scene's clock like everything
else rather than being set once when the scene opens.

`move` is ONE stride, so it is the one cued clip that loops for as long as its
walk lasts instead of running out after a single pass.

## Cameras

A `DSceneCamera` is an **orbit pose**: a point it looks at (`Anchor`), a
distance (`Rod`), two angles, `Roll`, `FOV`, and near/far planes. A
`DSceneCameraSet` pairs two of them — a shot is the travel from one to the
other. There are 3045 cameras and 3078 sets across 251 scenes: roughly twelve
camera poses per scene, which is where a scene author's time goes.

**Half the shots do not use a camera of their own.** The campaigns keep a
shared library at `Dialogs/` (3201 files) and point into it.

### The convention, measured

The file never says how its angles are measured. `npm run camera-shape` scores
every candidate against the 4578 poses whose stage terrain is at hand:

* **The anchor is in WORLD units** — 3292 of 6090 anchor coordinates lie past
  the 72-tile edge of the stage, which a tile coordinate could not. A tile is 2
  units, the same factor the rest of the renderer runs on.
* **Pitch is measured from the horizon, and stored negative when the camera is
  above what it films.** Read that way the eye on a close-up sits a median 2.3
  units over the ground — head height. Read from the zenith it hovers at 9.0,
  looking at the tops of their heads; read with the other sign, a tenth of all
  cameras are underground.
* **Yaw has its zero along +Y and grows clockwise.** Flat arenas say nothing
  about it — "does the eye stay on the stage" separates the candidates by half
  a percent — so the question came from the scenes instead: a shot exists to
  show somebody, so the speaker should be inside the frame. Over the 657 shots
  aimed at something other than the speaker (the ones that had to be pointed
  rather than orbiting them), the speaker lands in the 35° frame for `Y -` in
  24.5% of them against 14.3%, 13.1% and 9.7% for the rest. The absolute share
  is low because most of those shots are wide by intent; the ratio is the
  answer. Confirmed by eye in `tools/view-dialog-scene.ts`: under the runner-up
  the opening shot of C1M1 films a rock face, under this one it opens on the
  forest and later frames Isabell with Godric behind her.

* **The eye is at `anchor − rod`, not `anchor + rod`.** This one no amount of
  scoring found, and it is worth understanding why. The four yaw candidates are
  mirrorings; this is yaw plus *half a turn*, which is not among them. And the
  in-frame score cannot see it at all — most shots anchor ON their speaker, and
  a camera orbiting a point frames whatever is at that point from either side
  of it, so the two readings scored 22.7% and 21.9%, a coin toss. What settled
  it was rendering all 73 shots of C1M1 onto **one contact sheet**
  (`sheet(0, 73)` in the viewer): the wrong reading films the backs of
  everybody's heads — Isabell's hood for twelve shots running, Godric from
  behind his horse, the listener instead of the speaker — and the right one is
  the frames the game plays.

Two notes on scoring, because both attempts got something wrong:

* Rewarding a camera for *not being buried* rewards it for being high, and
  every zenith reading scored 90-92% for exactly that reason. What separates
  framing from hovering is the eye height on close-ups, not the not-buried
  count.
* A metric can be blind rather than wrong. The in-frame score answered a real
  question and was simply incapable of seeing a 180° error. **Before trusting
  one, break the thing it measures on purpose and check that it goes red.**

### Absolute, and what it is relative to

`Absolute` is false in 162 cameras, and in half of C1M1's second act. Their
anchor is `(0, 0, z)`, which reads as a bug and is not: the **set** carries the
placement, as the subject's own tile and facing —

    C1M1D1Ga1   StartCameraDiff 83, 65   StartCorrectionRot 3.1811   (Godric)
    C1M1D1BA1   StartCameraDiff 81, 77   StartCorrectionRot 6.2043   (the demon)

— so the camera document is a *framing* ("this high, this far, at this angle to
them") and the set says who it is of. Both are added in `poseAt`, which is all
the handling these need. Placing such a camera on the speaker as well moves it
twice and throws it off the map. [~] Whether `Absolute` changes anything beyond
documenting the intent is still open — nothing reads the flag.

A `Rod` of exactly zero happens (four shots in C1M1): the eye is then AT the
anchor, and "look at the anchor" is a direction of zero length. The aim comes
from the angles instead (`targetOf`).

**A camera may stand inside the scenery, and that is intended.** Four of C1M1's
shots put the eye inside the ridge of mountains that lines the arena — shot 22
is five units into `Mountain12x12`, and shots 15, 16 and 23 into the same ridge
— because a wide shot of a small arena has nowhere else to pull back to. What
makes those frames the scene rather than the inside of a rock is that the engine
**culls back faces** (`<Is2Sided>`, docs/GEOMETRY_FORMAT.md §5): from within a
body, its near faces are behind the eye and its far ones are turned away, so it
is not drawn at all. `view.sightline(actor)` is the probe for this — it casts
from the shot's eye through the same materials the frame uses and names what it
passes through (e2e/dialog-scene.spec.ts).

### What a set does between its two ends

| Flag | How the corpus uses it |
|---|---|
| `UniformCameraMovement` | off in 1063 of 1259 — **easing is the default**, constant speed the exception |
| `Direction` | set in 205 — which way round the heading travels |
| `IgnoreYawDiff` | set in 61 — hold the start heading |
| `Circles` | 0 in 1253, 1 in five, 2 in one — orbiting right around is rare |
| `Absolute` (on a camera) | false in 162 of 1209 — the anchor is then relative, and nothing reads that yet [~] |
| `Rot` (on a camera) | non-zero in 156 [~] |

Four cameras carry a **negative** `Rod` — the same eye written with the heading
turned around.

`Direction` is **which way the heading travels, not "the long way round"**: 1
means the yaw grows, 0 that it shrinks. Over the 1248 sets whose two ends face
differently it agrees with the short way round in 1089, so most of the time it
only says out loud what the two angles already imply; the 150 that disagree are
the shots that really do swing behind somebody, and a sweep past half a turn
should be about that rare. Read as a "go the other way" flag it is not merely
wrong on those — every set with Direction 1 and a heading that grows swung 330°
the wrong side, which is 583 laps instead of 150. Senya caught it in the
picture: Agrael's first cast is a straight pull-back in the game (rod 9 → 38,
heading +30°) and ours orbited the demon.

## Sound

A `<sound>` reference resolves to a `Sound` document whose `<uid>` names a blob:
`bin/SoundsLoc/<UID>` (Ogg Vorbis, `data/sound.pak`, localized) or
`bin/Sounds/<UID>` (RIFF WAV, `data/soundsfx.pak`). The campaigns' voice lines
ship in `UserMODs/All_campaigns.dialogscenes_en.h5u`. Both codecs play in
Chromium as they are, so a player needs no decoder.

## How a scene gets played

From Lua, in a mission script:

```lua
StartDialogScene("/DialogScenes/C1/M1/D1/DialogScene.xdb#xpointer(/DialogScene)", "callback", "autosave");
```

There is also a viewer built into the game — **Settings → Videos → Cutscene** —
that replays shipped dialogs. Its list is DATA:
`UI/UIGameRoot.(UIGameRoot).xdb` → `AllDialogScenes` →
`DialogScenes/AllDialogScenes.(DialogScenesList).xdb`, which any archive of ours
can override. That is a way to watch a scene in the engine without a map or a
campaign — the manual says the list depends on campaign progress, which has not
been tested. [~]

## Where the corpus is

**A scene is a folder, and a map only names it.** It is not part of a map the
way its terrain is — nothing in `map.xdb` points at a scene. A map *names* one,
from its script —

```lua
StartDialogScene("/DialogScenes/A2C1/M1/S1/DialogScene.xdb#xpointer(/DialogScene)", "callback", "autosave")
```

— so the two are joined by that path string alone, and the folder can be
anywhere the archives put it.

The campaigns put theirs in a shared tree: top level the campaign the scene was
written for (`C1`…`C6` original, `A1C*` Hammers of Fate, `A2C*` Tribes of the
East, plus `A2Single` for the addon's single missions), then the mission, then
the scene — `DialogScenes/<C>/<M>/<S>/`. **That is convention, not a rule**, and
two shipped counterexamples say so:

* `Maps/SmallSpecialArenas/SmallSpecialArena_Grass_Custom/DialogScene.xdb` —
  one of the 251, sitting in an arena's own folder inside `data.pak`.
* `Maps/12.h5m` — a map made in the ORIGINAL editor, carrying
  `Maps/SingleMissions/12/test_start_scene/DialogScene.xdb` and a second beside
  it, next to `Editor/Builder/DialogSceneBuilder.xdb`. So a scene really does
  travel inside the map's own archive, at the map's own path, and the original
  editor is what wrote it there.

Which means **a scene can be made on its own and shipped with a map**: a map
archive is mounted globally like any other (docs/ARCHIVES.md), so the folder
lands in the data tree wherever it is written, and `StartDialogScene` finds it
by that path. Whether the game then PLAYS one carried this way is not something
we have run yet. [~]

Which archive each lives in:

| Archive | Scenes | |
|---|---|---|
| `UserMODs/All_campaigns.data.h5u` | 185 | `C1..C6`, `A1C*`, **and** the shared `Dialogs/Cameras` + `Dialogs/CameraSet` library (3198 documents) |
| `data/data.pak` | 62 | the addon's `A2C*`, each keeping its cameras **inside its own scene folder** |
| `data/a2p1-data.pak` | 4 | patch |

Texts travel in the parallel `*-texts*` archives, the voice lines as
`bin/Sounds` blobs in `All_campaigns.dialogscenes_en.h5u`. A run that cannot see
`UserMODs` grades a quarter of the material — `tools/test-dialog-scene.ts` says
so out loud rather than going quietly green.

`All_campaigns.cutscenes.h5u` is the OTHER kind — `Maps/Cutscenes` and
`Scenes/C1M5_NikolayDeath`, the Maya-baked AnimScenes of the table above.

## What the editor has so far

* `src/dialog/dialog-scene.ts` — the document: parse, a read-only typed view
  (stage, shots, actors, animations, effects, sounds, music), and a save that
  is byte-identical for everything untouched. All 251 scenes round-trip.
* `src/dialog/camera.ts` — pose to eye and back (which is what "use what I am
  looking at" is), and the travel between two poses.
* `src/dialog/scene-source.ts` — what a FILE holds. The window is opened on a
  file, the way a map is: an archive (`.h5m .h5u .h5c .h5p .pak`) is read by its
  central directory alone, and every `…/DialogScene.xdb` in it is offered — so
  asking what is inside the 1.3 GB `data.pak` costs a seek and unpacks nothing.
  Pointing at a `DialogScene.xdb` itself opens that one; if it sits outside the
  data tree its parent is mounted as an asset root, so the actors and cameras
  written beside it resolve while `/Dialogs/…` and the arena still come from the
  install. Sweeping the whole install instead was the first shape of this and
  the wrong one — 253 entries, the one scene somebody had just written lost
  among the campaigns'.
* `src/dialog/stage.ts` — the scene's own cast and set dressing as map objects,
  placed on the stage map through the existing scene builder
  (`BuildSceneOptions.extraObjects`). There is no second renderer.

  A scene's `<objects>` are plain hrefs with **no `<Item id>`** on them, unlike
  a map's, and that broke the drawing of every one of them: the renderer looked
  an object's transform up by its id, and three.js seeds an instance buffer with
  IDENTITY matrices, so 523 of 657 props and creature stacks were drawn at the
  world origin — a heap in the corner of the arena, and the field they belong on
  bare. Handles are now keyed by the instance itself (`Floor3D.meshes`);
  selection still addresses objects by id, so scene objects are drawn and picked
  but not yet addressable by name.

  A scene fires its own **effects** (`<effects>` on a shot, 769 across the
  corpus): an effect href, a place in world units, and a delay in seconds from
  the line — which can be negative. These are the spellwork a scene is made of
  and they belong to the moment, so they are built when a shot is cued and taken
  down with it, rather than riding a floor the way an object's campfire does.
  C1M1's opening: eight Prayers over Isabell's soldiers, eight Bloodlusts over
  Agrael's, the ice bolt that lands on them, a Gating for the arch devil.

  A scene is **lit by itself**, not by the arena it borrows.
  `CustomSceneAmbientLight` replaces the stage map's preset on every floor, and
  `CustomAmbientLight` on a shot overrides that for as long as the shot is up —
  in C1M1's opening the 36 shots of the battle are `InfernoArena` (a red key
  light over black shade) and the 37 of the parley that follows are the scene's
  own daylight. Applied by writing the floor's `ambient` and calling
  `refreshLighting`, so the terrain shader, the point-light gain and the tint
  the particles are drawn with all follow one value.

  A scene also builds with `animate: true` unconditionally. On a map the idle
  stance is a setting, off by default, because it costs a draw call per creature
  — in a scene the armies standing behind the two heroes are half the frame, and
  unanimated they hold the bind pose with their arms straight out.

  **The shot owns the camera, including between shots.** The orbit controls
  re-derive the camera from their own state every frame and `enabled = false`
  does not stop `update()` doing it — so a shot that was not actively playing
  was aimed and then overwritten one frame later, and stepping through a scene
  showed the map's viewpoint over and over, with the effects and the animations
  going off somewhere off screen. The loop skips `controls.update()` while a
  scene is up. A test for this has to read the camera in the SAME turn as the
  aim: read a turn later it is already the drifted one and the check passes on a
  camera that has been thrown away.

  **A cue that has not fired yet is not shown.** Until its delay is up an actor
  idles rather than standing in the first frame of the clip to come (three
  seconds of a swordsman frozen mid-swing before he swings), and an effect is
  hidden rather than held at frame zero (a spell's flash sitting on the field
  before it is cast).

  **A one-shot clip runs once, and a death outlives its shot.** Two separate
  faults had the fallen getting up. The poser wrapped every clip like a loop,
  and a one-shot clamped to its own duration is `span % span` — frame ZERO, a
  corpse standing to attention. And a cue was forgotten when its shot ended, so
  the swordsmen cut down in shot 13 were back on their feet in shot 14. What
  carries over is only `death`/`defeat` (holding `happy` would freeze a hero in
  a grin for the rest of the scene) and only until the actor's next cue, which
  is how the paladin killed in shot 15 gets up when shot 23 resurrects him.

  **The whole scene runs on one clock** (see "A scene is one clock" above). Cues
  and effects carry an absolute `at` alongside the `delay` the file writes, and
  showing a shot at a moment is showing the SCENE at `shot.start + at`: every
  actor gets the latest cue at or before that instant, wherever it was written,
  and a shot builds the effects of any shot whose window overlaps its own. This
  is one rule where there were three (a per-shot handout, a walk back over
  earlier shots for the deaths, and a delay compared against `playing.at`), and
  it is the only reading under which a delay of 6.7 in a three-second shot means
  anything.

  **A clip that ends somewhere else HOLDS there.** A royal griffin's
  `specability1` is the first half of a dive: it takes off and leaves him three
  units up, and `specability2` is what brings him down. An arch devil's
  `moveStart` sinks him into the ground he gates out of. Handing either back to
  the idle when it runs out does not blend, it teleports — the griffin springs
  into the air and reappears standing. Which clips those are is MEASURED when
  the scene opens, once per character: pose the clip at its last frame, pose the
  idle at its first, and compare where the body is. Half a unit apart is a jump
  you can see; a `happy` or an `attack` ends exactly where it started. Naming
  them would not have worked — nobody would think to list a griffin's special
  ability beside `death`.

  **An actor burns with their own idle effect.** The fire an inferno soldier
  stands in hangs off the IDLE clip (`idle00` → `BasicSkelAnim` → `<Effect>`)
  and is alight from the scene's first frame to its last, cued or not — the same
  rule `clipEffectParticles` follows on a map, which shows the mist on a frozen
  dragon. A scene needs its own copy of it: on a map the effect rides the
  ADVENTURE body, and a scene takes that body off the field to make room for the
  arena rig, so the demons stood there cold. It follows them when they march
  (built against an identity frame, the actor's own applied on top each time
  they are placed) and is NOT scaled with them.

  **A clip brings its own effect.** `BasicSkelAnim` names an `<Effect>` beside
  its Granny file, and that is where a caster's own fire lives: the blue glow
  that runs up a knight's sword as he casts is `Heroes/Knight/buff.xdb`, named
  by the `buff` clip and by nothing in the scene at all. 45 of the 132 cues in
  C1M1's opening play a clip that carries one — a third of what the scene does
  was happening in silence. They are fired at the actor, at the cue's moment,
  through the same path the scene's own `CustomEffects` take: one machine for
  both is one machine to get right.

  **An effect brings its own geometry.** `<Models>` on an effect is a real mesh
  — the ice crystal of an ice bolt, the four burning panels of the gate an arch
  devil steps out of, nineteen meteors in a meteor shower — and nine of the
  twelve effects C1M1's opening fires carry one. Every part of every one of them
  is `AM_TRANSPARENT` and self-illuminated, and most are additive, so they are
  drawn unlit: read as ordinary scenery they come out as grey solids sitting in
  the middle of the sparks.

  **The preset's sky dome is the horizon.** An AmbientLight preset's `<Sky>` is
  reflection blobs, but its `<SkyDome>` names a drawable model — `SkyDome1` is
  a 250-unit skybox cube, the arena skies are spheres, and their materials
  already say how to draw them: every part self-lit (`L_SELFILLUM`) and
  depth-ignoring (`IgnoreZBuffer`). The dome is decoded WITH the light that
  names it (`loadAmbient`'s `geo` option puts it on `AmbientData.dome`) and
  drawn as a backdrop (`renderer/viewport/sky.ts`): painted before everything,
  no depth test, riding the camera — a sky is a direction, not a place. Because
  it rides the light it swaps per SHOT with the rest of the override, and that
  is where this scene's red sky comes from: the scene's own preset names the
  day cube, and the 34 inferno overrides name the red sphere the game shows.
  It sits on its own render layer, so the plan view (which would be looking at
  the dome's underside) and the layer-0 raycaster never meet it. The same
  mechanism serves a plain map — the floor's preset carries its dome, and the
  editor's horizon stopped being void there too.

  **A model plays its own clip, and it ENDS.** Every `ModelInstance` in the
  shipped library names a `<SkelAnim>` — nine bones for the ice bolt, thirteen
  for the prayer — baked onto it the way an actor's clip is, so the crystal
  falls instead of hanging in the air. That clip is also what says how long the
  model is up: `CycleCount` cycles of `CycleLength` seconds, and since every
  shipped instance leaves the length at 0, one cycle is the clip's own duration.
  Nothing else can end it — a particle train dies out because the bake knows how
  many copies there are and how long one lives, but a model has no such clock,
  and the praying hands of a Prayer stood inside the soldier they were cast on
  for the rest of the scene. Where a model names no clip, the effect's own
  `<Duration>` is the fallback (2.5 in 1781 of the 1814 shipped effects — it is
  the editor's default, which is why it is a fallback and not the rule).

  And the clip's SCALE is what most of these models are actually doing: a
  meteor impact is one small quad that swells and settles, the gating vortex a
  cylinder that opens around the caster. Baked without that channel they stood
  at bind size — cards in the grass, a knot of ribbons — which is the shape
  this bug took on screen (docs/ANIMATION_FORMAT.md §5).

  Still missing, and visible. An effect's `<Lights>` — a `LightInstance`
  pointing at an `AnimLight`, whose colour and intensity are a baked blob like
  an animation's — is not drawn at all. And 46 of the 298 placed effects fly a
  path (`MovePoints` in world units with a `MovementSpeed` and a
  `ConstantPitch`); we put them at their start and leave them there. None of the
  46 are in C1M1's opening, so a marksman's arrow there is not in the scene file
  at all — if the game shows one it comes from the creature's own `AnimShot`
  (`GameMechanics/Shot/…` → `MissileShot`: a model, a speed, and offsets from
  the shooter), fired at a target no scene document names. [~]
* `tools/test-dialog-scene.ts` — the corpus checks and the census above.
* `tools/camera-shape.ts` — the convention measurement.
* `src/dialog/actors.ts` — an actor's ARENA rig: the character's own mesh and
  only the clips this scene names on it, baked. The adventure path is untouched
  (`src/scene/skin.ts` still reads idle and only idle).
* `src/dialog/play.ts` — the one assembly: documents in, a stage payload, the
  shots' camera moves and the rigged actors out. The window and the standalone
  page both call it, so they cannot drift.
* `electron/channels/dialog-scenes.ts` + `renderer/features/dialog-scene.ts` —
  the scene in the editor's own viewport, in a window of its own: the one
  canvas the app has moves into the dialog while it is open and goes back to
  the page on close. The stage goes through `buildWorld`,
  the same call a map goes through; the actors through `makeIdle`/`poseIdle`,
  the same skinning the map's idles use; the shot drives the camera while the
  orbit controls stand down. Driven by `view.openScene / showShot / playScene`,
  covered by `e2e/dialog-scene.spec.ts`.
* `tools/view-dialog-scene.ts` — a self-contained page that plays the scene
  through its own cameras, arrow keys to step the shots. This is how the camera
  convention was confirmed by eye, and how a scene is looked at before the
  editor has a window for one.

  Two calls on it, and they are the instruments this feature was debugged with:
  `snap(shot, t)` renders one frame, `sheet(from, to)` renders **every** shot
  tiled and labelled onto a single image. Both POST the PNG to `/sink`, so a
  headless browser can drive them. The sheet is the one that matters: a whole
  scene at a glance shows what a frame at a time hides, and it is what caught a
  camera that was pointing 180° wrong after two rounds of scoring against 4578
  poses had missed it.

* `view.snapshot()` in the app — renders the current frame and hands back a PNG
  data URL. The only way to see what the **editor** draws: an Electron window
  capture comes back without the WebGL layer, and reading the canvas after the
  frame comes back blank, because the drawing buffer is cleared on present. So
  it draws again and reads in the same task.
* `tools/scene-stage.ts` — builds a scene headless and reports what drew.
  C1M1's opening comes out as 53 meshes and 665 placed objects with ONE
  skipped: `Sunflowers.(AdvMapStaticShared)`, which is one of the game's own
  empty stubs (the working sunflowers are the `Sunflowers_1..5` group), so the
  engine draws nothing there either.

A shipped scene is opened the way a shipped map is: its folder is unpacked out
of the archives into a workspace that mirrors its data path, and that workspace
is mounted over the data root. Then every href in it resolves normally — the
absolute ones at the arena, the relative ones at its own files.

Open, in rough order of when it will bite: **how much of a SHOT's
`CustomAmbientLight` the game really uses** — 34 of C1M1's 73 shots override the
day preset with an inferno one and the game stays daylit, two more name an
all-zero preset and the game does darken there, and the sun direction provably
never changes across three probed runs — the SKY at least is known to follow
the override (the game shows the inferno sphere's red over this field, and so
does the editor now); the **voice recordings**
and the timings they imply; what `DynamicCamera` does, which the
corpus cannot say because it is on in all 981 shots that resolve to an actor
[~]; whether `Absolute` means anything beyond intent, now that the set is known
to carry the placement [~]; whether the easing between two poses is the
smoothstep assumed here [~]; and whether a custom scene can be listed in the
game's replay viewer [~].

Two shots of C1M1 (42 and 47, both Godric's) put the eye within half a unit of
the actor who speaks them, so the camera stands inside his horse. The reading
is right everywhere else and the corpus says this happens in 1% of shots either
way round, so it is recorded rather than fixed — the likely answer is something
that pushes the eye off an obstruction, which nothing here does yet. [~]
