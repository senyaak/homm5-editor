// WHAT A BUILDING DOES — the town-feature table, and the rows a faction adds.
//
// Every compiled effect a special building has is a FEATURE, a number the
// executable keys on: the Library's extra spell, the Hall of Trial's three
// warcry tiers, the Capitol. One table at 0x10909B0 (`FEATURE_TABLE_RVA`)
// says which building of which town grants which, at what level —
// forty-seven rows, `{feature, town, building, minLevel}`, town 2 for any.
// The town's readers scan it (`native/faction/town-features.c` lists them),
// `OnBuildingBuilt` asks it what was just built, and a building the table
// does not know does nothing whatever: a hall of ours with three levels
// stood empty in launch 35 for that reason alone.
//
// The extension owns the table now — the engine's rows and then ours, read
// from `feature` lines of `bin/homm5-editor-buildings.txt`:
//
//   feature <townType> <buildingType> <minLevel> <feature>
//
// and a building of ours grants a feature by naming the SHIPPED building
// whose effect it wants (`BuildingEdit.grants: { like: 'TOWN_STRONGHOLD' }`):
// the rows below are copied level for level under our town and our slot.
// A feature is what the executable does with the number — the forty-six
// effects the eight towns ship — so this is the whole menu; an effect of
// our own is a term of the extension's, not a row here.
//
// `SHIPPED_FEATURES` is the table as read on 2026-09-18; `test-town-features`
// reads it back out of the executable.

import { buildingOrdinal } from './town-button.ts';

/** Where the compiled table sits in H5_Game_H5E.exe, as an RVA. */
export const FEATURE_TABLE_RVA = 0xc909b0;

export interface FeatureRow {
  /** The feature's number — what the executable's effect code keys on. */
  feature: number;
  /** A `TownType` ordinal; 2 (TOWN_NO_TYPE) for any town. */
  town: number;
  /** A `TownBuildingType` ordinal. */
  building: number;
  /** The building's level that grants it, 1-based. */
  minLevel: number;
}

const T = { ANY: 2, HAVEN: 3, SYLVAN: 4, ACADEMY: 5, DUNGEON: 6, NECRO: 7, INFERNO: 8, FORTRESS: 9, STRONGHOLD: 10 };
const S = (n: number): number => 16 + n;

/** The forty-seven rows of the compiled table, in its order. */
export const SHIPPED_FEATURES: readonly FeatureRow[] = [
  { feature: 0x00, town: T.HAVEN, building: S(1), minLevel: 1 },
  { feature: 0x01, town: T.HAVEN, building: S(2), minLevel: 1 },
  { feature: 0x02, town: T.HAVEN, building: S(3), minLevel: 1 },
  { feature: 0x03, town: T.HAVEN, building: S(4), minLevel: 1 },
  { feature: 0x04, town: T.HAVEN, building: S(5), minLevel: 1 },
  { feature: 0x05, town: T.INFERNO, building: S(1), minLevel: 1 },
  { feature: 0x06, town: T.INFERNO, building: S(2), minLevel: 1 },
  { feature: 0x07, town: T.INFERNO, building: S(3), minLevel: 1 },
  { feature: 0x08, town: T.INFERNO, building: S(4), minLevel: 1 },
  { feature: 0x09, town: T.INFERNO, building: S(5), minLevel: 1 },
  { feature: 0x0a, town: T.SYLVAN, building: S(0), minLevel: 1 },
  { feature: 0x0b, town: T.SYLVAN, building: S(0), minLevel: 2 },
  { feature: 0x0c, town: T.SYLVAN, building: S(2), minLevel: 1 },
  { feature: 0x0d, town: T.SYLVAN, building: S(2), minLevel: 2 },
  { feature: 0x0e, town: T.SYLVAN, building: S(4), minLevel: 1 },
  { feature: 0x0f, town: T.SYLVAN, building: S(5), minLevel: 1 },
  { feature: 0x10, town: T.NECRO, building: S(1), minLevel: 1 },
  { feature: 0x11, town: T.NECRO, building: S(3), minLevel: 1 },
  { feature: 0x12, town: T.NECRO, building: S(2), minLevel: 1 },
  { feature: 0x13, town: T.NECRO, building: S(4), minLevel: 1 },
  { feature: 0x14, town: T.NECRO, building: S(5), minLevel: 1 },
  { feature: 0x15, town: T.ACADEMY, building: S(1), minLevel: 1 },
  { feature: 0x16, town: T.ACADEMY, building: S(2), minLevel: 1 },
  { feature: 0x17, town: T.ACADEMY, building: S(3), minLevel: 1 },
  { feature: 0x18, town: T.ACADEMY, building: S(4), minLevel: 1 },
  { feature: 0x19, town: T.ACADEMY, building: S(5), minLevel: 1 },
  { feature: 0x1a, town: T.DUNGEON, building: S(1), minLevel: 1 },
  { feature: 0x1b, town: T.DUNGEON, building: S(1), minLevel: 2 },
  { feature: 0x1c, town: T.DUNGEON, building: S(3), minLevel: 1 },
  { feature: 0x1d, town: T.DUNGEON, building: S(4), minLevel: 1 },
  { feature: 0x1e, town: T.DUNGEON, building: S(5), minLevel: 1 },
  { feature: 0x1f, town: T.DUNGEON, building: S(6), minLevel: 1 },
  { feature: 0x20, town: T.FORTRESS, building: S(1), minLevel: 1 },
  { feature: 0x21, town: T.FORTRESS, building: S(1), minLevel: 2 },
  { feature: 0x22, town: T.FORTRESS, building: S(1), minLevel: 3 },
  { feature: 0x23, town: T.FORTRESS, building: S(2), minLevel: 1 },
  { feature: 0x24, town: T.FORTRESS, building: S(3), minLevel: 1 },
  { feature: 0x25, town: T.FORTRESS, building: S(4), minLevel: 1 },
  { feature: 0x26, town: T.FORTRESS, building: S(5), minLevel: 1 },
  { feature: 0x27, town: T.STRONGHOLD, building: S(1), minLevel: 1 },
  { feature: 0x28, town: T.STRONGHOLD, building: S(1), minLevel: 2 },
  { feature: 0x29, town: T.STRONGHOLD, building: S(1), minLevel: 3 },
  { feature: 0x2a, town: T.STRONGHOLD, building: S(2), minLevel: 1 },
  { feature: 0x2b, town: T.STRONGHOLD, building: S(3), minLevel: 1 },
  { feature: 0x2c, town: T.STRONGHOLD, building: S(4), minLevel: 1 },
  { feature: 0x2d, town: T.STRONGHOLD, building: S(5), minLevel: 1 },
  { feature: 0x2e, town: T.ANY, building: 0, minLevel: 4 },
];

