// The game settings panel, end to end: a tick in the window, a file on disk.
//
// The unit suite (tools/test-qol.ts) already checks the writer and the reader
// against each other. What only this layer can check is the SEAM — that the
// button opens the panel, that the panel shows what the install says rather
// than what it remembers, and that pressing Apply reaches the file the
// extension will read. A panel wired to nothing looks identical from the
// outside until somebody starts the game.
//
// Against installs of its own, never the real one. Two of them, because the
// interesting states are "not prepared at all" and "prepared" and they say
// different things — and a spec that wrote into the game folder would leave a
// borderless flag behind for whoever played next.
//
// HOMM5_DOCUMENTS is the reason the profile half can be tested at all: without
// it, applying borderless would edit the game profile of whoever ran the suite.

import { test, expect } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT, closeEditor, launchEditor } from './launch.ts';
import { writeArchive } from '#src/format/pak.ts';
import { QOL_ARCHIVE } from '#src/mods/qol-ui.ts';

/** An install with no patched executable — nothing here can take effect in it. */
const BARE = join(REPO_ROOT, '_tmp', 'e2e-qol-bare');
/** A Documents of its own, so no real profile is ever touched. */
const DOCS = join(REPO_ROOT, '_tmp', 'e2e-qol-docs');
const PROFILE = join(DOCS, 'My Games', 'Heroes of Might and Magic V — Tribes of the East',
  'Profiles', 'Player', 'user_a2.cfg');

const QOL_FILE = join(BARE, 'bin', 'homm5-editor-qol.txt');
const ARCHIVE = join(BARE, QOL_ARCHIVE);

test.beforeAll(() => {
  rmSync(BARE, { recursive: true, force: true });
  rmSync(DOCS, { recursive: true, force: true });
  mkdirSync(join(BARE, 'bin'), { recursive: true });
  mkdirSync(join(PROFILE, '..'), { recursive: true });
  // Shaped like the game's own: the two lines borderless cares about, and one
  // it must leave alone.
  writeFileSync(PROFILE, 'setvar gfx_gamma = 1\nsetvar gfx_fullscreen = 1\nsetvar gfx_resolution = 1024x768\n', 'utf8');
  // A data.pak of the right SHAPE, because the health-bar archive is built out
  // of the install's own: the four files the build copies fields from, each cut
  // to the pattern it is read by. The build only patches strings and repaints
  // pixels, so stand-ins prove the plumbing without a two-gigabyte fixture.
  mkdirSync(join(BARE, 'data'), { recursive: true });
  writeFileSync(join(BARE, 'data', 'data.pak'), writeArchive([
    {
      name: 'UI/CombatArena-FPP-2/StackInfo.(WindowMSButtonShared).xdb',
      data: Buffer.from('<?xml version="1.0"?><WindowMSButtonShared><Children>\n'
        + '\t<Item href="/UI/CombatArena/StackInfo/StackText.(WindowTextView).xdb#xpointer(/WindowTextView)"/>\n'
        + '</Children></WindowMSButtonShared>', 'utf8'),
    },
    // 128 bytes of DDS header, 15x15 BGRA pixels — the sizes the repaint assumes.
    { name: 'Textures/Interface/CombatArena/StackInfo/Positive.dds', data: Buffer.alloc(128 + 15 * 15 * 4) },
    {
      name: 'Textures/Interface/CombatArena/StackInfo/Positive.xdb',
      data: Buffer.from('<?xml version="1.0"?><Texture><SrcName href="x.tga"/><DestName href="x.dds"/></Texture>', 'utf8'),
    },
    {
      name: 'UI/AdventureScreen/StackInfo/Positive.(BackgroundTiledTexture).xdb',
      data: Buffer.from('<?xml version="1.0"?><BackgroundTiledTexture><Texture href="x.xdb"/></BackgroundTiledTexture>', 'utf8'),
    },
  ]));
});
test.afterAll(() => {
  rmSync(BARE, { recursive: true, force: true });
  rmSync(DOCS, { recursive: true, force: true });
});

