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
import { settled } from './trace.ts';
import type { Launched } from './launch.ts';
import { newMap } from './tiles.ts';
import { openObjectPalette, pickObject, placeAtTile } from './objects.ts';
import { addItem, reveal, setTreeValue } from './tree.ts';
import { DATA } from './launch.ts';
import { MOD, SHARPSHOOTER, clearMap, modGameRoot, readInstalledMod } from './mods.ts';
import { readExe } from '../src/exe/creature-limit.ts';
import { modFile } from '../src/game/mod-paths.ts';

let ed: Launched;

const GAME = modGameRoot();
const MAP_NAME = 'e2e Units Map';
const MAP_DIR = join(DATA, 'Maps', 'SingleMissions', MAP_NAME);

test.beforeAll(async () => {
  // The map this spec builds, gone before it starts: live, the last run left it
  // packed in the game and New Map will not write over a map that exists.
  clearMap(GAME, DATA, MAP_NAME);
  ed = await launchEditor({ HOMM5_ROOT: GAME });
});
test.afterAll(async () => {
  await ed?.app.close();
  if (existsSync(MAP_DIR)) rmSync(MAP_DIR, { recursive: true, force: true });
});

/** Open Units… and load the donor — the state the next test needs. */
async function openWithDonor(page: Launched['page']): Promise<void> {
  if (!(await page.locator('#unitsmod').isVisible())) await page.locator('#unitsbtn').click();
  if (!(await page.locator('#unitedit').isVisible())) await page.locator('#um-new').click();
  // Through the button, as a person does it: the preset is an action, and the
  // form shows which one was used rather than holding it as a field.
  await page.locator('#um-donor-pick').click();
  await expect(page.locator('#presetpick')).toBeVisible();
  await page.locator('#pp-search').fill('Лесные стрелки');
  await page.locator('#pp-list button').first().click();
  await expect(page.locator('#presetpick')).toBeHidden();
  await expect(page.locator('#um-shots')).toHaveValue('16'); // the preset settled
}

test('the dialog opens clean, and the donor loads as a preset', async () => {
  const { page } = ed;
  await page.locator('#unitsbtn').click();
  await expect(page.locator('#unitsmod')).toBeVisible();
  // No creature of ours is listed — which reads two ways and both are the same
  // fact: a throwaway install has no archive at all, while a live run works in a
  // game whose archive is still there carrying dwellings.
  await expect(page.locator('#um-list'))
    .toContainText(/none — the game holds its shipped creatures only|0 creature\(s\)/);

  // Picking the donor loads its EVERY field: texts, stats, abilities, art.
  await openWithDonor(page);
  await expect(page.locator('#um-name')).toHaveValue('Лесные стрелки');
  await expect(page.locator('#um-shots')).toHaveValue('16');
  await expect(page.locator('#um-town')).toHaveValue('TOWN_PRESERVE');
  // The donor's abilities arrive as ROWS, one each, named the way a player
  // reads them — and the line the hire dialog will print is shown as it is
  // decided, instead of being typed into a box beside them.
  await expect(page.locator('#um-abilities .um-ability-id')).toHaveCount(2);
  await expect(page.locator('#um-abilities .um-ability-id').first()).toHaveValue(/ABILITY_/);
  await expect(page.locator('#um-abil-preview')).toContainText('Hire dialog will print:');
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
  // Its third ability, added as a row. Nothing is typed about it: the printed
  // line follows what the creature has.
  await page.locator('#um-ability-add').click();
  await page.locator('#um-abilities .um-ability-id').last().selectOption('ABILITY_NO_MELEE_PENALTY');
  for (const [input, value] of Object.entries(SHARPSHOOTER.stats)) {
    await page.locator(`#${input}`).fill(value);
  }
  // The port's unit is a neutral; the donor's home town is not wanted.
  await page.locator('#um-town').selectOption('TOWN_NO_TYPE');

  await page.locator('#um-ok').click();
  await expect(page.locator('#um-note')).toContainText('installed', { timeout: 120_000 });
  await expect(page.locator('#um-note')).toContainText('ceiling 181');
  await expect(page.locator('#um-list')).toContainText(`${MOD}.h5u`);
  // The row itself, not the list's running text: number and name are separate
  // elements with nothing between them, so `180 Снайперы` never appears
  // anywhere — and matching the whole list would find "180" inside "ceiling 181".
  const row = page.locator('#um-list .um-item', { hasText: SHARPSHOOTER.name });
  await expect(row).toHaveCount(1);
  await expect(row.locator('.num')).toHaveText('180');
  await expect(row).toContainText(SHARPSHOOTER.id);

  // On disk: the archive reads back as the creature we described...
  const mod = readInstalledMod(GAME);
  const c = mod.creatures[0]!;
  expect(c.id).toBe(SHARPSHOOTER.id);
  expect(c.number).toBe(180);
  expect(c.stats.attack).toBe(12);
  expect(c.stats.shots).toBe(32);
  expect(c.stats.range).toBe(-1);
  expect(c.stats.town).toBe('TOWN_NO_TYPE');
  // The donor's two abilities, plus the one added as a row.
  expect([...c.stats.abilities].sort())
    .toEqual(['ABILITY_NO_MELEE_PENALTY', 'ABILITY_NO_RANGE_PENALTY', 'ABILITY_PIERCING_ARROW']);
  expect(c.visualSource).toContain('SharpShooter.(CreatureVisual)');
  expect(c.monsterSource).toContain('Sharpshooter.(AdvMapMonsterShared)');
  // And the art slots resolved to the donor's documents — the preset's copies.
  expect(c.from.icon).toContain('Sharpshooter.(Texture)');
  expect(c.from.character).toContain('T3_Elf_Sniper');

  // ...and the executable's ceiling agrees with it exactly.
  const exe = readExe(readFileSync(join(GAME, 'bin', 'H5_Game_H5E.exe')));
  expect(exe.limit).toBe(181);
  expect(exe.problems).toEqual([]);

  // A build closes the form and leaves the list, with what it did on it.
  await expect(page.locator('#unitedit')).toBeHidden();
  await page.locator('#um-cancel').click();
  await expect(page.locator('#unitsmod')).toBeHidden();
});

