// Why the game would refuse to start this map — asked before it is launched.
//
// Three sentences cost a game run each, and all three come out of the engine
// as the SAME line: `ERROR: Start player does not exist on map/…`. What that
// line actually means is one of the causes below, and which one it is cannot be
// read off it — so this says it instead, from the map alone
// (docs/CAMPAIGNS.md, "The traps").
//
// A CHECKER, NOT A FIXER. Every rule here is one the game enforces and we do
// not: a map may legitimately want an inactive slot or a neutral colour, and
// what makes a map unplayable is the COMBINATION. So the answer is a list of
// reasons in plain words, and what to do about them is the author's.

import { find, findAll, children, childText, text } from '../format/xml.ts';
import type { XmlElement } from '../format/xml.ts';

/**
 * The `<AdvMapDesc>` of a parsed document, or the element itself.
 *
 * `parse()` answers with the DOCUMENT, whose child is the root — and a checker
 * handed the document silently found no players and called every map in the
 * install unstartable. Taking either is what makes the mistake impossible.
 */
export function descOf(node: XmlElement): XmlElement {
  if (node.name === 'AdvMapDesc') return node;
  return children(node).find((c) => c.name === 'AdvMapDesc') ?? node;
}

/** Slots the game addresses as PLAYER_1 … PLAYER_8, in order. */
const PLAYER_IDS = [
  'PLAYER_1', 'PLAYER_2', 'PLAYER_3', 'PLAYER_4', 'PLAYER_5', 'PLAYER_6', 'PLAYER_7', 'PLAYER_8',
];

/** Object types that give a player something to start FROM. An EntryPoint is
 *  an `AdvMapHero` by shape and is not a hero — the engine agrees, and says so
 *  with the same error. */
const OWNS = new Set(['AdvMapHero', 'AdvMapTown']);

/** One slot, as the checks below need it. */
interface Slot {
  index: number;
  active: boolean;
  colour: string;
  team: number;
}

function slotsOf(desc: XmlElement): Slot[] {
  const players = find(desc, 'players');
  if (!players) return [];
  return findAll(players, 'Item').map((item, index) => ({
    index,
    active: childText(item, 'ActivePlayer') === 'true',
    colour: childText(item, 'Colour') || 'PCOLOR_NEUTRAL',
    team: Number.parseInt(childText(item, 'Team') || '0', 10) || 0,
  }));
}

/** Which players own a hero or a town on the map. */
function ownersOnMap(desc: XmlElement): Set<string> {
  const owners = new Set<string>();
  const objects = find(desc, 'objects');
  if (!objects) return owners;
  for (const item of findAll(objects, 'Item')) {
    for (const body of children(item)) {
      if (!OWNS.has(body.name)) continue;
      // AN ENTRYPOINT IS NOT A HERO, and it is not told apart by its class.
      //
      // It is an `AdvMapHero` whose Shared points at
      // `/MapObjects/Utility/EntryPoint.xdb#xpointer(/AdvMapHeroShared)` — the
      // SAME class name a real hero carries, so a check on the xpointer passes
      // it through. This one first read the class and called a map with an
      // EntryPoint for its second player perfectly startable; the game
      // disagreed, which is what this whole file exists to predict. The
      // DOCUMENT is the difference: a hero's own record lives beside his race,
      // the EntryPoint's under Utility.
      const shared = find(body, 'Shared')?.attrs.href ?? '';
      if (body.name === 'AdvMapHero' && /EntryPoint/i.test(shared.split('#')[0] ?? '')) continue;
      const player = childText(body, 'PlayerID');
      if (player) owners.add(player);
    }
  }
  return owners;
}

/** Does the map's primary objective say "defeat everybody"? */
function defeatAll(desc: XmlElement): boolean {
  const objectives = find(desc, 'Objectives');
  if (!objectives) return false;
  return /OBJECTIVE_KIND_DEFEAT_ALL/.test(
    findAll(objectives, 'Kind').map((k) => text(k)).join(' '));
}

/**
 * Every reason the game would refuse this map, in the order they bite.
 *
 * An empty list is not a promise that the map is good — only that these three
 * traps are not set.
 */
export function startableProblems(node: XmlElement): string[] {
  const desc = descOf(node);
  const problems: string[] = [];
  const slots = slotsOf(desc);
  const live = slots.filter((s) => s.active && s.colour !== 'PCOLOR_NEUTRAL');

  if (!live.length) {
    const activeOnly = slots.filter((s) => s.active);
    problems.push(activeOnly.length
      ? `every active slot is PCOLOR_NEUTRAL (slots ${activeOnly.map((s) => s.index).join(', ')})`
      + ' — an uncoloured player is not one the game can start as'
      : 'no player slot is active — a hero owned by PLAYER_1 does not make slot 0 a player');
    return problems;
  }

  const owners = ownersOnMap(desc);
  for (const slot of live) {
    const id = PLAYER_IDS[slot.index] ?? `slot ${slot.index}`;
    if (!owners.has(id)) {
      problems.push(`${id} is active and coloured but owns no hero and no town`
        + ' — an EntryPoint does not count');
    }
  }

  // THE ONE THAT LOOKS LIKE A WORKING MAP — and the one to distrust.
  //
  // NOT CONFIRMED. `Rules Test.h5m`, a map that starts and is played, has two
  // live players on team 0 and "defeat all" as its objective, so this rule
  // calls a working map broken. It is kept because the doc describes the
  // mechanism (an objective satisfied at load wins the mission and drops the
  // player) and because it costs nothing to say — but until a run confirms it,
  // it is a SUSPICION, not a diagnosis. What would settle it: a map that
  // differs from a working one in this alone. "Defeat all" with nobody to defeat
  // is satisfied at load: the game wins the mission, drops the winning player,
  // and then cannot find one to start as. Two players left on the team every
  // fresh slot comes with are allies, so this bites a map that has two sides
  // and looks entirely playable.
  if (defeatAll(desc)) {
    const teams = new Set(live.map((s) => s.team));
    if (teams.size < 2) {
      problems.push(live.length === 1
        ? 'the only live player has "defeat all" as the victory condition, which is'
        + ' satisfied at load — give the mission an opponent or clear that objective'
        : `all ${live.length} live players are on team ${[...teams][0]}, and the victory`
        + ' condition is "defeat all" — allies with nobody to defeat win at load,'
        + ' and the map then has no start player');
    }
  }

  return problems;
}
