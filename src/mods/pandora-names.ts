// What a box hands over, in the words the GAME uses for it.
//
// `SPELL_IMPLOSION` is an id, not a name — a player who opens a box should read
// "Implosion", the same string the spellbook shows, in the language the install
// was bought in. Every name here is looked up in the game's own texts through
// the same records the prices come from (pandora-prices.ts is the sibling that
// reads the numbers off them); nothing is transliterated from an id unless the
// data has nothing to say.
//
// LOOKED UP AT SAVE TIME, not in the game. The behaviour shows a text FILE, and
// building one sentence per box while the map is written is the only moment
// that has both the contents and the data root in reach — the engine's Lua has
// no way to turn an id into a name.

import { creaturePreset, artifactPreset } from '../schema/registry.ts';
import { gameText } from './building-presets.ts';
import { find, parse } from '../format/xml.ts';
import type { Assets } from '../game/assets.ts';
import { PANDORA_RESOURCES } from './pandora-contents.ts';
import type { PandoraContents } from './pandora-contents.ts';

const SPELL_TABLE = 'GameMechanics/RefTables/UndividedSpells.xdb';

/** The names a box needs, cached per id. */
export interface PandoraNames {
  creature(id: string | number, count: number): string;
  artifact(id: string | number): string;
  spell(id: string | number): string;
  /** `wood`, `gold`, and the word the game uses for experience. */
  word(what: 'exp' | 'gold' | (typeof PANDORA_RESOURCES)[number]): string;
}

/**
 * An id worn down to something readable, for when the data answers nothing.
 *
 * `SPELL_SUMMON_HIVE` → `Summon Hive`. Not a translation and not pretending to
 * be one — it is what a player sees instead of a blank, and it keeps the id
 * recognisable to whoever has to go looking for why the name is missing.
 */
export function tidyId(id: string | number, prefix: string): string {
  const raw = String(id);
  if (/^\d+$/.test(raw)) return `#${raw}`;
  const bare = raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;
  return bare.toLowerCase().split('_').filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * The plain words, and they are the game's too.
 *
 * A receipt reading "1000 experience" inside a Russian install is our English
 * leaking into the game's screen. The resource names live in
 * `ResourcesInfo.xdb` — one `NameFileRef` per resource, gold included — and the
 * word for experience only exists inside the treasure chest's own line,
 * `<value=exp><br><body>Опыт`, so it is taken from there with the markup
 * stripped. Both are the strings the player already reads elsewhere.
 */
const RESOURCE_TABLE = 'GameMechanics/RefTables/ResourcesInfo.xdb';
const EXPERIENCE_TEXT = '/Text/Chest/Experience.txt';
/** The id each resource carries in that table. */
const RESOURCE_IDS: Record<string, string> = {
  wood: 'E_WOOD', ore: 'E_ORE', mercury: 'E_MERCURY', crystal: 'E_CRYSTAL',
  sulfur: 'E_SULFUR', gem: 'E_GEM', gold: 'E_GOLD',
};
/** What is left of a text line once its `<tags>` are taken out. */
const plainText = (s: string): string => s.replace(/<[^>]*>/g, '').trim();

/** `E_*` → the file its name is written in, read once off the resource table. */
function resourceNameRefs(data: Assets): Map<string, string> {
  const out = new Map<string, string>();
  const text = data.text(RESOURCE_TABLE);
  if (!text) return out;
  for (const m of text.matchAll(/<ID>(E_\w+)<\/ID>[\s\S]*?<NameFileRef href="([^"]+)"/g)) {
    out.set(m[1]!, m[2]!);
  }
  return out;
}

