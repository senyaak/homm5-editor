// Build everything the Shadow of Death campaign needs — one window, one pass.
//
//   HOMM5_ROOT=C:\Projects\homm5-game-sod npm run sod-content
//
// The port needs eight things the game does not ship, and they depend on each
// other in one order: the Sharpshooter, the three pieces of the Cloak of the
// Undead King and the set they make, Gem's class, her racial and its branch, the
// weights that class gives them once they exist, her specialization, Gem
// herself, and the dwelling that hires the creature. Every one of them is
// authored through the editor's own forms, which is what makes the editor the
// only writer of the archive: one `homm5-editor.h5u`, because creatures,
// artifacts, classes, skills and specializations extend reference tables
// declared in types.xml, and a mod REPLACES that file rather than merging it.
//
// The gestures are the specs' own — mod-001 (units), mod-003 (artifacts),
// mod-004 (classes, skills, specializations, heroes), mod-006 (dwellings) — and
// they stay there, because a spec proves the form both ways: what it builds and
// what it refuses, and mod-004 finishes by taking Gem away again to prove that a
// hero can be removed. That is right for a test and wrong for an install, which
// is the whole reason this file exists rather than a runner over those specs.
// What is here is the authoring half, in the campaign's order, leaving what it
// makes.
//
// It is idempotent: whatever the installed mod already holds is skipped, so a
// run after a half-finished one finishes it instead of failing on a name that is
// already taken.
//
// This does NOT make the campaign's maps — it makes what a map may then place.
// The port converts those: C:\Projects\h3-mod, `node tools/convert-map.ts`.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect as rawExpect } from '@playwright/test';
import { buildRenderer } from './build-renderer.ts';
import { launchEditor } from '../e2e/launch.ts';
import type { Launched } from '../e2e/launch.ts';
import { settled } from '../e2e/trace.ts';
import {
  AMULET, BOOTS, CLOAK, GEM, GEM_SPEC, PALACE, PIECES, SHARPSHOOTER, TENT_MASTER, TENT_PERKS,
  UNDEAD_KING, WITCH,
} from '../e2e/mods.ts';
import { modFile } from '../src/game/mod-paths.ts';
import { MOD_STEM } from '../src/mods/mod-files.ts';
import { readCreatureMod } from '../src/mods/mod-archive.ts';
import type { CreatureMod } from '../src/mods/mod-model.ts';

type Page = Launched['page'];

// The suite's timeouts come from playwright.config.ts, which nothing outside the
// runner reads: a bare `expect` would give up after five seconds on a window
// that is loading a preset off the data root. Said once here rather than on
// every line; the few steps that take minutes still say so themselves.
const expect = rawExpect.configure({ timeout: 30_000 });

const game = process.env.HOMM5_ROOT || '';
if (!game || !existsSync(join(game, 'bin', 'H5_Game.exe'))) {
  console.error(game
    ? `no game at ${game} — expected bin\\H5_Game.exe under it`
    : 'set HOMM5_ROOT to the game copy this content is being built into');
  console.error('  e.g. HOMM5_ROOT=C:\\Projects\\homm5-game-sod npm run sod-content');
  process.exit(2);
}

/** The mod as it stands, or null before there is one. */
function installed(): CreatureMod | null {
  const path = modFile(game, 'mod', MOD_STEM);
  return existsSync(path) ? readCreatureMod(path)?.mod ?? null : null;
}

/** What is already in it — asked once per stage, since each stage adds to it. */
function holds(pick: (m: CreatureMod) => readonly string[], id: string): boolean {
  const mod = installed();
  return !!mod && pick(mod).includes(id);
}

const done: string[] = [];
const skipped: string[] = [];
function report(what: string, already: boolean): boolean {
  (already ? skipped : done).push(what);
  console.log(already ? `  · ${what} — already in the mod` : `  → ${what}`);
  return already;
}

/** Open the Heroes window on one of its tabs — the panes are one at a time. */
async function openHeroes(page: Page, tab: 'Heroes' | 'Specializations' | 'Classes' | 'Skills'): Promise<void> {
  if (!(await page.locator('#heroesmod').isVisible())) await page.locator('#heroesbtn').click();
  await expect(page.locator('#heroesmod')).toBeVisible();
  await page.locator('#hm-tabs button', { hasText: tab }).click();
  await expect(page.locator('#hm-legend')).toContainText(tab);
}

