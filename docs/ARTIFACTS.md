# Adding an artifact to Tribes of the East

> **Where this document is, and what its paths mean.** It was written in the
> Heroes III port and moved here in 2026-07, because what it describes is the
> EDITOR: the format, the six places an artifact touches, and the four wrong
> answers found on the way. Paths below are this repo's unless they say
> otherwise; the port's own files (`src/new-artifacts.ts`,
> `tools/probe-artifacts.ts`) were retired when the dialog took over, and the
> three artifacts and their set are fixtures of [e2e/mods.ts](../e2e/mods.ts)
> now. The port itself lives at `<game>/h3-mod/`.

Confirmed working in game: three artifacts the game never had — the Amulet of the
Undertaker, the Vampire's Cloak and the Dead Man's Boots — worn by a hero, lying
on a map, picked up.

This is what it takes, and what it took to find out. The recipe is six places,
and **five of them can be right while the sixth makes everything look like it
never worked at all**. Four explanations were wrong before the right one, each of
them a real defect that changed nothing; they are all written down below, because
the next person will make one of them.

## What an artifact is made of

| | |
|---|---|
| the **record** | one entry in `GameMechanics/RefTables/Artifacts.xdb` — name, slot, price, and the six hero stats it moves |
| the **shared** | `AdvMapArtifactShared` — the thing lying on the ground: a model, a glow, two messages |
| the **icon** | a 64×64 `TF_8888` `.dds` under `Textures/HeroScreen/Artifacts/` with a `(Texture).xdb` beside it |
| the **texts** | name and description, UTF-16 LE with a byte-order mark |
| the **palette entry** | one link file, so the editor can place it |

The record and the shared are joined by exactly one line: the shared's last
field, `<ArtifactID>`, names the artifact. `AdvMapMonsterShared` names its
creature the same way, and that line is how a copied document once put someone
else's creature on a map (docs/NEW_CREATURES.md).

## The six places

Everything the port adds is **one archive** — `homm5-editor.h5u`, the editor's
global mod rather than one of the port's own. See the
warning about two archives below.

1. **`types.xml`, the enum** — `<Item>ARTIFACT_X</Item>`, after the last shipped
   one (`ARTIFACT_PRINCESS`).
2. **`types.xml`, the name→number map** — `<Name>ARTIFACT_X</Name><Value>97</Value>`.
   The number is what a map, a save and a script store, so **the list is
   append-only**: inserting or reordering repoints every artifact after it.
3. **`types.xml`, the declared size** — on `Table_DBArtifact_ArtifactEffect`,
   **`MinElements` AND `MaxElements`, which are equal**. This differs from
   creatures, whose table has a `ref_table_num_objs` and a `MinElements` that is
   only a floor. Raise one and not the other and the table says it holds exactly
   97 while carrying 100.
4. **`GameMechanics/RefTables/Artifacts.xdb`** — the whole table, with our
   entries added. Written as a **bare `<obj>`**; see below.
5. **`scripts/advmap-startup.lua`** — `ARTIFACT_X = 97`, and
   `ARTIFACT_ARTIFACT_EFFECT_COUNT` moves with it. That constant is what a script
   loops to; left behind it stops one short of everything the mod added.
6. **The executable's ceiling.** See below. This is the one that took four
   guesses.

And one that is not in the mod at all:

7. **The map's own `<artifactIDs>`** — the list, at the root of `<AdvMapDesc>`,
   of which artifacts exist on that map. 97 entries on a map the stock editor
   made.

## The executable's ceiling

Raising the declared size in `types.xml` is enough for the game to **read** a
hundred artifacts out of a modded table. It is not enough for it to **use** the
ones past 97.

Two sites, mirroring the creature ceiling byte for byte:

| | where | shape |
|---|---|---|
| the load | 37 bytes after the code naming `/GameMechanics/RefTables/Artifacts.xdb` | `push 97` (`6a 61`) |
| the accessor | on its own, padded with `int3` | `mov eax, 97; ret` (`b8 61 00 00 00 c3`) |

The creature one is a `push 180` thirty-three bytes after *its* table's name, in
identical surrounding code — the same function called with (table name, count).

`src/exe/artifact-limit.ts` finds both **by pattern, not by address**,
because the Steam build of the game is a different compilation from the retail
one and shares no offsets with it. Installing the mod sets this ceiling and the
creature one together, because both have to agree exactly with what the mod
carries.

Two limits worth knowing:

- **127.** The load site is a `push imm8`, so a ceiling above 127 cannot be
  written without lengthening the instruction. That is thirty new artifacts.
- **The search cannot run twice.** At the shipped 97 the accessor sequence occurs
  exactly once; at a round 100 it occurs four times, so an executable already
  patched can no longer say where its own accessor is. The offsets are noted in
  `bin/H5_Game_NCF.artifact-sites.json` when they are found, and the note is
  re-checked against the opcodes in front of them before it is believed.

## The four wrong answers

Each of these was a real defect, found and fixed, and none of them was the cause.
They are here because they all *look* like the cause.

**1. `<obj href="#n:inline(DBArtifact)">`.** The artifact table writes its objects
as a bare `<obj>` — all 97 of them. The creature table looks like the same thing
and is not: there the object is a *reference*, either to a file or with
`#n:inline(Creature)` as the marker for one written in place. Carrying that
marker across gives an href the game cannot resolve, and the record comes out
empty. *The test now reads the shape off the shipped entries instead of asserting
one from memory — the old assertion held the bug in place and passed.*

