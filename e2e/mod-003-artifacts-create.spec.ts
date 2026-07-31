// Adding an artifact to the game through the window, end to end.
//
// Runs alone, on its own game install (e2e/mods.ts) — and needs no creature:
// an artifact costs the mod no creature ceiling, only its own. The artifact
// sites note beside the executable takes care of itself here: that install is
// built by the first run out of the shipped executable, so its accessor bytes
// are still unique and the search finds them, which is the one moment the note
// can be written. It exists because a PATCHED executable can no longer find
// those sites by search.
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
import { ORIGINAL_ARTIFACTS, readArtifactLimit, SITES_FILE } from '../src/exe/artifact-limit.ts';
import { modFile } from '../src/game/mod-paths.ts';
import { MOD_STEM } from '../src/mods/creature-mod.ts';
import { extensionState } from '../src/mods/extension.ts';
import { EFFECTS_FILE, readEffects } from '../src/mods/artifact-effects.ts';
import { COMMON_SCRIPT, SCRIPT_DIR } from '../src/mods/artifact-scripts.ts';
import { readEntries } from '../src/format/pak.ts';
import type { Site } from '../src/exe/artifact-limit.ts';

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
  const amuletRow = page.locator('#am-effects label').first();
  // One list, both kinds: the six the record itself holds and the bonuses only
  // the extension can add. Which side of that line a row falls on is the
  // dialog's problem, not the author's.
  await expect(amuletRow.locator('select option')).toContainText(['Attack', 'necromancy', 'energy']);
  await amuletRow.locator('select').selectOption('necromancy');
  await amuletRow.locator('input').fill('5');

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
  await effect.locator('select').selectOption('necromancy');
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
  const bootsRow = page.locator('#am-effects label').first();
  await bootsRow.locator('select').selectOption('necromancy');
  await bootsRow.locator('input').fill(String(BOOTS.necromancy));

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

