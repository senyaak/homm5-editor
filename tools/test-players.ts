// The player slots, kept true to what is on the map (src/map/players.ts).
//
// Everything here runs against a REAL fresh map — buildBlankMap's own eight
// slots, parsed — rather than a hand-written scrap of XML. The bug this exists
// for is precisely a property of that map: all eight slots ship off, so a hero
// given to PLAYER_1 belongs to somebody the game does not offer, and the map
// loads with nobody to play it as and no error to read. A stand-in whose slots
// were already on could not have failed.
//
//   node tools/test-players.ts

import { buildBlankMap } from '../src/map/blank-map.ts';
import { loadMap } from '../src/map/map.ts';
import {
  isActive, mainHero, mainHeroRef, objectRemoved, ownerGiven, playerOf, setActive, setMainHero, slotOf,
} from '../src/map/players.ts';
import type { OwnedObject } from '../src/map/players.ts';
import type { XmlElement } from '../src/format/xml.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

/** A fresh map's <AdvMapDesc>, the way New Map makes one. */
function freshDesc(): XmlElement {
  return loadMap(buildBlankMap({ tiles: 72, twoLevel: false, spells: [], artifacts: [] })).desc;
}

const hero = (id: string, player: string | null): OwnedObject => ({ id, type: 'AdvMapHero', player });
const town = (id: string, player: string | null): OwnedObject => ({ id, type: 'AdvMapTown', player });

// --- reading the slots -------------------------------------------------------

check('PLAYER_1 is slot 0 and PLAYER_8 is slot 7', slotOf('PLAYER_1') === 0 && slotOf('PLAYER_8') === 7);
check('PLAYER_NONE is not a slot', slotOf('PLAYER_NONE') === null);
check('nor is nothing at all', slotOf(null) === null && slotOf('') === null && slotOf(undefined) === null);
check('nor a ninth player', slotOf('PLAYER_9') === null && slotOf('PLAYER_0') === null);
check('and a slot reads back as its player', playerOf(0) === 'PLAYER_1' && playerOf(7) === 'PLAYER_8');

{
  const desc = freshDesc();
  // THE BUG, stated: this is what a person starts from.
  check('a fresh map has all eight slots off',
    [0, 1, 2, 3, 4, 5, 6, 7].every((s) => !isActive(desc, s)));
  check('and none of them has a main hero',
    [0, 1, 2, 3, 4, 5, 6, 7].every((s) => mainHero(desc, s) === ''));
  check('a slot the map does not have answers no', !isActive(desc, 8) && !setActive(desc, 8, true));
}

// --- giving an owner ---------------------------------------------------------

{
  const desc = freshDesc();
  const r = ownerGiven(desc, hero('item_A', 'PLAYER_1'));
  check('giving a hero an owner turns that owner on', r.activated && isActive(desc, 0));
  check('and makes him where the player starts',
    r.mainHero && mainHero(desc, 0) === '#xpointer(id(item_A)/AdvMapHero)');
  check('the other seven are left alone',
    [1, 2, 3, 4, 5, 6, 7].every((s) => !isActive(desc, s)));

  // A second hero for the same player is not a promotion.
  const second = ownerGiven(desc, hero('item_B', 'PLAYER_1'));
  check('a second hero does not take the main hero over',
    !second.mainHero && mainHero(desc, 0) === mainHeroRef('item_A'));
  check('and does not re-activate what is already on', !second.activated);

  // A town is an owner too — it just cannot be where a hero starts.
  const t = ownerGiven(desc, town('item_T', 'PLAYER_3'));
  check('a town turns its owner on as well', t.activated && isActive(desc, 2));
  check('but is never made the main hero', !t.mainHero && mainHero(desc, 2) === '');

  // Taking the owner away is not this function's business — it changes nothing,
  // which is what lets the remove path own that decision without a fight.
  const none = ownerGiven(desc, hero('item_C', 'PLAYER_NONE'));
  check('an owner of nobody turns nothing on', !none.activated && !none.mainHero);
}

{
  // A hero with no id cannot be pointed at, so he cannot be a main hero — but
  // his owner still exists. Silently writing `id()` would be a reference the
  // game cannot resolve, which reads as no main hero at all and is worse.
  const desc = freshDesc();
  const r = ownerGiven(desc, hero('', 'PLAYER_2'));
  check('a hero with no id still turns his owner on', r.activated && isActive(desc, 1));
  check('...but is not written as the main hero', !r.mainHero && mainHero(desc, 1) === '');
}