test('the panel opens from the bar with everything off @nodata', async () => {
  const ed = await launchEditor({ HOMM5_ROOT: BARE, HOMM5_DOCUMENTS: DOCS });
  try {
    const btn = ed.page.locator('#qolbtn');
    await expect(btn, 'the button is in the bar').toBeVisible();
    // Offered with no map open, like Play: these are settings of the GAME.
    await expect(btn, 'and offered whether or not a map is open').toBeEnabled();

    await btn.click();
    await expect(ed.page.locator('#qolcfg'), 'the panel opens').toBeVisible();

    // A <dialog> that is not given its own chrome keeps the UA's — a white box
    // and, worse, black text, which lands unreadable on the dark card inside
    // it. Every other dialog here resets both by id, and this one shipped
    // without doing so: asserted rather than remembered.
    const chrome = await ed.page.locator('#qolcfg').evaluate((el) => {
      const s = getComputedStyle(el);
      return { color: s.color, background: s.backgroundColor };
    });
    expect(chrome.color, 'the dialog does not keep the UA text colour').not.toBe('rgb(0, 0, 0)');
    expect(chrome.background, 'nor its opaque white box').toBe('rgba(0, 0, 0, 0)');

    // The promise the whole feature rests on: an install nobody configured
    // plays exactly as it did before.
    const boxes = ed.page.locator('#qol-list input[type=checkbox]');
    await expect(boxes.first(), 'the flags are listed').toBeVisible();
    const count = await boxes.count();
    expect(count, 'every flag has a switch').toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      await expect(boxes.nth(i), 'and starts off').not.toBeChecked();
    }

    // The detail is FOLDED: six paragraphs open at once is a panel somebody
    // scrolls past to reach the switches. Shut on open, and the words are there
    // when the fold is used — asserted both ways, since a fold that opens onto
    // nothing looks identical to one nobody clicked.
    const fold = ed.page.locator('.qol-row', { has: ed.page.locator('#qol-borderless') })
      .locator('.qol-detail');
    await expect(fold, 'the detail starts folded away').not.toHaveAttribute('open', /.*/);
    await expect(fold.locator('span'), 'so its words are not on the screen yet').toBeHidden();
    await fold.locator('summary').click();
    await expect(fold.locator('span'), 'and the fold opens onto them').toBeVisible();
    await expect(fold.locator('span'), 'the same words the config file carries')
      .toContainText('exclusive fullscreen');
    // Opening it must not have ticked anything: the fold lives outside the
    // label for exactly this reason, and a summary inside one toggles the box.
    await expect(ed.page.locator('#qol-borderless'), 'and opening it ticks nothing')
      .not.toBeChecked();

    // The second tab: fixes, grouped, with a master switch. Preferences and
    // fixes are lines in the same file, but they are different KINDS of line —
    // the tab is what says so.
    await expect(ed.page.locator('#qol-fixes'), 'the fixes start hidden').toBeHidden();
    await ed.page.locator('#qol-tab-fixes').click();
    await expect(ed.page.locator('#qol-fixes'), 'the tab shows them').toBeVisible();
    await expect(ed.page.locator('#qol-list'), 'and hides the preferences').toBeHidden();
    await expect(ed.page.locator('#qol-combat-ai-fix'), 'the AI fix lives here now').toBeVisible();
    await expect(ed.page.locator('.qol-group').filter({ hasText: 'Battle AI' }),
      'under its group heading').toBeVisible();
    // A heading with no rows under it is an empty promise — only groups that
    // have a fix are shown at all.
    await expect(ed.page.locator('.qol-group')).toHaveCount(1);

    // The master: every fix at once, and it mirrors the rows both ways.
    const master = ed.page.locator('#qol-all-fixes');
    await expect(master, 'the master starts off').not.toBeChecked();
    await master.check();
    await expect(ed.page.locator('#qol-combat-ai-fix'), 'checking it checks the fixes').toBeChecked();
    await ed.page.locator('#qol-combat-ai-fix').uncheck();
    await expect(master, 'and unchecking a fix takes the master with it').not.toBeChecked();

    // A flag that is somebody else's work says so on the row, not only in the
    // repository: the mark is beside the name and its tooltip names them and
    // where they published it. Asserted because a credit nobody can see is the
    // same as no credit at all.
    const credit = ed.page.locator('.qol-row', { has: ed.page.locator('#qol-combat-ai-fix') })
      .locator('.qol-credit');
    await expect(credit, 'the credited flag carries a mark').toBeVisible();
    await expect(credit, 'and the tooltip names whose work it is')
      .toHaveAttribute('title', /CombatAIFix v1\.1 by RedHavenHero/);
    await expect(credit, 'and where to find it')
      .toHaveAttribute('title', /forum\.heroesworld\.ru\/showthread\.php\?t=15624/);
    // Only where there IS a credit — an (i) on every row would say nothing.
    await ed.page.locator('#qol-tab-qol').click();
    await expect(ed.page.locator('#qol-list'), 'the first tab comes back').toBeVisible();
    await expect(ed.page.locator('.qol-row', { has: ed.page.locator('#qol-borderless') })
      .locator('.qol-credit'), 'and our own flags carry none').toHaveCount(0);

    // An install with no copy of the executable cannot load the extension, and
    // saying so afterwards would be saying it too late.
    await expect(ed.page.locator('#qol-warn'), 'an unprepared install is called out').toBeVisible();
    await expect(ed.page.locator('#qol-warn')).toContainText('executable');
    // And WHICH install, because the same sentence without it reads as a broken
    // panel when the real fault is a window pointed at the wrong folder.
    await expect(ed.page.locator('#qol-warn'), 'and named').toContainText(BARE);

    // An unprepared install is a state the panel is meant to REPORT, so nothing
    // in getting here may have thrown — which `closeEditor` checks, here and in
    // every other test: a renderer that died at the top of the bundle keeps the
    // whole static page, and every expectation above would pass over its
    // wreckage.
  } finally {
    await closeEditor(ed);
  }
});