test('an artifact opened for editing comes back whole', async () => {
  test.setTimeout(3 * 60_000);
  const { page } = ed;
  if (await page.locator('#artedit').isVisible()) await page.locator('#artedit-cancel').click();
  if (!(await page.locator('#artsmod').isVisible())) await page.locator('#artsbtn').click();

  // The pencil on the amulet's row. Nothing covered this path before, which is
  // why the form could come up holding a quarter of the artifact and write the
  // rest away on save — a price changed, and the description, the rank, the
  // icon and the bonus went with it.
  const row = page.locator('#am-list .um-item').filter({ hasText: AMULET.name });
  await row.locator('button', { hasText: '✎' }).click();
  await expect(page.locator('#artedit-title')).toHaveText('Editing artifact');

  await expect(page.locator('#am-name')).toHaveValue(AMULET.name);
  await expect(page.locator('#am-desc')).toHaveValue(AMULET.description);
  await expect(page.locator('#am-rank')).toHaveValue('ARTF_CLASS_MINOR');
  await expect(page.locator('#am-cost')).toHaveValue('5000');
  await expect(page.locator('#am-ai')).toHaveValue('700');
  await expect(page.locator('#am-icon')).toHaveValue(/Necromancer_Pendant/);
  // And what it gives, as the row it was authored as.
  await expect(page.locator('#am-effects label')).toHaveCount(1);
  const first = page.locator('#am-effects label').first();
  await expect(first.locator('select')).toHaveValue('necromancy');
  await expect(first.locator('input')).toHaveValue(String(AMULET.necromancy));

  // A stat the RECORD holds, added the same way as the bonus above — the whole
  // point of one list. It lands in the artifact's own document, not in the
  // extension's file, and the price it was opened for stays what it was.
  await page.locator('#am-effect-add').click();
  const added = page.locator('#am-effects label').nth(1);
  await added.locator('select').selectOption('Attack');
  await added.locator('input').fill('2');
  await page.locator('#am-ok').click();
  await expect(page.locator('#artedit')).toBeHidden({ timeout: 120_000 });

  const a = readInstalledMod(GAME).artifacts.find((x) => x.id === AMULET.id)!;
  expect(a.stats).toEqual({ Attack: 2 });
  expect(a.description).toBe(AMULET.description);
  expect(a.cost).toBe(5000);
  expect(a.aiValue).toBe(700);
  expect(a.rank).toBe('ARTF_CLASS_MINOR');
  // The bonus is still in the extension's file, and only once.
  const rows = readEffects(readFileSync(join(GAME, EFFECTS_FILE), 'latin1'));
  expect(rows.filter((r) => r.artifacts[0] === ORIGINAL_ARTIFACTS && r.stat === 'necromancy'))
    .toEqual([{ stat: 'necromancy', artifacts: [ORIGINAL_ARTIFACTS], threshold: 1, amount: AMULET.necromancy }]);

  // Put it back: the port's amulet moves no stat, as in Heroes III, and the
  // stages after this one read the mod as the port's.
  await row.locator('button', { hasText: '✎' }).click();
  const gives = page.locator('#am-effects label');
  await expect(gives).toHaveCount(2);
  // The record's six come first and the extension's bonuses after — which is
  // worth saying out loud, because the first draft of this test removed "the
  // second row" and took the bonus off instead of the stat.
  await expect(gives.nth(0).locator('select')).toHaveValue('Attack');
  await expect(gives.nth(1).locator('select')).toHaveValue('necromancy');
  await gives.nth(0).locator('button', { hasText: '×' }).click();
  await expect(gives).toHaveCount(1);
  await expect(gives.first().locator('select')).toHaveValue('necromancy');
  await page.locator('#am-ok').click();
  await expect(page.locator('#artedit')).toBeHidden({ timeout: 120_000 });
  const back = readInstalledMod(GAME).artifacts.find((x) => x.id === AMULET.id)!;
  expect(back.stats).toBeUndefined();
  expect(back.effects).toEqual({ necromancy: AMULET.necromancy });
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
// they run on every pass. To see just these: `npx playwright test --grep @wip`
// — a script for it would be run by `npm test` as a suite, and this stage
// cannot pass out of the chain's order.
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

  // The other half of a set: what it does on an EVENT. Lua is a row like the
  // rest, but it is never written among the fields — the row carries a pencil
  // and the pencil opens the editor the map's own scripts are written in.
  await page.locator('#as-effect-add').click();
  const luaRow = page.locator('#as-effects label').nth(1);
  await luaRow.locator('select').selectOption('lua');
  await expect(luaRow.locator('.as-effect-edit')).toBeVisible();
  await luaRow.locator('.as-effect-edit').click();
  await expect(page.locator('#setscript')).toBeVisible();
  const code = page.locator('#ss-text .cm-content');
  await code.fill(UNDEAD_KING.script);
  // The linter is the editor's own, in the gutter and on the line below it.
  await expect(page.locator('#ss-lint')).toHaveText('✓ no errors');
  await page.locator('#ss-ok').click();
  await expect(page.locator('#setscript')).toBeHidden();

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
  // The script is the set's, and it reaches the game the only way a script can:
  // its own file in the mod, plus the game's global one carrying a line that
  // loads it — with everything the game shipped in it still there, because a mod
  // that dropped those lines would break every mission's script instead.
  expect(set.script).toContain('Trigger(NEW_DAY_TRIGGER,');
  const files = new Map(readEntries(readFileSync(modFile(GAME, 'mod', MOD_STEM)))
    .map((e) => [e.name.split('\\').join('/'), e.data.toString('latin1')] as const));
  const script = files.get(`${SCRIPT_DIR}/${UNDEAD_KING.file}.lua`);
  expect(script, 'the set brought its own script file').toBeTruthy();
  expect(script).toContain(`${UNDEAD_KING.file}_MEMBERS = { ${PIECES.map((p) => p.id).join(', ')} };`);
  const common = files.get(COMMON_SCRIPT);
  expect(common, 'and the global script that loads it').toBeTruthy();
  expect(common).toContain(`doFile("/${SCRIPT_DIR}/${UNDEAD_KING.file}.lua");`);
  expect(common).toContain('function EditorHeroWearing(');
  expect(common, "the game's own helpers are still in it").toContain('function SetPlayerStartResource(');
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

test('removing asks in a dialog of ours, and Cancel means no', async () => {
  test.setTimeout(2 * 60_000);
  const { page } = ed;
  if (await page.locator('#setedit').isVisible()) await page.locator('#setedit-cancel').click();
  if (!(await page.locator('#artsmod').isVisible())) await page.locator('#artsbtn').click();

  // The × on the set's row. This used to be `confirm()` — a native window that
  // blocks the renderer, so a spec that reached one hung until the timeout with
  // nothing to read. Now the question is ours: visible, readable, answerable.
  const row = page.locator('#as-list .um-item').filter({ hasText: UNDEAD_KING.name });
  await row.locator('button', { hasText: '×' }).click();
  await expect(page.locator('#ask-text')).toContainText('only the set goes');
  await page.locator('#ask-no').click();
  await expect(page.locator('#ask')).toBeHidden();
  // Cancel means the set is still there — the assertion the old prompt could
  // not make, because nothing could press its buttons.
  expect(readInstalledMod(GAME).sets.map((x) => x.effect)).toContain(UNDEAD_KING.effect);
  await expect(page.locator('#as-list')).toContainText(UNDEAD_KING.name);
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
