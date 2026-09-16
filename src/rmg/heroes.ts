// THE HEROES A GENERATED MAP MAY OFFER — an order's choice, not the
// template's, and OURS: the engine's dialog has no such field.
//
// A generated map writes `<AvailableHeroes/>`, which the game reads as
// "every hero that is not a scenario's" — the lobby lets each player pick
// among their race's, taverns hire from the rest. Emptying every race's
// `HeroPool` in the RMG preset table changed neither the map (the generator
// never reads it, measured) nor the lobby's choice (played), so the pool is
// dead data and the roster comes from the hero documents themselves: every
// `*.(AdvMapHeroShared).xdb` whose `<ScenarioHero>` is not true, grouped by
// its `<TownType>` — eight a race in the shipped data, a mod's beside them.
//
// What an order can say, per player slot:
//
//   any      leave it to the game — nothing of theirs is listed, the whole
//            race stays on offer
//   random   one hero of the player's race, drawn from the seed, listed
//   <href>   that hero, listed
//
// and the map's `AvailableHeroes` becomes the union — a slot that said
// `any` contributes its race's whole roster, so a restricted map still
// offers that player a choice. Nothing listed when every slot says `any`,
// which is the generated map as the engine writes it. Two slots may name
// one hero; whether the game seats him twice is the lobby's business.
//
// The draw is on a stream of its own, seeded from the order's seed, so the
// engine's stream — and with it the map — is what it was with no heroes
// asked for.

import { childText, find, parse } from '../format/xml.ts';
import { Registry } from '../schema/registry.ts';
import { readText, toAssets } from './data.ts';
import type { DataRoot } from './data.ts';
import { RmgRandom } from './random.ts';

export interface HireableHero {
  /** `/MapObjects/Haven/Orrin.(AdvMapHeroShared).xdb#xpointer(/AdvMapHeroShared)`. */
  href: string;
  /** `TOWN_HEAVEN` and the like — the document's own `<TownType>`. */
  town: string;
  /** The file's base name; the localized name is the UI's business. */
  name: string;
}

/** Every hero the lobby would offer, from the mounted data — mods included. */
export function hireableHeroes(dataRoot: DataRoot): HireableHero[] {
  const data = toAssets(dataRoot);
  const out: HireableHero[] = [];
  for (const entry of new Registry(data).heroes()) {
    const path = entry.id.replace(/#.*$/, '').replace(/^\/+/, '');
    let doc;
    try {
      doc = find(parse(readText(data, path)), 'AdvMapHeroShared');
    } catch {
      continue; // a hero the chain names and cannot read is not on offer
    }
    if (!doc) continue;
    if (childText(doc, 'ScenarioHero') === 'true') continue;
    // An EntryPoint is an AdvMapHeroShared too (`/MapObjects/Utility/`), and
    // not a hero: no class, no name. The class is what says so.
    if (childText(doc, 'Class') === 'HERO_CLASS_NONE') continue;
    const town = childText(doc, 'TownType');
    if (!town) continue;
    out.push({ href: entry.id, town, name: entry.name ?? path });
  }
  return out.sort((a, b) => a.href.localeCompare(b.href));
}

/** What an order says about one player slot. */
export type HeroChoice = 'any' | 'random' | string;

export interface HeroesOrderInput {
  /** Per active player, in slot order. */
  choices: readonly HeroChoice[];
  /** Per active player, the race's `TOWN_*` name — what the chain seated. */
  races: readonly string[];
  roster: readonly HireableHero[];
  seed: number;
}

export interface HeroesOrderResult {
  /** The map's `AvailableHeroes`, empty when nothing was asked. */
  available: string[];
  /** Per player: the hero listed for them, or null for `any`. */
  chosen: Array<string | null>;
  warnings: string[];
}

export function chooseHeroes(input: HeroesOrderInput): HeroesOrderResult {
  const { roster } = input;
  const warnings: string[] = [];
  const chosen: Array<string | null> = [];
  const available = new Set<string>();
  const restricted = input.choices.some((c) => c !== 'any');
  // A draw per slot in slot order, spent whether or not the slot uses it, so
  // changing one player's choice does not move another's hero.
  const rng = new RmgRandom(input.seed);
  input.choices.forEach((choice, i) => {
    const race = input.races[i] ?? '';
    const ofRace = roster.filter((h) => h.town === race);
    const draw = rng.below(Math.max(1, ofRace.length));
    if (choice === 'any') {
      chosen.push(null);
      if (restricted) for (const h of ofRace) available.add(h.href);
      return;
    }
    if (choice === 'random') {
      const h = ofRace[draw];
      if (!h) {
        warnings.push(`player ${i + 1}: no hireable hero of ${race} in the data — left to the game`);
        chosen.push(null);
        return;
      }
      chosen.push(h.href);
      available.add(h.href);
      return;
    }
    const named = roster.find((h) => h.href === choice || h.href.replace(/#.*$/, '') === choice.replace(/#.*$/, ''));
    if (!named) {
      warnings.push(`player ${i + 1}: ${choice} is not a hireable hero in the data — left to the game`);
      chosen.push(null);
      if (restricted) for (const h of ofRace) available.add(h.href);
      return;
    }
    if (named.town !== race) warnings.push(`player ${i + 1}: ${named.name} is ${named.town}, the player is ${race}`);
    chosen.push(named.href);
    available.add(named.href);
  });
  return { available: [...available], chosen, warnings };
}