/** The Sharpshooter, on the shipped Sharp Shooter's preset. */
async function creature(page: Page): Promise<void> {
  if (report('the Sharpshooter', holds((m) => m.creatures.map((c) => c.id), SHARPSHOOTER.id))) return;

  if (!(await page.locator('#unitsmod').isVisible())) await page.locator('#unitsbtn').click();
  if (!(await page.locator('#unitedit').isVisible())) await page.locator('#um-new').click();
  // The preset is a BUTTON: press it, pick from the list it opens.
  await page.locator('#um-donor-pick').click();
  await expect(page.locator('#presetpick')).toBeVisible();
  await page.locator('#pp-search').fill('Лесные стрелки');
  await page.locator('#pp-list button').first().click();
  await expect(page.locator('#presetpick')).toBeHidden();
  await expect(page.locator('#um-shots')).toHaveValue('16'); // the preset settled

  await page.locator('#um-file').fill(SHARPSHOOTER.file); // the stem spells the id
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

  const note = await settled(page, 'installing the creature', '#um-note', '#ue-err',
    () => page.locator('#um-ok').click());
  expect(note).toMatch(/installed/i);
  await expect(page.locator('#unitedit')).toBeHidden();
  await page.locator('#um-cancel').click();
  await expect(page.locator('#unitsmod')).toBeHidden();
}

/** One piece of the Cloak. The amulet keeps the donor's slot; the others say theirs. */
async function artifact(page: Page, piece: typeof AMULET & { slot?: string }): Promise<void> {
  if (!(await page.locator('#artsmod').isVisible())) await page.locator('#artsbtn').click();
  if (!(await page.locator('#artedit').isVisible())) await page.locator('#am-new').click();
  await expect(page.locator(`#am-donor option[value="${piece.donor}"]`)).toHaveCount(1);
  await page.locator('#am-donor').selectOption(piece.donor);
  await expect(page.locator('#am-cost')).toHaveValue('7000'); // the preset settled

  await page.locator('#am-file').fill(piece.file);
  await expect(page.locator('#am-id')).toHaveValue(piece.id);
  await page.locator('#am-name').fill(piece.name);
  await page.locator('#am-desc').fill(piece.description);
  if (piece.slot) await page.locator('#am-slot').selectOption(piece.slot);
  await page.locator('#am-rank').selectOption('ARTF_CLASS_MINOR');
  if (piece.id === AMULET.id) {
    await page.locator('#am-cost').fill('5000');
    await page.locator('#am-ai').fill('700');
  }
  // The part no artifact record can hold: a percentage on a skill, which goes to
  // the file the native extension reads. The form opens empty of rows — one left
  // standing would give this piece the last one's bonus as well as its own.
  await expect(page.locator('#am-effects label')).toHaveCount(0);
  await page.locator('#am-effect-add').click();
  const row = page.locator('#am-effects label').first();
  await row.locator('select').selectOption('necromancy');
  await row.locator('input').fill(String(piece.necromancy));

  await page.locator('#am-ok').click();
  await expect(page.locator('#am-note')).toContainText('installed', { timeout: 120_000 });
  await expect(page.locator('#artedit')).toBeHidden(); // a build closes the form
}