**2. Two archives.** Artifacts need no patched executable, so they had an archive
of their own for a while. A mod **replaces** a file rather than merging it, and
creatures and artifacts both edit `types.xml`: whichever archive the game read
second wiped the other's edit out. In game that read as
`Empty pointer to creature # 180`.

**3. The map's `<artifactIDs>`.** An artifact outside that list is refused
wherever it turns up — a hero who starts wearing one has nothing, and picking one
up off the ground says *Невозможно взять артефакт* and destroys it. Both symptoms
look like the mod failing to register the artifact. The converter builds this
list through the **mounted** chain so every converted map allows what the mod
adds.

**4. "Artifacts have no compiled ceiling."** They do. The reasoning that said
otherwise was: the twelve `mov eax,N; ret` accessors in the cluster where the
creature ceiling sits hold 7, 126, 5, 180, 5, 11, 1, 5, 9, 10, 5 and 23, and 97
is not among them. True, and the wrong conclusion — the artifact accessor is
elsewhere.

## What settled it

A probe that changed something **shipped**. `tools/probe-artifacts.ts` renames
the Treeborn Quiver inside our copy of the table and nothing else; the test map
gives the necromancer that quiver as a control beside our three. One look at the
hero screen splits three worlds:

| the quiver | what it means |
|---|---|
| renamed, ours present | it works |
| renamed, ours missing | the table is read; the trouble is ids past 97 — a compiled ceiling |
| its own name | our table is not read at all, and nothing downstream matters |

It came back *renamed, ours missing*, which pointed at the executable and nothing
else. The same trick settled whether the creature table was being read.

**The lesson is the control, not the probe.** Three of the four wrong answers
would have been skipped by having a shipped artifact on that hero from the start:
if it arrives and ours do not, the map and the hero are fine and the question is
the mod. Without it those cases are indistinguishable, and one guesses.

## What data cannot say

An artifact's record carries six hero stats and nothing else. Every special
property the shipped artifacts have — the Necromancer's Pendant raising
necromancy, a set's bonus — is compiled into the executable against a specific
id, and a new id gets none of it and cannot be given any.

Heroes V's own set mechanism goes **half** the way, and the half it goes is
free. `GameMechanics/RPGStats/DefaultStats.xdb` holds the sets as data —
membership, per-count descriptions, icons — and `<Effect>` names a value in an
ordinary enum in `types.xml`, so a mod can append **its own** twelfth value
rather than borrowing one of the eleven. Confirmed in game on 2026-07-28: the
Cloak of the Undead King is named on the hero screen and the engine counts the
pieces worn by itself. There is no compiled ceiling on the number of sets.

What that does not buy is the bonus. Each shipped effect's behaviour is compiled
against its value (`LIONS` fires at exactly 3, `NECROMANCERS` at 2 and 4, most
of the rest at 2); their magnitudes are data (`ArtifactsSetsEffectsConsts`), the
behaviour is not — and ours is a value the executable has never heard of.

So the bonus is **native code**, added on top of the engine's own arithmetic
rather than replacing any of it: the necromancy percentage is one sum whose last
term is "count worn pieces of a set, if enough add a number from data", and a
term of ours is the same shape. The plan and the reverse-engineering behind it
are [SLICE_artifact_effects.md](../SLICE_artifact_effects.md) and
[ENGINE_INTERNALS.md](ENGINE_INTERNALS.md), and it works in game as of
2026-07-29. A script was the earlier answer here
and is not one: it has no equip event, cannot take back a spell it granted, and
sees no combat number.

One thing has no hook at all: **dark energy**. The script API has
`GetPlayerNecroEnergy` and no setter — the complete function table was pulled out
of the executable to be sure — and the console's `add_energy` is the ghost-mode
resource, not the necropolis one. What a script *can* do is the thing energy buys:
raise creatures directly.

## The board

An artifact with no model of its own stands on the map as a flat board showing
its own icon, rather than borrowing a shipped artifact's model — pointing the
boots at the pendant's model says *this is the pendant* to anyone who knows the
art.

The game's developer posters are the only bare quad it ships (`Size` 1.43 × 0 ×
1.43, one mesh, one material), so the board references their geometry and carries
a material of its own: two-sided, because an artifact spins and a one-sided board
vanishes for half of every turn, and unlit, so the picture does not go muddy at
dusk. The quad is moved to the middle of its tile and stood on the ground — and
the shift goes in **before** the scale, so scaling it too buries the board,
deeper the bigger it is.

## Pictures

The artwork a port starts from is whatever the author has, and for Heroes III
that is a GIF. `src/format/gif.ts` reads one and `src/format/texture.ts` writes
the game's texture, so a build depends on nothing that happens to be installed.
The icons themselves are somebody else's artwork: they live in `art/artifacts/`
and are not committed, and `src/new-artifacts.ts` says where each came from.

## Where it stands

- [x] three artifacts, ids 97–99, in the game
- [x] worn, lying on a map, and picked up
- [x] the set itself — its own effect value, named on the hero screen, pieces
      counted by the engine
- [ ] the set's bonuses, as native code — `+5%` necromancy each, and something
      for the pair and the trio. What replaces "restore dark energy" is still
      open; raising the creatures directly is the honest equivalent.
