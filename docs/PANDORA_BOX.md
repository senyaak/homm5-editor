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
| Message | Shown when the box opens, the way a signpost speaks — to the player who opened it, and to nobody else (below). |
| Experience | `GiveExp` to the opening hero. |
| Gold, and the six resources | Added to the opening hero's player. |
| Artifacts | `GiveArtefact`, one per entry. |
| Spells | `TeachHeroSpell` — the hero learns them. |
| Creatures | Join the opening hero's army. |
| Guards | Fought BEFORE the box opens. Win and it opens; lose and it stays shut. |

Two of them are worth knowing about before an author blames a box: **a spell
needs a book that takes it** — a Barbarian keeps CRIES where everybody else
keeps spells, so `SPELL_TOWN_PORTAL` handed to him lands nowhere while
`SPELL_WARCRY_*` lands fine (the game's own campaign teaches a barbarian his
cries with the same call, `TeachHeroSpell("Kujin", SPELL_WARCRY_RALLING_CRY)`
in A2C3M4) — and **creatures join an existing stack**, so ten archangels added
to a hundred read as nothing happening at all.

The first of those is a **TO FIX**: a box should not be able to promise a
hero something his book cannot hold, and today it can. The probe map asks the
question rather than answering it — a third hero, a barbarian, with a box of
cries and a box of Town Portal beside him.

### What the player sees, and when

1. **The question** — "the box is sealed… open it?"
2. **The author's message**, right after "yes". It is what is written on the
   lid, so it comes BEFORE anything the box does — not after the battle, which
   is where it used to arrive and where it read as a reward slip.
3. **A taunt, for a guarded box** — the lid is off and what was locked in is
   awake — and then the fight.
4. **The receipt**, once the box is open: what it handed over, flown over the
   hero the way the game announces its own gains.

The receipt is written by the editor, not typed by anybody, and it uses the
GAME's words: `SPELL_IMPLOSION` reaches the player as `Шок Земли` in a Russian
install, because the name is read out of the same records the prices come from
(`src/mods/pandora-names.ts`). Even `experience` and `gold` are the game's —
the resource names live in `ResourcesInfo.xdb`, and the word for experience is
lifted out of the treasure chest's own line, which is the only place it exists
as a word.

It exists because two kinds of reward move a number in the HUD and nothing
else. A play-through reported both rows as boxes that did nothing, and from
outside there is no way to tell that from a box that is broken.

### Only what a box asked for is announced

The engine announces an artifact taken and a stack raised by necromancy, but
never a spell taught and never a stack handed over — which is why a box that
gave one read as a box that did nothing. The extension announces those two, and
**only when the box asks**: the generated Lua calls `H5EAnnounceGain()` before
each spell and each stack, one gain at a time, and the extension announces the
next one it sees and then forgets. Everybody else's spells and stacks behave
exactly as the game shipped them.

That is the second design. The first hooked the command every script teaches
through, and a map whose INIT SCRIPT hands its hero a spell then told the player
he had just learned it. Three ways to tell "being set up" from "being played"
were tried and all three failed the same way — they refused the init they were
meant to refuse and real events with it:

- the announcement holder's own two questions about the world — they answer the
  same while a map is being set up as they do in play;
- a whole kilobyte of the world diffed against ITSELF, loading against playing.
  Three words move, and all three move on an init-only map as well: they count
  announcements, they do not describe the game;
- observables that are only true in play — "a sign has flown off a hero", and
  the map's own first thread waking up. Both refused the init they were meant to
  refuse AND real events: a barbarian is handed his first war cry before he has
  earned any experience, morale or luck, and the first box on the probe map
  comes up before a freshly started thread has answered.

A fourth was proposed and answered out of a log that already existed: the game
names the week the moment a map begins, so a banner by that name would be the
signal. Every announcement now writes its own wording to the log, and it says
the week banner is the FIRST announcement of all — it arrives BEFORE the init
script has handed anything over, so it cannot separate them either.

None of that matters now. The question "is this map being set up or played" was
only ever asked because the extension had taken over a path that belongs to
everybody; asking the box instead makes the question go away.

### Who sees the message

Only the player who opened the box, and only while it is his turn.

That has to be enforced, because a message box is shown to the SCREEN rather
than to a player: the script runs once and the popup lands on whoever is
watching. The obvious test is the wrong one — `GetCurrentPlayer()` is the
player whose TURN it is, not the one at the keyboard (the shipped scripts spin
`while GetCurrentPlayer() ~= PLAYER_2 do sleep(1); end` on it), so on the
computer's own turn it equals the computer, and an owner check passes. Played,
that was the AI announcing its own reward on the human's screen.

The test that does work is `IsAIPlayer`, and both popups — the question and the
message — go through one function that asks it. Whoever is refused still gets
everything the box holds; the box just opens in silence.

The receipt needs none of that: `ShowFlyingSign` takes the player it is for, so
the engine shows it to him and to nobody else.

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

## What the data calls it, and why that is the end of it

`AdvMapTreasureShared`. A class of our own was the planned next step and is
**dropped**: it changes nothing a player sees, and being a treasure is what
makes the engine find the box and walk the computer's heroes to it. The design
is written down in `docs/engineInternals/PANDORA_OBJECT.md` for the next object
that really does need a class the engine has never heard of.

## Where the code is

| Piece | File |
|---|---|
| the contents model, the valuer, the tiers | `src/mods/pandora-contents.ts` |
| prices off the game's tables | `src/mods/pandora-prices.ts` |
| names off the game's texts, and the receipt | `src/mods/pandora-names.ts` |
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

Which is why **every box on it also speaks**, saying what it just handed over —
written from the contents, so it cannot describe itself wrongly. Two of the
eight kinds move a number in the HUD and nothing else, and the first
play-through reported them as doing nothing at all: a silent reward and a
broken one look identical from the outside. The rows run north to south in the
order of the table above — message, experience, gold, resources, artifacts,
spells, army, guards — and the glows run west to east, poorest first.

The last row is the one that walks the whole path: **guarded AND paying**, the
way a box in Heroes III is. The rows above it each stop halfway — the guards
row fights and hands nothing over, the army row hands over without a fight — so
until that row existed nothing had ever proved that winning the battle is what
opens the box.

The sides are led by **generic heroes** — the palette's `. Heroes (Generic)`
group, one class each, which is what a map wants and what a person clicks.
Asking the catalogue for "the first hero that sits beside a race" answered with
Alaric instead: a campaign hero, not in the standard pool at all.

A generic entry places a REAL hero. It is generic in the palette and nowhere
else: the swatch is one per class because the model is one per class —
`Brem`, `Christian` and `Alaric` all wear `/_(Model)/Heroes/Knight_LOD` — and
the entry is a `RndGroup` over that class's standard pool, of which the editor
places the first member (`Stronghold/Hero1`, `Inferno/Calid`). What the map
file records is that hero, by name. Nothing else is possible: no shipped map
mentions an `AdvMapSharedGroup` at all — 0 of them across `data-unpacked/Maps`
— so the group is the palette's way of offering a class, not something a map
can carry.
