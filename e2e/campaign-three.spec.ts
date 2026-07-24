// A three-mission campaign that carries a hero, built end to end in the app.
//
// The point is the handover. Each mission is the same tiny fight — our hero
// with an Archangel against theirs with a Peasant — so the mission is winnable
// and the campaign moves on. Missions 2 and 3 have NO hero of ours: where he
// would stand there is an EntryPoint, the utility object that marks where a
// transported hero arrives. If the handover works, the same hero (and whatever
// he picked up) shows up there.
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

    const built = await page.evaluate(async ({ ours, hero, entryPoint }) => {
      const { objects } = await window.editor.listObjects();
      const heroes = objects.filter((o) => o.type === 'AdvMapHero' && !o.hidden && !o.random);
      // The EntryPoint is a hero by shape; find it by path, not by name.
      const entry = objects.find((o) => /Utility\/EntryPoint/i.test(o.shared));
      const pick = heroes.filter((o) => !/EntryPoint/i.test(o.shared));
      const note: string[] = [];

      /** Place one and return its id, or '' when the catalogue refuses it. */
      const place = async (shared: string, x: number, y: number): Promise<string> => {
        try {
          const r = await window.editor.addObject({ type: 'AdvMapHero', shared, x, y, floor: 0, r: 0 });
          return String((r.instance as { id?: string }).id ?? '');
        } catch (e) { note.push(`${shared}: ${(e as Error).message}`); return ''; }
      };

      // Ours (mission 1) or the arrival point (missions 2 and 3).
      let mine = '';
      if (ours) {
        for (const h of pick.slice(0, 8)) { mine = await place(h.shared, 10, 10); if (mine) break; }
      } else if (entry) {
        mine = await place(entry.shared, 10, 10);
      }
      // Theirs, always: something to beat.
      let theirs = '';
      for (const h of pick.slice(0, 8)) { theirs = await place(h.shared, 14, 10); if (theirs) break; }

      const set = async (id: string, path: (string | number)[], value: string): Promise<void> => {
        if (id) await window.editor.setObjectPath({ id, path, value });
      };
      if (ours && mine) {
        // The name is the campaign's handle on him; the army is what he carries.
        await set(mine, ['Name'], hero);
        await set(mine, ['PlayerID'], 'PLAYER_1');
        await window.editor.addObjectItem({ id: mine, path: ['armySlots'] });
        await set(mine, ['armySlots', 0, 'Creature'], 'CREATURE_ARCHANGEL');
        await set(mine, ['armySlots', 0, 'Count'], '1');
      } else if (mine) {
        await set(mine, ['PlayerID'], 'PLAYER_1');
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
      return { mine, theirs, entryPoint: !!entry && !ours, note };
    }, { ours: i === 0, hero: HERO, entryPoint: i > 0 });

    expect(built.theirs, `${name}: an opponent was placed — ${built.note.join('; ')}`).not.toBe('');
    expect(built.mine, `${name}: our side was placed — ${built.note.join('; ')}`).not.toBe('');
    console.log(`${name}: ${i === 0 ? `${HERO} + Rival` : `EntryPoint + Rival`}`);
  }

  // --- what actually landed on disk ---
  for (const [i, name] of MAPS.entries()) {
    const map = loadMap(readFileSync(join(mapDir(name), 'map.xdb'), 'latin1'));
    const heroes = map.objects.filter((o) => o.type === 'AdvMapHero');
    expect(heroes.length, `${name} holds two hero-shaped objects`).toBe(2);
    const entry = heroes.filter((o) => /Utility\/EntryPoint/i.test(find(o.el, 'Shared')?.attrs.href ?? ''));
    expect(entry.length, `${name}: an EntryPoint only where a hero arrives`).toBe(i === 0 ? 0 : 1);
    if (i === 0) {
      const ours = heroes.find((o) => childText(o.el, 'Name') === HERO);
      expect(ours, 'the travelling hero is named, or nothing can hand him on').toBeTruthy();
      expect(serializeArmy(ours!), 'and he carries the Archangel').toContain('CREATURE_ARCHANGEL');
    }
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
      // Only mission 1 has a named hero to offer; 2 relays whoever arrived.
      const who = page.locator('#ms-heroes select').first();
      await expect(who).toBeVisible();
      if (i === 0) await who.selectOption(HERO);
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
  expect(xdb, 'the travelling hero is named in the pool').toContain(`<HeroScriptName>${HERO}</HeroScriptName>`);
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
