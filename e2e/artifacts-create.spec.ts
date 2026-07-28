// Adding an artifact to the game through the window, end to end.
//
// Runs alone, on its own game install (e2e/mods.ts) — and needs no creature:
// an artifact costs the mod no creature ceiling, only its own. What it does
// need is the artifact sites note beside the executable, which prepareGameRoot
// copies along, because a patched executable can no longer find those sites by
// search.
//
// What gets built is two pieces of the SoD port's Cloak of the Undead King, on
// a shipped neck-piece's preset, and then the SET they belong to — because a
// set is where the two halves of this feature meet: it names artifacts that
// have to exist already, and it rides in the same archive they do.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { launchEditor, REPO_ROOT } from './launch.ts';
import type { Launched } from './launch.ts';
import { AMULET, CLOAK, prepareGameRoot, readInstalledMod, removeGameRoot, UNDEAD_KING } from './mods.ts';
import { ORIGINAL_ARTIFACTS, readArtifactLimit, SITES_FILE } from '../src/artifact-limit.ts';
import { EFFECTS_FILE, readEffects } from '../src/artifact-effects.ts';
import type { Site } from '../src/artifact-limit.ts';

let ed: Launched;

const GAME = join(REPO_ROOT, '_tmp', 'e2e-arts-game');

test.beforeAll(async () => {
  prepareGameRoot(GAME);
  ed = await launchEditor({ HOMM5_ROOT: GAME });
});
test.afterAll(async () => { await ed?.app.close(); removeGameRoot(GAME); });

/** Open Artifacts… with the donor loaded. */
async function openWithDonor(page: Launched['page']): Promise<void> {
  // The list is a list; the form is a dialog on top of it.
  if (!(await page.locator('#artsmod').isVisible())) await page.locator('#artsbtn').click();
  if (!(await page.locator('#artedit').isVisible())) await page.locator('#am-new').click();
  await expect(page.locator(`#am-donor option[value="${AMULET.donor}"]`)).toHaveCount(1, { timeout: 30_000 });
  await page.locator('#am-donor').selectOption(AMULET.donor);
  await expect(page.locator('#am-cost')).toHaveValue('7000'); // the preset settled
}

test('the dialog opens clean, and the donor loads as a preset', async () => {
  const { page } = ed;
  await page.locator('#artsbtn').click();
  await expect(page.locator('#artsmod')).toBeVisible();
  await expect(page.locator('#am-list')).toContainText('none — the game holds its shipped artifacts only');

  // The artifact table keeps everything inline, so one lookup fills the form.
  await openWithDonor(page);
  await expect(page.locator('#am-name')).toHaveValue('Амулет некроманта');
  await expect(page.locator('#am-slot')).toHaveValue('NECK');
  await expect(page.locator('#am-rank')).toHaveValue('ARTF_CLASS_RELIC');
  await expect(page.locator('#am-icon')).toHaveValue(/Necromancer_Pendant/);
});

test('edits the difference and installs the artifact', async () => {
  test.setTimeout(3 * 60_000);
  const { page } = ed;
  await openWithDonor(page);

  await page.locator('#am-file').fill(AMULET.file);
  await expect(page.locator('#am-id')).toHaveValue(AMULET.id);
  await page.locator('#am-name').fill(AMULET.name);
  await page.locator('#am-desc').fill(AMULET.description);
  // The port's amulet is a cheaper minor piece that moves Knowledge.
  await page.locator('#am-rank').selectOption('ARTF_CLASS_MINOR');
  await page.locator('#am-cost').fill('5000');
  await page.locator('#am-ai').fill('700');
  await page.locator('#am-knowledge').fill('2');

  await page.locator('#am-ok').click();
  await expect(page.locator('#am-note')).toContainText('installed', { timeout: 120_000 });
  await expect(page.locator('#am-note')).toContainText(`ceiling ${ORIGINAL_ARTIFACTS + 1}`);
  await expect(page.locator('#am-list')).toContainText('Амулет гробовщика (NECK)');

  // On disk: the archive carries it, with the fields we authored and the ones
  // the preset supplied.
  const mod = readInstalledMod(GAME);
  const a = mod.artifacts[0]!;
  expect(a.id).toBe(AMULET.id);
  expect(a.number).toBe(ORIGINAL_ARTIFACTS);
  expect(a.slot).toBe('NECK');
  expect(a.rank).toBe('ARTF_CLASS_MINOR');
  expect(a.cost).toBe(5000);
  expect(a.stats).toEqual({ Knowledge: 2 });
  expect(a.icon).toContain('Necromancer_Pendant');
  // No map model was given, so it stands as a flat board of its own icon.
  expect(a.board).toEqual({ tiles: 1 });
  // An artifact needs no creature, and the mod has none.
  expect(mod.creatures).toHaveLength(0);

  // And the executable's ARTIFACT ceiling agrees.
  const noted = JSON.parse(readFileSync(join(GAME, SITES_FILE), 'utf8')) as Site[];
  const reading = readArtifactLimit(readFileSync(join(GAME, 'bin', 'H5_Game_H5E.exe')), noted);
  expect(reading.limit).toBe(ORIGINAL_ARTIFACTS + 1);

  await expect(page.locator('#artedit')).toBeHidden(); // a build closes the form
});

