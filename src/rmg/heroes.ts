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
// its `<TownType>` — eight a race in the shipped data, a mod's beside them —
// each with the name the game shows (`Editable/NameFileRef`, in the
// install's language; the file's base name is `Hero1` for an orc).
//
// What an order can say:
//
//   nothing            the engine's map — `<AvailableHeroes/>` empty
//   of the races       every hero of the races the players came out as,
//                      known only after the run (a race may be random)
//   a list             exactly these — the WHITE list of the dialog; the
//                      map has no other kind of list, so the dialog's black
//                      one is for the eye and is not written
//
// Played (16.09): the lobby offers exactly the heroes listed, one per slot,
// and the TAVERNS are empty when the list is short — every listed hero is
// seated at the start. A hero of a race no player has is never offered, so
// that is a warning; a mirrored map wanting one hero in two slots wants two
// documents of him, which is the Outcast's business (ROADMAP, Phase 10).

import { childText, find, parse } from '../format/xml.ts';
import type { Assets } from '../game/assets.ts';
import { Registry, gameText } from '../schema/registry.ts';
import { readText, toAssets } from './data.ts';
import type { DataRoot } from './data.ts';

export interface HireableHero {
  /** `/MapObjects/Haven/Orrin.(AdvMapHeroShared).xdb#xpointer(/AdvMapHeroShared)`. */
  href: string;
  /** `TOWN_HEAVEN` and the like — the document's own `<TownType>`. */
  town: string;
  /** What the game shows — `Editable/NameFileRef` read through the chain; the file's base name when it has none. */
  name: string;
}

/**
 * Every hero the lobby would offer, from the mounted data — mods included.
 *
 * READ ONCE PER CHAIN. The roster walks every object folder of every root
 * and reads the head of thousands of files — five seconds on the shipped
 * data — and it does not change under a running editor. So it is kept by
 * the chain object: the chain the generator's service mounts once is read
 * once a launch, while a plain folder string makes a chain of its own each
 * call and is read each call, as the tools always have been.
 */
export function hireableHeroes(dataRoot: DataRoot): HireableHero[] {
  if (typeof dataRoot === 'string') return readRoster(toAssets(dataRoot));
  let roster = rosters.get(dataRoot);
  if (!roster) rosters.set(dataRoot, roster = readRoster(dataRoot));
  return roster;
}

const rosters = new WeakMap<Assets, HireableHero[]>();

function readRoster(data: Assets): HireableHero[] {
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
    // The name is the Editable block's; the document's own NameFileRef-like
    // tags (SpecializationNameFileRef) are the specialization's.
    const editable = find(doc, 'Editable');
    const nameRef = editable ? find(editable, 'NameFileRef')?.attrs.href : undefined;
    const shown = nameRef ? gameText(data, nameRef) : '';
    out.push({ href: entry.id, town, name: shown || entry.name || path });
  }
  return out.sort((a, b) => a.town.localeCompare(b.town) || a.name.localeCompare(b.name) || a.href.localeCompare(b.href));
}

export interface AvailableHeroesInput {
  /** Every hero of these races — the players' races as the run seated them, `TOWN_*` names. */
  ofRaces?: readonly string[];
  /** Or exactly these hrefs, as the dialog's white list holds them. */
  listed?: readonly string[];
  /** The players' races, for the warning about a listed hero nobody can take. */
  races: readonly string[];
  roster: readonly HireableHero[];
}

export interface AvailableHeroesResult {
  /** The map's `AvailableHeroes`, empty when nothing was asked. */
  available: string[];
  warnings: string[];
}

/** The document's path without the pointer — one hero, however the href spells it. */
const docOf = (href: string): string => href.replace(/#.*$/, '');

export function availableHeroes(input: AvailableHeroesInput): AvailableHeroesResult {
  const { roster } = input;
  const warnings: string[] = [];
  if (input.ofRaces) {
    const races = new Set(input.ofRaces);
    return { available: roster.filter((h) => races.has(h.town)).map((h) => h.href), warnings };
  }
  const available: string[] = [];
  const seen = new Set<string>();
  const races = new Set(input.races);
  for (const href of input.listed ?? []) {
    const hero = roster.find((h) => h.href === href || docOf(h.href) === docOf(href));
    if (!hero) {
      warnings.push(`${href} is not a hireable hero in the data — left out`);
      continue;
    }
    if (seen.has(hero.href)) continue;
    seen.add(hero.href);
    available.push(hero.href);
    if (!races.has(hero.town)) warnings.push(`${hero.name} is ${hero.town}, and no player is — never offered`);
  }
  return { available, warnings };
}