/** The shipped town ordinals the table keys on, by `TownType` name. */
export const FEATURE_TOWNS: Readonly<Record<string, number>> = {
  TOWN_HEAVEN: T.HAVEN, TOWN_PRESERVE: T.SYLVAN, TOWN_ACADEMY: T.ACADEMY, TOWN_DUNGEON: T.DUNGEON,
  TOWN_NECROMANCY: T.NECRO, TOWN_INFERNO: T.INFERNO, TOWN_FORTRESS: T.FORTRESS, TOWN_STRONGHOLD: T.STRONGHOLD,
};

/** What a building of ours grants: the effect of a shipped town's building, level for level. */
export interface Grant {
  /** The shipped town — `TOWN_STRONGHOLD`. */
  like: string;
  /** Its building; the same type as ours when absent. */
  building?: string;
}

/** A row of ours before the town is numbered: the copier knows the type's name, not its ordinal. */
export interface OwnFeature {
  building: number;
  minLevel: number;
  feature: number;
}

/**
 * The rows a building of ours gets from a grant — every shipped row of that
 * town and building, at its own level. None is a refusal — the building
 * named has no compiled effect — unless the grant is only implied by `from`.
 */
export function grantedFeatures(ourBuilding: string, grant: Grant, what: string, implied = false): OwnFeature[] {
  const town = FEATURE_TOWNS[grant.like];
  if (!town) throw new Error(`${what}: grants like ${grant.like}, which is not a shipped town`);
  const source = buildingOrdinal(grant.building ?? ourBuilding);
  const rows = SHIPPED_FEATURES.filter((r) => r.town === town && r.building === source);
  // A building taken whole brings what it had — a guild's stubs, nothing; asked for outright, nothing is a mistake.
  if (!rows.length && !implied) throw new Error(`${what}: ${grant.like}'s ${grant.building ?? ourBuilding} has no effect to grant`);
  const ours = buildingOrdinal(ourBuilding);
  return rows.map((r) => ({ building: ours, minLevel: r.minLevel, feature: r.feature }));
}

/** The rows' lines for the buildings file, the town numbered. */
export function featureLines(town: number, rows: readonly OwnFeature[]): string[] {
  return rows.map((r) => `feature ${town} ${r.building} ${r.minLevel} ${r.feature}`);
}
