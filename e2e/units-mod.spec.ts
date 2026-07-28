// Adding a new unit — and a new artifact — to the game, end to end through the
// window.
//
// The Units and Artifacts dialogs are game-global: they build a .h5u into
// UserMODs and patch the executable's ceilings. So the test hands the app its
// OWN game install — a temp folder holding a copy of the shipped executable and
// an empty UserMODs — via HOMM5_ROOT, and the real install is never touched.
// The data root stays the ordinary checkout tree; a mod build only reads it.
//
// The forms work from PRESETS: picking a donor loads its every field (stats,
// texts, abilities, the art documents), and the person edits the difference.
// The mod is always OURS — there is no field for choosing an archive.
//
// What gets added reproduces the SoD port's Sharpshooter and its Undertaker's
// Amulet, exactly as the shipped sod-creatures/sod-artifacts mods define them
// (Maps/sod/packed/*/units.json) — the known-good things this suite rebuilds
// through the UI instead of the CLI. The last test proves the loop closes: a
// fresh map's garrison offers the new creature in its army picker.

import { test, expect } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchEditor, REPO_ROOT } from './launch.ts';
import type { Launched } from './launch.ts';
import { newMap } from './tiles.ts';
import { openObjectPalette, pickObject, placeAtTile } from './objects.ts';
import { addItem, reveal, setTreeValue } from './tree.ts';
import { readCreatureMod } from '../src/creature-mod.ts';
import { readEntries } from '../src/pak.ts';
import { decodeDDSBuffer } from '../src/dds.ts';
import { patchExe, readExe } from '../src/creature-limit.ts';
import { ORIGINAL_ARTIFACTS, patchArtifactLimit, readArtifactLimit, SITES_FILE } from '../src/artifact-limit.ts';
import type { Site } from '../src/artifact-limit.ts';

let ed: Launched;

const DATA = process.env.HOMM5_DATA || join(REPO_ROOT, 'data-unpacked');
/** The app's game install for this run: ours alone, deletable whole. */
const GAME = join(REPO_ROOT, '_tmp', 'e2e-units-game');
/** The real install the checkout sits in — the source of a shipped executable. */
const REAL_GAME = join(REPO_ROOT, '..');
/** The archive the dialogs create: always OUR mod, never a choice. */
const MOD = 'homm5-units';
const MAP_NAME = 'e2e Units Map';
const MAP_DIR = join(DATA, 'Maps', 'SingleMissions', MAP_NAME);

/** What the form gets edited to — the sod-creatures Sharpshooter, verbatim.
 *  The rest of the fields come from the donor's preset and stay. */
const SHARPSHOOTER = {
  file: 'H3Sharpshooter',
  id: 'CREATURE_H3_SHARPSHOOTER', // fills itself from the file stem
  name: 'Снайперы',
  description: 'Стрелки-наёмники, чьё мастерство не знает ни укрытий, ни расстояний.',
  abilitiesText: 'Стрелок, Без штрафа за дистанцию, Пробивающая стрела',
  donor: 'CREATURE_SHARP_SHOOTER',
  stats: {
    'um-attack': '12', 'um-defence': '10', 'um-mindmg': '8', 'um-maxdmg': '10',
    'um-health': '15', 'um-speed': '9', 'um-init': '12', 'um-shots': '32',
    'um-range': '-1', 'um-growth': '4', 'um-gold': '400', 'um-tier': '4',
    'um-exp': '82', 'um-power': '940', 'um-size': '1',
  } as Record<string, string>,
};

/** And the sod-artifacts amulet, built on a shipped neck-piece's preset. */
const AMULET = {
  file: 'H3UndertakersAmulet',
  id: 'ARTIFACT_H3_UNDERTAKERS_AMULET',
  name: 'Амулет гробовщика',
  description: 'Увеличивает мастерство некромантии своего владельца.',
  donor: 'ARTIFACT_NECROMANCER_PENDANT',
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
  // one and put BOTH ceilings back at their shipped values, so this install
  // starts as a game no mod has ever touched. The artifact sites cannot be
  // re-found by search once the value is a round 100 (the accessor bytes stop
  // being unique), so the sites note beside the real executable rides along —
  // for the reset here, and for the install the test performs.
  const real = readFileSync(join(REAL_GAME, 'bin', 'H5_Game_NCF.exe'));
  const noted = JSON.parse(readFileSync(join(REAL_GAME, SITES_FILE), 'utf8')) as Site[];
  const exe = patchArtifactLimit(patchExe(real, 180).data, ORIGINAL_ARTIFACTS, noted).data;
  writeFileSync(join(GAME, 'bin', 'H5_Game_NCF.exe'), exe);
  writeFileSync(join(GAME, SITES_FILE), `${JSON.stringify(noted, null, 2)}\n`);
  ed = await launchEditor({ HOMM5_ROOT: GAME });
});
test.afterAll(async () => { await ed?.app.close(); cleanup(); });

