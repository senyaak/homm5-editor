// A creature record — the `Creature` document, read and written as stats.
//
// Tribes of the East holds 180 creatures and THE NUMBER IS COMPILED INTO
// H5_Game.exe, at two int32 sites. Adding a creature is therefore two halves that
// have to agree exactly: a patched executable (see the patcher) and a mod that
// fills every id below the new ceiling. An id below the ceiling with no object
// behind it stops the game at startup — "Empty pointer to creature # N", with an
// offer to skip the remaining checks that skips the rest of the database with it.
//
// So there are no spare slots and nothing to fill them with: the ceiling is
// exactly SHIPPED + however many creatures the mod carries. Growing the set means
// patching again, which is one command, and there is never a hole.
//
// This module is only the record. creature-mod.ts is the mod that carries it.

import { find, childText, parse, serialize, setText, setAttr, children, clearElement } from '../format/xml.ts';
import type { XmlElement } from '../format/xml.ts';

/**
 * How many creatures the shipped game counts to, and so the first id a mod may
 * use. CREATURE_UNKNOWN is 0, the last shipped one is 179.
 */
export const SHIPPED_CREATURES = 180;

/** The game's null creature — the shortest complete `Creature` document there is. */
export const NULL_CREATURE = 'GameMechanics/Creature/Creatures/None.xdb';

/**
 * "This creature is a dragon" — an ability id of ours, carried in the record.
 *
 * The engine decides what a dragon is from a table of four ids compiled into
 * the executable (Bone, Green, Deep, Fire) and their upgrades, which is enough
 * for the twelve the game ships and blind to the thirteenth. A creature of ours
 * cannot join that table, so it says so itself, in the game's own vocabulary:
 * one more `<Item>` in `<Abilities>`.
 *
 * SAFE TO SHIP. The executable maps an ability name to its id with an unrolled
 * chain of string comparisons (`0xBE1A30`) whose last answer is `xor eax,eax` —
 * a name it does not know becomes `ABILITY_NONE`, which nothing asks about. So
 * the game loads a creature carrying this and ignores it, exactly as it ignores
 * a typo, while our own tools read it. Nothing of the engine's is patched to
 * make the tag exist.
 *
 * WHO READS IT. The install writes the creatures that carry it into the
 * extension's config as `dragon <id> …`, and the extension answers the rune's
 * "is this a dragon?" with the engine's own answer OR that list. See
 * docs/engineInternals/RULES_FIXES.md.
 *
 * It is deliberately NOT printed in the hire dialog: a tag is not an ability a
 * player has, and the line the dialog prints is built from the same list.
 */
export const DRAGON_TAG = 'ABILITY_DRAGON';

/** The seven resources a creature can cost, in the order `<Cost>` lists them. */
export const COST_RESOURCES = ['Wood', 'Ore', 'Mercury', 'Crystal', 'Sulfur', 'Gem', 'Gold'] as const;

/** A creature's numbers, in the fields the game's own record uses. */
export interface CreatureStats {
  attack: number;
  defence: number;
  minDamage: number;
  maxDamage: number;
  health: number;
  speed: number;
  initiative: number;
  /** 0 for a melee creature. */
  shots: number;
  /**
   * Shooting range. 0 is the ordinary ranged creature (half-damage past the
   * halfway line); NEGATIVE widens it — the shipped Sharp Shooter uses -1, which
   * is how "no distance penalty" is expressed alongside the ability.
   */
  range: number;
  weeklyGrowth: number;
  /** Gold, and whatever else it costs. */
  gold: number;
  resources?: Partial<Record<(typeof COST_RESOURCES)[number], number>>;
  tier: number;
  /** `TOWN_NO_TYPE` for a neutral. */
  town: string;
  /** What the AI values one of them at. */
  exp: number;
  power: number;
  flying: boolean;
  /** 1 for a small creature, 2 for a large one (two tiles square in combat). */
  combatSize: number;
  /** How long the hire dialog waits before it will command them. Shipped: 7–10. */
  timeToCommand: number;
  abilities: string[];
}

/** Sensible zeroes — what an unfilled creature form starts from. */
export function blankStats(): CreatureStats {
  return {
    attack: 1, defence: 1, minDamage: 1, maxDamage: 1, health: 1,
    speed: 4, initiative: 10, shots: 0, range: 0, weeklyGrowth: 1,
    gold: 100, tier: 1, town: 'TOWN_NO_TYPE', exp: 1, power: 1,
    flying: false, combatSize: 1, timeToCommand: 10, abilities: [],
  };
}

/**
 * Fill a `Creature` document with `stats`, in place.
 *
 * Written over the game's null creature rather than composed from nothing: the
 * loader checks more of this document than we know about, and None.xdb is the
 * shortest thing that satisfies it. (The one field it gets away with omitting is
 * the icon, and only because it sits at id 0 — the startup check starts at 1.)
 */
