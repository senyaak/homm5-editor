# Units and artifacts — adding things the game never shipped

How a new creature or a new artifact gets into Heroes V from this editor: what a
mod is, what the two dialogs do, and where the recolour pipeline stops.

The format work behind it — why the mod carries copies of three shipped files,
why an id is a NUMBER, why the executable has to be patched — lives in
`src/creature-mod.ts`, `src/creatures.ts`, `src/artifacts.ts`,
`src/creature-limit.ts` and `src/artifact-limit.ts`, each documented at its head.
The port's own write-up of the discovery is `<game>/Maps/sod/docs/NEW_CREATURES.md`.
This file is about the editor.

## One mod, always ours

A creature mod is a `.h5u` in `<game>/UserMODs` plus a ceiling in
`bin/H5_Game_NCF.exe`, and the two must agree exactly. It carries its own whole
copy of the game's creature registry, so **two creature mods do not compose**:
the game reads one and the other's creatures do not exist.

That is why the dialogs never ask which archive to write. They find the one
manifest-carrying mod in `UserMODs` and extend it; with none, they create
`homm5-units.h5u`. Two of ours is an error with the reason, not a choice.

An archive without our `units.json` manifest (someone else's mod) is listed and
left alone — it can be replaced, never extended, because names, texts and art
provenance are not recoverable from the game's own formats.

## Units…

Session-free — no map has to be open, because a mod is game-global.

**The donor is a preset, not a costume.** Picking a creature reads it whole
(`creaturePreset` in `src/registry.ts`): its record through the reference table
for the stats, its `CreatureVisual`'s refs for the name, description and ability
line, and both source documents for the four art hrefs. Every field in the form
fills in, and what you author is the difference.

| Field | Where it comes from | What it becomes |
|---|---|---|
| Preset | the creatures roster | `visualSource` + `monsterSource` |
| Files | typed | the stem of every generated file, and the folder |
| ID | spelled from Files (`H3Sharpshooter` → `CREATURE_H3_SHARPSHOOTER`) | what maps, saves and Lua store |
| Ability ids | multi-select over the 199 `ABILITY_…` in `types.xml` | `<Abilities>` in the creature record |
| Town | the races roster | `CreatureTown`; `TOWN_NO_TYPE` for a neutral |
| Art (4 rows) | the donor's documents | the files copied into the mod |

The four art rows are the **copy handles**. Each names a document in the game's
data — `AnimCharacter` (what fights), `Model` (what stands on the map),
`AnimSet`, `Icon128` — and the build copies its whole closure into the mod.
Point one at another file and only that piece changes; the rest stays the
donor's. A creature without an icon stops the game at startup, so that row is
never allowed to be empty.

**Build & install** packs the archive into `UserMODs` and sets the creature
ceiling in one action (`installCreatureMod`). They are never written apart: a mod
above the ceiling is read and silently ignored, a ceiling above the mod stops the
game at launch.

## Artifacts…

The same dialog one button over, for the artifact side of the same mod.

The artifact reference table keeps every artifact **inline** — slot, rank, cost,
AI value, the six hero stats, the icon and model hrefs — so a preset is one
lookup (`artifactPreset`). Slot and rank are selects over the engine's own
enums.

Two things differ from creatures:

- **No map model means a flat board.** With `Map model` left empty the mod builds
  a quad showing the artifact's own icon, standing on the tile — the developers'
  posters are exactly this, so nothing artistic is borrowed. Naming a shipped
  model instead references it; artifact models are never copied.
- **The artifact ceiling is also in the executable**, and finding that out cost
  three wrong answers: raising the table's declared size in `types.xml` is enough
  for the game to *read* a hundred artifacts and not enough for it to *use* the
  ones past 97. `src/artifact-limit.ts` patches the two sites, and because an
  already-patched executable holds a round number whose accessor bytes are no
  longer unique, it leaves a note beside itself
  (`bin/H5_Game_NCF.artifact-sites.json`). **That note belongs with the
  executable** — copy one without the other and the next patch cannot find its
  own sites.

## Recolor

Every creature of our mod has a **Recolor** button in the Units list. What it
repaints are the **mod's own textures** — the art closure put copies there — so
nothing shipped is touched and reverting is rebuilding on the donor.

### The palette

A global hue turn paints the skin along with the cloak, which is rarely what
anyone wants. So the dialog opens with the textures' palette
(`extractPalette` in `src/recolor.ts`): a 24-bin hue histogram over the visible
pixels, merged into runs around the peaks, the largest kept, plus one **neutral**
cluster for everything below 12% saturation, where a hue means nothing.

Each cluster is a swatch with a colour picker. A pixel belongs to the cluster
whose hue centre is nearest, and **only remapped clusters change**: the target
contributes hue and saturation, the pixel keeps its own **lightness**, which is
where the drawing lives — folds, shadow, the shape of the metal. Leave a swatch
alone and its pixels come through untouched.

The global hue / saturation / lightness / tint controls still apply, on top, to
everything; the **Grey** preset is saturation to zero.

Preview and rewrite run the **same function** on raw RGBA — the renderer on a
canvas's `ImageData`, the main process on the decoded DDS — so the canvases are
not an approximation of the result, they are the result. Alpha is never touched:
on a creature texture it is the silhouette cut-out (`AM_ALPHA_TEST`), and
recoloured must not mean eroded.

### Where this pipeline stops

The shipped textures are **DXT3, 512×512, with a 7-level mipmap chain**. The
first cut writes the recoloured surface back **uncompressed** (`TF_8888`, one
surface) and edits the paired `.(Texture).xdb` to match — `Format`, `IsDXT`,
`NMips`. That format is one the game demonstrably reads (every shipped artifact
icon is one), and a `.dds` its document misdescribes is present and invisible,
which is why the pair is always written together.

The costs, stated plainly:

- **1 MB instead of 256 KB** per 512×512 texture.
- **No mipmaps**, so a recoloured creature seen small may shimmer where the
  original does not.
- **Not yet verified in the running game** — only against our own decoder and the
  editor's renderer.

Recompressing to BC2 and regenerating the chain is the finish, and it is the
first item of the recolour section in `ROADMAP.md`, along with splitting a
cluster by lightness, painting by region, and per-material targeting.

## Team colour

Creatures have none. Both of the Sharpshooter's materials are plain diffuse maps
with no player-colour layer or mask — checked, because "the game tints a layer
per player" is a reasonable thing to assume and it is not true here. Flags and
banners are where a player-colour layer is real, and those are objects, not
creature art.

## Testing

`e2e/units-mod.spec.ts` drives all of it against an **isolated game root**: a
temp folder holding a copy of the unwrapped executable with both ceilings reset
to their shipped values, and an empty `UserMODs`. The real install is never
touched. In order, it

1. opens Units… on a clean install and checks the donor preset fills the form,
2. edits the difference and installs the port's Sharpshooter, then reads the
   archive back and the executable's ceiling,
3. builds the Undertaker's Amulet through Artifacts… into the same archive,
4. remaps one palette cluster to grey and proves, through `extractPalette` over
   the archive's own bytes, that the remapped hue is gone and every other cluster
   survived,
5. paints the whole creature grey and checks every pixel, the alpha, and the
   paired documents,
6. places a garrison on a fresh map and finds the new creature in the army
   picker — the loop closing, since the editor mounts what it just installed.
