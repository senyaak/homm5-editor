// The creature table, as the guard-setter reads it: an id, a name and a
// Power, in the order the reference table lists them.
//
// The engine keeps a 16-byte record per creature behind a pointer at
// 0x1204608, filled at start-up from `GameMechanics/RefTables/Creatures.xdb`;
// the count comes from a function that simply returns 180 on a vanilla
// install. Power is field +0x84 of a creature document — pinned through the
// document's generated reader, and confirmed by the guards it produces.
//
// Three ids are skipped by the single-stack branch of the guard setter: 0
// (CREATURE_UNKNOWN, a placeholder), 89 (Black Knight) and 114 (Snow Ape).
// The two real ones have Power and stats but no usable adventure-map
// object — Black Knight's `MonsterShared` is empty and Snow Ape's points at
// a stand-in built from peasant art — so a map cannot show them.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { childText, find, findAll, parse } from '../format/xml.ts';

export interface CreatureInfo {
  /** The index in the reference table — the `CREATURE_*` enum value. */
  id: number;
  name: string;
  power: number;
  /** The creature document's `MonsterShared` href — what a placed monster's `Shared` writes. */
  monsterShared: string;
  /** `CreatureTier`, 1..8 — field +0x8C, which the town guard filters on. */
  tier: number;
  /**
   * `CreatureTown` as a number, the enum's own order (types.xml): SPECIAL 0,
   * RANDOM_TYPE 1, NO_TYPE 2, HEAVEN 3, PRESERVE 4, ACADEMY 5, DUNGEON 6,
   * NECROMANCY 7, INFERNO 8, FORTRESS 9, STRONGHOLD 10 — field +0x98.
   *
   * The same numbers as `RACE_*`, entry for entry, which is why the engine's
   * race-to-town switch at 0xeb5788 maps 3..10 to themselves. The one place
   * the two enums disagree is the NAME of 9: RACE_DWARF against TOWN_FORTRESS.
   */
  town: number;
}

/** `CreatureTown` in the enum's order — see `CreatureInfo.town`. */
export const TOWN_BY_NAME: Record<string, number> = {
  TOWN_SPECIAL: 0, TOWN_RANDOM_TYPE: 1, TOWN_NO_TYPE: 2, TOWN_HEAVEN: 3,
  TOWN_PRESERVE: 4, TOWN_ACADEMY: 5, TOWN_DUNGEON: 6, TOWN_NECROMANCY: 7,
  TOWN_INFERNO: 8, TOWN_FORTRESS: 9, TOWN_STRONGHOLD: 10,
};

/** Ids the guard setter refuses outright, whatever their Power says. */
export const UNPLACEABLE_CREATURES: ReadonlySet<number> = new Set([0, 89, 114]);

export function readCreatures(dataRoot: string): CreatureInfo[] {
  const root = parse(readFileSync(join(dataRoot, 'GameMechanics', 'RefTables', 'Creatures.xdb'), 'utf8'));
  const table = find(root, 'Table_Creature_CreatureType');
  const objects = table ? find(table, 'objects') : null;
  if (!objects) return [];
  return findAll(objects, 'Item').map((item, id) => {
    const href = find(item, 'Obj')?.attrs['href'];
    let power = 0;
    let monsterShared = '';
    let tier = 0;
    let town = 0;
    if (href) {
      const path = href.replace(/#xpointer\(.*\)$/, '').replace(/^\//, '');
      const doc = find(parse(readFileSync(join(dataRoot, path), 'utf8')), 'Creature');
      power = doc ? Number.parseInt(childText(doc, 'Power'), 10) || 0 : 0;
      monsterShared = (doc ? find(doc, 'MonsterShared')?.attrs['href'] : undefined) ?? '';
      tier = doc ? Number.parseInt(childText(doc, 'CreatureTier'), 10) || 0 : 0;
      town = doc ? TOWN_BY_NAME[childText(doc, 'CreatureTown')] ?? 0 : 0;
    }
    return { id, name: childText(item, 'ID'), power, monsterShared, tier, town };
  });
}
