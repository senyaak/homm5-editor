// A three-mission campaign that carries a hero, built end to end in the app.
//
// The point is the handover. Each mission is the same tiny fight — our hero
// against theirs with a Peasant — so the mission is winnable and the campaign
// moves on. Only the first mission gives him an Archangel; if the handover
// works, he walks onto missions 2 and 3 with whatever he survived with.
//
// Every mission places him. A map has to hold a hero for the player it starts,
// or the game refuses it with "Start player does not exist"; an EntryPoint does
// not stand in for one, and not one of the 93 maps in the shipped campaigns
// uses an EntryPoint at all — C1M2 simply places the Isabell it is about to
// receive. What travels is the CHARACTER, matched by the <InternalName> of his
// shared document, not by whatever the object on the map is called.
//
// Each map also gets a town of our own with a Tavern, and two EntryPoints. That
// part is an open question rather than a settled one: a HIRED hero has no
// placed copy waiting on the next map, so if an EntryPoint is where such a hero
// arrives, this is the setup that would show it.
//
// The one piece of setup that is deliberate rather than incidental: player 2 is
// switched ON. A fresh map ships one active player and the editor's default
// victory condition ("defeat all", won instantly) — with nobody live to defeat,
// that condition holds at load, the game wins the mission and drops the winning
// player, and the mission then fails to start at all.
//
// The result is left on disk for a human to play: the .h5c and the three .h5m
// go where the game reads them, so "does the hero actually travel" is one
// launch away.

import { test, expect } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { launchEditor, REPO_ROOT } from './launch.ts';
import type { Launched } from './launch.ts';
import { loadMap } from '../src/map.ts';
import { readEntries } from '../src/pak.ts';
import { find, childText } from '../src/xml.ts';

let ed: Launched;

const DATA = process.env.HOMM5_DATA || join(REPO_ROOT, 'data-unpacked');
/** The game folder holds this checkout — data-unpacked lives INSIDE it. */
const GAME = process.env.HOMM5_ROOT || join(REPO_ROOT, '..');
const CAMP = 'e2e Carry';
/** The hero who travels — his <Name> IS the handle the campaign hands on. */
const HERO = 'Traveller';
const MAPS = ['e2e Carry M1', 'e2e Carry M2', 'e2e Carry M3'];
const OUT_DIR = existsSync(join(GAME, 'UserCampaigns')) ? join(GAME, 'UserCampaigns') : join(REPO_ROOT, 'test-results');
const OUT = join(OUT_DIR, `${CAMP}.h5c`);

const mapDir = (name: string): string => join(DATA, 'Maps', 'SingleMissions', name);

function cleanup(): void {
  for (const m of MAPS) rmSync(mapDir(m), { recursive: true, force: true });
  rmSync(join(DATA, 'Campaigns', CAMP), { recursive: true, force: true });
}

test.beforeAll(async () => { cleanup(); ed = await launchEditor(); });
test.afterAll(async () => { await ed?.app.close(); });

