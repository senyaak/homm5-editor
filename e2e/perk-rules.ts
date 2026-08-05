// A hero's kit, checked against the game's own rules about skills and perks.
//
// WHY THIS EXISTS. A perk handed to a hero who does not qualify for it is
// simply not granted, and nothing says so: the map is written, the map loads,
// the hero stands there without it, and the test that was going to watch that
// perk watches nothing. It cost a whole play-through to notice that the warlock
// had no Payback — the perk had been listed with no Dark Magic to hang it on.
//
// So the rules are read from the game's own table rather than remembered:
// `GameMechanics/RefTables/Skills.xdb` gives each entry its kind, the skill it
// belongs to, the class allowed to take it, and — per class — the perks that
// come before it.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** What the table says about one skill or perk. */
export interface SkillRule {
  id: string;
  /** `SKILLTYPE_SKILL` for a skill; the rest are kinds of perk. */
  kind: string;
  /** The skill a perk hangs off, or `HERO_SKILL_NONE` for a skill itself. */
  parent: string;
  /** The class allowed to take it, or `HERO_CLASS_NONE` for anyone. */
  heroClass: string;
  /** Perks that must come first, by the class taking it. */
  before: Map<string, string[]>;
}

/**
 * Every entry of the skills table, by id.
 *
 * Read as text rather than parsed as a document: the file is four megabytes of
 * XML and this wants four fields out of each entry. An entry runs from its
 * `<ID>` to the next one.
 */
export function skillRules(dataRoot: string): Map<string, SkillRule> {
  const text = readFileSync(join(dataRoot, 'GameMechanics', 'RefTables', 'Skills.xdb'), 'latin1');
  const out = new Map<string, SkillRule>();
  const heads = [...text.matchAll(/<ID>(HERO_SKILL_[A-Z_]+)<\/ID>/g)];
  for (const [i, head] of heads.entries()) {
    const block = text.slice(head.index!, heads[i + 1]?.index ?? text.length);
    const one = (tag: string): string =>
      new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(block)?.[1] ?? '';
    const before = new Map<string, string[]>();
    for (const m of block.matchAll(
      /<Item>\s*<Class>([^<]*)<\/Class>\s*<dependenciesIDs>([\s\S]*?)<\/dependenciesIDs>/g)) {
      before.set(m[1]!, [...m[2]!.matchAll(/<Item>([^<]*)<\/Item>/g)].map((d) => d[1]!));
    }
    // The table lists an id once; a later mention inside somebody's
    // prerequisites is not a second entry, and `<ID>` only heads real ones.
    if (!out.has(head[1]!)) {
      out.set(head[1]!, {
        id: head[1]!, kind: one('SkillType'), parent: one('BasicSkillID'),
        heroClass: one('HeroClass'), before,
      });
    }
  }
  return out;
}

/** What is wrong with one hero's kit, in sentences. Empty means nothing is. */
export function kitComplaints(
  kit: { key: string; heroClass: string; skills?: { id: string }[]; perks?: string[] },
  rules: Map<string, SkillRule>,
): string[] {
  const said: string[] = [];
  const skills = new Set((kit.skills ?? []).map((s) => s.id));
  const perks = new Set(kit.perks ?? []);

  for (const id of skills) {
    const rule = rules.get(id);
    if (!rule) { said.push(`${kit.key}: no such skill as ${id}`); continue; }
    if (rule.kind !== 'SKILLTYPE_SKILL') {
      said.push(`${kit.key}: ${id} is a ${rule.kind}, not a skill — it belongs in perks`);
    }
  }

  for (const id of perks) {
    const rule = rules.get(id);
    if (!rule) { said.push(`${kit.key}: no such perk as ${id}`); continue; }
    if (rule.kind === 'SKILLTYPE_SKILL') {
      said.push(`${kit.key}: ${id} is a skill, not a perk — it belongs in skills`);
      continue;
    }
    if (rule.heroClass && rule.heroClass !== 'HERO_CLASS_NONE' && rule.heroClass !== kit.heroClass) {
      said.push(`${kit.key}: ${id} belongs to ${rule.heroClass}, and he is ${kit.heroClass}`);
    }
    if (rule.parent && rule.parent !== 'HERO_SKILL_NONE' && !skills.has(rule.parent)) {
      said.push(`${kit.key}: ${id} hangs off ${rule.parent}, which he does not have`);
    }
    for (const needed of rule.before.get(kit.heroClass) ?? []) {
      if (!perks.has(needed)) said.push(`${kit.key}: ${id} wants ${needed} before it`);
    }
  }
  return said;
}
