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
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT, launchEditor } from './launch.ts';

/** An install with no patched executable — nothing here can take effect in it. */
const BARE = join(REPO_ROOT, '_tmp', 'e2e-qol-bare');
/** A Documents of its own, so no real profile is ever touched. */
const DOCS = join(REPO_ROOT, '_tmp', 'e2e-qol-docs');
const PROFILE = join(DOCS, 'My Games', 'Heroes of Might and Magic V — Tribes of the East',
  'Profiles', 'Player', 'user_a2.cfg');

const QOL_FILE = join(BARE, 'bin', 'homm5-editor-qol.txt');

test.beforeAll(() => {
  rmSync(BARE, { recursive: true, force: true });
  rmSync(DOCS, { recursive: true, force: true });
  mkdirSync(join(BARE, 'bin'), { recursive: true });
  mkdirSync(join(PROFILE, '..'), { recursive: true });
  // Shaped like the game's own: the two lines borderless cares about, and one
  // it must leave alone.
  writeFileSync(PROFILE, 'setvar gfx_gamma = 1\nsetvar gfx_fullscreen = 1\nsetvar gfx_resolution = 1024x768\n', 'utf8');
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

    // An install with no copy of the executable cannot load the extension, and
    // saying so afterwards would be saying it too late.
    await expect(ed.page.locator('#qol-warn'), 'an unprepared install is called out').toBeVisible();
    await expect(ed.page.locator('#qol-warn')).toContainText('executable');
    // And WHICH install, because the same sentence without it reads as a broken
    // panel when the real fault is a window pointed at the wrong folder.
    await expect(ed.page.locator('#qol-warn'), 'and named').toContainText(BARE);
  } finally {
    await ed.app.close();
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
    await ed.app.close();
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
    await ed.app.close();
  }
});