test('a second piece, so there is a set to make', async () => {
  test.setTimeout(3 * 60_000);
  const { page } = ed;
  await openWithDonor(page);

  await page.locator('#am-file').fill(CLOAK.file);
  await expect(page.locator('#am-id')).toHaveValue(CLOAK.id);
  await page.locator('#am-name').fill(CLOAK.name);
  await page.locator('#am-desc').fill(CLOAK.description);
  await page.locator('#am-slot').selectOption(CLOAK.slot);
  await page.locator('#am-rank').selectOption('ARTF_CLASS_MINOR');
  await page.locator('#am-knowledge').fill('2');
  // The part no artifact record can hold: it goes to a file the native
  // extension reads, and the artifact carries its six stats without it. Added
  // as a row rather than typed into a field of its own — the list of stats
  // grows with the reverse engineering and the form should not.
  await page.locator('#am-effect-add').click();
  const effect = page.locator('#am-effects label').first();
  await expect(effect.locator('select')).toHaveValue('necromancy');
  await effect.locator('input').fill('10');

  await page.locator('#am-ok').click();
  await expect(page.locator('#am-note')).toContainText('installed', { timeout: 120_000 });
  await expect(page.locator('#am-list')).toContainText('Плащ вампира (SHOULDERS)');

  // Written beside the executable, not into the mod — the extension reads it
  // from its own folder and knows nothing about archives.
  const effects = readFileSync(join(GAME, EFFECTS_FILE), 'latin1');
  expect(readEffects(effects)).toEqual([{ stat: 'necromancy', artifact: ORIGINAL_ARTIFACTS + 1, amount: 10 }]);
  // The amulet was installed first with no effect, so it must NOT be in there:
  // a file that only grows would keep granting bonuses nobody asked for.
  expect(effects).not.toContain(`artifact ${ORIGINAL_ARTIFACTS} `);
});

test('says the extension is missing rather than letting the effect look live', async () => {
  const { page } = ed;
  await openWithDonor(page);
  // This install has no extension: the effect is written and does nothing, and
  // "it does not work" and "it is not installed" look identical in game.
  await expect(page.locator('#am-ext')).toContainText('not installed', { timeout: 30_000 });
});

test('makes a set of the two, with an effect of our own', async () => {
  test.setTimeout(3 * 60_000);
  const { page } = ed;
  if (await page.locator('#artedit').isVisible()) await page.locator('#artedit-cancel').click();
  if (!(await page.locator('#artsmod').isVisible())) await page.locator('#artsbtn').click();
  await page.locator('#as-new').click();

  // Members are ticked, not typed: a misspelt id builds cleanly and produces a
  // set that never combines. The list offers this mod's own artifacts first.
  const members = page.locator('#as-members');
  await expect(members.locator(`input[value="${AMULET.id}"]`)).toHaveCount(1, { timeout: 30_000 });
  await members.locator(`input[value="${AMULET.id}"]`).check();
  await members.locator(`input[value="${CLOAK.id}"]`).check();

  // The per-count fields follow what is ticked, and are indexed from ONE piece
  // worn — position IS the count, so two members means two fields.
  const counts = page.locator('#as-counts input');
  await expect(counts).toHaveCount(2);

  await page.locator('#as-file').fill(UNDEAD_KING.file);
  await expect(page.locator('#as-effect')).toHaveValue(UNDEAD_KING.effect); // derived from the stem
  await page.locator('#as-name').fill(UNDEAD_KING.name);
  await page.locator('#as-desc').fill(UNDEAD_KING.description);
  await counts.nth(1).fill(UNDEAD_KING.perCount[1]!);

  await page.locator('#as-ok').click();
  await expect(page.locator('#am-note')).toContainText('installed', { timeout: 120_000 });
  // 11 — after the game's own eleven, 0..10. Taking one of theirs would build
  // just as cleanly and stop their set working.
  await expect(page.locator('#am-note')).toContainText('set effect 11');
  // Sets have a list of their own beside the artifacts they are made of.
  await expect(page.locator('#as-list')).toContainText(UNDEAD_KING.name);

  const mod = readInstalledMod(GAME);
  const set = mod.sets[0]!;
  expect(set.effect).toBe(UNDEAD_KING.effect);
  expect(set.number).toBe(11);
  expect(set.artifacts).toEqual([AMULET.id, CLOAK.id]);
  expect(set.perCount).toEqual(UNDEAD_KING.perCount);
  // The two artifacts are still there: a set is added to the mod, not instead
  // of it, and both edits land in the one archive.
  expect(mod.artifacts.map((a) => a.id)).toEqual([AMULET.id, CLOAK.id]);
});

test('refuses one of the game\'s own set effects', async () => {
  const { page } = ed;
  // The previous test's install closed the form; open a fresh one and wait
  // for it, rather than assuming it is still up.
  if (!(await page.locator('#artsmod').isVisible())) await page.locator('#artsbtn').click();
  if (!(await page.locator('#setedit').isVisible())) await page.locator('#as-new').click();
  await expect(page.locator('#as-file')).toBeVisible({ timeout: 30_000 });

  const members = page.locator('#as-members');
  await members.locator(`input[value="${AMULET.id}"]`).check();
  await members.locator(`input[value="${CLOAK.id}"]`).check();
  await page.locator('#as-file').fill('Borrowed');
  await page.locator('#as-effect').fill('ARTFSET_EFFECT_NECROMANCERS');
  await page.locator('#as-name').fill('Borrowed');

  await page.locator('#as-ok').click();
  await expect(page.locator('#as-err')).toContainText('the game\'s own set', { timeout: 60_000 });
  // Nothing was installed: the mod still holds the one set from before.
  expect(readInstalledMod(GAME).sets).toHaveLength(1);
});