/** The three pieces, then the set they make. */
async function artifacts(page: Page): Promise<void> {
  for (const piece of [AMULET, CLOAK, BOOTS]) {
    if (report(piece.name, holds((m) => m.artifacts.map((a) => a.id), piece.id))) continue;
    await artifact(page, piece);
  }

  if (report(UNDEAD_KING.name, holds((m) => m.sets.map((s) => s.effect), UNDEAD_KING.effect))) return;
  if (await page.locator('#artedit').isVisible()) await page.locator('#artedit-cancel').click();
  if (!(await page.locator('#artsmod').isVisible())) await page.locator('#artsbtn').click();
  await page.locator('#as-new').click();

  // Members are ticked, not typed: a misspelt id builds cleanly and produces a
  // set that never combines.
  const members = page.locator('#as-members');
  await expect(members.locator(`input[value="${AMULET.id}"]`)).toHaveCount(1);
  for (const p of PIECES) await members.locator(`input[value="${p.id}"]`).check();

  await page.locator('#as-file').fill(UNDEAD_KING.file);
  await expect(page.locator('#as-effect')).toHaveValue(UNDEAD_KING.effect); // from the stem
  await page.locator('#as-name').fill(UNDEAD_KING.name);
  await page.locator('#as-desc').fill(UNDEAD_KING.description);

  // What the set GIVES. The threshold is a field because it is ours: the
  // extension counts the worn members itself, so "two of three" needs nothing of
  // the engine's — every shipped set effect has its threshold compiled in.
  await expect(page.locator('#as-effects label')).toHaveCount(0);
  await page.locator('#as-effect-add').click();
  const effect = page.locator('#as-effects label').first();
  await effect.locator('select').selectOption('energy');
  await effect.locator('input').first().fill(String(UNDEAD_KING.energy.worn));
  await effect.locator('input').last().fill(String(UNDEAD_KING.energy.amount));

  // The words the player reads, one box per count worn. Index 0 stays blank:
  // one piece of a set is not a set.
  const counts = page.locator('#as-counts input');
  await expect(counts).toHaveCount(PIECES.length);
  for (const [i, text] of UNDEAD_KING.perCount.entries()) if (text) await counts.nth(i).fill(text);

  // And the other half: what it does on an EVENT. Lua is a row like the rest,
  // but it is never written among the fields — the row carries a pencil, and the
  // pencil opens the editor the map's own scripts are written in.
  await page.locator('#as-effect-add').click();
  const luaRow = page.locator('#as-effects label').nth(1);
  await luaRow.locator('select').selectOption('lua');
  await luaRow.locator('.as-effect-edit').click();
  await expect(page.locator('#setscript')).toBeVisible();
  await page.locator('#ss-text .cm-content').fill(UNDEAD_KING.script);
  await expect(page.locator('#ss-lint'), 'the set ships no script that does not parse')
    .toHaveText('✓ no errors');
  await page.locator('#ss-ok').click();
  await expect(page.locator('#setscript')).toBeHidden();

  await page.locator('#as-ok').click();
  await expect(page.locator('#am-note')).toContainText('installed', { timeout: 120_000 });
  await expect(page.locator('#as-list')).toContainText(UNDEAD_KING.name);
  await page.locator('#am-cancel').click();
  await expect(page.locator('#artsmod')).toBeHidden();
}

/**
 * Her class, on the Ranger's numbers — and without her racial's weight.
 *
 * A class cannot weight a skill that does not exist yet, so the racial's ten
 * points sit on the war machines until it does and `reweight` moves them. That
 * is the order the window forces, not a choice.
 */
async function heroClass(page: Page): Promise<void> {
  if (report(`the class ${WITCH.name}`, holds((m) => (m.classes ?? []).map((c) => c.id), WITCH.id))) return;

  await openHeroes(page, 'Classes');
  await page.locator('#hc-new').click();
  await expect(page.locator('#classedit')).toBeVisible();

  // A class of ours is not a copy, but it starts from one: thirteen weights and
  // four attributes are a lot to type when eight sensible sets of them ship.
  await page.locator('#hc-donor-pick').click();
  await expect(page.locator('#presetpick')).toBeVisible();
  await page.locator('#pp-search').fill('RANGER');
  await page.locator('#pp-list button', { hasText: 'RANGER' }).first().click();
  await expect(page.locator('#presetpick')).toBeHidden();
  await expect(page.locator('#hc-skill-total')).toHaveText(/100/);

  await page.locator('#hc-id').fill(WITCH.id);
  await page.locator('#hc-name').fill(WITCH.name);

  const { [TENT_MASTER.id]: racial = 0, ...rest } = WITCH.weights;
  const before = { ...rest, HERO_SKILL_WAR_MACHINES: (rest.HERO_SKILL_WAR_MACHINES ?? 0) + racial };
  for (const [skill, prob] of Object.entries(before)) {
    await page.locator(`#hc-skills input[data-skill="${skill}"]`).fill(String(prob));
  }
  for (const [id, value] of Object.entries({
    'hc-off': WITCH.attributes.offence, 'hc-def': WITCH.attributes.defence,
    'hc-sp': WITCH.attributes.spellpower, 'hc-kn': WITCH.attributes.knowledge,
  })) await page.locator(`#${id}`).fill(String(value));
  await expect(page.locator('#hc-skill-total')).toHaveText('100 ✓');
  await expect(page.locator('#hc-attr-total')).toHaveText('100 ✓');

  // «Чумная палатка», which four classes may pitch and the Ranger is not among
  // them: one move between the two sides of the availability list is the whole
  // of that gate.
  await page.locator('#hc-denied').selectOption(WITCH.perk);
  await page.locator('#hc-allow').click();
  await expect(page.locator(`#hc-allowed option[value="${WITCH.perk}"]`)).toHaveCount(1);

  const note = await settled(page, 'installing the class', '#hm-note', '#hc-err',
    () => page.locator('#hc-ok').click());
  expect(note).toContain('Installed');
}

