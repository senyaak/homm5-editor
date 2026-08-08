// Adding a spell to the game through the window, end to end.
//
// The last authoring stage of the chain, and the one with the most to prove,
// because a spell is the only thing the editor makes whose parts leave by two
// different doors. What the DOCUMENT holds — school, level, mana, target, the
// element, the four damage entries and the two reach flags — is read by the
// engine's own code and works for a number nothing was compiled against. What it
// does NOT hold — which tiles an area covers, which creature kinds the damage
// passes over — has no field to go in, because the engine picks both by
// switching on the spell's number, so those reach the game through the file the
// native extension reads. One form, two destinations, and this spec follows both
// to disk.
//
// What gets built is a five-tile CROSS, deliberately: a 3×3 is what a fireball
// covers and what the engine's own default is, so seeing one would prove
// nothing. Nothing in the game covers a plus, so a plus on the field could only
// have come from the grid in the form.
//
// Runs in the chain's install like every mod stage. It does not assume it is the
// first spell there: live, the Rules Test map's fixtures are already installed,
// and the value a spell takes is its position in the list.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { DATA, launchEditor } from './launch.ts';
import type { Launched } from './launch.ts';
import { modGameRoot, readInstalledMod } from './mods.ts';
import { settled } from './trace.ts';
import { EFFECTS_FILE, readSpellRows } from '../src/mods/artifact-effects.ts';
import { abilityNumbers } from '../src/mods/ability-files.ts';
import { NOT_LIVING, SHIPPED_SPELLS } from '../src/mods/spells.ts';
import type { Locator } from '@playwright/test';

let ed: Launched;
const GAME = modGameRoot();

/**
 * The spell the form authors — a Death Ripple that hits a cross rather than the
 * whole field, so the two halves of the feature are exercised at once: it spares
 * the kinds that are not alive AND it names the tiles it covers.
 */
const SPELL = {
  file: 'E2eCrossRipple',
  id: 'SPELL_E2E_CROSS_RIPPLE',
  name: 'Крестовая волна',
  description: 'Наносит урон живым существам на кресте из пяти клеток.',
  level: 3,
  mana: 12,
  school: 'MAGIC_SCHOOL_DARK',
  element: 'ELEMENT_FIRE',
  /** (0,0) is the tile aimed at; the rest are its four neighbours. */
  cross: [{ x: 0, y: 0 }, { x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 1 }],
  /** Per mastery, both parts — the shape every shipped damage spell has. */
  damage: [10, 15, 20, 25],
};

test.beforeAll(async () => {
  test.skip(!existsSync(join(DATA, 'types.xml')), 'needs the unpacked data');
  ed = await launchEditor({ HOMM5_ROOT: GAME });
});
test.afterAll(async () => { await ed?.app.close(); });

/** Open the window, and the form on top of it, with nothing left from before. */
async function openForm(page: Launched['page']): Promise<void> {
  if (await page.locator('#spelledit').isVisible()) await page.locator('#spelledit-cancel').click();
  if (!(await page.locator('#spellsmod').isVisible())) await page.locator('#spellsbtn').click();
  await page.locator('#sm-new').click();
  await expect(page.locator('#spelledit')).toBeVisible();
}

/** The tile at this offset, in the grid as it is drawn now. */
function tile(page: Launched['page'], x: number, y: number, w: number, h: number): Locator {
  const index = (y + (h - 1) / 2) * w + (x + (w - 1) / 2);
  return page.locator('#sm-area-grid label').nth(index);
}

test('the window opens and offers the game\'s own lists', async () => {
  const { page } = ed;
  await page.locator('#spellsbtn').click();
  await expect(page.locator('#spellsmod')).toBeVisible();
  await page.locator('#sm-new').click();
  await expect(page.locator('#spelledit')).toBeVisible();

  // Read off types.xml rather than written into the form: the legal values of a
  // field are a fact about the install, and a list frozen into our source is a
  // second copy of them to drift.
  await expect(page.locator('#sm-school option')).toContainText(
    ['MAGIC_SCHOOL_DESTRUCTIVE', 'MAGIC_SCHOOL_DARK'], { timeout: 30_000 });
  await expect(page.locator('#sm-element option')).toContainText(
    ['ELEMENT_NONE', 'ELEMENT_AIR', 'ELEMENT_FIRE', 'ELEMENT_WATER', 'ELEMENT_EARTH']);
  await expect(page.locator('#sm-target option')).toHaveCount(3);
  // And the kinds a spell can pass over are the creature abilities the game
  // declares, named the way a player sees them.
  await expect(page.locator(`#sm-spares option[value="${NOT_LIVING[0]}"]`)).toHaveCount(1);

  // Four masteries, each a flat part and a per-power one — the engine reads the
  // list positionally, so there are always four.
  await expect(page.locator('#sm-damage label')).toHaveCount(4);
  await expect(page.locator('#sm-damage label').first()).toContainText('No mastery');
  await expect(page.locator('#sm-damage label').last()).toContainText('Expert');
});

