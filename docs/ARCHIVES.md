# Archives — how the game mounts what we pack

## One mechanism, five folders

Everything the game reads outside `data/` is the same kind of thing: a ZIP whose
members are named by their in-game path. `H5_Game.exe` carries the scan patterns
as one contiguous group of literals in `.rdata` (from `0xB4E5E8` in the 2.5.0.3
build):

```
name.txt   desc.txt
Maps/*.h5m
DuelPresets/*.h5p
UserCampaigns/*.h5c
UserMODs/*.h5u
UserMODs/*.zip
current_attached_mod
MOD.RelativePath   MOD.FullPath   MOD.Name   MOD.Desc
```

and immediately before them `add_resource_path` with its console help, "add
search paths to game file system". A map, a duel preset, a campaign and a mod are
one thing to the engine: an archive it attaches, whose name and description come
from `name.txt`/`desc.txt` at its root.

That grouping is where the static evidence stops. The executable has a `.bind`
section — the publisher's protector — so `.text` is encrypted on disk and the
absolute references to those strings are not visible. The rest was measured.

## A map is mounted for the whole game, not for its own mission

An `.h5m` does not merely hold a map the engine reads when you pick it. Its
members are visible to everything, exactly as a mod's are.

The check, and it is worth repeating whenever this is in doubt:

1. Copy a map that the lobby actually lists (needs `map-tag.xdb` and a coloured
   player — see [CAMPAIGNS.md](CAMPAIGNS.md)) and add **one foreign path** to the
   archive, next to its `Maps/SingleMissions/<name>/…` members. A UI string is
   the cheapest: `UI/EscMenu/ReturnToGame.txt`, UTF-16LE with a BOM, holding
   something unmistakable.
2. Start the game and play **a different map**.
3. Press Esc.

The changed text is on the button. Verified 2026-07-26 against a `Sharpshooter
Test` map while the modified archive was a copy of it under another name; the
control is that no other installed archive carried that path (all 8 mods in
`UserMODs/` and all 24 maps in `Maps/` were read back and checked).

So `Maps/` is not a place for map data. It is a mod folder that also happens to
be where the lobby looks.

## Which copy wins

Given one path in more than one mounted archive, the game takes the **newest
member** — see `writeArchive` in `src/pak.ts`, which stamps the current time for
exactly this reason. Members dated at the ZIP epoch are read and then silently
ignored, so an archive can be mounted, correct and completely without effect.
`UserMODs/` is applied after everything in `data/`, including the addon's own
`a2p1-*` paks.

## What follows for us

- **A campaign can ship self-contained.** The files a mod carries — `types.xml`,
  `GameMechanics/RefTables/Creatures.xdb`, `UI/UIGameRoot.(UIGameRoot).xdb`, the
  creature's own files and art (`src/creature-mod.ts`) — can go **inside** the
  `.h5c` or the `.h5m` instead of a separate `.h5u` the player has to install.
  One file to hand over. A raised creature ceiling still needs a patched
  executable; that part is not data and no archive can carry it.
- **A stray file breaks every map, not its own.** Anything that ends up in an
  `.h5m` outside `Maps/…` overrides the game globally for the whole session. Pack
  exactly the map's own tree.
- **Two maps collide the way two mods do.** Creature ids are global and an
  archive replaces files rather than merging them, so two maps in `Maps/` that
  each carry their own `Creatures.xdb` do not compose — one wins outright. The
  unit of a creature set is the project, not the map.

## What this does not establish

- **When an archive is unmounted**, or whether it ever is. All that was shown is
  that it is live while an unrelated map plays.
- **Priority between archives** beyond the date rule.
- **That the lobby will list a map.** Mounting and listing are separate: the
  lobby indexes `map-tag.xdb`, and a map whose only player is `PCOLOR_NEUTRAL`
  has an empty team list and never appears however well its archive mounts.
- **Hot-adding.** The archive existed before the process started; nothing here
  says a file dropped into `Maps/` mid-session is picked up.

## Where the code is

- `src/pak.ts` — `writeArchive`, member naming and the timestamp rule.
- `src/project.ts` — `packProject`, which decides what goes into an archive.
- `src/creature-mod.ts` — what a units mod carries and why.
