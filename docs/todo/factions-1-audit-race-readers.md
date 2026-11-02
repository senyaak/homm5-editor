# Factions 1 — every reader of the race list goes through us

**What.** Prove that nothing in the executable still reads the race list or
count the shipped way where a ninth race would be lost. Complete the sweep in
[engineInternals/FACTIONS.md](../engineInternals/FACTIONS.md) into one table,
one row per site, each with a verdict:

- the accessors and every caller: `RaceCount` `0xB4E700` (16), `TownOfIndex`
  `0xB4E760` (7), `IndexOfTown` `0xB4E740` (3), the selector `0xB4E7D0` (4),
  `IsRealTown`, the clamp `0xB4E730`; thunks expanded (`calls` misses callers
  of a `jmp` wrapper);
- inline bounds: `cmp …,7` / `cmp …,8` after `TownType − 3`, and loops bounded
  by a literal 8 over race-sized data;
- `__RACE_COUNT`-sized arrays and every `switch (type − 3)` (the 143 sites of
  the 2026-09-19 sweep), each with what its default arm hands a ninth race;
- the data side: `TownTypesInfo`, `TownSpecs`, `RMGPresetTable`,
  `Heroes/Any.xdb`, `Towns/any.xdb`, `RPGRoot` groups.

Verdict per row: **detoured** (by which file of `native/faction/`),
**patched** (by which patcher), **data** (written by the faction build),
**harmless default** (why), or **open**. Every open row becomes an item or is
fixed here.

**Source.** FACTIONS.md "The picker", "What the executable compiled per race";
FACTION_PLAN.md §4.

**Acceptance.** The table is in FACTIONS.md with addresses; every detoured or
patched row's site is checked by `test-native-anchors` (add the missing ones);
a script under `tools/reverse/` that redoes the sweep and fails when a site
appears that the table does not list.

**Depends on.** none.