/** `SPELL_*` → its record's path, read once off the spell table. */
function spellRecords(data: Assets): Map<string, string> {
  const out = new Map<string, string>();
  const text = data.text(SPELL_TABLE);
  if (!text) return out;
  for (const m of text.matchAll(/<ID>(SPELL_\w+)<\/ID>\s*<Obj href="([^"]+)"/g)) {
    out.set(m[1]!, m[2]!.split('#')[0]!.replace(/^\//, ''));
  }
  return out;
}

/** The game's own name for each kind of reward. */
export function pandoraNames(data: Assets): PandoraNames {
  const creatures = new Map<string, string>();
  const artifacts = new Map<string, string>();
  const spells = new Map<string, string>();
  const words = new Map<string, string>();
  let records: Map<string, string> | null = null;
  let resourceRefs: Map<string, string> | null = null;

  const spellName = (key: string): string => {
    records ??= spellRecords(data);
    const path = records.get(key) ?? records.get(`SPELL_${key}`);
    if (!path) return '';
    const xml = data.text(path);
    if (!xml) return '';
    const doc = parse(xml);
    const root = find(doc, 'Spell') ?? doc;
    const ref = find(root, 'NameFileRef')?.attrs.href ?? '';
    return ref ? gameText(data, ref).trim() : '';
  };

  return {
    creature(id, count) {
      const key = String(id);
      let name = creatures.get(key);
      if (name === undefined) {
        name = creaturePreset(data, key)?.name?.trim() || tidyId(key, 'CREATURE_');
        creatures.set(key, name);
      }
      // The game's own creature names are singular; a stack says its count
      // beside it rather than pretending to a plural the texts do not carry.
      return `${count} × ${name}`;
    },
    artifact(id) {
      const key = String(id);
      let name = artifacts.get(key);
      if (name === undefined) {
        // Both spellings, the same as the price lookup: the table keys on the
        // bare name and every script says ARTIFACT_*.
        const bare = key.startsWith('ARTIFACT_') ? key.slice('ARTIFACT_'.length) : key;
        name = (artifactPreset(data, key)?.name || artifactPreset(data, bare)?.name || '').trim()
          || tidyId(key, 'ARTIFACT_');
        artifacts.set(key, name);
      }
      return name;
    },
    spell(id) {
      const key = String(id);
      let name = spells.get(key);
      if (name === undefined) {
        name = spellName(key) || tidyId(key, 'SPELL_');
        spells.set(key, name);
      }
      return name;
    },
    word(what) {
      let name = words.get(what);
      if (name === undefined) {
        if (what === 'exp') {
          name = plainText(gameText(data, EXPERIENCE_TEXT)) || 'experience';
        } else {
          resourceRefs ??= resourceNameRefs(data);
          const ref = resourceRefs.get(RESOURCE_IDS[what] ?? '');
          name = (ref ? plainText(gameText(data, ref)) : '') || what;
        }
        words.set(what, name);
      }
      return name;
    },
  };
}

/**
 * What the box just handed over, as the line the player reads.
 *
 * A NUMBER AND A NAME PER LINE, nothing joined into a sentence: the flying sign
 * is a short stack of words over the hero's head, and the game's own texts are
 * words rather than sentence fragments — anything more grammatical would be our
 * English word order wrapped around somebody else's language.
 *
 * Empty when there is nothing to report — a box that only speaks has its
 * author's message and needs no receipt under it.
 */
export function pandoraReport(box: PandoraContents, names: PandoraNames): string {
  const parts: string[] = [];
  if (box.exp) parts.push(`${box.exp} ${names.word('exp')}`);
  if (box.gold) parts.push(`${box.gold} ${names.word('gold')}`);
  const res = PANDORA_RESOURCES.filter((r) => box[r]).map((r) => `${box[r]} ${names.word(r)}`);
  if (res.length) parts.push(res.join(', '));
  for (const a of box.artifacts ?? []) parts.push(names.artifact(a));
  for (const s of box.spells ?? []) parts.push(names.spell(s));
  for (const c of box.creatures ?? []) parts.push(names.creature(c.creature, c.count));
  return parts.join('\n');
}
