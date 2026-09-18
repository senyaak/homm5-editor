# SLICE — an asset editor: models, textures, animations, effects

> **Status: planned, nothing started.** Written 18–19.09.2026 after a talk about
> what the editor still has to become. Two other lines are running in parallel —
> the frame optimisation and the factions of our own — and both come first. What
> this slice may do meanwhile is READ: the engine's playback of these assets is
> disassembled and written up in `docs/engineInternals/`, one note per question,
> and nothing in the app is touched until the reading is done. Branch
> `fx/engine-playback`, worktree `C:\Projects\homm5-editor-fx`, its own game copy
> `C:\Projects\homm5-game-fx` (see §7).

## The goal, in Senya's words

> «Редактор моделей, текстур и анимаций! + эффектов!»

and, on why an external tool is not the answer:

> «Править чуть-чуть модельки проще в игре, когда видишь косяк анимации. …
> Одна прога — создал, вторая — анимировал, третья — вставил в карту, увидел баг
> и всё по новой — вот в чём моя проблема.»

The problem is the **loop**, not the power of any one tool: three programs per
bug. The editor already has the model on the map, in the game's light, with the
game's terrain under it — so a small fix made THERE is worth more than a big one
made in Blender, because it is made where the fault is visible.

## 1. What is already on the ground

Everything below is measured, not assumed; the format notes carry the proofs.

| | read | written | seen by the game |
|---|---|---|---|
| geometry, `bin/Geometries` | all 3572 | byte-exact, `src/format/geometry-write.ts` | yes — the Pandora's Box |
| skeleton + clips, GR2 | yes, `src/format/gr2.ts` | yes, `src/format/gr2-write.ts` (stored sections, plain curves) | yes — the Pandora's Box |
| textures, DDS | DXT1/3/5 | `TF_8888` (no mips), DXT1 with mips | yes — icons, recolours |
| effects, `bin/effects` | 1922/1924, and they play | **no writer** | **never** |
| viewer | Three.js draws meshes, skinned meshes, effects | | |

ROADMAP.md already holds this in pieces: the animation player dialog (Phase 5b),
the model picker with a preview and the recolour editor done properly (Phase 7),
the model-editing ladder — skeleton swap, material edits, mesh surgery (Phase
5b), and "importing custom assets" (Phase 7). This slice is those pieces named as
one thing, with an order.

## 2. The shape: a window that edits the PRESET, with a scene switch

A model is shared by every placement that uses it, so "edit this one on the map"
is ambiguous — the preset or this instance? A separate window that honestly
edits the **preset** removes the ambiguity. The map is not where the edit is
made; it is one of the backgrounds the edit is checked against.

The scene is a switch:

- **Preset** — the grid, as the shipped editor shows it (its `Character` view:
  the Animation panel with the AnimSet list and per-clip speed, `Global Move`,
  `User sequence`, `Color model`). That panel is the floor for our player, not
  the ceiling.
- **Map** — the open map, read-only, camera on the placement the window was
  opened from ("Open model in editor" on a placed object), with the map's light,
  terrain and neighbours.
- **Arena** — the `-arena` AnimSets (attack / move / hit / death) are never
  visible on a map; their own light and camera distance.
- **Dialog scene** — for heroes and talking heads; light and shadow already
  measured (docs/DIALOG_SCENES.md).

**One link without which the window is pointless:** an edit to the preset must
show in the map viewport at once, or the loop breaks in two again. Models go
through a cache (docs/PERFORMANCE.md), so an edit is an invalidation by uid and
a reload of every placement carrying that model. Designed in from day one, not
bolted on.

And the map background answers the other half of the ask: if the window and the
map viewport are one renderer, "do we play it as the game does" is fixed once
for both.

## 3. Not Blender — the ready pieces, and the line

Nobody sculpts vertices in a map editor; but the small fixes are not sculpting.
The line:

- **in the window:** pivot, scale, orientation, materials (texture reference,
  AlphaMode, AddPlaced, L_SELFILLUM — the flags this project already
  understands), clip timing, root motion, nudging a vertex group, flipping UVs,
  which clip is `idle00` / `attack` / `move` in an AnimSet, pointing a model at
  another model's skeleton;
- **outside, through ONE import:** retopology, rigging from scratch. Import is
  the first brick — without it there is nothing to edit.

Ready JS, none of it to be written from scratch (Senya: «может есть что-то на
js готовое? … не надо Blender писать с нуля — хотя бы базовые вещи»):

- **three.js editor** (MIT, in the three.js repo) — `TransformControls`, the
  material sidebar, the animation sidebar, glTF in and out. An application, but
  its parts are modules and come one at a time. Three.js is already ours.
- **theatre.js** (Apache-2.0) — a sequencer with a dope sheet and a **curve
  editor**, on top of Three.js. That is "fix the clip": move a key, stretch,
  cut the root motion.
- **SculptGL** (MIT) — WebGL sculpting, if it ever comes to vertices. Not first.
- **not ready anywhere:** skin-weight painting. That would be ours, and it is
  needed least.

