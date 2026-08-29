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
}

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
    if (href) {
      const path = href.replace(/#xpointer\(.*\)$/, '').replace(/^\//, '');
      const doc = find(parse(readFileSync(join(dataRoot, path), 'utf8')), 'Creature');
      power = doc ? Number.parseInt(childText(doc, 'Power'), 10) || 0 : 0;
      monsterShared = (doc ? find(doc, 'MonsterShared')?.attrs['href'] : undefined) ?? '';
    }
    return { id, name: childText(item, 'ID'), power, monsterShared };
  });
}