// --- taking an object away ---------------------------------------------------

{
  const desc = freshDesc();
  ownerGiven(desc, hero('item_A', 'PLAYER_1'));
  ownerGiven(desc, hero('item_B', 'PLAYER_1'));

  const r = objectRemoved(desc, hero('item_A', 'PLAYER_1'), [hero('item_B', 'PLAYER_1')]);
  check('the main hero leaving hands the field to another of his',
    r.mainHero === 'moved' && mainHero(desc, 0) === mainHeroRef('item_B'));
  check('and the player stays on, since he still owns one', !r.deactivated && isActive(desc, 0));
}

{
  const desc = freshDesc();
  ownerGiven(desc, hero('item_A', 'PLAYER_1'));

  const r = objectRemoved(desc, hero('item_A', 'PLAYER_1'), []);
  check('the last hero leaving empties the main hero',
    r.mainHero === 'cleared' && mainHero(desc, 0) === '');
  check('and turns the player off, since nothing of his is left',
    r.deactivated && !isActive(desc, 0));
}

{
  // Owning a TOWN is owning something: the player stays, even with no hero.
  const desc = freshDesc();
  ownerGiven(desc, hero('item_A', 'PLAYER_1'));
  ownerGiven(desc, town('item_T', 'PLAYER_1'));

  const r = objectRemoved(desc, hero('item_A', 'PLAYER_1'), [town('item_T', 'PLAYER_1')]);
  check('a player with a town but no hero keeps his slot', !r.deactivated && isActive(desc, 0));
  check('though he has nowhere to start from', r.mainHero === 'cleared' && mainHero(desc, 0) === '');
}

{
  // Removing someone who was NOT the main hero must not disturb the field.
  const desc = freshDesc();
  ownerGiven(desc, hero('item_A', 'PLAYER_1'));
  ownerGiven(desc, hero('item_B', 'PLAYER_1'));

  const r = objectRemoved(desc, hero('item_B', 'PLAYER_1'), [hero('item_A', 'PLAYER_1')]);
  check('removing a second hero leaves the main hero where it was',
    r.mainHero === 'kept' && mainHero(desc, 0) === mainHeroRef('item_A'));
}

{
  // Another player's objects are not this player's, however many there are.
  const desc = freshDesc();
  ownerGiven(desc, hero('item_A', 'PLAYER_1'));
  ownerGiven(desc, hero('item_Z', 'PLAYER_2'));

  const r = objectRemoved(desc, hero('item_A', 'PLAYER_1'), [hero('item_Z', 'PLAYER_2')]);
  check('somebody else\'s hero does not keep a player alive', r.deactivated && !isActive(desc, 0));
  check('and that somebody else is untouched', isActive(desc, 1) && mainHero(desc, 1) === mainHeroRef('item_Z'));
}

{
  // An unowned object leaving says nothing about any slot.
  const desc = freshDesc();
  ownerGiven(desc, hero('item_A', 'PLAYER_1'));
  const r = objectRemoved(desc, { id: 'item_X', type: 'AdvMapTreasure', player: null }, [hero('item_A', 'PLAYER_1')]);
  check('an object nobody owned changes no slot',
    !r.deactivated && r.mainHero === 'kept' && isActive(desc, 0));
}

// --- the reference is an href, never text ------------------------------------

{
  // The failure this guards: written as TEXT the field looks filled in here and
  // reads as blank to the game, and the map dies on load with "start player does
  // not exist". So the shape is asserted on the XML, not on the accessor.
  const desc = freshDesc();
  ownerGiven(desc, hero('item_A', 'PLAYER_1'));
  const slot = (desc.children.find((c): c is XmlElement => c.type === 'element' && c.name === 'players')
    ?.children.filter((c): c is XmlElement => c.type === 'element')[0]);
  const field = slot?.children.find((c): c is XmlElement => c.type === 'element' && c.name === 'MainHero');
  check('the main hero is an href attribute', field?.attrs.href === mainHeroRef('item_A'));
  check('and carries no text', (field?.children ?? []).length === 0);

  setMainHero(desc, 0, '');
  check('emptying it takes the attribute away, rather than blanking it',
    field !== undefined && field.attrs.href === undefined);
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