/** One skill — the racial, or one of the four perks that hang off it. */
async function skill(page: Page, s: {
  id: string; name: string; description: string; pictures: readonly string[];
  effects: Readonly<Record<string, number | undefined>>; kind: 'racial' | 'perk';
}): Promise<void> {
  await page.locator('#hk-new').click();
  await expect(page.locator('#skilledit')).toBeVisible();
  await page.locator('#hk-id').fill(s.id);
  await page.locator('#hk-kind').selectOption(s.kind);
  // It belongs to a class of OURS — the only kind a racial of ours can belong
  // to, since the binding is the skill naming the class.
  await page.locator('#hk-class').selectOption(WITCH.id);
  if (s.kind === 'perk') await page.locator('#hk-branch').selectOption(TENT_MASTER.id);
  await page.locator('#hk-name').fill(s.name);
  await page.locator('#hk-desc').fill(s.description);
  // A drawing per level for a racial, grey and lit for a perk. Typed rather than
  // chosen: the button beside each row opens the system's file dialog, and this
  // field is what it writes into.
  for (const [i, picture] of s.pictures.entries()) await page.locator(`#hk-pic-${i + 1}`).fill(picture);
  // And what it DOES — a term the extension adds to a sum the engine computes.
  // A skill with no row is a name and a drawing.
  const [stat, amount] = Object.entries(s.effects)[0]!;
  await page.locator('#hk-effect-add').click();
  await page.locator('#hk-effects .hk-effect-stat').last().selectOption(stat);
  await page.locator('#hk-effects .hk-effect-amount').last().fill(String(amount));

  const note = await settled(page, `installing ${s.name}`, '#hm-note', '#hk-err',
    () => page.locator('#hk-ok').click());
  expect(note).toContain('Installed');
}

/** Her racial, then the branch it gates. */
async function skills(page: Page): Promise<void> {
  const wanted = [
    { ...TENT_MASTER, kind: 'racial' as const },
    ...TENT_PERKS.map((p) => ({ ...p, kind: 'perk' as const })),
  ];
  const missing = wanted.filter((s) => !report(s.name, holds((m) => (m.skills ?? []).map((x) => x.id), s.id)));
  if (!missing.length) return;

  await openHeroes(page, 'Skills');
  for (const s of missing) await skill(page, s);
}

/**
 * Now the class can weight the racial, which it could not an hour ago.
 *
 * Skipped when the weight is already hers — the same test the other stages make,
 * asked of a number rather than of a name.
 */
async function reweight(page: Page): Promise<void> {
  const mod = installed();
  const ours = (mod?.classes ?? []).find((c) => c.id === WITCH.id);
  const already = !!ours?.skills.some((w) => w.skill === TENT_MASTER.id && w.prob > 0);
  if (report(`${WITCH.name} weighting her racial`, already)) return;

  await openHeroes(page, 'Classes');
  await page.locator('#hc-list .um-item', { hasText: WITCH.name }).first()
    .locator('button', { hasText: '✎' }).click();
  await expect(page.locator('#classedit')).toBeVisible();
  await page.locator(`#hc-skills input[data-skill="${TENT_MASTER.id}"]`)
    .fill(String(WITCH.weights[TENT_MASTER.id]));
  await page.locator('#hc-skills input[data-skill="HERO_SKILL_WAR_MACHINES"]')
    .fill(String(WITCH.weights.HERO_SKILL_WAR_MACHINES));
  await expect(page.locator('#hc-skill-total')).toHaveText('100 ✓');

  const note = await settled(page, 'reweighting the class', '#hm-note', '#hc-err',
    () => page.locator('#hc-ok').click());
  expect(note).toContain('Updated');
}

