// MEMBERSHIP: the groups the game draws a race's random things from.
//
// Two of a faction's registries are neither a table nor a name but a LIST OF
// HREFS in an `AdvMapSharedGroup` document that `RPGRoot` names:
//
//   Towns/any.xdb   TOWN_ANY — `0xAC0CB0` walks the members and returns the
//                   `AdvMapTownShared` whose `Type` is the race; a random
//                   town on a map becomes that one;
//   Heroes/Any.xdb  HEROES_ANY — `0xB911E0` takes a member whose `TownType` is
//                   the race AND whose `ScenarioHero` is false; the player's
//                   starting hero when the map names none, and the tavern's
//                   draw. A race with nobody here starts with NOTHING and is
//                   out before its first turn (engineInternals/FACTIONS.md,
//                   launch six).
//
// So a town of ours is a member of the first, a hero of ours a member of the
// second, and nothing else makes either "of the race". The groups are shipped
// documents; the mod carries a patched copy (a mod's file shadows the pak's
// whole, so the copy lists everything the shipped one does plus ours). This
// is the splice: one href appended before `</links>`, once — a group already
// carrying the href is left alone, so building the mod twice does not seat a
// hero twice.
//
// The faction entity (FACTION_PLAN.md §5) will call this for its town and its
// heroes; until then the probe does, by hand, the same two lines.

import { insertBeforeLine, once } from './xml-edit.ts';

/** The random-town group: every town the game can put on a map by race. */
export const TOWN_GROUP = 'MapObjects/_(AdvMapSharedGroup)/Towns/any.xdb';

/** The random-hero pool: every hero a tavern or a start may draw, by race. */
export const HERO_GROUP = 'MapObjects/_(AdvMapSharedGroup)/Heroes/Any.xdb';

/** The hrefs a group lists, in the document's order. */
export function groupMembers(group: string): string[] {
  return [...group.matchAll(/<Item href="([^"]*)"\s*\/>/g)].map((m) => m[1]!);
}

/**
 * The group's text with `href` as its last member, or unchanged when it is
 * one already. `what` names the group in the error an unrecognizable
 * document raises.
 */
export function addGroupMember(group: string, href: string, what: string): string {
  if (!href.startsWith('/') || !href.includes('#xpointer(')) {
    throw new Error(`${what}: a group member is an absolute href with an xpointer — ${href}`);
  }
  if (groupMembers(group).includes(href)) return group;
  const close = once(group, '</links>', what);
  return insertBeforeLine(group, close, [`<Item href="${href}"/>`]);
}

/** The group's text without `href`; unchanged when it was never a member. */
export function removeGroupMember(group: string, href: string): string {
  const line = new RegExp(`^[\\t ]*<Item href="${href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*/>\\r?\\n`, 'm');
  return group.replace(line, '');
}
