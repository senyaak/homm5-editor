# The Pandora's Box — how one is authored

Heroes III's box, brought over: an object a hero opens for whatever the map's
author put inside. This page is the EDITOR's half — what a box can hold, what
that is worth, where the contents live and what actually ships inside the map.
The engine half — the native class the box is to become — is
`docs/engineInternals/PANDORA_OBJECT.md`.

## Turning it on

Settings → Game settings → **Gameplay → `pandora-box`**. The flag writes
`H5E/homm5-editor-gameplay.h5u`, and that archive IS the box: the model, its
four glow documents, the palette entry and the behaviour script. The editor
mounts the same archive, so the palette gains the box on the next map opened;
the game needs a restart.

Turning the flag off deletes the archive again, and with it the box: the
extension's gate is behind the same flag, so an install that turned it off is
back to the one it was, chest and all. A map that places boxes and is played
without it has objects pointing at definitions nothing provides — so the flag
travels with the map, not with the mood.

Both directions are asserted rather than assumed — `mod-011` deletes the archive
first, ticks the box, and finds it written; then unticks it and finds it gone.
A switch measured with the thing already installed reports success whatever it
does.

## Placing one

Objects → **. Treasures**, beside the chests and the resource piles. That group
is not decoration: the Objects tab's filters live in `Editor/MapFilters.xml`, a
loose file no mod can add a group to, and each group is a set of folder
prefixes — so an object lands in a group by WHERE ITS LINK FILE SITS. The box's
link is `MapObjects/_(AdvMapObjectLink)/Treasures/PandoraBox.xdb`.

A fresh box is the poorest glow and holds nothing. Select it and the inspector
offers **Contents…**.

## What a box can hold

Everything is optional and everything adds up — a box may hand over gold AND an
artifact AND a stack, and be guarded besides.

| Content | What happens |
|---|---|
| Message | Shown when the box opens, the way a signpost speaks. |
| Experience | `GiveExp` to the opening hero. |
| Gold, and the six resources | Added to the opening hero's player. |
| Artifacts | `GiveArtefact`, one per entry. |
| Spells | `TeachHeroSpell` — the hero learns them. |
| Creatures | Join the opening hero's army. |
| Guards | Fought BEFORE the box opens. Win and it opens; lose and it stays shut. |

## What the contents are worth, and the glow

The glow states the value: **blue, green, gold, red**, poorest to richest, at
0 / 5 000 / 15 000 / 40 000 gold. The colour is a shared document rather than a
per-placement field, so each tier is its own definition and saving a box points
the placement at the one its contents earn.

**A guard costs exactly what a gift costs.** Ten archangels handed over and ten
archangels fought are the same ten archangels — the box holds them either way —
so both land on the same colour. Nothing lets an author dodge the glow by
turning a reward into a fight.

Prices come from the game where the game states them:

| Content | Priced by |
|---|---|
| Creatures | the creature's hire gold, times the count |
| Artifacts | the artifact's `CostOfGold` |
| Spells | the spell's `Level`, at our rate below |

and from OUR rates where it does not — the game ships no resource price
(`ResourcesInfo.xdb` carries icons and nothing else; the market rate is computed
in the executable) and experience has no price at all:

| Rate | Value | Where |
|---|---|---|
| a common resource (wood, ore) | 250 gold | `PANDORA_RATES.common` |
| a rare one (mercury, crystal, sulfur, gems) | 500 gold | `PANDORA_RATES.rare` |
| one point of experience | 1 gold | `PANDORA_RATES.exp` |
| one level of a taught spell | 1000 gold | `PANDORA_RATES.spellLevel` |

They are in one place, `src/mods/pandora-contents.ts`, and changing one is one
line. They are ours, not measured, and this table is where that is admitted.

The window shows the total and the breakdown that produced it, because the first
question anyone asks a number like this is which half of the box made it. The
**Glow** dropdown overrides the tier for a box that means to lie about itself —
a trap dressed as a trinket — and an override survives the contents changing
under it.

## Where the contents live

In a sidecar beside the map, `pandora.json`, keyed by the placement's **Name**.

