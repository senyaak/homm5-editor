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

**In our build those five read `H5E/*` instead** — `*.mod` for maps, and the
kinds keep their extensions — so nothing installed for anybody else's mod is
mounted. What is patched, and where the map browser gets its list from, is in
[ENGINE_INTERNALS.md](ENGINE_INTERNALS.md); everything below is about the
mechanism itself and holds either way.

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
  executable; that part is not data and no archive can carry it, which is why
  installing a mod writes both at once (`src/creature-limit.ts`).
- **A stray file breaks every map, not its own.** Anything that ends up in an
  `.h5m` outside `Maps/…` overrides the game globally for the whole session. Pack
  exactly the map's own tree.
- **Two maps collide the way two mods do.** Creature ids are global and an
  archive replaces files rather than merging them, so two maps in `Maps/` that
  each carry their own `Creatures.xdb` do not compose — one wins outright. The
  unit of a creature set is the project, not the map.
- **The editor has to mount them too, or it shows a different game.** Reading one
  unpacked data root is reading the shipped game, not the installed one. With the
  creature mod installed and the editor reading only `data-unpacked`, the army
  picker offered 180 of 181 creatures and a map that placed the 181st **dropped
  the object from the scene** — no error, just an absent unit. So the editor
  resolves through a CHAIN of roots (`src/assets.ts`), the mounted mods over the
  data, which is the same "topmost wins" rule one file at a time. Folder scans
  walk every root and dedupe, because a mod adding an object does not replace the
  folder it sits in — and there are three separate lists to get right, each with
  its own source: the object **palette** (link files under
  `MapObjects/_(AdvMapObjectLink)/`), the creature **roster** (the ref table), and
  the placed object's own **model** (the shared definition). A creature can be in
  one and missing from the others, and was.
- **Nor can a mod write the editor's name and thumbnail cache.** `Editor/IconCache`
  is loose beside the install, only the game's own installer fills it, and it is
  where the palette gets both the label under a tile and its picture. So a mod's
  entry has neither, and the fallback was the LINK FILE'S NAME — a path standing
  in for a name, changeable only by renaming a file. A monster is named by its
  creature instead, read through the chain under the id the map stores, which is
  the same name the roster and the game show; the picture comes from the
  creature's own 128px texture, which the mod already carries.

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
- `src/creature-mod.ts` — what a units mod carries and why, and
  `mountCreatureMods`, which unpacks the installed ones for the editor to read.
- `src/assets.ts` — the root chain the editor resolves through, so it sees the
  installed game rather than the shipped one.
- `electron/paths.ts` — `mountedAssets`, where the chain is assembled per map.