test('it will not build a spell that is missing what it needs', async () => {
  const { page } = ed;
  await openForm(page);

  await expect(page.locator('#sm-ok')).toBeDisabled();
  await expect(page.locator('#sm-missing')).toHaveText(/files.*id.*name/);
  await expect(page.locator('#spelledit .req')).toHaveCount(3);

  await page.locator('#sm-file').fill(SPELL.file);
  // The id spells itself from the stem, the way an artifact's does.
  await expect(page.locator('#sm-id')).toHaveValue(SPELL.id);
  await page.locator('#sm-name').fill('Отказник');
  await expect(page.locator('#sm-ok')).toBeEnabled();
  await expect(page.locator('#sm-missing')).toHaveText('');
});

/**
 * The refusal that has no field to put a star on.
 *
 * `IsAreaAttack` says a spell hits an area and never says which; the shape is a
 * switch on the number with one case per shipped spell, and the default a number
 * of ours lands on covers nothing. So an area spell with no tiles is a cast that
 * plays, spends its mana and touches nobody — which in game is indistinguishable
 * from a spell that does not work. The form says so before the press.
 */
test('an area spell with no tiles is refused, and the grid is how they are given', async () => {
  const { page } = ed;
  // The grid only exists for the reach that has tiles; the other two never see it.
  await expect(page.locator('#sm-area-grid')).toBeHidden();
  await page.locator('#sm-reach').selectOption('area');
  await expect(page.locator('#sm-area-grid')).toBeVisible();
  await expect(page.locator('#sm-ok')).toBeDisabled();
  await expect(page.locator('#sm-missing')).toHaveText(/tiles it covers/);

  // 3×3 by default — the size of the engine's own neighbour table, which is what
  // makes a fireball a 3×3 and what proves the grid is SQUARE.
  await expect(page.locator('#sm-area-grid label')).toHaveCount(9);
  await page.locator('#sm-area-w').fill('5');
  await page.locator('#sm-area-h').fill('5');
  await page.locator('#sm-area-w').dispatchEvent('change');
  await expect(page.locator('#sm-area-grid label')).toHaveCount(25);
  // An even size is snapped up to odd: the tile aimed at is the middle one, and
  // an even grid has no middle.
  await page.locator('#sm-area-w').fill('4');
  await page.locator('#sm-area-w').dispatchEvent('change');
  await expect(page.locator('#sm-area-w')).toHaveValue('5');

  await tile(page, 0, 0, 5, 5).click();
  await expect(page.locator('#sm-area-note')).toHaveText(/1 tile\(s\) covered/);
  await expect(page.locator('#sm-ok'), 'one tile is a shape').toBeEnabled();

  // A tile outside a shrunken grid is DROPPED and counted, rather than staying
  // covered where nobody can see it.
  await tile(page, 2, 0, 5, 5).click();
  await expect(page.locator('#sm-area-note')).toHaveText(/2 tile\(s\) covered/);
  await page.locator('#sm-area-w').fill('3');
  await page.locator('#sm-area-w').dispatchEvent('change');
  await expect(page.locator('#sm-area-note')).toHaveText(/1 tile\(s\) covered.*1 outside the new grid dropped/);
});