**glTF is the import format.** It carries positions, normals, UVs, skin weights,
the skeleton and the clips in one file, and we have a writer for every half of
that on the game side: glTF → Geometry + Skeleton + clips + `(Model).xdb` +
materials + AnimSet.

The shipped Blitzkrieg editor (Nival; same engine line?) has NOT been checked.
If it turns out to WRITE this container or these effects, it is valuable as a
second writer to diff ours against — not as a tool to use.

## 4. Effects are the one genuinely new tool, and the one unproven half

`bin/effects` is a **recording** — a baked Maya particle run, no emitter logic
in the file (docs/EFFECTS_FORMAT.md §1). So an effects editor is not a curve
editor over the file; it is **our own particle system** (emitter, forces, colour
/ size / texture-frame curves over life) plus a **baker** into the format, with
the live preview the renderer already gives. Nothing like it exists for this game
outside Maya of 2006, and it is what a spell of ours needs — a spell has two
visuals (docs/engineInternals/SPELLS.md).

It is also the only row in the table above with two "no"s. Before any simulator:
a file with ONE particle, written by hand, placed on a map, and seen — or not —
in the game. That is the probe whose "no" changes the whole plan, and it is the
first thing to spend a launch on.

## 5. Order

Senya, on the order: «для начала надо разобрать все игровые вещи — потому что мы
не всё правильно играем». A preview that lies is worse than none — the edit is
made against a picture the game does not show.

1. **Play it as the game does** — effects first, because the list of what we
   simplify or invented is already written: SLICE_effects_probe.md §7
   (`gfx_particles` boolean or density; the alpha threshold 0.003 / 0.01 is
   ours; the phase spread `i * 0.37` is ours; sorting never looked at; the
   fixed-function path never looked at; `<Lights>` and `<Models>` inside an
   effect; the scale channel of a clip).
2. **glTF import + the viewer**, no worse than the shipped Animation panel.
3. **Edits in place** — gizmo / material / skeleton / AnimSet from the three.js
   editor's parts, curves from theatre.js.
4. **The texture debts** — DXT3 recompression + the mip chain + `AverageColor`
   (a recolour today costs 1 MB instead of 256 KB and loses the chain), import
   an image as a texture, per-material targeting, undo / revert to the donor.
5. **The particle simulator and its baker** — once (1) is closed and the
   one-particle probe of §4 has said yes.

Steps 1–3 pay the ninth faction (new creatures); 4–5 pay the spells of our own.

## 6. The reading — what to disassemble, in order of cheapness

Reading only touches the exe and `docs/engineInternals/`; it does not cross the
two running lines. Each item has an anchor to start from:

1. **`gfx_particles`, `gfx_effect_alpha_treshold`** — strings in the exe; find
   their readers. "Boolean or density" and "whose threshold" are answered
   statically.
2. **The particle shader and its pass** — the shaders sit in the exe as text
   from `0xc64f04` (docs/engineInternals, "shaders live in the exe"); the chain
   material → `CGenericMaterial` → pass gives the blend state, the alpha test,
   and whether the engine sorts before drawing. Three of §7's questions in one
   read.
3. **The `bin/effects` loader** — the in-memory structure, where `EndCycle` and
   `Speed` are applied, and whether the engine spreads phases between instances
   at all (our `i * 0.37`, or something of its own).
4. **`<Lights>` and `<Models>` inside an effect** — how they are placed and
   animated.
5. **The scale channel of a clip** — SLICE_effects_probe.md.

What reading cannot say: **which branch** (`fx_tnl_mode`, the fixed-function
fallback) is taken on this machine — that is chosen from device caps at run
time. The disassembly shows both; the one launch says which plays.

Format: one note per question in `docs/engineInternals/`, addresses given,
proven and assumed kept apart, one commit per note.

## 7. The launch rule, and the worktree

> «Запуск не должен быть ради одной вещи. Если запуск идёт — логируем вообще всё,
> на чём фокус: не какой вариант берётся, а как работает этот кусок exe
> полностью. Хоть миллион гигабайт лога — так проще, чем миллион запусков и
> миллион маленьких файлов.»

So a probe for a launch is designed as a **trace of the whole subsystem** — the
full list of its functions from the disassembly (loader, particle update, draw,
every `gfx_*` read), a hook with a full dump of arguments and state on each — not
as the answer to one question. The disassembly comes first because it is what
produces that list. The one known limit stays: a log that crashes the game
(147 MB once did) kills the run it was for; events in full, questions not
echoed (memory: "logs must not be rationed", 08.08.2026).

The worktree carries **its own game copy** so that a launch here touches neither
the shared Steam install nor the other lines' copies: `.env` →
`HOMM5_ROOT=C:\Projects\homm5-game-fx` (a copy of `homm5-game-sod`, 2.95 GB,
with `H5_Game_H5E.exe`, our `homm5-editor.dll` and the `H5E/` mods; it already
holds `bin/homm5-editor-effects.txt`, the effects probe's config). Launches are
Senya's.
