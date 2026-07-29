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

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { launchEditor, REPO_ROOT } from './launch.ts';
import type { Launched } from './launch.ts';
import { AMULET, BOOTS, CLOAK, modGameRoot, PIECES, readInstalledMod, UNDEAD_KING } from './mods.ts';
import { ORIGINAL_ARTIFACTS, readArtifactLimit, SITES_FILE } from '../src/artifact-limit.ts';
import { modFile } from '../src/mod-paths.ts';
import { MOD_STEM } from '../src/creature-mod.ts';
import { extensionState } from '../src/extension.ts';
import { EFFECTS_FILE, readEffects } from '../src/artifact-effects.ts';
import type { Site } from '../src/artifact-limit.ts';

let ed: Launched;

const GAME = modGameRoot();
/** How many creatures were in the mod before this spec touched it. */
let creaturesBefore = 0;

test.beforeAll(async () => {
  // Zero in a throwaway install; live, whatever mod-001 authored. Either way
  // this spec must not move it — an artifact is not a creature.
  creaturesBefore = existsSync(modFile(GAME, 'mod', MOD_STEM))
    ? readInstalledMod(GAME).creatures.length : 0;
  ed = await launchEditor({ HOMM5_ROOT: GAME });
});
test.afterAll(async () => { await ed?.app.close(); });

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
  // As in the units spec: no artifact of ours, whether or not an archive exists.
  await expect(page.locator('#am-list'))
    .toContainText(/none — the game holds its shipped artifacts only|0 artifact\(s\)|none/);

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
  // A cheaper minor piece, and one that moves no stat at all: everything it
  // gives is the percentage below, which is the case worth authoring — an
  // artifact whose whole effect is the part the record cannot hold.
  await page.locator('#am-rank').selectOption('ARTF_CLASS_MINOR');
  await page.locator('#am-cost').fill('5000');
  await page.locator('#am-ai').fill('700');
  // The part no artifact record can hold: a percentage on a skill. It goes to a
  // file the native extension reads, added as a row rather than a field of its
  // own — the list of stats grows with the reverse engineering, the form should
  // not. The description beside it promises exactly this number.
  await page.locator('#am-effect-add').click();
  await page.locator('#am-effects label').first().locator('input').fill('5');

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
  expect(a.stats).toBeUndefined(); // no stat was typed, so none is recorded
  // The description is what the hero screen shows, and it names the +2 the
  // stats above give. It has to survive the round trip, or the artifact arrives
  // in game explaining itself with whatever the preset's donor said.
  expect(a.description).toBe(AMULET.description);
  expect(a.icon).toContain('Necromancer_Pendant');
  // No map model was given, so it stands as a flat board of its own icon.
  expect(a.board).toEqual({ tiles: 1 });
  // An artifact needs no creature: whatever was in the mod is still there and
  // nothing was added. In a fresh install that is none, which is the stronger
  // reading and the one the isolated run makes.
  expect(mod.creatures).toHaveLength(creaturesBefore);

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
  // THE FORM CAME UP EMPTY OF EFFECTS. The amulet was authored a test ago with
  // a row of its own, and the dialog was never closed in between — the row it
  // left standing gave this artifact the amulet's bonus as well as its own, and
  // the only sign was two rows nobody looked at.
  await expect(page.locator('#am-effects label')).toHaveCount(0);
  await page.locator('#am-effect-add').click();
  await expect(page.locator('#am-effects label')).toHaveCount(1);
  const effect = page.locator('#am-effects label').first();
  await expect(effect.locator('select')).toHaveValue('necromancy');
  await effect.locator('input').fill(String(CLOAK.necromancy));

  await page.locator('#am-ok').click();
  await expect(page.locator('#am-note')).toContainText('installed', { timeout: 120_000 });
  await expect(page.locator('#am-list')).toContainText('Плащ вампира (SHOULDERS)');

  // Written beside the executable, not into the mod — the extension reads it
  // from its own folder and knows nothing about archives.
  // BOTH rows, in mod order: the file is rewritten from the whole mod every
  // time rather than appended to, so the piece installed a test ago is still in
  // it and neither row is a leftover.
  expect(readEffects(readFileSync(join(GAME, EFFECTS_FILE), 'latin1'))).toEqual([
    { stat: 'necromancy', artifacts: [ORIGINAL_ARTIFACTS], threshold: 1, amount: AMULET.necromancy },
    { stat: 'necromancy', artifacts: [ORIGINAL_ARTIFACTS + 1], threshold: 1, amount: CLOAK.necromancy },
  ]);
  // And the text promises exactly that 10%: the row and the sentence are
  // written from the same form and are the only two places the number exists.
  expect(readInstalledMod(GAME).artifacts[1]!.description).toBe(CLOAK.description);
});