test('builds the spell, and both halves of it land where they belong', async () => {
  test.setTimeout(3 * 60_000);
  const { page } = ed;
  await openForm(page);

  await page.locator('#sm-file').fill(SPELL.file);
  await expect(page.locator('#sm-id')).toHaveValue(SPELL.id);
  await page.locator('#sm-name').fill(SPELL.name);
  await page.locator('#sm-desc').fill(SPELL.description);
  await page.locator('#sm-school').selectOption(SPELL.school);
  await page.locator('#sm-level').fill(String(SPELL.level));
  await page.locator('#sm-mana').fill(String(SPELL.mana));
  await page.locator('#sm-element').selectOption(SPELL.element);

  // ONE CHOICE, TWO FLAGS: the engine has a damage branch per shape and what
  // chooses between them is the pair of booleans the document already carries.
  await page.locator('#sm-reach').selectOption('area');
  await page.locator('#sm-area-w').fill('3');
  await page.locator('#sm-area-h').fill('3');
  await page.locator('#sm-area-w').dispatchEvent('change');
  // A NEW form starts from nothing — the tiles ticked in the test above must
  // not be this spell's, which is the mistake the artifact form made once with
  // its effect rows.
  await expect(page.locator('#sm-area-note')).toHaveText(/0 tile\(s\) covered/);
  for (const t of SPELL.cross) await tile(page, t.x, t.y, 3, 3).click();
  await expect(page.locator('#sm-area-note')).toHaveText(/5 tile\(s\) covered/);

  for (const [i, n] of SPELL.damage.entries()) {
    await page.locator(`#sm-dmg-${i}-base`).fill(String(n));
    await page.locator(`#sm-dmg-${i}-per`).fill(String(n));
  }

  // The kinds it passes over — the three whose absence the game prints as
  // «Живое существо». There is no flag for being alive, so the question is asked
  // the way the game asks it, and the button fills the list from the same
  // constant the extension's config is written from.
  await page.locator('#sm-spares-notliving').click();
  await expect(page.locator('#sm-spares-note')).toContainText('undead');

  await page.locator('#sm-ok').click();
  await expect(page.locator('#sm-note')).toContainText('installed', { timeout: 120_000 });
  await expect(page.locator('#spelledit')).toBeHidden();
  await expect(page.locator('#sm-list')).toContainText(SPELL.name);
  // The list says what it reaches, which is the thing a person cannot read off
  // a pair of booleans.
  await expect(page.locator('#sm-list')).toContainText('an area of 5 tile(s)');

  // --- the archive: the document's half ---------------------------------------
  const mod = readInstalledMod(GAME);
  const s = mod.spells?.find((x) => x.id === SPELL.id);
  expect(s, 'the mod carries it').toBeTruthy();
  expect(s!.number).toBeGreaterThanOrEqual(SHIPPED_SPELLS);
  expect(s!.name).toBe(SPELL.name);
  expect(s!.description).toBe(SPELL.description);
  expect(s!.school).toBe(SPELL.school);
  expect(s!.level).toBe(SPELL.level);
  expect(s!.manaCost).toBe(SPELL.mana);
  expect(s!.element).toBe(SPELL.element);
  // The pair the reach became. Both, because either alone is a different shape.
  expect(s!.aimed).toBe(true);
  expect(s!.areaAttack).toBe(true);
  // Four entries whatever the form was given, since the engine reads them by
  // position: a short list would leave the masteries after it at whatever the
  // parser had.
  expect(s!.damage).toEqual(SPELL.damage.map((n) => ({ base: n, perPower: n })));
  expect(s!.area).toEqual(SPELL.cross);
  // A SET, not a sequence: the kinds come out of the list in the order the game
  // declares them, and the filter asks "is it one of these" either way.
  expect([...(s!.spares ?? [])].sort()).toEqual([...NOT_LIVING].sort());

  // --- and the extension's half, beside the executable -------------------------
  //
  // By NUMBER on both sides, because a number is what the engine is asked: the
  // spell's own value, and the ability values it compares a stack against.
  const abilities = abilityNumbers(readFileSync(join(DATA, 'types.xml'), 'latin1'));
  const rows = readSpellRows(readFileSync(join(GAME, EFFECTS_FILE), 'latin1'));
  const row = rows.find((r) => r.spell === s!.number);
  expect(row, 'the extension is told about it').toBeTruthy();
  expect(row!.area).toEqual(SPELL.cross);
  expect([...row!.spares].sort()).toEqual(NOT_LIVING.map((a) => abilities.get(a)!).sort());
});