That name is not a label: it is the handle the touch trigger looks the box up
by. Renaming the placement in the inspector carries the contents across; a box
whose name drifted away from its contents would still be on the map, still
glowing, and would open with nothing inside.

The sidecar is the editor's bookkeeping and never ships — `EDITOR_SIDECARS` in
`src/map/project.ts` keeps it, `localization.json` and the project manifest out
of every pack.

## What ships inside the map

Saving materialises what the GAME can read:

* **the generated block** in the map's Lua, between
  `-- H5E pandora (generated)` and `-- H5E pandora end`: a data table of every
  box, a touch trigger per box, each guarded box's fight written out in full,
  and a `doFile` of the shipped behaviour **last** — a trigger resolves its
  handler when it fires, so the hooks survive a behaviour file that fails to
  load, where a `doFile` first would take the thread down with every hook still
  unbound;
* **one text file per talking box**, `pandora-<Name>.txt`, because `MessageBox`
  takes a ref and a ref is a whole file — two boxes sharing one would say each
  other's lines;
* **a map script**, if the map had none. The behaviour is a touch trigger and
  there is nothing to hook it into otherwise. The author's own code sits below
  the fenced block, untouched.

Everything outside the fences is the author's and is never rewritten. A map
whose last box is deleted loses the block entirely.

The block is written in Lua 4's own grammar, and two of its rules were paid for
in game runs: inside a table constructor the separator is the COMMA (a `;`
there is "invalid constructor syntax" and takes the whole `DoString` down with
every hook unbound), and `return;` alone kills the file. Both are in the
linter — `src/script/lua-lint.ts`.

## It is not a chest — and that half needs the extension

The box is an `AdvMapTreasure` in the data, and left alone the engine would run
the CHEST's visit beside ours: its own dialog, its own goods, and the object
taken off the map before the player answered anything. Our extension takes that
one behaviour away — and only for boxes, recognised by the document they were
built from, so every real chest on the map behaves exactly as it always did
(`native/qol/pandora-box.c`, and `docs/engineInternals/PANDORA_OBJECT.md` for
how it is done).

**So a map with boxes wants the extension installed**, which the `pandora-box`
flag does along with the archive. Without it the boxes still work — the touch
trigger, the question, the contents are all script — but the chest talks over
them.

## What is not done yet

The DATA still says `AdvMapTreasureShared`. A class of our own,
`AdvMapPandoraShared`, is the remaining step, and it is cosmetic in the sense
that nothing a player sees depends on it — it is what makes a map say what it
means (`docs/engineInternals/PANDORA_OBJECT.md`, stage 2).

## Where the code is

| Piece | File |
|---|---|
| the contents model, the valuer, the tiers | `src/mods/pandora-contents.ts` |
| prices off the game's tables | `src/mods/pandora-prices.ts` |
| the object: model, texture, glows, palette link | `src/mods/pandora-files.ts` |
| the behaviour and the generated block | `src/mods/pandora-scripts.ts` |
| the sidecar | `src/map/pandora-store.ts` |
| writing the block at save time | `electron/pandora-save.ts` |
| the window | `renderer/features/pandora.ts` |
| tests | `tools/test-pandora.ts`, `tools/test-pandora-store.ts`, `e2e/mod-011-pandora-map.spec.ts` |

The e2e is also the **probe map**: eight kinds of content in four glows each,
twice over — one row per side — with a hundred archangels for the first hero so
the guarded boxes can be opened, and an enemy hero with the same row of boxes
beside him. It builds `<game>/H5E/PandoraProbe.h5m`, and what it cannot answer
is what the engine does with any of it. That is read by playing it.

The sides are led by **generic heroes** — the palette's `. Heroes (Generic)`
group, one class each, which is what a map wants and what a person clicks. A
named hero is a hero with a story: asking the catalogue for "the first one that
sits beside a race" answers with Alaric, who is a campaign hero and not in the
standard pool at all. The generic entries are `RndGroup`s over each class's
standard heroes, and the editor stands in the group's first member the way the
original does.
