// The player slots, and keeping them true to what is on the map.
//
// A map has eight of them. They are NOT the owners written on objects: an
// object's `PlayerID` says whose it is, and the slot says whether that owner
// exists at all. A fresh map declares all eight `ActivePlayer false`, so a hero
// given to PLAYER_1 belongs to somebody the game does not offer — the map loads
// and there is nobody to play it as, with no error anywhere. That was left for
// the person to notice, and they noticed it in the game.
//
// So the editor keeps the two in step: giving an object an owner turns that
// owner on, and a player left owning nothing is turned off again. Both are the
// same rule read in opposite directions, and both are the map saying what is
// true of itself rather than a person remembering a field two panels away.
//
// MAIN HERO is the other half. An active player still needs somewhere to begin,
// and `MainHero` is that: a reference INTO this map (`#xpointer(id(…)/AdvMapHero)`),
// not a document of its own — the schema said otherwise for a while and the
// field written as text reads as blank to the game while looking filled in here.
// A player whose main hero is taken off the map gets another of his heroes, and
// if there are none, gets none — the field goes empty rather than pointing at an
// object that is not there.

import { children, find, setAttr, setText, text } from '../format/xml.ts';
import type { XmlElement } from '../format/xml.ts';

/** How many slots a map has, and the enum's own count: PLAYER_1…PLAYER_8. */
export const SLOTS = 8;

/** The owner value that means nobody. */
export const NO_PLAYER = 'PLAYER_NONE';

/** The object type a main hero has to be. */
export const HERO_TYPE = 'AdvMapHero';

/**
 * `PLAYER_3` → 2, and anything else → null.
 *
 * Null for PLAYER_NONE as well, which is the point: taking an owner away is not
 * a slot to turn on, it is the caller's cue to look at what is left.
 */
export function slotOf(playerId: string | null | undefined): number | null {
  const m = /^PLAYER_([1-8])$/.exec(playerId ?? '');
  return m ? +m[1]! - 1 : null;
}

/** 0 → `PLAYER_1`. The inverse of slotOf, for reading a slot back out. */
export const playerOf = (slot: number): string => `PLAYER_${slot + 1}`;

/**
 * How a player's main hero names an object of this map.
 *
 * The id is the `id` ATTRIBUTE of the object's `<Item>` wrapper, not its
 * `<Name>` — checked against A2C1M1, whose `#xpointer(id(item_DB28…))` resolves
 * to an attribute and matches no Name in the file. An object without one cannot
 * be a main hero: there is nothing to point at.
 */
export const mainHeroRef = (id: string): string => `#xpointer(id(${id})/AdvMapHero)`;

/** The `<players>` list of an `<AdvMapDesc>`, or null when the map has none. */
function playersOf(desc: XmlElement): XmlElement | null {
  return find(desc, 'players');
}

/** One slot's element, by index. Null when the map declares fewer. */
export function slotEl(desc: XmlElement, slot: number): XmlElement | null {
  const list = playersOf(desc);
  if (!list) return null;
  return children(list)[slot] ?? null;
}

/** Is this slot on? */
export function isActive(desc: XmlElement, slot: number): boolean {
  const el = slotEl(desc, slot);
  return !!el && text(find(el, 'ActivePlayer')) === 'true';
}

/** Turn a slot on or off. False when the map has no such slot. */
export function setActive(desc: XmlElement, slot: number, on: boolean): boolean {
  const el = slotEl(desc, slot);
  const flag = el && find(el, 'ActivePlayer');
  if (!flag) return false;
  setText(flag, on ? 'true' : 'false');
  return true;
}

/** A slot's main hero reference, or '' when it has none. */
export function mainHero(desc: XmlElement, slot: number): string {
  const el = slotEl(desc, slot);
  const h = el && find(el, 'MainHero');
  return h?.attrs.href ?? '';
}

/**
 * Point a slot's main hero at a reference, or empty it.
 *
 * Always as an href, never as text: `<MainHero>#xpointer(…)</MainHero>` looks
 * right in the panel and reads as blank to the game.
 */
export function setMainHero(desc: XmlElement, slot: number, href: string): boolean {
  const el = slotEl(desc, slot);
  const h = el && find(el, 'MainHero');
  if (!h) return false;
  if (href) setAttr(h, 'href', href);
  else delete h.attrs.href;
  return true;
}

/** What an object has to look like for the rules below. */
export interface OwnedObject {
  /** The `id` attribute of its `<Item>` — what MainHero points at. */
  id: string;
  /** Its element name — `AdvMapHero`, `AdvMapTown`, `AdvMapMine`… */
  type: string;
  /** Its `PlayerID`, or null when it has no owner field at all. */
  player: string | null;
}

/**
 * An owner was given to an object: make that owner exist.
 *
 * Two writes at most, and both are about the same sentence — "PLAYER_1 is on
 * this map, and this is where he starts". The main hero is only taken when the
 * slot has none: a person who has chosen one is not overruled by placing a
 * second hero.
 *
 * Returns what it changed, so a caller can say so and a test can see it.
 */
export function ownerGiven(desc: XmlElement, obj: OwnedObject): { activated: boolean; mainHero: boolean } {
  const slot = slotOf(obj.player);
  if (slot === null) return { activated: false, mainHero: false };
  const activated = !isActive(desc, slot) && setActive(desc, slot, true);
  const takesMain = obj.type === HERO_TYPE && !!obj.id && !mainHero(desc, slot);
  const gotMain = takesMain && setMainHero(desc, slot, mainHeroRef(obj.id));
  return { activated, mainHero: gotMain };
}

/**
 * An object is leaving the map: keep the slots true without it.
 *
 * `remaining` is what the map will still hold — the caller's list, taken after
 * the object is gone or filtered by its id, because "does this player still own
 * anything" cannot be answered from the object being removed.
 *
 * Two things can follow, in this order:
 *
 *   the main hero  — if the one leaving was it, another hero of that player's
 *                    takes the field; with none, the field is emptied rather
 *                    than left pointing at an object that is not there.
 *   the slot       — a player who owns nothing at all is turned off. A slot on
 *                    with nothing behind it is a side the lobby offers and the
 *                    game then cannot start.
 */
export function objectRemoved(
  desc: XmlElement, gone: OwnedObject, remaining: readonly OwnedObject[],
): { mainHero: 'kept' | 'moved' | 'cleared'; deactivated: boolean } {
  const slot = slotOf(gone.player);
  if (slot === null) return { mainHero: 'kept', deactivated: false };

  const mine = remaining.filter((o) => o.player === gone.player);

  let moved: 'kept' | 'moved' | 'cleared' = 'kept';
  if (gone.type === HERO_TYPE && gone.id && mainHero(desc, slot) === mainHeroRef(gone.id)) {
    const heir = mine.find((o) => o.type === HERO_TYPE && o.id);
    setMainHero(desc, slot, heir ? mainHeroRef(heir.id) : '');
    moved = heir ? 'moved' : 'cleared';
  }

  // Nothing of his left anywhere — not a hero, not a town, not a mine.
  const deactivated = mine.length === 0 && isActive(desc, slot) && setActive(desc, slot, false);
  return { mainHero: moved, deactivated };
}