test('a spell opened for editing comes back whole — the tiles included', async () => {
  test.setTimeout(3 * 60_000);
  const { page } = ed;
  if (await page.locator('#spelledit').isVisible()) await page.locator('#spelledit-cancel').click();
  if (!(await page.locator('#spellsmod').isVisible())) await page.locator('#spellsbtn').click();

  const row = page.locator('#sm-list .um-item').filter({ hasText: SPELL.name });
  await row.locator('button', { hasText: '✎' }).click();
  await expect(page.locator('#spelledit-title')).toContainText(SPELL.name);

  // The form writes back what it holds, so anything it fails to reload is
  // erased on save. The tiles are the part with nowhere else to come from: they
  // are in no document, only in the manifest and the extension's file.
  await expect(page.locator('#sm-name')).toHaveValue(SPELL.name);
  await expect(page.locator('#sm-desc')).toHaveValue(SPELL.description);
  await expect(page.locator('#sm-school')).toHaveValue(SPELL.school);
  await expect(page.locator('#sm-level')).toHaveValue(String(SPELL.level));
  await expect(page.locator('#sm-mana')).toHaveValue(String(SPELL.mana));
  await expect(page.locator('#sm-element')).toHaveValue(SPELL.element);
  await expect(page.locator('#sm-reach')).toHaveValue('area');
  await expect(page.locator('#sm-dmg-3-base')).toHaveValue('25');
  await expect(page.locator('#sm-spares-note')).toContainText('undead');
  // Sized to hold what it covers — a cross reaching one tile out is a 3×3.
  await expect(page.locator('#sm-area-w')).toHaveValue('3');
  await expect(page.locator('#sm-area-note')).toHaveText(/5 tile\(s\) covered/);
  await expect(page.locator('#sm-area-grid label.on')).toHaveCount(5);
  // Neither the id nor the stem may move: the value behind the id is what a
  // spellbook and a save store, and the stem names every file already written.
  await expect(page.locator('#sm-id')).toBeDisabled();
  await expect(page.locator('#sm-file')).toBeDisabled();

  // Save it back unchanged, and nothing about it moves — a round trip through
  // the form is the cheapest way to catch a field the form quietly drops.
  const before = readInstalledMod(GAME).spells!.find((x) => x.id === SPELL.id)!;
  await page.locator('#sm-ok').click();
  await expect(page.locator('#spelledit')).toBeHidden({ timeout: 120_000 });
  expect(readInstalledMod(GAME).spells!.find((x) => x.id === SPELL.id)).toEqual(before);
});

test('one of the game\'s own spell names is refused', async () => {
  test.setTimeout(2 * 60_000);
  const { page } = ed;
  await openForm(page);
  await page.locator('#sm-file').fill('Borrowed');
  await page.locator('#sm-id').fill('SPELL_ARMAGEDDON');
  await page.locator('#sm-name').fill('Заимствованный');
  await page.locator('#sm-ok').click();
  // A duplicate `<Name>` in an enum is not something the game reports: it is a
  // value that resolves to whichever entry the parser saw first.
  await expect(page.locator('#se-err')).toContainText('the game\'s own spell', { timeout: 60_000 });
  const ours = readInstalledMod(GAME).spells ?? [];
  expect(ours.filter((x) => x.id === 'SPELL_ARMAGEDDON')).toHaveLength(0);
  await page.locator('#spelledit-cancel').click();
});

/**
 * A specialization can GIVE this spell — and the form is the only door to that.
 *
 * Here rather than in mod-004, where specializations are authored, for one
 * reason: the picker lists the MOD's own spells and there are none until this
 * spec has built one. And before the removal below, which takes that spell away.
 *
 * What it proves is the claim the whole mechanism rests on: the ability is
 * written on the SPECIALIZATION, and the hero holding it gets it from there. A
 * unit test already builds the documents (tools/test-heroes.ts); what only a run
 * through the form can say is that the field survives the payload, the archive
 * and being opened again.
 */