/** Her specialization — the one thing no arrangement of the game's data expresses. */
async function specialization(page: Page): Promise<void> {
  if (report(GEM_SPEC.name, holds((m) => (m.specializations ?? []).map((x) => x.id), GEM_SPEC.id))) return;

  await openHeroes(page, 'Specializations');
  await page.locator('#hs-new').click();
  await expect(page.locator('#specedit')).toBeVisible();
  await page.locator('#hs-id').fill(GEM_SPEC.id);
  await page.locator('#hs-name').fill(GEM_SPEC.name);
  await page.locator('#hs-desc').fill(GEM_SPEC.description);
  await page.locator('#hs-pic').fill(GEM_SPEC.picture);
  await page.locator('#hs-stat').selectOption(GEM_SPEC.effect.stat);
  await page.locator('#hs-percent').fill(String(GEM_SPEC.effect.percentPerLevel));

  const note = await settled(page, 'installing the specialization', '#hm-note', '#hs-err',
    () => page.locator('#hs-ok').click());
  expect(note).toContain('Installed');
}

/** And Gem, who is made of all of it. */
async function hero(page: Page): Promise<void> {
  if (report(GEM.name, holds((m) => m.heroes.map((h) => h.id), GEM.id))) return;

  await openHeroes(page, 'Heroes');
  if (!(await page.locator('#heroedit').isVisible())) await page.locator('#hm-new').click();
  await page.locator('#he-preset-pick').click();
  await expect(page.locator('#presetpick')).toBeVisible();
  await page.locator('#pp-search').fill('Ossir');
  await page.locator('#pp-list button', { hasText: 'Ossir' }).first().click();
  await expect(page.locator('#presetpick')).toBeHidden();
  // The preset fills the appearance fields; the model settling is the signal
  // that it has, since everything else can be set before it arrives.
  await expect(page.locator('#he-model')).not.toHaveValue('', { timeout: 30_000 });

  await page.locator('#he-id').fill(GEM.id);
  await page.locator('#he-name').fill(GEM.name);
  await page.locator('#he-bio').fill(GEM.biography);
  await page.locator('#he-spec').selectOption(GEM.spec);
  // Words of her own on top of the specialization's: a specialization carries
  // what its heroes SHOULD say, and a hero may still say something else.
  await page.locator('#he-spec-name').fill(GEM.specName);
  await page.locator('#he-spec-desc').fill(GEM.specText);
  await page.locator('#he-spec-pic').fill(GEM.specPicture);
  // Her face lives under the fold with the rest of the appearance, so the fold
  // has to be opened first — the same click a person makes.
  await page.locator('#heroedit details.he-art summary').click();
  await page.locator('#he-portrait-pic').fill(GEM.portrait);

  await page.locator('#he-class').selectOption(GEM.heroClass);
  await page.locator('#he-primary').selectOption(GEM.racial);
  await page.locator('#he-skill').selectOption(GEM.skill);
  await page.locator('#he-perk').selectOption(GEM.perk);
  // The tent she is specialised in, which is what she is in both games.
  await page.locator('#he-tent').check();
  await page.locator('#he-off').fill(String(GEM.attributes.off));
  await page.locator('#he-def').fill(String(GEM.attributes.def));
  await page.locator('#he-sp').fill(String(GEM.attributes.sp));
  await page.locator('#he-kn').fill(String(GEM.attributes.kn));

  const note = await settled(page, 'installing Gem', '#hm-note', '#he-err',
    () => page.locator('#he-ok').click());
  expect(note).toContain('Installed');
  await expect(page.locator('#hm-list')).toContainText(GEM.name);
  await page.locator('#hm-close').click();
}