export function writeStats(creature: XmlElement, stats: CreatureStats): void {
  const num: Array<[string, number]> = [
    ['AttackSkill', stats.attack], ['DefenceSkill', stats.defence],
    ['MinDamage', stats.minDamage], ['MaxDamage', stats.maxDamage],
    ['Health', stats.health], ['Speed', stats.speed],
    ['Initiative', stats.initiative], ['Shots', stats.shots],
    ['Range', stats.range], ['WeeklyGrowth', stats.weeklyGrowth],
    ['Exp', stats.exp], ['Power', stats.power],
    ['CreatureTier', stats.tier], ['CombatSize', stats.combatSize],
    ['TimeToCommand', stats.timeToCommand],
  ];
  for (const [tag, value] of num) setNumber(creature, tag, value);
  setNumber(creature, 'Flying', stats.flying);
  set(creature, 'CreatureTown', stats.town);

  const cost = find(creature, 'Cost');
  if (cost) {
    for (const r of COST_RESOURCES) {
      const want = r === 'Gold' ? stats.gold : (stats.resources?.[r] ?? 0);
      setNumber(cost, r, want);
    }
  }

  const list = find(creature, 'Abilities');
  if (list) {
    clearElement(list);
    if (stats.abilities.length) list.selfClose = false;
    for (const a of stats.abilities) {
      list.children.push({
        type: 'element', name: 'Item', rawAttrs: '', attrs: {},
        children: [{ type: 'text', text: a }], selfClose: false,
      });
    }
  }
}

/** Read them back out — the inverse, so a built mod can be reopened. */
export function readStats(creature: XmlElement): CreatureStats {
  const n = (tag: string): number => Number(childText(creature, tag) || 0);
  const cost = find(creature, 'Cost');
  const resources: Partial<Record<(typeof COST_RESOURCES)[number], number>> = {};
  for (const r of COST_RESOURCES) {
    if (r === 'Gold' || !cost) continue;
    const v = Number(childText(cost, r) || 0);
    if (v) resources[r] = v;
  }
  const abilities = find(creature, 'Abilities');
  return {
    attack: n('AttackSkill'), defence: n('DefenceSkill'),
    minDamage: n('MinDamage'), maxDamage: n('MaxDamage'),
    health: n('Health'), speed: n('Speed'), initiative: n('Initiative'),
    shots: n('Shots'), range: n('Range'), weeklyGrowth: n('WeeklyGrowth'),
    gold: cost ? Number(childText(cost, 'Gold') || 0) : 0,
    ...(Object.keys(resources).length ? { resources } : {}),
    tier: n('CreatureTier'), town: childText(creature, 'CreatureTown') || 'TOWN_NO_TYPE',
    exp: n('Exp'), power: n('Power'),
    flying: childText(creature, 'Flying') === 'true',
    combatSize: n('CombatSize') || 1,
    timeToCommand: n('TimeToCommand'),
    abilities: abilities
      ? children(abilities).filter((c) => c.name === 'Item').map((c) => childTextOf(c)).filter(Boolean)
      : [],
  };
}

/** The `<Creature>` element of a document, whether or not it is the root. */
export function creatureRoot(xdbText: string): XmlElement {
  const doc = parse(xdbText);
  const root = doc.name === 'Creature' ? doc : find(doc, 'Creature');
  if (!root) throw new Error('not a Creature document');
  return root;
}

/** Serialize one back to a full `.xdb`. */
export function saveCreature(creature: XmlElement): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\r\n${serialize(creature)}`;
}

/** Point a creature at its visual and its map-stack definition. */
export function setCreatureRefs(creature: XmlElement, visual: string, monster: string): void {
  href(creature, 'Visual', `${visual}#xpointer(/CreatureVisual)`);
  href(creature, 'MonsterShared', `${monster}#xpointer(/AdvMapMonsterShared)`);
}

// --- small helpers ------------------------------------------------------------

function set(el: XmlElement, tag: string, value: string): void {
  const child = find(el, tag);
  if (!child) throw new Error(`the creature has no <${tag}>`);
  setText(child, value);
}

function setNumber(el: XmlElement, tag: string, value: number | boolean): void {
  set(el, tag, typeof value === 'boolean' ? String(value) : String(value));
}

function href(el: XmlElement, tag: string, value: string): void {
  const child = find(el, tag);
  if (!child) throw new Error(`the creature has no <${tag}>`);
  clearElement(child);
  child.selfClose = true;
  setAttr(child, 'href', value);
}

/** An `<Item>`'s own text, trimmed. */
function childTextOf(el: XmlElement): string {
  return el.children.map((c) => (c.type === 'text' ? c.text : '')).join('').trim();
}
