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

/** Where the game declares the ids its own scripts speak in. */
const SCRIPT_IDS = ['scripts/common.lua', 'scripts/advmap-startup.lua'];
/** And the enum every spell has a number in, whether a script names it or not. */
const SPELL_ENUM = 'SpellID';

/**
 * How a spell must be WRITTEN in a script: the game's own global when there is
 * one, and the plain number when there is not.
 *
 * `SPELL_FIREBALL` is a global the shipped `scripts/common.lua` declares, and a
 * block that says the word works. `SPELL_RUNE_OF_CHARGE` is NOT — 104 of the
 * 353 spells in the `SpellID` enum have no global anywhere, the ten runes among
 * them — and a block that says that word hands `nil` to `TeachHeroSpell` and
 * dies on the next `..`:
 *
 *     [Script warning!] Value was NIL when getting global with name 'SPELL_RUNE_OF_CHARGE'
 *     (Script) ERROR: attempt to concat a nil value
 *
 * which is what a box of runes did in the game (13.08.2026). So the name is
 * kept where it reads, and the NUMBER is written where the name would be a
 * hole — read off `types.xml`, which is where the engine's own numbering lives
 * rather than something to count out here.
 *
 * An id nobody knows keeps its name: there is nothing better to say, and a
 * script that mentions it says so in the log.
 */
export function spellRefs(data: Assets): (id: string | number) => string {
  const declared = new Set<string>();
  for (const path of SCRIPT_IDS) {
    const text = data.text(path);
    for (const m of (text ?? '').matchAll(/\b(SPELL_\w+)\s*=\s*\d+/g)) declared.add(m[1]!);
  }
  const numbers = new Map<string, number>();
  const types = data.text('types.xml') ?? '';
  const at = types.indexOf(`<TypeName>${SPELL_ENUM}</TypeName>`);
  const from = at < 0 ? -1 : types.indexOf('<Entries>', at);
  const to = from < 0 ? -1 : types.indexOf('</Entries>', from);
  if (from >= 0 && to > from) {
    for (const m of types.slice(from, to).matchAll(/<Name>(\w+)<\/Name>\s*<Value>(\d+)<\/Value>/g)) {
      numbers.set(m[1]!, Number(m[2]));
    }
  }
  return (id) => {
    if (typeof id === 'number') return String(id);
    const name = id.trim();
    if (/^\d+$/.test(name)) return name;
    const full = name.startsWith('SPELL_') ? name : `SPELL_${name}`;
    if (declared.has(full)) return full;
    const number = numbers.get(full);
    return number === undefined ? full : String(number);
  };
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
