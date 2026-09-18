// A faction of our own, as the editor takes it in.
//
// A faction is a TOWN TYPE — a twelfth `ETownType` after the eleven the game
// declares (none, random, neutral, the eight) — and everything the engine
// indexes by it: a town copied from a shipped one and made ours (town-files.ts),
// the race's record (town-type-info.ts), its named towns, its music, its
// picker tile, its heroes' pool, its centre button. The type holds a NUMBER —
// the ordinal every table and `town_buildings_N` key on — so the list is
// append-only for the reason every numbered thing in the mod is: renumbering
// after a removal would repoint every map that placed a town of the type.
//
// What is here is the spec and its checks. The files are faction-files.ts,
// the install's side (the executable's ceilings, the extension's files) is
// mod-archive.ts, and the probe that found all of it is
// docs/engineInternals/FACTIONS.md.

import { SHIPPED_TOWN_ORDINALS, parseBuildingKey } from './town-files.ts';
import type { NamedTown, TownSpec } from './town-files.ts';

/** How many `ETownType` values the game declares: TOWN_NO_TYPE … TOWN_STRONGHOLD. */
export const SHIPPED_TOWN_TYPES = 11;

/** The last shipped type — our anchor for appending to the enum, both shapes. */
export const LAST_SHIPPED_TOWN_TYPE = 'TOWN_STRONGHOLD';
export const LAST_SHIPPED_RACE = 'RACE_STRONGHOLD';

/** How many rows `RMGPresetTable` ships: one per race plus `__RACE_COUNT`. */
export const SHIPPED_RMG_PRESETS = 12;

/** The build grid the town screen draws: five columns by six rows, 1-based. */
export const GRID = { columns: 5, rows: 6 } as const;

/**
 * A faction as the editor takes it in: the town (`TownSpec` is most of it —
 * donor, dwellings, siege, exterior, icons, buildings, race, magic, script)
 * plus what a town alone has not.
 */
export interface FactionSpec extends TownSpec {
  /**
   * The race's named towns — one `TownSpecialization` each. A random town of
   * the race draws one of these (name, history, bonus); a race with none has
   * no town to draw and its player is out before the first turn.
   */
  towns: NamedTown[];
  /**
   * Who mans the siege towers: a creature of the mod, by id. Resolved at
   * build time to the Character its visual names and the Shot it fires —
   * the mod's own copies, recolouring and all — which is what
   * `siegeShooter` holds; a spec that gives `siegeShooter` outright keeps it.
   */
  shooter?: string;
}

/** One in a mod: a spec plus the ordinal it holds. */
export interface ModFaction extends FactionSpec {
  /** Its `ETownType` value, assigned on the way in and never changed. */
  number: number;
}

/** The type a file stem names: `Test` → `TOWN_TEST`, `BoneCourt` → `TOWN_BONE_COURT`. */
export function townTypeFor(file: string): string {
  return `TOWN_${file.trim().replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`;
}

/**
 * The race enum's spelling of a type: `TOWN_TEST` → `RACE_TEST`. `ERace` is a
 * typedef of `ETownType`, value for value — and one name apart: the dwarves'
 * town is `TOWN_FORTRESS` and their race `RACE_DWARF`.
 */
export function raceFor(type: string): string {
  if (!type.startsWith('TOWN_')) throw new Error(`${type} is not a TownType name`);
  if (type === 'TOWN_FORTRESS') return 'RACE_DWARF';
  return `RACE_${type.slice('TOWN_'.length)}`;
}

/**
 * What a faction cannot be built without — asked when one is added AND when
 * one is changed, because the form is not the only door into either.
 */
export function factionProblems(spec: FactionSpec): string[] {
  const out: string[] = [];
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(spec.file)) out.push('the identifier is letters and digits, starting with a letter');
  if (spec.type !== townTypeFor(spec.file)) out.push(`the type is ${townTypeFor(spec.file)} for ${spec.file}, not ${spec.type}`);
  if (!SHIPPED_TOWN_ORDINALS[spec.donor]) out.push(`${spec.donor} is not a shipped town — the donor is one of ${Object.keys(SHIPPED_TOWN_ORDINALS).join(', ')}`);
  if (!spec.name.trim()) out.push('a town of the faction needs a name');
  if (!spec.race?.name.trim()) out.push('the race needs a name — the "Race:" line');
  if (!spec.towns.length) out.push('a race needs at least one named town, or a random town of it has nothing to be');
  const stems = new Set<string>();
  for (const t of spec.towns) {
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(t.file)) out.push(`named town "${t.file}": the identifier is letters and digits`);
    if (stems.has(t.file)) out.push(`named town ${t.file} is listed twice`);
    stems.add(t.file);
    if (!t.name.trim()) out.push(`named town ${t.file} has no name`);
  }
  for (const key of Object.keys(spec.buildings ?? {})) {
    try { parseBuildingKey(key); } catch (e) { out.push(e instanceof Error ? e.message : String(e)); }
  }
  for (const [tier, d] of Object.entries(spec.dwellings ?? {})) {
    if (!d) continue;
    if (!(Number(tier) >= 1 && Number(tier) <= 7)) out.push(`dwelling tier ${tier}: tiers are 1–7`);
    if (!d.base || !d.upgrade) out.push(`dwelling tier ${tier}: names a base creature and its upgrade`);
  }
  return out;
}
