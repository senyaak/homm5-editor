// Adding a creature to the game through the window, end to end.
//
// Runs alone: its own game install (a copy of the unwrapped executable with the
// ceilings reset, an empty UserMODs) via HOMM5_ROOT, so the real install is
// never touched — see e2e/mods.ts.
//
// The form works from a PRESET: picking a donor loads its every field, and what
// is authored is the difference. What gets built is the SoD port's Sharpshooter,
// exactly as its shipped mod defines it, which is the known-good thing to
// reproduce. The last test closes the loop: a fresh map's garrison offers the
// creature that was just installed.

import { test, expect } from '@playwright/test';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { launchEditor, REPO_ROOT } from './launch.ts';
import type { Launched } from './launch.ts';
import { newMap } from './tiles.ts';
import { openObjectPalette, pickObject, placeAtTile } from './objects.ts';
import { addItem, reveal, setTreeValue } from './tree.ts';
import { DATA, MOD, SHARPSHOOTER, prepareGameRoot, readInstalledMod, removeGameRoot } from './mods.ts';
import { readExe } from '../src/creature-limit.ts';

let ed: Launched;

const GAME = join(REPO_ROOT, '_tmp', 'e2e-units-game');
const MAP_NAME = 'e2e Units Map';
const MAP_DIR = join(DATA, 'Maps', 'SingleMissions', MAP_NAME);

test.beforeAll(async () => {
  prepareGameRoot(GAME);
  if (existsSync(MAP_DIR)) rmSync(MAP_DIR, { recursive: true, force: true });
  ed = await launchEditor({ HOMM5_ROOT: GAME });
});
test.afterAll(async () => {
  await ed?.app.close();
  removeGameRoot(GAME);
  if (existsSync(MAP_DIR)) rmSync(MAP_DIR, { recursive: true, force: true });
});

/** Open Units… and load the donor — the state the next test needs. */
async function openWithDonor(page: Launched['page']): Promise<void> {
  if (!(await page.locator('#unitsmod').isVisible())) await page.locator('#unitsbtn').click();
  await expect(page.locator('#um-donor option[value="CREATURE_SHARP_SHOOTER"]')).toHaveCount(1, { timeout: 30_000 });
  await page.locator('#um-donor').selectOption(SHARPSHOOTER.donor);
  await expect(page.locator('#um-attack')).toHaveValue('6'); // the preset settled
}

test('the dialog opens clean, and the donor loads as a preset', async () => {
  const { page } = ed;
  await page.locator('#unitsbtn').click();
  await expect(page.locator('#unitsmod')).toBeVisible();
  await expect(page.locator('#um-list')).toContainText('none — the game holds its shipped creatures only');

  // Picking the donor loads its EVERY field: texts, stats, abilities, art.
  await openWithDonor(page);
  await expect(page.locator('#um-name')).toHaveValue('Лесные стрелки');
  await expect(page.locator('#um-shots')).toHaveValue('16');
  await expect(page.locator('#um-town')).toHaveValue('TOWN_PRESERVE');
  await expect(page.locator('#um-abids option:checked')).toHaveCount(2);
  await expect(page.locator('#um-abids option[value="ABILITY_NO_RANGE_PENALTY"]')).toHaveJSProperty('selected', true);
  await expect(page.locator('#um-art-icon')).toHaveValue(/Sharpshooter\.\(Texture\)\.xdb/);
  await expect(page.locator('#um-art-character')).toHaveValue(/T3_Elf_Sniper\.\(Character\)\.xdb/);
});

test('edits the difference and installs the creature', async () => {
  test.setTimeout(3 * 60_000);
  const { page } = ed;
  await openWithDonor(page);

  // The file stem spells the ID by itself.
  await page.locator('#um-file').fill(SHARPSHOOTER.file);
  await expect(page.locator('#um-id')).toHaveValue(SHARPSHOOTER.id);

  await page.locator('#um-name').fill(SHARPSHOOTER.name);
  await page.locator('#um-desc').fill(SHARPSHOOTER.description);
  await page.locator('#um-abil').fill(SHARPSHOOTER.abilitiesText);
  for (const [input, value] of Object.entries(SHARPSHOOTER.stats)) {
    await page.locator(`#${input}`).fill(value);
  }
  // The port's unit is a neutral; the donor's home town is not wanted.
  await page.locator('#um-town').selectOption('TOWN_NO_TYPE');

  await page.locator('#um-ok').click();
  await expect(page.locator('#um-note')).toContainText('installed', { timeout: 120_000 });
  await expect(page.locator('#um-note')).toContainText('ceiling 181');
  await expect(page.locator('#um-list')).toContainText(`${MOD}.h5u`);
  await expect(page.locator('#um-list')).toContainText('180 Снайперы');

  // On disk: the archive reads back as the creature we described...
  const mod = readInstalledMod(GAME);
  const c = mod.creatures[0]!;
  expect(c.id).toBe(SHARPSHOOTER.id);
  expect(c.number).toBe(180);
  expect(c.stats.attack).toBe(12);
  expect(c.stats.shots).toBe(32);
  expect(c.stats.range).toBe(-1);
  expect(c.stats.town).toBe('TOWN_NO_TYPE');
  // The abilities came from the donor's preset, untouched.
  expect([...c.stats.abilities].sort()).toEqual(['ABILITY_NO_RANGE_PENALTY', 'ABILITY_PIERCING_ARROW']);
  expect(c.visualSource).toContain('SharpShooter.(CreatureVisual)');
  expect(c.monsterSource).toContain('Sharpshooter.(AdvMapMonsterShared)');
  // And the art slots resolved to the donor's documents — the preset's copies.
  expect(c.from.icon).toContain('Sharpshooter.(Texture)');
  expect(c.from.character).toContain('T3_Elf_Sniper');

  // ...and the executable's ceiling agrees with it exactly.
  const exe = readExe(readFileSync(join(GAME, 'bin', 'H5_Game_H5E.exe')));
  expect(exe.limit).toBe(181);
  expect(exe.problems).toEqual([]);

  await page.locator('#um-cancel').click();
  await expect(page.locator('#unitsmod')).toBeHidden();
});

test('a fresh map offers the new creature in the army picker', async () => {
  test.setTimeout(3 * 60_000);
  const { page } = ed;

  // Self-sufficient: the creature is installed here if this test is run alone.
  if (!existsSync(join(GAME, 'UserMODs', `${MOD}.h5u`))) {
    const { installCreatureHeadless } = await import('./mods.ts');
    installCreatureHeadless(GAME);
  }

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

  // The dropdown is the army picker: its roster is built over the mounted
  // chain, so the creature just installed is one of its options — under the
  // name the mod gave it.
  await addItem(page, ['armySlots']);
  await setTreeValue(page, ['armySlots', 0, 'Creature'], SHARPSHOOTER.id);
  await setTreeValue(page, ['armySlots', 0, 'Count'], '12');
  const row = await reveal(page, ['armySlots', 0, 'Creature']);
  await expect(row.locator('select')).toHaveValue(SHARPSHOOTER.id);
  expect(await row.locator('select option:checked').textContent()).toContain('Снайперы');
});
