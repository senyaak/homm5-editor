# Where the game looks for mods, and where maps come from

*Answers: why a map archive can override anything, how our own mod folder was
made, and where the random map generator writes.*

The editor's side of this is `src/game/mod-paths.ts`.

Five patterns, together in `.rdata` at `0xf4f7e8`:

```
Maps/*.h5m   DuelPresets/*.h5p   UserCampaigns/*.h5c   UserMODs/*.h5u   UserMODs/*.zip
```

`0x5bd0f0` pushes all five into **one** list and hands it to **one** provider
(`0x953350` → the constructor at `0x953fb0`, the same one that scans `data/`
for `*.pak` when the list is empty). So the extensions are a convention and not
a mechanism: every archive found by any of the five is mounted into the game
file system the same way, which is why a `.h5m` can override any path in the
game and not just its own map.

The patterns are turned into strings with strlen at runtime, so a **shorter**
name can be written over one in place. `src/game/mod-paths.ts` does exactly that: our
copy scans `H5E/*.h5m` and four siblings, so nothing anyone installed for
another mod is read at all, and a map of ours keeps the name the game has always
given it — `H5E/<name>.h5m`. Launching the shipped executable reads the five
again — that is the off switch.

**Where the generator writes, and why that string is different.** The random map
generator saves what it makes to `<install>/` + `Maps/` + name + `.h5m`, which
is a folder our copy no longer mounts — so a generated map used to be there on
disk and gone from the game. Four strings sit together for it at `0xf7dce8`:

```
RMGTemp/CurrentMap/   Maps/RMG/   .h5m   Maps/
```

`Maps/RMG/` is the *virtual* prefix the archive carries inside it
(`Maps/RMG/<GUID>/map.xdb`) and must not move; `Maps/` (`0xf7dd10`) is the folder
on disk. It has fifteen references, of which **three are live** — two literals
(`0x91dbba`, `0xea8460`) and one static string (`0x121b18c`, built at `0x4d4f28`,
read at `0xead2cd` where a flag picks between it and `RMGTemp/CurrentMap/`).
The other twelve are per-translation-unit copies nothing ever reads.

Unlike a scan pattern, **this one cannot be shortened**. It is appended by
(begin, end) pointers (`push 0F7DD15h; push 0F7DD10h`) and copied with an
allocation size that is an immediate (`push 6`), so the length 5 is compiled into
every site: writing `H5E/` would append the terminator with it and the path would
end at the folder. The replacement is therefore exactly as long — `H5E//` — and
Windows collapses the doubled separator on the way to the file system.

**Maps are found separately, and not by that mask.** `0x915170` builds the list
for the custom-game screen out of the *mounted* file system, from three roots
chosen by flags in `+0x38`: `Maps/Multiplayer` (`0xf7df40`, flag 1),
`Maps/SingleMissions` (`0xf6c044`, flag 2) and `Maps/RMG` (flag 4). Each root
goes to `0x9152f0` → `0x897440`, which collects `map-tag` files
(`#xpointer(/AdvMapDescTag)`) under it and logs "Custom game map tags collected
in … seconds".

Two consequences worth writing down:

- The shipped maps are inside the archives — `data.pak` and `a2p1-data.pak`
  carry `Maps/SingleMissions/A2S*`, `Maps/Multiplayer/*`, `Maps/Scenario/*` —
  so ours and theirs land in the same virtual tree and **cannot be told apart by
  path**. Hiding the shipped ones would mean moving the roots (`Mods/…`, same
  length, four bytes each), not filtering.
- A map's own files are referenced relatively (`href="GroundTerrain.bin"`) and
  only shared data is absolute (`/MapObjects/…`), so a map tree can be moved
  whole without touching what is inside it.