test('the Units dialog opens clean, and the donor loads as a preset', async () => {
  const { page } = ed;
  await page.locator('#unitsbtn').click();
  await expect(page.locator('#unitsmod')).toBeVisible();
  await expect(page.locator('#um-list')).toContainText('none — the game holds its shipped creatures only');

  // Picking the donor loads its EVERY field: texts, stats, abilities, art.
  await expect(page.locator('#um-donor option[value="CREATURE_SHARP_SHOOTER"]')).toHaveCount(1, { timeout: 30_000 });
  await page.locator('#um-donor').selectOption(SHARPSHOOTER.donor);
  await expect(page.locator('#um-name')).toHaveValue('Лесные стрелки');
  await expect(page.locator('#um-attack')).toHaveValue('6');
  await expect(page.locator('#um-shots')).toHaveValue('16');
  await expect(page.locator('#um-town')).toHaveValue('TOWN_PRESERVE');
  const abids = page.locator('#um-abids option:checked');
  await expect(abids).toHaveCount(2);
  await expect(page.locator('#um-abids option[value="ABILITY_NO_RANGE_PENALTY"]')).toHaveJSProperty('selected', true);
  await expect(page.locator('#um-art-icon')).toHaveValue(/Sharpshooter\.\(Texture\)\.xdb/);
  await expect(page.locator('#um-art-character')).toHaveValue(/T3_Elf_Sniper\.\(Character\)\.xdb/);
});

test('edits the difference and installs the Sharpshooter', async () => {
  test.setTimeout(3 * 60_000);
  const { page } = ed;

  // Self-sufficient: a worker restart after an earlier failure relaunches the
  // app, so the dialog and the donor are ensured rather than assumed.
  if (!(await page.locator('#unitsmod').isVisible())) {
    await page.locator('#unitsbtn').click();
    await expect(page.locator('#um-donor option[value="CREATURE_SHARP_SHOOTER"]')).toHaveCount(1, { timeout: 30_000 });
  }
  await page.locator('#um-donor').selectOption(SHARPSHOOTER.donor);
  await expect(page.locator('#um-attack')).toHaveValue('6'); // the preset settled

  // The file stem spells the ID by itself.
  await page.locator('#um-file').fill(SHARPSHOOTER.file);
  await expect(page.locator('#um-id')).toHaveValue(SHARPSHOOTER.id);

  await page.locator('#um-name').fill(SHARPSHOOTER.name);
  await page.locator('#um-desc').fill(SHARPSHOOTER.description);
  await page.locator('#um-abil').fill(SHARPSHOOTER.abilitiesText);
  for (const [input, value] of Object.entries(SHARPSHOOTER.stats)) {
    await page.locator(`#${input}`).fill(value);
  }
  // The sod unit is a neutral; the donor's home town is not wanted.
  await page.locator('#um-town').selectOption('TOWN_NO_TYPE');

  await page.locator('#um-ok').click();
  await expect(page.locator('#um-note')).toContainText('installed', { timeout: 120_000 });
  await expect(page.locator('#um-note')).toContainText('ceiling 181');
  await expect(page.locator('#um-list')).toContainText(`${MOD}.h5u`);
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
  expect(c.stats.town).toBe('TOWN_NO_TYPE');
  // The abilities came from the donor's preset, untouched.
  expect([...c.stats.abilities].sort()).toEqual(['ABILITY_NO_RANGE_PENALTY', 'ABILITY_PIERCING_ARROW']);
  expect(c.visualSource).toContain('SharpShooter.(CreatureVisual)');
  expect(c.monsterSource).toContain('Sharpshooter.(AdvMapMonsterShared)');
  // And the art slots resolved to the donor's documents — the preset's copies.
  expect(c.from.icon).toContain('Sharpshooter.(Texture)');
  expect(c.from.character).toContain('T3_Elf_Sniper');

  // ...and the executable's ceiling agrees with it exactly.
  const exe = readExe(readFileSync(join(GAME, 'bin', 'H5_Game_NCF.exe')));
  expect(exe.limit).toBe(181);
  expect(exe.problems).toEqual([]);

  await page.locator('#um-cancel').click();
  await expect(page.locator('#unitsmod')).toBeHidden();
});

