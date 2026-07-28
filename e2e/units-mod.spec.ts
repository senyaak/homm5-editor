// Adding a new unit to the game, end to end through the window.
//
// The Units dialog is game-global: it builds a .h5u into UserMODs and patches
// the executable's creature ceiling. So the test hands the app its OWN game
// install — a temp folder holding a copy of the shipped executable and an empty
// UserMODs — via HOMM5_ROOT, and the real install is never touched. The data
// root stays the ordinary checkout tree; a mod build only reads it.
//
// The creature added is the Heroes 3 Sharpshooter, with exactly the numbers the
// shipped sod-creatures mod gives it (Maps/sod/packed/sod-creatures/units.json)
// — the known-good unit this reproduces through the UI instead of the CLI. The
// last test then proves the loop closes: a fresh map's monster offers the new
// creature in its picker, because the editor mounts what it just installed.

import { test, expect } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchEditor, REPO_ROOT } from './launch.ts';
import type { Launched } from './launch.ts';
import { newMap } from './tiles.ts';
import { openObjectPalette, pickObject, placeAtTile } from './objects.ts';
import { addItem, reveal, setTreeValue } from './tree.ts';
import { readCreatureMod } from '../src/creature-mod.ts';
import { patchExe, readExe } from '../src/creature-limit.ts';

let ed: Launched;

const DATA = process.env.HOMM5_DATA || join(REPO_ROOT, 'data-unpacked');
/** The app's game install for this run: ours alone, deletable whole. */
const GAME = join(REPO_ROOT, '_tmp', 'e2e-units-game');
/** The real install the checkout sits in — the source of a shipped executable. */
const REAL_GAME = join(REPO_ROOT, '..');
const MOD = 'e2e-units';
const MAP_NAME = 'e2e Units Map';
const MAP_DIR = join(DATA, 'Maps', 'SingleMissions', MAP_NAME);

/** What the form gets filled with — the sod-creatures Sharpshooter, verbatim. */
const SHARPSHOOTER = {
  id: 'CREATURE_H3_SHARPSHOOTER',
  file: 'H3Sharpshooter',
  name: 'Снайперы',
  description: 'Стрелки-наёмники, чьё мастерство не знает ни укрытий, ни расстояний.',
  abilitiesText: 'Стрелок, Без штрафа за дистанцию, Пробивающая стрела',
  abilityIds: 'ABILITY_NO_RANGE_PENALTY ABILITY_PIERCING_ARROW',
  donor: 'CREATURE_SHARP_SHOOTER',
  stats: {
    'um-attack': '12', 'um-defence': '10', 'um-mindmg': '8', 'um-maxdmg': '10',
    'um-health': '15', 'um-speed': '9', 'um-init': '12', 'um-shots': '32',
    'um-range': '-1', 'um-growth': '4', 'um-gold': '400', 'um-tier': '4',
    'um-exp': '82', 'um-power': '940', 'um-size': '1',
  } as Record<string, string>,
};