test('an installed creature opens for editing, whole', async () => {
  const { page } = ed;
  if (!(await page.locator('#unitsmod').isVisible())) await page.locator('#unitsbtn').click();
  const row = page.locator('#um-list .um-item', { hasText: SHARPSHOOTER.name }).first();
  await expect(row).toBeVisible();
  await row.locator('button', { hasText: '✎' }).click();
  await expect(page.locator('#unitedit')).toBeVisible();
  await expect(page.locator('#unitedit-title')).toHaveText(/Editing/);

  // Whole. Everything below was blank when the list sent a summary, and saving
  // wrote the blanks back — which is how a creature loses its description by
  // having its price corrected.
  await expect(page.locator('#um-id')).toHaveValue(SHARPSHOOTER.id);
  await expect(page.locator('#um-name')).toHaveValue(SHARPSHOOTER.name);
  await expect(page.locator('#um-desc')).toHaveValue(SHARPSHOOTER.description);
  await expect(page.locator('#um-attack')).toHaveValue('12');
  await expect(page.locator('#um-shots')).toHaveValue('32');
  await expect(page.locator('#um-town')).toHaveValue('TOWN_NO_TYPE');
  await expect(page.locator('#um-abilities .um-ability-id')).toHaveCount(3);
  await expect(page.locator('#um-art-icon')).toHaveValue(/Sharpshooter/);

  // Change one number and save: the rest must survive the round trip.
  await page.locator('#um-gold').fill('450');
  // settled(), never a bare wait-for-text: the note still holds the last
  // message, and the form reports a refusal in a different box entirely — so a
  // plain wait either reads the old note or sits out its timeout while the
  // answer is on screen. Twice now.
  const note = await settled(page, 'saving the creature', '#um-note', '#ue-err',
    () => page.locator('#um-ok').click());
  expect(note).toMatch(/installed|updated/i);

  const c = readInstalledMod(GAME).creatures[0]!;
  expect(c.stats.gold).toBe(450);
  expect(c.description, 'the words a summary would have lost').toBe(SHARPSHOOTER.description);
  expect([...c.stats.abilities].sort())
    .toEqual(['ABILITY_NO_MELEE_PENALTY', 'ABILITY_NO_RANGE_PENALTY', 'ABILITY_PIERCING_ARROW']);

  // Put the window back the way it was found: these are modal dialogs, and the
  // next test clicks a button that is underneath them.
  await page.locator('#um-cancel').click();
  await expect(page.locator('#unitsmod')).toBeHidden();
});

test('a fresh map offers the new creature in the army picker', async () => {
  test.setTimeout(3 * 60_000);
  const { page } = ed;

  // Self-sufficient: the creature is installed here if this test is run alone.
  if (!existsSync(modFile(GAME, 'mod', MOD))) {
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