test('applying writes the file the extension reads, and the profile @nodata', async () => {
  const ed = await launchEditor({ HOMM5_ROOT: BARE, HOMM5_DOCUMENTS: DOCS });
  try {
    await ed.page.locator('#qolbtn').click();
    await ed.page.locator('#qol-borderless').check();
    await ed.page.locator('#qol-apply').click();

    // The settings are kept even though this install cannot take the extension:
    // they are what was asked for, and the reason they are inert is a message,
    // not a reason to discard them.
    await expect(ed.page.locator('#qol-msg')).toContainText('settings written', { timeout: 30_000 });

    const written = readFileSync(QOL_FILE, 'utf8');
    expect(written, 'borderless is on in the file').toMatch(/^borderless 1$/m);
    expect(written, 'and what was not ticked is written down as off').toMatch(/^own-profile 0$/m);

    // The other half of borderless, in the game's own profile.
    const profile = readFileSync(PROFILE, 'utf8');
    expect(profile, 'windowed mode is set').toMatch(/^setvar gfx_fullscreen = 0$/m);
    expect(profile, 'the render size follows the screen').toMatch(/^setvar gfx_resolution = \d+x\d+$/m);
    expect(profile, 'nothing else in the profile moved').toContain('setvar gfx_gamma = 1');
  } finally {
    await closeEditor(ed);
  }
});

test('the battle-plate flags reach the file, and the bar its archive @nodata', async () => {
  const ed = await launchEditor({ HOMM5_ROOT: BARE, HOMM5_DOCUMENTS: DOCS });
  try {
    await ed.page.locator('#qolbtn').click();
    await ed.page.locator('#qol-stack-health-bar').check();
    await ed.page.locator('#qol-stack-losses').check();
    await ed.page.locator('#qol-apply').click();
    await expect(ed.page.locator('#qol-msg')).toContainText('settings written', { timeout: 30_000 });

    const written = readFileSync(QOL_FILE, 'utf8');
    expect(written, 'the bar is on in the file').toMatch(/^stack-health-bar 1$/m);
    expect(written, 'and the losses beside it').toMatch(/^stack-losses 1$/m);

    // The half of the bar the config line cannot carry: the strips are child
    // windows in an archive, drawn by the game itself, so applying the flag
    // must put that archive into the install...
    expect(existsSync(ARCHIVE), 'the archive is written beside the flag').toBe(true);

    // ...and taking the flag back must take the archive with it, or the bar
    // stays on the screen of somebody who turned it off.
    await ed.page.locator('#qol-stack-health-bar').uncheck();
    await ed.page.locator('#qol-apply').click();
    await expect.poll(() => existsSync(ARCHIVE), { timeout: 30_000 }).toBe(false);
    expect(readFileSync(QOL_FILE, 'utf8'), 'while the other flag keeps its line')
      .toMatch(/^stack-losses 1$/m);
  } finally {
    await closeEditor(ed);
  }
});

test('the panel shows what the install says, not what it remembers @nodata', async () => {
  // Written by hand, the way somebody debugging would: the panel must come up
  // agreeing with the file rather than with anything it kept from last time.
  writeFileSync(QOL_FILE, '# by hand\nborderless 0\nown-profile 1\n', 'utf8');

  const ed = await launchEditor({ HOMM5_ROOT: BARE, HOMM5_DOCUMENTS: DOCS });
  try {
    await ed.page.locator('#qolbtn').click();
    await expect(ed.page.locator('#qol-own-profile'), 'what the file turned on is on').toBeChecked();
    await expect(ed.page.locator('#qol-borderless'), 'what it turned off is off').not.toBeChecked();
  } finally {
    await closeEditor(ed);
  }
});
