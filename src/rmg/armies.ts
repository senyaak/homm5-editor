// `CMonsterSetter::SetMonster` — what stands on a guarded spot, and how many.
//
// Read from 0xED1DC0 with its two branches, 0xED2880 (an army from a
// template) and 0xED26B0 (one stack of one creature). The reading is held to
// the reference map three times over: every guard the connections phase
// placed matches down to the creature counts.
//
//   power < 100                        no monster, and no draws at all
//   power = trunc(power * strength)    the map's monster level scales it
//   r = betweenFloat(0, 1)             ONE draw, always
//   r < 0.6  -> an army from a simple template, at power * 0.9 AGAIN
//   r >= 0.6 -> a single stack, sized around a drawn desired count
//
// Then two more draws mint the object's name — `item_<signed int32>` from
// two below(65535) — so a guard costs four or five draws depending on the
// branch. Both are spent whether or not anything can be found to place.
//
// THE ARMY BRANCH. The template list is one file, named by a hardcoded path,
// and the candidates are the templates whose [MinPower, MaxPower] contains
// the scaled power, IN FILE ORDER. One draw picks among them. The stack
// sizes come out of the coefficients:
//
//   weighted   = Σ coef_i · power_i
//   k          = power / weighted            integer division
//   amount_i   = coef_i · k
//   remainder  = power − k · weighted, spent on the LAST stack alone
//
// THE SINGLE-STACK BRANCH. A desired count is drawn (10 + below(30)), and
// every creature whose amount-for-this-power lands within a tolerance of it
// becomes a candidate: desired/tol ≤ power/creaturePower ≤ desired·tol, with
// tol starting at 1.1. If fewer than ten candidates turn up, the tolerance
// widens by 1.2 and the scan RUNS AGAIN WITHOUT CLEARING the list — so the
// creatures that already qualified are added a second time and become twice
// as likely. That is the engine's behaviour, copied rather than tidied.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { childText, find, findAll, parse } from '../format/xml.ts';
import type { CreatureInfo } from './creatures.ts';
import { UNPLACEABLE_CREATURES } from './creatures.ts';

/**
 * Only the two entries a guard spends, so a test can hand this function a
 * recorded sequence instead of a seed. `RmgRandom` satisfies it as it is.
 */
export interface DrawSource {
  below(limit: number): number;
  betweenFloat(a: number, b: number): number;
}

const fl = Math.fround;

/** `MonsterStrenghtNames` order: weak, medium, strong, very strong, impossible. */
export const STRENGTH_MULTIPLIER: readonly number[] = [0.4, 0.9, 1.7, 4.0, 12.0].map((v) => fl(v));

/** Below this the engine places nothing and spends nothing. */
export const MIN_GUARD_POWER = 100;

export interface ArmyTemplate {
  path: string;
  stacks: Array<{ creature: string; coef: number }>;
  minPower: number;
  maxPower: number;
}

export interface GuardStack {
  creature: string;
  amount: number;
}

export interface Guard {
  /** `item_<signed int32>`, minted from two draws. */
  name: string;
  stacks: GuardStack[];
  /** 2 HOSTILE for a template army, 3 WILD for a single stack. */
  mood: number;
  /** Which branch produced it — the reference can be checked against both. */
  branch: 'army' | 'single';
}

/**
 * The template list, at the path the executable spells out in full — not a
 * parameter, not a reference table, a string constant in the image. Its
 * ORDER is the candidate order the draw indexes into.
 */
export const ARMY_TEMPLATE_GROUP =
  'RMG/CustomArmyTemplates/SimpleTemplates/AutoTemplates/TestTemplateGroup.(RMGSimpleCustomArmyTemplateGroup).xdb';