/** The dwelling that hires the creature — the object a converted map places. */
async function dwelling(page: Page): Promise<void> {
  if (report(PALACE.name, holds((m) => m.buildings.map((b) => b.file), PALACE.file))) return;

  if (await page.locator('#heroesmod').isVisible()) await page.locator('#hm-close').click();
  await page.locator('#bldbtn').click();
  await expect(page.locator('#bldmod')).toBeVisible();
  await page.locator('#bld-tabs .mp-tab', { hasText: 'Dwelling' }).first().click();
  await page.locator('#bld-new').click();
  await expect(page.locator('#bldedit')).toBeVisible();

  // No preset: what is wanted is the elves' tier-3 dwelling's LOOK with our own
  // creature behind it, so the art is named outright.
  await page.locator('#bld-file').fill(PALACE.file);
  await page.locator('#bld-type').selectOption(PALACE.type);
  await page.locator('#bld-model').fill(PALACE.model);
  await page.locator('#bld-animset').fill(PALACE.animSet);
  await page.locator('#bld-effect').fill(PALACE.effect);
  await page.locator('#bld-icon').fill(PALACE.icon);
  // What it hires — the field only this class has.
  await page.locator('.bld-field[data-field="creatures"]').fill(PALACE.creatures.join(', '));

  // Its six lines, in the order the engine reads them.
  const lines = [
    PALACE.name, PALACE.description, PALACE.firstVisit,
    PALACE.secondVisit, PALACE.firstVisitNoHire, PALACE.secondVisitNoHire,
  ];
  await expect(page.locator('#bld-texts .bld-text')).toHaveCount(6);
  for (const [i, line] of lines.entries()) await page.locator('#bld-texts .bld-text').nth(i).fill(line);

  await page.locator('#bld-ok').click();
  await expect(page.locator('#bldedit')).toBeHidden({ timeout: 240_000 });

  // Repainted, or it IS the High Cabins with a different sign on it: same model,
  // same animation, same colours, standing next to the real one on the same map.
  await page.locator('#bld-list .um-item', { hasText: PALACE.name }).locator('.um-paint').click();
  await expect(page.locator('#recolor')).toBeVisible();
  await page.locator('#rc-hue').fill(String(PALACE.recolor.hue));
  await page.locator('#rc-ok').click();
  await expect(page.locator('#rc-note')).toContainText(/repainted \d+ texture/, { timeout: 240_000 });
  await page.locator('#rc-close').click();
}

console.log(`building the campaign's content into ${game}\n`);
// The app loads a BUILT renderer bundle; without this the run drives whatever
// app.js was last left on disk. Same reason the suite's global setup does it.
await buildRenderer();

const ed = await launchEditor({ HOMM5_ROOT: game });
try {
  await creature(ed.page);
  await artifacts(ed.page);
  await heroClass(ed.page);
  await skills(ed.page);
  await reweight(ed.page);
  await specialization(ed.page);
  await hero(ed.page);
  await dwelling(ed.page);
} finally {
  await ed.app.close();
}

// What it comes to: read the archive back rather than repeat what was asked for.
// A form can close on a note that says Installed and still have installed
// something other than the campaign expects, and the archive is the only place
// that says which.
const mod = installed();
if (!mod) {
  console.error(`\nnothing was written — no mod at ${modFile(game, 'mod', MOD_STEM)}`);
  process.exit(1);
}
const line = (what: string, names: readonly string[]): void => {
  console.log(`  ${what.padEnd(16)} ${names.length}${names.length ? `  ${names.join(', ')}` : ''}`);
};
console.log(`\ninstalled — ${modFile(game, 'mod', MOD_STEM)}\n`);
line('creatures', mod.creatures.map((c) => c.id));
line('buildings', mod.buildings.map((b) => b.file));
line('artifacts', mod.artifacts.map((a) => a.id));
line('sets', mod.sets.map((s) => s.effect));
line('classes', (mod.classes ?? []).map((c) => c.id));
line('skills', (mod.skills ?? []).map((s) => s.id));
line('specializations', (mod.specializations ?? []).map((s) => s.id));
line('heroes', mod.heroes.map((h) => h.id));

// The campaign's list, checked against the archive rather than against the log:
// a stage that was skipped as "already there" and a stage that never ran leave
// the same silence otherwise.
const missing = [
  ...(mod.creatures.some((c) => c.id === SHARPSHOOTER.id) ? [] : [SHARPSHOOTER.id]),
  ...PIECES.filter((p) => !mod.artifacts.some((a) => a.id === p.id)).map((p) => p.id),
  ...(mod.sets.some((s) => s.effect === UNDEAD_KING.effect) ? [] : [UNDEAD_KING.effect]),
  ...((mod.classes ?? []).some((c) => c.id === WITCH.id) ? [] : [WITCH.id]),
  ...[TENT_MASTER, ...TENT_PERKS].filter((s) => !(mod.skills ?? []).some((x) => x.id === s.id))
    .map((s) => s.id),
  ...((mod.specializations ?? []).some((s) => s.id === GEM_SPEC.id) ? [] : [GEM_SPEC.id]),
  ...(mod.heroes.some((h) => h.id === GEM.id) ? [] : [GEM.id]),
  ...(mod.buildings.some((b) => b.file === PALACE.file) ? [] : [PALACE.file]),
];
console.log(`\n${done.length} authored, ${skipped.length} already there`);
if (missing.length) {
  console.error(`\nthe campaign is still missing:\n  ${missing.join('\n  ')}`);
  process.exit(1);
}
console.log("the campaign's content is all in the archive");
