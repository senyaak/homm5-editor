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

Both directions are asserted rather than assumed — `013-mod-pandora-map` deletes the archive
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
| Spells | `TeachHeroSpell` — the hero learns them, or is paid in experience for the ones he cannot hold (below). |
| Creatures | Join the opening hero's army. |
| Guards | Fought BEFORE the box opens. Win and it opens; lose and it stays shut. |

Two of them are worth knowing about before an author blames a box: **a spell
needs a hero the game would teach it to** — a Barbarian keeps CRIES where
everybody else keeps spells, so `SPELL_TOWN_PORTAL` handed to him is paid for
rather than learned while `SPELL_WARCRY_*` is learned outright (the game's own
campaign teaches a barbarian his cries with the same call,
`TeachHeroSpell("Kujin", SPELL_WARCRY_RALLING_CRY)` in A2C3M4) — and
**creatures join an existing stack**, so ten archangels added to a hundred read
as nothing happening at all.

### A spell a hero cannot learn is lost — unless he is a barbarian

The box asks the engine the whole question, the one the **spell shop** and the
**shrine** go through (`H5ECanLearnSpell`), and it is four things at once:

- the school against the hero's kind — a barbarian shouts, everybody else casts;
- the **skill** of that school: a wizard with no Dark Magic cannot take Curse;
- the hero's **level** against the record's `RequiredHeroLevel`;
- the runic case, which is the dwarves' own.

Refused, the spell is **lost** — exactly as it is at a shrine — and the box says
so with the game's own line, flown over the hero: *"Герой не может выучить
выбранное заклинание"*, the one the spell shop puts under its Buy button.

Refused for **what the hero IS** — the spell is not his kind of magic at all —
he is **paid** instead: **1000 experience per level of the spell** (measured
12.08.2026 at shrines of levels 1, 2 and 3 — also exactly what the valuer prices
a spell at, so the box is worth what it says). A barbarian handed a fireball, a
knight handed a war cry, anybody but a dwarf handed a rune. Refused for what he
has not got **yet** — a skill, a mastery, a level — he loses it.

Which of the two it is comes from the school gate alone, so the rule covers
every kind of magic the game has and any a mod adds. It used to pay the
barbarian and nobody else, which left a knight handed a war cry with nothing at
all (fixed 13.08.2026).

The levels are worth knowing, since they are the reason a war cry can vanish
into a young barbarian: a war cry of level 1 asks hero level **2**, level 2 asks
**6**, level 3 asks **11**. Adventure magic asks 1, 10, 15 and 20. Every other
school asks nothing of the hero's level — only the skill.

**Runes are the one school gated on MASTERY.** They are `MAGIC_SCHOOL_RUNIC`,
the gate wants the Runemage's own ability, and the rune's own level says how far
his **Runelore** must have come — basic for a rune of level 1 or 2, advanced for
3 and 4, expert for 5 (`0xc63e90`, read 13.08.2026). No rune asks a hero level:
every `RequiredHeroLevel` in the ten records is 0. So a box of runes tells three
answers apart at once — learned, lost, paid for.

They are also the reason the block writes some spells as **numbers**. A script
says `SPELL_FIREBALL` because `scripts/common.lua` declares that global — but it
declares no rune at all, and 104 of the 353 spells in the `SpellID` enum have no
global anywhere. Named, such a spell reaches `TeachHeroSpell` as `nil` and the
box then dies concatenating it:

```
[Script warning!] Value was NIL when getting global with name 'SPELL_RUNE_OF_CHARGE'
(Script) ERROR: attempt to concat a nil value
```

So the name is kept where the engine knows it and the id out of `types.xml` is
written where it does not (`spellRefs()` in `src/mods/pandora-prices.ts`).

**Adventure magic comes through here too**, and through nothing else. Summon
Boat, Summon Creatures, Dimension Door and Town Portal are the four spells of
`MAGIC_SCHOOL_ADVENTURE`, a barbarian is refused all four, and he is paid for
them exactly as he is paid for a fireball. There is no second path.

A spell the hero **already knows** is not paid for — he learns it again, which
is what it always did.

The window says as much beside the spell list, and the whole reading — what the
gate branches on, where the level lives, what a talisman is — is in
[SPELLS.md](engineInternals/SPELLS.md#the-barbarians-adventure-magic-is-a-talisman-not-a-book).

#### The talisman, and how to hand one out if you ever want to

The shipped game gives a barbarian adventure magic through a channel of its
own — the **talisman**, sold a level at a time in the Stronghold's Traveller's
Shelter. `DefaultStats.xdb`'s `TalismanOfAdventure` says what a level is worth,
one spell per rung:

| talisman | spell | the hero must have reached |
|---|---|---|
| 1 | Summon Boat | level 1 |
| 2 | Summon Creatures | level 10 |
| 3 | Dimension Door | level 15 |
| 4 | Town Portal | level 20 |

A box used to raise it: an adventure spell in the contents became **one step up
the ladder** for a barbarian and the named spell for everybody else. It is
**gone** (Senya, 12.08.2026) — boxes, probe row and the extension's function
alike. Nothing in the editor offers a talisman and nothing in the DLL raises
one; a box that asked for it would call a global that is NIL and hand over
nothing.

What it took, for whoever wants it back — all of it is in the history, at
`f2d036a` and the commits before it:

* `native/lua/hero-spells.c` held `H5ETalismanStep(heroName)`, over `CHero`'s
  vtable at `0xfc69fc`: **+0x300** reads the level, **+0x304** writes it (and
  clamps to the table's own length, so "the top" never has to be written down),
  **+0x384** recomputes the spells, **+0x258** answers his race. The recompute
  takes the map's forbidden-spell list, reached hero → player → world → vt+0x34,
  and a null there is legal and means "nothing is forbidden";
* it answered three ways — `nil` for a hero no talisman serves, `0` for a
  talisman already at the top, `1…N` for the rung he ended on;
* `talismanLadder()` in `src/mods/pandora-prices.ts` read the four spells off
  `DefaultStats.xdb`, and `boxLua` used it to split a box's spells into
  `spells` (taught) and `adventure` (walked up the ladder).

Three things about the ladder are the engine's and not ours, and they are why
the row read badly enough to be taken out. It is **cumulative** — a talisman of
4 is four spells, not one. Every rung asks a **hero level** of its own, and the
recompute **stops at the first rung he has not reached**, so a level-2 barbarian
who opens all four boxes ends up with a talisman of 4 and exactly one spell,
Summon Boat. And a talisman does nothing whatsoever for a hero who is **not of
the Horde**.

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
| what a hero may be taught, asked of the engine | `native/lua/hero-spells.c` |
| tests | `tools/test-pandora.ts`, `tools/test-pandora-store.ts`, `e2e/013-mod-pandora-map.spec.ts` |

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