test('a specialization can hand this spell to whoever holds it', async () => {
  test.setTimeout(3 * 60_000);
  const { page } = ed;
  const SPEC = { id: 'HERO_SPEC_E2E_ABILITY', name: 'Наставник' };

  // The Spells window has to GO first, not merely be behind: a `<dialog open>`
  // takes the whole surface, so the button that opens the Heroes window is
  // visible, enabled and stable — and every click on it lands on the dialog in
  // front. The spec that follows opens Spells again if it is closed.
  if (await page.locator('#spellsmod').isVisible()) await page.locator('#sm-cancel').click();
  await expect(page.locator('#spellsmod')).toBeHidden();
  await page.locator('#heroesbtn').click();
  await expect(page.locator('#heroesmod')).toBeVisible();
  await page.locator('#hm-tabs button', { hasText: 'Specializations' }).click();
  await page.locator('#hs-new').click();
  await expect(page.locator('#specedit')).toBeVisible();

  // The spell just built is in the picker BECAUSE it is the mod's. A shipped
  // spell is not offered: it already reaches its heroes the way the game hands
  // it out, and a second quieter door to the same thing is not wanted.
  await expect(page.locator('#hs-ability option')).toContainText([/none/, new RegExp(SPELL.id)]);

  await page.locator('#hs-id').fill(SPEC.id);
  await page.locator('#hs-name').fill(SPEC.name);
  await page.locator('#hs-ability').selectOption(SPELL.id);
  const note = await settled(page, 'installing the specialization', '#hm-note', '#hs-err',
    () => page.locator('#hs-ok').click());
  expect(note).toContain('Installed');
  await expect(page.locator('#hs-list')).toContainText(`grants ${SPELL.id}`);

  // In the manifest, which is what the build reads when it writes the heroes.
  const ours = (readInstalledMod(GAME).specializations ?? []).find((s) => s.id === SPEC.id);
  expect(ours, 'the manifest remembers it').toBeTruthy();
  expect(ours!.ability).toBe(SPELL.id);

  // And back out again: a field that saves and does not reload is a field that
  // is silently cleared the next time anybody presses OK on this form.
  await page.locator('#hs-list .um-item', { hasText: SPEC.name }).first()
    .locator('button', { hasText: '✎' }).click();
  await expect(page.locator('#specedit')).toBeVisible();
  await expect(page.locator('#hs-ability')).toHaveValue(SPELL.id);
  await page.locator('#specedit-cancel').click();
  await page.locator('#hm-cancel').click();
  await expect(page.locator('#heroesmod')).toBeHidden();
});

/**
 * Removing WARNS and then does it — it is never refused.
 *
 * A map stores a spell's NAME, in a hero's book, a guild's list, on a shrine, so
 * the question is asked with those maps in front of it; a hero of the mod who
 * knows it and a class that prefers it are ours, so they are named too and then
 * edited. What none of that does is stand in the way: something you cannot
 * delete because something else names it is a trap, not a safeguard.
 */
test('removing asks first — Cancel means no, and Remove means gone', async () => {
  test.setTimeout(3 * 60_000);
  const { page } = ed;
  if (!(await page.locator('#spellsmod').isVisible())) await page.locator('#spellsbtn').click();
  const row = page.locator('#sm-list .um-item').filter({ hasText: SPELL.name });
  await row.locator('button', { hasText: '×' }).click();
  await expect(page.locator('#ask-text')).toContainText(/Remove .*\?/);
  await page.locator('#ask-no').click();
  await expect(page.locator('#ask')).toBeHidden();
  // Cancel means it is still there — the assertion a native `confirm()` could
  // not make, because nothing could press its buttons.
  expect(readInstalledMod(GAME).spells?.map((x) => x.id)).toContain(SPELL.id);

  const had = readInstalledMod(GAME).spells!.find((x) => x.id === SPELL.id)!.number;
  await row.locator('button', { hasText: '×' }).click();
  await page.locator('#ask-yes').click();
  await expect(page.locator('#sm-note')).toContainText('removed', { timeout: 120_000 });
  await expect(page.locator('#sm-list')).not.toContainText(SPELL.name);
  const left = readInstalledMod(GAME).spells ?? [];
  expect(left.map((x) => x.id)).not.toContain(SPELL.id);
  // And the numbering closed up behind it: the value IS the position in the
  // table, so a hole in it would repoint everything after the gap.
  expect(left.map((x) => x.number)).toEqual(left.map((_, i) => SHIPPED_SPELLS + i));
  // The extension's file is written from the whole mod every time, so the rows
  // that named its tiles and its spared kinds go with it rather than being left
  // behind pointing at a number the table no longer has.
  expect(readSpellRows(readFileSync(join(GAME, EFFECTS_FILE), 'latin1'))
    .map((r) => r.spell)).not.toContain(had);
});
