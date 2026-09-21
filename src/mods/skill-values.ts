// The AI's worth of every skill, race by race — the table the Factions window
// shows so a race of ours can be given a column of its own.
//
// `Skills.xdb` holds `AIRacesValues` per skill: three numbers per shipped race
// (a commander's, a collector/supplier's, a freelancer's — the hero's role),
// which the AI's level-up reads for the hero's race. The struct is EIGHT wide,
// compiled, so a ninth race has no field; the extension answers ours from
// `skillvalue` lines of the races file (src/mods/race-order.ts,
// native/faction/race-traits.c), keyed by the skill's ORDINAL — its place in
// the table, which is its enum value (types.xml lists SkillID in the table's
// order, and a skill of ours is appended to both at SHIPPED_SKILLS + i).
//
// Read the way readPerks reads the same file — by `<ID>` blocks, not a DOM —
// because the file is 600 KB and a regex over each record is what the sibling
// readers do.

import type { SkillValues } from './factions.ts';
import { AI_RACES, skillAiValues } from './hero-skills.ts';
import type { ModHeroSkill } from './hero-skills.ts';

/** One skill's row: what each shipped race thinks it is worth. */
export interface SkillAiRow {
  /** The enum value — what the record is read by and what a `skillvalue` line names. */
  ordinal: number;
  id: string;
  /** The first level's name, when its text is readable. */
  name?: string;
  /** A perk hangs off a skill (`BasicSkillID`); a skill hangs off nothing. */
  perk: boolean;
  /** By `TOWN_*`, the eight shipped. */
  values: Record<string, SkillValues>;
}

const ROLE_TAGS = ['CommanderValue', 'CollectorSupplierValue', 'FreelancerValue'] as const;

/** A race's three numbers out of one record's `AIRacesValues`, zeros when the field is missing. */
function raceValues(record: string, field: string): SkillValues {
  const at = record.indexOf(`<${field}>`);
  const end = at < 0 ? -1 : record.indexOf(`</${field}>`, at);
  const block = end < 0 ? '' : record.slice(at, end);
  const [commander, collectorSupplier, freelancer] = ROLE_TAGS.map((tag) => {
    const m = new RegExp(`<${tag}>(-?\\d+)</${tag}>`).exec(block);
    return m ? Number(m[1]) : 0;
  }) as [number, number, number];
  return { commander, collectorSupplier, freelancer };
}

/**
 * Every skill of the shipped table, in the table's order, then the mod's own
 * after it — a skill of ours is written into the table with its `aiRace`'s
 * numbers (patchSkillTable), and here it reads the same. `HERO_SKILL_NONE`,
 * the table's first, is left out: nobody levels up into it.
 */
export function readSkillAiRows(table: string, textOf: (href: string) => string, ours: readonly ModHeroSkill[] = []): SkillAiRow[] {
  const out: SkillAiRow[] = [];
  const blocks = table.split('<ID>').slice(1);
  blocks.forEach((block, ordinal) => {
    const id = block.slice(0, block.indexOf('<'));
    if (!id.startsWith('HERO_SKILL_') || id === 'HERO_SKILL_NONE') return;
    const record = block.slice(0, block.indexOf('</obj>') + 1);
    const names = /<NameFileRef>([\s\S]*?)<\/NameFileRef>/.exec(record)?.[1] ?? '';
    const href = /<Item href="([^"]+)"/.exec(names)?.[1];
    const name = href ? textOf(href) : '';
    const branch = /<BasicSkillID>(\w+)<\/BasicSkillID>/.exec(record)?.[1] ?? 'HERO_SKILL_NONE';
    const values: Record<string, SkillValues> = {};
    for (const { field, town } of AI_RACES) values[town] = raceValues(record, field);
    out.push({ ordinal, id, ...(name ? { name } : {}), perk: branch !== 'HERO_SKILL_NONE', values });
  });
  const seen = new Set(out.map((r) => r.id));
  for (const s of ours) {
    if (seen.has(s.id)) continue;
    const values: Record<string, SkillValues> = {};
    for (const { field, town } of AI_RACES) values[town] = skillAiValues(s, field);
    out.push({ ordinal: s.number, id: s.id, name: `${s.name || s.id} (ours)`, perk: s.kind === 'perk', values });
  }
  return out;
}
