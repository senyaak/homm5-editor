// The prices the valuer asks for, read off the game's own tables.
//
// Kept apart from pandora-contents.ts on purpose: the valuer is arithmetic and
// runs anywhere, this half needs a mounted data root. The window builds one of
// these once and hands it over; a test hands over its own numbers instead.
//
// EVERY PRICE HERE IS THE GAME'S. A creature's hire gold, an artifact's
// `CostOfGold`, a spell's `Level` — read, not invented. What the game does NOT
// price (a resource, a point of experience, what a spell level is worth in
// gold) is not here at all: those rates are ours and live in pandora-contents.
//
// Lookups are cached per id because a box with a dozen stacks would otherwise
// re-read the reference tables a dozen times, and the artifact table is one of
// the big ones.

import { creaturePreset, artifactPreset } from '../schema/registry.ts';
import type { Assets } from '../game/assets.ts';
import type { PandoraPrices } from './pandora-contents.ts';

const SPELL_TABLE = 'GameMechanics/RefTables/UndividedSpells.xdb';
const DEFAULT_STATS = 'GameMechanics/RPGStats/DefaultStats.xdb';

/**
 * The talisman ladder, in the game's own order — and it is the whole of what a
 * barbarian's adventure magic can be.
 *
 * A hero of the Horde is refused every adventure spell by the gate on the
 * spell's SCHOOL, and gets them instead by upgrading a talisman at the
 * Traveller's Shelter; `DefaultStats.xdb` is where the ladder lives, one spell
 * per level. So "which spells can a box hand a barbarian" and "what is on this
 * ladder" are the same question, and the answer is read rather than written
 * down here — a mod that lengthens the table lengthens this.
 *
 * Empty when the data root has no such table, which is how every caller finds
 * out that the branch is not available rather than by a list going stale.
 */
export function talismanLadder(data: Assets): string[] {
  const text = data.text(DEFAULT_STATS);
  const table = /<TalismanOfAdventure>([\s\S]*?)<\/TalismanOfAdventure>/.exec(text ?? '')?.[1];
  return table ? [...table.matchAll(/<Spell>(\w+)<\/Spell>/g)].map((m) => m[1]!) : [];
}

/** `SPELL_*` → the record's href, read once off the spell table. */
function spellRecords(data: Assets): Map<string, string> {
  const out = new Map<string, string>();
  const text = data.text(SPELL_TABLE);
  if (!text) return out;
  const item = /<ID>(SPELL_\w+)<\/ID>\s*<Obj href="([^"]+)"/g;
  for (const m of text.matchAll(item)) out.set(m[1]!, m[2]!.split('#')[0]!.replace(/^\//, ''));
  return out;
}

/**
 * What the game says the box's contents cost.
 *
 * An id nobody knows answers 0 rather than throwing: a map may name a creature
 * a mod added and then be opened without that mod, and a value of nothing is a
 * better answer there than a window that will not open.
 */
export function pandoraPrices(data: Assets): PandoraPrices {
  const creatures = new Map<string, number>();
  const artifacts = new Map<string, number>();
  const levels = new Map<string, number>();
  let spellHrefs: Map<string, string> | null = null;

  return {
    creature(id) {
      const key = String(id);
      let gold = creatures.get(key);
      if (gold === undefined) {
        gold = creaturePreset(data, key)?.stats.gold ?? 0;
        creatures.set(key, gold);
      }
      return gold;
    },
    artifact(id) {
      const key = String(id);
      let gold = artifacts.get(key);
      if (gold === undefined) {
        // TWO SPELLINGS OF THE SAME ARTIFACT. The reference table keys on the
        // BARE name (`TITANS_TRIDENT`) while everything a script says carries
        // the `ARTIFACT_` prefix — the same split map.xdb's enabled list has
        // (docs/MAP_PROPERTIES.md). A box's contents are written in script
        // spelling, so the bare form is tried when the prefixed one misses.
        gold = artifactPreset(data, key)?.cost
          ?? (key.startsWith('ARTIFACT_') ? artifactPreset(data, key.slice('ARTIFACT_'.length))?.cost : undefined)
          ?? 0;
        artifacts.set(key, gold);
      }
      return gold;
    },
    spellLevel(id) {
      const key = String(id);
      let level = levels.get(key);
      if (level === undefined) {
        spellHrefs ??= spellRecords(data);
        const href = spellHrefs.get(key);
        const text = href ? data.text(href) : null;
        level = Number(/<Level>(\d+)<\/Level>/.exec(text ?? '')?.[1] ?? 0);
        levels.set(key, level);
      }
      return level;
    },
  };
}