export function readArmyTemplates(dataRoot: string): ArmyTemplate[] {
  const groupPath = join(dataRoot, ARMY_TEMPLATE_GROUP);
  const group = find(parse(readFileSync(groupPath, 'utf8')), 'RMGSimpleCustomArmyTemplateGroup');
  const holder = group ? find(group, 'Templates') : null;
  if (!holder) return [];
  const base = dirname(groupPath);
  return findAll(holder, 'Item')
    .map((i) => i.attrs['href'])
    .filter((h): h is string => !!h)
    .map((href) => {
      const path = href.replace(/#xpointer\(.*\)$/, '');
      const doc = find(parse(readFileSync(join(base, path), 'utf8')), 'RMGSimpleCustomArmyTemplate');
      const stacks = doc ? find(doc, 'Stacks') : null;
      return {
        path,
        stacks: stacks
          ? findAll(stacks, 'Item').map((s) => ({
            creature: childText(s, 'Creature'),
            coef: Number.parseInt(childText(s, 'Coef'), 10) || 0,
          }))
          : [],
        minPower: doc ? Number.parseInt(childText(doc, 'MinPower'), 10) || 0 : 0,
        maxPower: doc ? Number.parseInt(childText(doc, 'MaxPower'), 10) || 0 : 0,
      };
    });
}

/** `item_<signed int32>` — the two draws every created object costs. */
export function mintName(rng: DrawSource): string {
  const hi = rng.below(65535);
  const lo = rng.below(65535);
  return `item_${(hi * 65536 + lo) | 0}`;
}

export interface GuardTables {
  templates: ArmyTemplate[];
  creatures: CreatureInfo[];
  /** By name, for the templates' `CREATURE_*` references. */
  powerByName: Map<string, number>;
}

/**
 * @param power the raw guard power, before the map's monster level scales it
 * @param strengthLevel 0..4 — the map's monster strength
 */
export function setMonster(power: number, strengthLevel: number, tables: GuardTables, rng: DrawSource): Guard | null {
  if (power < MIN_GUARD_POWER) return null; // no draws on this path

  const scaled = Math.trunc(fl(power * (STRENGTH_MULTIPLIER[strengthLevel] ?? 1)));
  const roll = rng.betweenFloat(0, 1);

  if (roll < fl(0.6)) {
    // The army branch scales the power a second time by the same 0.9.
    const budget = Math.trunc(fl(scaled * fl(0.9)));
    const candidates = tables.templates.filter((t) => t.minPower <= budget && budget <= t.maxPower);
    if (!candidates.length) return { name: mintName(rng), stacks: [], mood: 2, branch: 'army' };
    const chosen = candidates[rng.below(candidates.length)]!;

    let weighted = 0;
    for (const s of chosen.stacks) weighted += s.coef * (tables.powerByName.get(s.creature) ?? 0);
    const stacks: GuardStack[] = [];
    if (weighted > 0) {
      const k = Math.trunc(budget / weighted);
      let remainder = budget - k * weighted;
      for (const s of chosen.stacks) stacks.push({ creature: s.creature, amount: s.coef * k });
      const last = stacks[stacks.length - 1];
      const lastPower = last ? tables.powerByName.get(last.creature) ?? 0 : 0;
      if (last && lastPower > 0) {
        last.amount += Math.trunc(remainder / lastPower);
        remainder %= lastPower;
      }
    }
    return { name: mintName(rng), stacks, mood: 2, branch: 'army' };
  }

  const desired = 10 + rng.below(30);
  const candidates: CreatureInfo[] = [];
  let tolerance = fl(1.1);
  // The engine rescans without clearing, so a creature that qualifies at a
  // tighter tolerance is listed again at a looser one.
  for (let round = 0; round < 16 && candidates.length < 10; round++) {
    for (const creature of tables.creatures) {
      if (UNPLACEABLE_CREATURES.has(creature.id) || creature.power <= 0) continue;
      const ratio = fl(scaled / creature.power);
      if (ratio >= fl(desired / tolerance) && ratio <= fl(desired * tolerance)) candidates.push(creature);
    }
    if (candidates.length < 10) tolerance = fl(tolerance * fl(1.2));
  }
  if (!candidates.length) return { name: mintName(rng), stacks: [], mood: 3, branch: 'single' };
  const creature = candidates[rng.below(candidates.length)]!;
  const amount = Math.trunc(fl(scaled) / fl(creature.power));
  return { name: mintName(rng), stacks: [{ creature: creature.name, amount }], mood: 3, branch: 'single' };
}