test('the Artifacts dialog builds the amulet into the same mod', async () => {
  test.setTimeout(3 * 60_000);
  const { page } = ed;

  await page.locator('#artsbtn').click();
  await expect(page.locator('#artsmod')).toBeVisible();

  // The donor's preset fills the form: slot, rank, prices, stats, icon.
  await expect(page.locator(`#am-donor option[value="${AMULET.donor}"]`)).toHaveCount(1, { timeout: 30_000 });
  await page.locator('#am-donor').selectOption(AMULET.donor);
  await expect(page.locator('#am-slot')).toHaveValue('NECK');
  await expect(page.locator('#am-cost')).toHaveValue('7000');
  await expect(page.locator('#am-icon')).toHaveValue(/Necromancer_Pendant/);

  await page.locator('#am-file').fill(AMULET.file);
  await expect(page.locator('#am-id')).toHaveValue(AMULET.id);
  await page.locator('#am-name').fill(AMULET.name);
  await page.locator('#am-desc').fill(AMULET.description);
  // The sod amulet is a cheaper minor piece that moves Knowledge.
  await page.locator('#am-rank').selectOption('ARTF_CLASS_MINOR');
  await page.locator('#am-cost').fill('5000');
  await page.locator('#am-ai').fill('700');
  await page.locator('#am-knowledge').fill('2');

  await page.locator('#am-ok').click();
  await expect(page.locator('#am-note')).toContainText('installed', { timeout: 120_000 });
  await expect(page.locator('#am-note')).toContainText('ceiling 98');
  await expect(page.locator('#am-list')).toContainText('Амулет гробовщика (NECK)');

  // One archive carries both: the creature from the previous test, this artifact.
  const found = readCreatureMod(join(GAME, 'UserMODs', `${MOD}.h5u`));
  expect(found!.mod.creatures).toHaveLength(1);
  const a = found!.mod.artifacts[0]!;
  expect(a.id).toBe(AMULET.id);
  expect(a.number).toBe(97);
  expect(a.slot).toBe('NECK');
  expect(a.rank).toBe('ARTF_CLASS_MINOR');
  expect(a.cost).toBe(5000);
  expect(a.stats).toEqual({ Knowledge: 2 });
  expect(a.icon).toContain('Necromancer_Pendant');
  expect(a.board).toEqual({ tiles: 1 });

  // And the executable's artifact ceiling agrees.
  const noted = JSON.parse(readFileSync(join(GAME, SITES_FILE), 'utf8')) as Site[];
  const reading = readArtifactLimit(readFileSync(join(GAME, 'bin', 'H5_Game_NCF.exe')), noted);
  expect(reading.limit).toBe(ORIGINAL_ARTIFACTS + 1);

  await page.locator('#am-cancel').click();
  await expect(page.locator('#artsmod')).toBeHidden();
});

test('the Recolor dialog paints the Sharpshooter grey', async () => {
  test.setTimeout(3 * 60_000);
  const { page } = ed;

  // Self-sufficient: ensure the Units dialog is open and lists our creature.
  if (!(await page.locator('#unitsmod').isVisible())) await page.locator('#unitsbtn').click();
  const paint = page.locator('.um-recolor', { hasText: 'Снайперы' });
  await expect(paint).toBeVisible({ timeout: 30_000 });
  await paint.click();

  await expect(page.locator('#recolor')).toBeVisible();
  // The mod carries three textures for it: body, the add layer, the icon.
  await expect(page.locator('#rc-previews canvas')).toHaveCount(3, { timeout: 60_000 });

  await page.locator('#rc-grey').click();
  await expect(page.locator('#rc-sat')).toHaveValue('0');
  await page.locator('#rc-ok').click();
  await expect(page.locator('#rc-note')).toContainText('repainted 3 texture(s)', { timeout: 120_000 });

  // The archive's own bytes: every creature texture is now grey (r=g=b on
  // every pixel), the alpha cut-out survived, and the paired texture documents
  // describe the uncompressed format the new bytes are in.
  const archive = readFileSync(join(GAME, 'UserMODs', `${MOD}.h5u`));
  let dds = 0, xdb = 0, alpha = 0;
  for (const e of readEntries(archive)) {
    const name = e.name.replace(/\\/g, '/');
    if (!name.startsWith('Units/H3Sharpshooter/')) continue;
    if (name.toLowerCase().endsWith('.dds')) {
      dds++;
      const img = decodeDDSBuffer(e.data);
      for (let i = 0; i < img.rgba.length; i += 4) {
        if (img.rgba[i] !== img.rgba[i + 1] || img.rgba[i + 1] !== img.rgba[i + 2]) {
          throw new Error(`${name}: pixel ${i / 4} is not grey`);
        }
        if (img.rgba[i + 3]! < 255) alpha++;
      }
    }
    if (name.toLowerCase().endsWith('.(texture).xdb')) {
      xdb++;
      const text = e.data.toString('latin1');
      expect(text, name).toContain('<Format>TF_8888</Format>');
      expect(text, name).toContain('<IsDXT>false</IsDXT>');
    }
  }
  expect(dds).toBe(3);
  expect(xdb).toBe(3);
  expect(alpha, 'the alpha cut-out survived the repaint').toBeGreaterThan(0);

  await page.locator('#rc-cancel').click();
  await page.locator('#um-cancel').click();
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
  // roster is built over the mounted chain, so the creature the earlier test
  // installed is one of its options — under the name the mod gave it.
  await addItem(page, ['armySlots']);
  await setTreeValue(page, ['armySlots', 0, 'Creature'], SHARPSHOOTER.id);
  await setTreeValue(page, ['armySlots', 0, 'Count'], '12');
  const row = await reveal(page, ['armySlots', 0, 'Creature']);
  await expect(row.locator('select')).toHaveValue(SHARPSHOOTER.id);
  const label = await row.locator('select option:checked').textContent();
  expect(label).toContain('Снайперы');
});
