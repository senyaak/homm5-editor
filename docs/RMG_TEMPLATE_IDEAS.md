# What other generators put in a template

Source material for the v2 template format — the extension that should make a
Jebus-Outcast-like map expressible in HoMM5. Nothing here is implemented; this
is the catalogue the design will shop from, gathered from open sources so that
HotA never needs disassembling: VCMI reimplements the H3 generator in readable
C++, and HotA documents its own format.

The baseline being extended, for contrast — everything a H5 zone can say today:
`Index`, `Setting`, `Size`, `Town`, `CanBePlayerStart`, per-tier `Mines` and
`Dwellings`, a dozen density/points knobs, `TreasureDensity` +
`TreasureBlocksTotalValue`; and a connection: two zones, `GuardStrenght`,
`Guarded`, `TwoWay`, `Wide`. See `src/rmg/template.ts`.

Reliability: the VCMI sections are read from its code and official docs; the
HotA section from its official format page and community wikis; the JO section
from community write-ups — JO's exact numbers moved between versions, so treat
them as orders of magnitude, not constants.

## VCMI's pipeline, for the concepts

[github.com/vcmi/vcmi/tree/develop/lib/rmg](https://github.com/vcmi/vcmi/tree/develop/lib/rmg)
(`AGENTS.md` there is the architecture note).

`CMapGenerator::generate()`: header/tiles init → `genZones()` → per-zone
modificator chains → `fillZones()` (towns → terrain → connections → mines →
treasures → roads/rivers → obstacles) → finalization.

**Zone placement is force-directed** (`CZonePlacer.cpp`): a rough grid start,
then iterated attraction along connections and separation of overlapping zones
(with `repulsive` connections always pushing), stiffness ×1.03 whenever
improvement stalls, fitness = `(totalDistance+1) × (totalOverlap+1)`, and a
`moveOneZone` teleport when stuck. Zone radii are prescaled by
`√(W·H / (Σ size²·π))` so the zones' total area fits the map. Tiles are then
assigned by a Penrose-vertex Voronoi (`assignZones()`), which is where the
ragged organic borders come from.

**Connections** (`ConnectionsPlacer.cpp`): portals forced first, then direct
land passages (border tile → guard point → path carved by pathfinding, guard
strength from the template), then a blocked border, then indirect ones —
subterranean gate pairs, or a monolith pair when no tiles agree. `wide` is an
unguarded border-long join.

**Treasures** (`TreasurePlacer.cpp`): a pool of `ObjectInfo` {value,
probability, maxPerZone, generator} built from object metadata; piles are
grown toward a drawn `desiredValue ∈ [min,max]` taking objects valued within
`[0.25 × remainder, remainder]`. Pile count = `zoneArea × density / 400`.
Piles above a threshold (`{6500, 4167, 3000, 1833, 1333}` by monster-strength
level) get a guard seated on the pile's single entrance; guard creature count
comes from piecewise-linear value→strength tables over the pile's value.

**The invariant worth copying**: paths are carved first and frozen — nothing
placed later may block a connection path.

## VCMI's template format (the H3 rmg.txt lineage)

Docs: [vcmi.eu/modders/Random_Map_Template/](https://vcmi.eu/modders/Random_Map_Template/);
schema: `config/schemas/template.json` in the repo.

Template level: `minSize`/`maxSize`, `players`, `humans`, water content, and
per-template bans/allows for spells, artifacts, skills and heroes.

Zone level:

- `type`: `playerStart` | `cpuStart` | `treasure` | `junction` | `sealed`,
  plus `owner` — the four SoD zone types survive intact;
- `playerTowns` / `neutralTowns` {castles, towns}, `townsAreSameType`,
  `allowedTowns`/`bannedTowns`;
- `terrainTypes`/`bannedTerrains`, `matchTerrainToTown`, `forcedLevel`
  (surface/underground);
- `mines` per resource;
- `treasure`: an **array** of `{min, max, density}` groups — SoD's three
  triples, generalised;
- `monsters` (weak/normal/strong) + faction allows/bans;
- `customObjects`: `bannedCategories`, `bannedObjects`, `commonObjects`
  (per-object `{value, rarity, zoneLimit}` overrides), `requiredObjects`;
- `…LikeZone` references (terrain/mines/treasure/customObjects) — "same as
  zone N", which is how symmetric templates avoid copy-paste.

Connection level: `a`, `b`, `type`: `guarded` | `wide` | `fictive` |
`repulsive` | `forcePortal`; `guard` value; `road` yes/no/random. `fictive`
and `repulsive` exist only as placement hints — attraction or repulsion with
no passage carved.

## What HotA added on top of SoD

Official format page: [h3hota.com/en/template-format](https://h3hota.com/en/template-format);
[heroes.thelazy.net/index.php/Template_Editor](https://heroes.thelazy.net/index.php/Template_Editor).

- A template editor, and `.h3t` template packs as the container.
- Pack-level settings: hero/artifact/spell/skill bans per template, mirror
  templates, max battle rounds, hero-hiring limits, special-week toggle.
- **Object customization tables** — the big one, and what JO is made of: for
  nearly any object, per-template and per-zone (zone overrides template):
  enable/disable, value, frequency, max per map, max per zone. Dwellings,
  creature Pandoras and seer-hut rewards configurable per creature type.
- Zone options: `Zone Repulsion`, `Force Neutral Creatures`, allowed factions,
  ground/underground placement, road-coherence and rock-radius knobs, a max
  road-block value.
- Monsters: disposition 0–10, joining percent, join-only-for-money.
- Type Generator rules: "zone X's town/terrain/faction matches / must differ
  from zone Y's".
- Connections: guard value with a documented strength formula; placement kinds
  `Ground`/`Underground`/`Monolith`/`Random`/`Fictive`; per-connection road
  setting; coloured Border Guards (a colour is a connection or a Keymaster
  quest). Wide connections are never guarded.

## Jebus Outcast, anatomically

Contrast with Jebus Cross first
([thelazy.net/Jebus_Cross](https://heroes.thelazy.net/index.php/Jebus_Cross)):
JC is 4 player zones around one super-rich sand centre — rich homes, strong
passage guards, the whole game a race to the middle.

JO ([homm3milord](https://sites.google.com/view/homm3milord/templates/jebus-outcast),
[h3templates.com](https://www.h3templates.com/templates/jebus-outcast)) is a
one-hero-mode derivative that inverts the economy:

- each player gets a **home biome** with no towns and modest treasure (~22k
  max); side zones richer (to ~50k); **all towns sit in the desert centre**,
  same type, with forts;
- far zones open through a single **Border Guard "Universal Break"** door
  (45–60k value) — one wall to break or bribe;
- the centre's content is **fixed, not rolled**, via HotA's object tables:
  exact counts of tier-7/6 dwellings, creature boxes, Utopias, Libraries —
  determinism where SoD templates only had densities;
- all Pandoras are creature-Pandoras except a handful of fixed all-spells
  boxes; and a timer win — whoever holds the central town at a set date wins.

In one line each: JC — rich homes racing to a common pot; JO — poor homes,
towns and economy centralised, content pinned by tables, one hero, a timer.

An H5 equivalent therefore needs: a zone with a fixed object list and value
thresholds, same-type towns per zone, a border-guard door with a configurable
value, object-category bans — and the timer objective, which in multiplayer
means native code, since map Lua is dead there.

## The steal list, ranked

What v2 should add, in order of how much of the above it unlocks:

1. **Zone type** (`playerStart`/`cpuStart`/`treasure`/`junction`) + `owner` —
   without it neither JC nor JO is sayable.
2. **Treasure groups as an array of `{min, max, density}`** — the wealth
   gradient every Jebus-like lives on, replacing the single
   density+totalValue pair.
3. **Object customization**: category bans, per-object
   `{value, frequency, maxPerZone/maxPerMap}`, and `requiredObjects` — fixed
   zone content, the thing JO is made of.
4. **Connection types**: `wide` semantics, `borderGuard(value)`,
   `forcePortal`, `fictive`/`repulsive` placement hints, per-connection road.
5. **Zone monster strength** + a guarded-value threshold — pile guards scaled
   by zone, not only passage guards.
6. **Terrain control**: terrain types / match-to-town, `townsAreSameType`,
   allowed factions.
7. **`…LikeZone` references** — cheap symmetry.
8. **Zone repulsion / forced level** (surface vs underground).
9. **Pack-level bans** (artifacts/spells/heroes/perks per template).
10. Mirror templates and water modes — low priority here.

Algorithmic note: H5's own placement stays — what is worth borrowing from VCMI
is not the geometry but the two ideas around it: the distance×overlap fitness
as a fallback when a layout wedges, and carve-paths-first-and-freeze-them as
the fill invariant.