test('a hero carried across three missions, and the campaign packed for play', async () => {
  test.skip(!existsSync(join(DATA, 'MapObjects')), 'needs the game data');
  test.setTimeout(600_000);
  const { page } = ed;
  /** The character our hero is — the same on every map, and what travels. */
  let carriedShared = '';
  /** And the name he travels under: his character's, read off the dropdown. */
  let carriedName = '';
  await ed.app.evaluate(({ dialog }, save) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: save })) as typeof dialog.showSaveDialog;
  }, OUT);

  // --- the three maps ---
  for (const [i, name] of MAPS.entries()) {
    await page.locator('#newmapbtn').click();
    await page.locator('#nm-name').fill(name);
    await page.locator('#nm-size').selectOption('72');
    await page.locator('#nm-ok').click();
    await expect(page.locator('#newmap')).toBeHidden({ timeout: 60_000 });
    await expect(page.locator('#title')).toContainText(name, { timeout: 90_000 });

    const built = await page.evaluate(async ({ first, hero }) => {
      const { objects } = await window.editor.listObjects();
      // Two DIFFERENT heroes: the catalogue's first two placeable ones. The
      // EntryPoint is a hero by shape, so keep it out of that pick.
      const pick = objects.filter((o) => o.type === 'AdvMapHero' && !o.hidden && !o.random
        && !/Utility\/EntryPoint/i.test(o.shared));
      const note: string[] = [];

      /** Place one and return its id, or '' when the map refuses it there. */
      const placeOf = async (type: string, shared: string, x: number, y: number): Promise<string> => {
        try {
          const r = await window.editor.addObject({ type, shared, x, y, floor: 0, r: 0 });
          return String((r.instance as { id?: string }).id ?? '');
        } catch (e) { note.push(`${shared} @${x},${y}: ${(e as Error).message}`); return ''; }
      };
      const place = (shared: string, x: number, y: number): Promise<string> => placeOf('AdvMapHero', shared, x, y);

      // Ours. Every mission places him — including the ones he ARRIVES on: a
      // map has to hold a hero for the player it starts, or it has no start
      // player at all and refuses to load. That is how the shipped campaigns do
      // it (C1M2 places Isabell again, unnamed, to receive her from C1M1); not
      // one of their 93 maps uses an EntryPoint for this.
      let mine = '', mineShared = '';
      for (const h of pick.slice(0, 8)) { mine = await place(h.shared, 10, 10); if (mine) { mineShared = h.shared; break; } }
      // Theirs, always: something to beat. A different hero, so the two sides
      // are telling apart on screen.
      let theirs = '', theirsShared = '';
      for (const h of pick.slice(0, 8)) {
        if (h.shared === mineShared) continue;
        theirs = await place(h.shared, 14, 10);
        if (theirs) { theirsShared = h.shared; break; }
      }

      const set = async (id: string, path: (string | number)[], value: string): Promise<void> => {
        if (id) await window.editor.setObjectPath({ id, path, value });
      };
      if (mine) {
        await set(mine, ['PlayerID'], 'PLAYER_1');
        // He carries the SAME name on every map. That name is the handle the
        // campaign hands on, and every mission of the shipped C1 names the same
        // one (HeroScriptName=Isabell throughout) — so a mission that receives
        // him has to know him by it too.
        await set(mine, ['Name'], hero);
        if (first) {
          // The army is only placed where he starts; afterwards he brings
          // whatever he survived the last mission with.
          await window.editor.addObjectItem({ id: mine, path: ['armySlots'] });
          await set(mine, ['armySlots', 0, 'Creature'], 'CREATURE_ARCHANGEL');
          await set(mine, ['armySlots', 0, 'Count'], '1');
        }
      }
      // Five Learning Stones beside him, so a mission ends with him visibly
      // levelled. An Obelisk would not do it — that one uncovers the puzzle
      // map; the Learning Stone is what grants experience. The level he shows
      // up with on the next mission is the proof the handover carried him and
      // not just a fresh copy of the same hero.
      const stone = objects.find((o) => /\/Learning_Stone\./i.test(o.shared));
      const stones: string[] = [];
      if (stone) {
        for (const [x, y] of [[6, 14], [9, 14], [12, 14], [6, 17], [9, 17], [12, 17], [15, 14], [15, 17]] as [number, number][]) {
          if (stones.length >= 5) break;
          const id = await placeOf('AdvMapBuilding', stone.shared, x, y);
          if (id) stones.push(id);
        }
      }

      // A town of our own, so heroes can be HIRED — and EntryPoints beside it.
      // Nothing in the shipped campaigns uses an EntryPoint, and the hero the
      // campaign hands on does not need one (he lands on his own placed copy),
      // so what these are for is still open: a hired hero has no copy waiting
      // on the next map, and an arrival point is the obvious candidate.
      const town = objects.find((o) => o.type === 'AdvMapTown' && /Heaven\.\(AdvMapTownShared\)/i.test(o.shared));
      let hall = '';
      if (town) {
        hall = await placeOf('AdvMapTown', town.shared, 22, 10);
        if (hall) {
          await window.editor.setObjectPath({ id: hall, path: ['PlayerID'], value: 'PLAYER_1' });
          // A fresh town is a Town Hall and nothing else, and heroes are hired
          // in a TAVERN — so without this there is no hiring to test.
          //
          // Listing a building is not building it: a new entry comes out
          // InitialUpgrade=BLD_UPG_NONE, which is "not there at the start".
          // BLD_UPG_1 with room to grow (max BLD_UPG_5) is what a shipped map
          // writes for a building that stands from turn one — 49 of the
          // campaigns' taverns look exactly like this.
          for (const b of ['TB_TAVERN', 'TB_FORT', 'TB_MARKETPLACE']) {
            await window.editor.addObjectItem({ id: hall, path: ['buildings'] });
            const at = (await window.editor.objectTree({ id: hall })) as { tree: { buildings?: unknown[] } };
            const last = (at.tree.buildings?.length ?? 1) - 1;
            await window.editor.setObjectPath({ id: hall, path: ['buildings', last, 'Type'], value: b });
            await window.editor.setObjectPath({ id: hall, path: ['buildings', last, 'InitialUpgrade'], value: 'BLD_UPG_1' });
            await window.editor.setObjectPath({ id: hall, path: ['buildings', last, 'MaxUpgrade'], value: 'BLD_UPG_5' });
          }
        }
      }
      const entry = objects.find((o) => /Utility\/EntryPoint/i.test(o.shared));
      const entries: string[] = [];
      if (entry) {
        for (const [x, y] of [[18, 6], [20, 6]] as [number, number][]) {
          const id = await placeOf('AdvMapHero', entry.shared, x, y);
          if (id) entries.push(id);
        }
      }

      if (theirs) {
        await set(theirs, ['Name'], 'Rival');
        await set(theirs, ['PlayerID'], 'PLAYER_2');
        await window.editor.addObjectItem({ id: theirs, path: ['armySlots'] });
        await set(theirs, ['armySlots', 0, 'Creature'], 'CREATURE_PEASANT');
        await set(theirs, ['armySlots', 0, 'Count'], '1');
      }

      // Two live, COLOURED players. A fresh map's eight slots are all inactive
      // and PCOLOR_NEUTRAL, so both have to be switched on: players[0] is
      // PLAYER_1 (the human) and players[1] is PLAYER_2, matching the heroes
      // placed above. A neutral or inactive slot is not a player the game can
      // start as — and with nobody live to defeat, the "defeat all" condition a
      // fresh map carries holds at load and the mission ends before it starts.
      // The colours and team are the ones a working scenario uses.
      for (const [slot, colour] of [[0, 'PCOLOR_ORANGE'], [1, 'PCOLOR_TEAL']] as [number, string][]) {
        await window.editor.setMapPath({ path: ['players', slot, 'ActivePlayer'], value: 'true' });
        await window.editor.setMapPath({ path: ['players', slot, 'Colour'], value: colour });
      }
      await window.editor.save();
      return { mine, theirs, mineShared, theirsShared, stones: stones.length, town: hall, entries: entries.length, note };
    }, { first: i === 0, hero: HERO });

    expect(built.theirs, `${name}: an opponent was placed — ${built.note.join('; ')}`).not.toBe('');
    expect(built.mine, `${name}: our side was placed — ${built.note.join('; ')}`).not.toBe('');
    expect(built.stones, `${name}: five Learning Stones — ${built.note.join('; ')}`).toBe(5);
    expect(built.town, `${name}: a town of our own to hire from — ${built.note.join('; ')}`).not.toBe('');
    expect(built.entries, `${name}: two arrival points — ${built.note.join('; ')}`).toBe(2);
    carriedShared ||= built.mineShared;
    expect(built.mineShared, `${name}: the same character as the other missions`).toBe(carriedShared);
    console.log(`${name}: ${HERO}${i === 0 ? ' + Archangel' : ' (arrives)'} vs Rival, ${built.stones} stones, town, ${built.entries} entry points`);
  }

  // --- what actually landed on disk ---
  for (const [i, name] of MAPS.entries()) {
    const map = loadMap(readFileSync(join(mapDir(name), 'map.xdb'), 'latin1'));
    const shaped = map.objects.filter((o) => o.type === 'AdvMapHero');
    const entry = shaped.filter((o) => /Utility\/EntryPoint/i.test(find(o.el, 'Shared')?.attrs.href ?? ''));
    const heroes = shaped.filter((o) => !entry.includes(o));
    // Two real heroes — ours and theirs. The EntryPoints are extra, and they do
    // NOT stand in for our hero: he is placed on every map he arrives on.
    expect(heroes.length, `${name} holds our hero and theirs`).toBe(2);
    expect(entry.length, `${name}: the arrival points are there too`).toBe(2);
    // The SAME character stands on every map — that is what the handover
    // matches on, not the object's own name.
    const ours = heroes.find((o) => childText(o.el, 'Name') === HERO);
    expect(ours, `${name}: our hero is there`).toBeTruthy();
    expect(find(ours!.el, 'Shared')?.attrs.href, `${name}: and he is the same character throughout`)
      .toBe(carriedShared);
    if (i === 0) expect(serializeArmy(ours!), 'and he starts with the Archangel').toContain('CREATURE_ARCHANGEL');
    // Both sides have to be live AND coloured: a neutral or inactive slot is
    // not a player the game can start as, whatever heroes point at it.
    const players = find(map.desc, 'players');
    const slots = players ? players.children.filter((c): c is typeof map.desc => c.type === 'element' && c.name === 'Item') : [];
    const live = slots
      .map((p, n) => ({ n, active: childText(p, 'ActivePlayer'), colour: childText(p, 'Colour') }))
      .filter((p) => p.active === 'true' && p.colour !== 'PCOLOR_NEUTRAL');
    expect(live.map((p) => p.n), `${name}: players 1 and 2 are live and coloured`).toEqual([0, 1]);
  }

  // --- the campaign, through the dialogs ---
  await page.locator('#campaignbtn').click();
  await page.locator('#cl-name').fill(CAMP);
  await page.locator('#cl-new').click();
  await expect(page.locator('#campaign')).toBeVisible();
  await page.locator('#cp-summary').fill('Carry one hero through three fights.');
  await page.locator('#cp-description').fill('Beat the rival; your hero and his Archangel travel on.');

  for (const [i, name] of MAPS.entries()) {
    await page.locator('#cp-add').click();
    await expect(page.locator('#mission')).toBeVisible();
    await page.locator('#ms-map').selectOption(`SingleMissions/${name}`);
    await page.locator('#ms-name').fill(`Fight ${i + 1}`);
    await page.locator('#ms-description').fill(`Defeat the rival on ${name}.`);
    // The first two missions hand the hero on; the last has nowhere to send him.
    if (i < 2) {
      await page.locator('#ms-hcount').fill('1');
      await page.locator('#ms-hcount').dispatchEvent('change');
      const who = page.locator('#ms-heroes select').first();
      await expect(who).toBeVisible();
      // The list offers "(default hero)" plus the CHARACTERS standing on this
      // map — the hero travels under his character's name, so take that rather
      // than assuming what it is called.
      const offered = await who.locator('option').count();
      expect(offered, `${name}: a hero to hand on`).toBeGreaterThan(1);
      await who.selectOption({ index: 1 });
      const picked = await who.inputValue();
      carriedName ||= picked;
      expect(picked, 'the same character travels the whole way').toBe(carriedName);
    }
    await page.locator('#ms-ok').click();
    await expect(page.locator('#mission')).toBeHidden();
  }
  await expect(page.locator('#cp-rows tr')).toHaveCount(3);

  await page.locator('#cp-pack').click();
  await expect.poll(() => existsSync(OUT), { timeout: 60_000 }).toBe(true);

  // --- the archive says what it should ---
  const xdb = readEntries(readFileSync(OUT)).find((e) => e.name.endsWith('campaign.xdb'))!.data.toString('latin1');
  for (const name of MAPS) {
    expect(xdb, `mission for ${name}`).toContain(`<MissionTag href="/Maps/SingleMissions/${name}/map-tag.xdb#xpointer(/AdvMapDescTag)"/>`);
  }
  // The pool names the CHARACTER (Isabell, Godric, …) — the shared document's
  // InternalName. A made-up name matches no character and travels nowhere.
  expect(carriedName, 'the dropdown offered a character, not a blank').not.toBe('');
  expect(xdb, 'the travelling character is named in the pool').toContain(`<HeroScriptName>${carriedName}</HeroScriptName>`);
  expect(xdb, 'and nothing else is').not.toContain(`<HeroScriptName>${HERO}</HeroScriptName>`);
  // Mission 1 hands to 2, mission 2 to 3 — 0-based, as the shipped campaigns do.
  expect([...xdb.matchAll(/<TargetMission>(\d+)<\/TargetMission>/g)].map((m) => m[1]), 'handovers point at the next mission')
    .toEqual(['1', '2']);

  // --- leave it playable ---
  //
  // The campaign carries no maps, so pack each one to its own .h5m beside the
  // game's other maps; the VFS is what brings the two together at load.
  await page.locator('#cp-close').click();
  await expect(page.locator('#campaign')).toBeHidden();
  const packed: string[] = [];
  for (const name of MAPS) {
    const to = join(GAME, 'Maps', `${name}.h5m`);
    mkdirSync(join(GAME, 'Maps'), { recursive: true });
    await ed.app.evaluate(({ dialog }, save) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: save })) as typeof dialog.showSaveDialog;
    }, to);
    await page.evaluate((p) => window.view.open(p), join(mapDir(name), 'map.xdb'));
    await expect(page.locator('#title')).toContainText(name, { timeout: 90_000 });
    await page.locator('#pack').click();
    await expect.poll(() => existsSync(to), { timeout: 60_000 }).toBe(true);
    packed.push(to);
  }
  console.log(`\nready to play:\n  ${OUT}\n  ${packed.join('\n  ')}`);
});

/** The creatures an object's army holds, as text. */
function serializeArmy(o: { el: import('../src/xml.ts').XmlElement }): string {
  const slots = find(o.el, 'armySlots');
  return slots ? JSON.stringify(slots.children.map((c) => (c.type === 'element' ? childText(c, 'Creature') : ''))) : '';
}
