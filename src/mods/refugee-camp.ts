// The game's own refugee camp, and the creatures of ours it never rolls.
//
// `MapObjects/Special/RefugeeCamp.xdb` is an `AdvMapDwellingShared` of type
// `BUILDING_REFUGEE_CAMP` with a POOL written into it by name: thirty-eight
// creatures, tiers three to six of the six original races — Fortress and
// Stronghold were never added when the expansions came. The weekly roll is
// `pool[int(n · r)]` over that list (`0xD0E610`, docs/FACTION_PLAN.md §2b), so
// a creature the mod adds is never offered by a camp on the map, however many
// of them a faction ships. The extension's own camp reads the creature table
// to its ceiling and has no such gap; this closes the shipped one the same
// way — the mod carries its own copy of the record with the pool extended,
// through the same tier filter, and a map's `.h5m`/`.h5u` mounts over the
// game's file, so every camp on every map draws from it.
//
// The pool's size is read off the vector at run time; nothing else names it,
// so nothing else has to be retuned.

import type { ModCreature } from './mod-model.ts';
import { EOL, insertBeforeLine, once } from './xml-edit.ts';

/** The shipped camp's record — the path the mod's copy takes over. */
export const REFUGEE_CAMP = 'MapObjects/Special/RefugeeCamp.xdb';

/** The tiers the shipped pool spans, and so the filter a creature of ours passes to join it. */
export const CAMP_TIERS = { min: 3, max: 6 } as const;

/** The creatures of the mod a camp on the map should offer: those of the pool's own tiers, in the mod's order. */
export function campPoolAdditions(creatures: readonly Pick<ModCreature, 'id' | 'stats'>[]): string[] {
  return creatures
    .filter((c) => c.stats.tier >= CAMP_TIERS.min && c.stats.tier <= CAMP_TIERS.max)
    .map((c) => c.id);
}

/**
 * The camp's record with the mod's creatures appended to its pool — the text
 * unchanged when none of them is of the pool's tiers.
 *
 * Appended, not sorted in: the shipped list is by race, and the roll does not
 * care. A creature already listed is refused rather than listed twice, which
 * would double its odds without anyone asking for that.
 */
export function patchRefugeeCamp(xml: string, creatures: readonly Pick<ModCreature, 'id' | 'stats'>[]): string {
  const ours = campPoolAdditions(creatures);
  if (!ours.length) return xml;
  const open = once(xml, '<creatures>', `${REFUGEE_CAMP} pool`);
  const close = xml.indexOf('</creatures>', open);
  if (close < 0) throw new Error(`${REFUGEE_CAMP}: the pool never closes`);
  const pool = xml.slice(open, close);
  for (const id of ours) {
    if (pool.includes(`<Item>${id}</Item>`)) throw new Error(`${REFUGEE_CAMP}: the pool already lists ${id}`);
  }
  return insertBeforeLine(xml, close, ours.map((id) => `<Item>${id}</Item>`));
}

/** The pool a camp record lists, in its order — for tests and for the window that shows it. */
export function campPool(xml: string): string[] {
  const open = xml.indexOf('<creatures>');
  const close = xml.indexOf('</creatures>', open);
  if (open < 0 || close < 0) return [];
  return [...xml.slice(open, close).matchAll(/<Item>(CREATURE_\w+)<\/Item>/g)].map((m) => m[1]!);
}

/** So a caller can write the record the way the rest of the mod's files are written. */
export const CAMP_EOL = EOL;