test('and the third, so the set is the whole Cloak', async () => {
  test.setTimeout(3 * 60_000);
  const { page } = ed;
  await openWithDonor(page);

  // Every piece a player will wear is authored HERE, through the form. The map
  // fixture used to add this one in code because the dialog stopped at two, and
  // that is exactly the difference nobody notices: two artifacts made the way a
  // person makes them, one made a way no person can.
  await page.locator('#am-file').fill(BOOTS.file);
  await expect(page.locator('#am-id')).toHaveValue(BOOTS.id);
  await page.locator('#am-name').fill(BOOTS.name);
  await page.locator('#am-desc').fill(BOOTS.description);
  await page.locator('#am-slot').selectOption(BOOTS.slot);
  await page.locator('#am-rank').selectOption('ARTF_CLASS_MINOR');
  await expect(page.locator('#am-effects label')).toHaveCount(0);
  await page.locator('#am-effect-add').click();
  await page.locator('#am-effects label').first().locator('input').fill(String(BOOTS.necromancy));

  await page.locator('#am-ok').click();
  await expect(page.locator('#am-note')).toContainText('installed', { timeout: 120_000 });
  await expect(page.locator('#am-list')).toContainText('Сапоги мертвеца (FEET)');

  // Three rows now, one per piece, each with the number its own description
  // promises — the file is written from the whole mod every time.
  expect(readEffects(readFileSync(join(GAME, EFFECTS_FILE), 'latin1'))).toEqual(
    PIECES.map((p, i) => ({
      stat: 'necromancy', artifacts: [ORIGINAL_ARTIFACTS + i], threshold: 1, amount: p.necromancy,
    })),
  );
});

test('says whether the extension is there, so an effect cannot look live when it is not', async () => {
  const { page } = ed;
  await openWithDonor(page);
  // Without the extension an effect is written and does nothing, and "it does
  // not work" and "it is not installed" look identical in game — so the form
  // says which. The assertion is against the state of the install being used: a
  // throwaway one has no extension, the game this checkout sits in usually has.
  const there = extensionState(GAME).installed;
  await expect(page.locator('#am-ext'))
    .toContainText(there ? /(?<!not )installed/ : /not installed/, { timeout: 30_000 });
});

// WIP, and tagged so it says so while still running: the set's bonus works in
// game (2026-07-29) but the dialog around it is not finished — there is no
// hint of what a threshold means, and nothing offers to write the tooltip that
// describes the bonus. The assertions below are the contract as it stands, so
// they run on every pass; `--grep-invert @wip` leaves them out.
test('makes a set of all three, with an effect of our own', {
  tag: '@wip',
  annotation: { type: 'wip', description: 'set effects work; the dialog around them is unfinished' },
}, async () => {
  test.setTimeout(3 * 60_000);
  const { page } = ed;
  if (await page.locator('#artedit').isVisible()) await page.locator('#artedit-cancel').click();
  if (!(await page.locator('#artsmod').isVisible())) await page.locator('#artsbtn').click();
  await page.locator('#as-new').click();

  // Members are ticked, not typed: a misspelt id builds cleanly and produces a
  // set that never combines. The list offers this mod's own artifacts first.
  const members = page.locator('#as-members');
  await expect(members.locator(`input[value="${AMULET.id}"]`)).toHaveCount(1, { timeout: 30_000 });
  for (const p of PIECES) await members.locator(`input[value="${p.id}"]`).check();

  // The per-count fields follow what is ticked, and are indexed from ONE piece
  // worn — position IS the count, so three members means three fields, and the
  // first stays blank because one piece of a set is not a set.
  const counts = page.locator('#as-counts input');
  await expect(counts).toHaveCount(PIECES.length);

  await page.locator('#as-file').fill(UNDEAD_KING.file);
  await expect(page.locator('#as-effect')).toHaveValue(UNDEAD_KING.effect); // derived from the stem
  await page.locator('#as-name').fill(UNDEAD_KING.name);
  await page.locator('#as-desc').fill(UNDEAD_KING.description);
  for (const [i, text] of UNDEAD_KING.perCount.entries()) if (text) await counts.nth(i).fill(text);

  // And what the set GIVES, which is not data of the game's at all: its own
  // <Effect> is one of eleven behaviours compiled into the executable. The
  // threshold is a field because it is ours — the extension counts the worn
  // members itself, so "two of three" needs nothing of the engine's.
  await expect(page.locator('#as-effects label')).toHaveCount(0);
  await page.locator('#as-effect-add').click();
  const effect = page.locator('#as-effects label').first();
  await effect.locator('select').selectOption('energy');
  await effect.locator('input').first().fill(String(UNDEAD_KING.energy.worn));
  await effect.locator('input').last().fill(String(UNDEAD_KING.energy.amount));

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
  expect(set.artifacts).toEqual(PIECES.map((p) => p.id));
  expect(set.perCount).toEqual(UNDEAD_KING.perCount);
  expect(set.effects).toEqual([
    { stat: 'energy', threshold: UNDEAD_KING.energy.worn, amount: UNDEAD_KING.energy.amount },
  ]);
  // And the extension is told, in the form it parses: the members by NUMBER,
  // because that is what the game knows them by, and the threshold beside them.
  // Without this row the set is named on the hero screen and does nothing.
  expect(readEffects(readFileSync(join(GAME, EFFECTS_FILE), 'latin1')).at(-1)).toEqual({
    stat: 'energy',
    artifacts: PIECES.map((_, i) => ORIGINAL_ARTIFACTS + i),
    threshold: UNDEAD_KING.energy.worn,
    amount: UNDEAD_KING.energy.amount,
  });
  // The artifacts are still there: a set is added to the mod, not instead of
  // it, and every edit lands in the one archive.
  expect(mod.artifacts.map((a) => a.id)).toEqual(PIECES.map((p) => p.id));
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