function cleanup(): void {
  for (const dir of [GAME, MAP_DIR]) {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
}

test.beforeAll(async () => {
  cleanup();
  mkdirSync(join(GAME, 'bin'), { recursive: true });
  mkdirSync(join(GAME, 'UserMODs'), { recursive: true });
  // The shipped H5_Game.exe is wrapped in Steam's DRM, so its code cannot be
  // read — the unwrapped copy is the real install's H5_Game_NCF.exe. Take that
  // one and put its ceiling back at the shipped 180, so this install starts as
  // a game no mod has ever touched.
  const real = readFileSync(join(REAL_GAME, 'bin', 'H5_Game_NCF.exe'));
  writeFileSync(join(GAME, 'bin', 'H5_Game_NCF.exe'), patchExe(real, 180).data);
  ed = await launchEditor({ HOMM5_ROOT: GAME });
});
test.afterAll(async () => { await ed?.app.close(); cleanup(); });

test('the Units dialog opens with no map and reports a clean install', async () => {
  const { page } = ed;
  await page.locator('#unitsbtn').click();
  await expect(page.locator('#unitsmod')).toBeVisible();
  await expect(page.locator('#um-list')).toContainText('none — the game holds its shipped creatures only');
  // The donor picker filled from the data root, with human labels.
  await expect(page.locator('#um-donor option[value="CREATURE_SHARP_SHOOTER"]')).toHaveCount(1, { timeout: 30_000 });
  const label = await page.locator('#um-donor option[value="CREATURE_SHARP_SHOOTER"]').textContent();
  expect(label).toContain('Лесные стрелки');
});

test('fills the form and installs the Sharpshooter', async () => {
  test.setTimeout(3 * 60_000);
  const { page } = ed;

  await page.locator('#um-stem').fill(MOD);
  await page.locator('#um-id').fill(SHARPSHOOTER.id);
  await page.locator('#um-file').fill(SHARPSHOOTER.file);
  await page.locator('#um-name').fill(SHARPSHOOTER.name);
  await page.locator('#um-desc').fill(SHARPSHOOTER.description);
  await page.locator('#um-abil').fill(SHARPSHOOTER.abilitiesText);
  await page.locator('#um-abids').fill(SHARPSHOOTER.abilityIds);
  await page.locator('#um-donor').selectOption(SHARPSHOOTER.donor);
  for (const [input, value] of Object.entries(SHARPSHOOTER.stats)) {
    await page.locator(`#${input}`).fill(value);
  }

  await page.locator('#um-ok').click();
  // Building copies the whole art closure (~45 files) and patches a 14 MB
  // executable; well under a minute, but not instant.
  await expect(page.locator('#um-note')).toContainText('installed', { timeout: 120_000 });
  await expect(page.locator('#um-note')).toContainText('ceiling 181');

  // The list refreshed to show what is now installed.
  await expect(page.locator('#um-list')).toContainText(`${MOD}.h5u`);
  await expect(page.locator('#um-list')).toContainText('ceiling 181');
  await expect(page.locator('#um-list')).toContainText('180 Снайперы');

  // On disk: the archive reads back as the creature we described...
  const found = readCreatureMod(join(GAME, 'UserMODs', `${MOD}.h5u`));
  expect(found).not.toBeNull();
  expect(found!.reconstructed).toBeUndefined();
  const c = found!.mod.creatures[0]!;
  expect(c.id).toBe(SHARPSHOOTER.id);
  expect(c.number).toBe(180);
  expect(c.stats.attack).toBe(12);
  expect(c.stats.shots).toBe(32);
  expect(c.stats.range).toBe(-1);
  expect(c.stats.abilities).toEqual(['ABILITY_NO_RANGE_PENALTY', 'ABILITY_PIERCING_ARROW']);
  expect(c.visualSource).toContain('SharpShooter.(CreatureVisual)');
  expect(c.monsterSource).toContain('Sharpshooter.(AdvMapMonsterShared)');

  // ...and the executable's ceiling agrees with it exactly.
  const exe = readExe(readFileSync(join(GAME, 'bin', 'H5_Game_NCF.exe')));
  expect(exe.limit).toBe(181);
  expect(exe.problems).toEqual([]);

  await page.locator('#um-cancel').click();
  await expect(page.locator('#unitsmod')).toBeHidden();
});

test('a fresh map offers the new creature in the army picker', async () => {
  test.setTimeout(3 * 60_000);
  const { page } = ed;

  await newMap(page, MAP_NAME, '72');
  await openObjectPalette(page);
  const shared = await page.evaluate(async () => {
    const { objects } = await window.editor.listObjects();
    return objects.find((o) => o.type === 'AdvMapGarrison')?.shared ?? '';
  });
  expect(shared, 'a garrison entry exists').not.toBe('');
  await pickObject(page, shared);
  await placeAtTile(page, 10, 10);
  await page.evaluate(() => { const o = window.view.objects()[0]; if (o) window.view.select(o.id); });

  // Army stacks live behind the panel's structured Army row — Edit opens the
  // object's tree on it.
  const army = page.locator('#p-props .pf', { has: page.locator('label', { hasText: /^Army$/ }) });
  await army.locator('button.struct-edit').click();
  await expect(page.locator('#mt-dialog')).toBeVisible();

  // Add a stack and pick our creature. The dropdown is the army picker: its
  // roster is built over the mounted chain, so the creature the previous test
  // installed is one of its options — under the name the mod gave it.
  await addItem(page, ['armySlots']);
  await setTreeValue(page, ['armySlots', 0, 'Creature'], SHARPSHOOTER.id);
  await setTreeValue(page, ['armySlots', 0, 'Count'], '12');
  const row = await reveal(page, ['armySlots', 0, 'Creature']);
  await expect(row.locator('select')).toHaveValue(SHARPSHOOTER.id);
  const label = await row.locator('select option:checked').textContent();
  expect(label).toContain('Снайперы');
});
