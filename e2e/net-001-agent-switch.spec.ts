// The multiplayer agent's switch, end to end: a tick on the Network tab, a line
// in the file the extension reads at startup.
//
// The unit suite (tools/test-qol.ts) already checks that the flag exists on both
// sides — the C reader's vocabulary and the panel's registry — and the file
// writer against the reader. What only this layer can check is the SEAM: that
// the flag reached a tab of its own rather than the pile of preferences, that
// the tab shows it, and that Apply puts it where `native/net/agent.c` will look.
//
// Against an install of its own. A spec that ticked this in the real game folder
// would leave the agent watching somebody's next match.

import { test, expect } from '@playwright/test';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT, closeEditor, launchEditor } from './launch.ts';

/** An install with no patched executable — nothing here can take effect in it. */
const BARE = join(REPO_ROOT, '_tmp', 'e2e-net-bare');
/** A Documents of its own, so no real game profile is ever touched. */
const DOCS = join(REPO_ROOT, '_tmp', 'e2e-net-docs');
/** A data root of its own: without one the app decides it was never set up. */
const DATA = join(REPO_ROOT, '_tmp', 'e2e-net-data');

const QOL_FILE = join(BARE, 'bin', 'homm5-editor-qol.txt');
const NET_FILE = join(BARE, 'bin', 'homm5-editor-net.txt');

test.beforeAll(() => {
  for (const dir of [BARE, DOCS, DATA]) rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(BARE, 'bin'), { recursive: true });
  mkdirSync(DOCS, { recursive: true });
  mkdirSync(join(DATA, 'MapObjects'), { recursive: true });
});
test.afterAll(() => {
  for (const dir of [BARE, DOCS, DATA]) rmSync(dir, { recursive: true, force: true });
});

test('the agent has a tab of its own, and its tick reaches the file @nodata', async () => {
  const ed = await launchEditor({ HOMM5_ROOT: BARE, HOMM5_DOCUMENTS: DOCS, HOMM5_DATA: DATA });
  try {
    await ed.page.locator('#qolbtn').click();

    // Its own tab, and the switch is not among the preferences: playing with
    // somebody else is a different kind of setting, and putting it in the pile
    // is what this tab exists to avoid.
    const network = ed.page.locator('#qol-network');
    await expect(ed.page.locator('#qol-tab-network')).toBeVisible();
    await expect(network).toBeHidden();
    await expect(ed.page.locator('#qol-list #qol-net-agent'), 'not on the preferences tab').toHaveCount(0);

    await ed.page.locator('#qol-tab-network').click();
    await expect(network).toBeVisible();
    await expect(ed.page.locator('#qol-list'), 'and that tab goes away when it does').toBeHidden();
    const box = network.locator('#qol-net-agent');
    await expect(box).toBeVisible();
    await expect(box, 'off until somebody asks for it').not.toBeChecked();

    // What it costs and what it does today, in front of whoever is deciding.
    await expect(network).toContainText('ONLY WATCHES');

    await box.check();
    await ed.page.locator('#qol-apply').click();
    await expect(ed.page.locator('#qol-msg')).toContainText('settings written', { timeout: 30_000 });

    const written = readFileSync(QOL_FILE, 'utf8');
    expect(written, 'the agent is on in the file the extension reads').toMatch(/^net-agent 1$/m);
    expect(written, 'and what was not ticked is written down as off').toMatch(/^second-instance 0$/m);
  } finally {
    await closeEditor(ed);
  }
});

test('the relay and the secret reach a file of their own @nodata', async () => {
  const ed = await launchEditor({ HOMM5_ROOT: BARE, HOMM5_DOCUMENTS: DOCS, HOMM5_DATA: DATA });
  try {
    await ed.page.locator('#qolbtn').click();
    await ed.page.locator('#qol-tab-network').click();

    // A password field, because a secret read over somebody's shoulder is a
    // secret. It is still editable — this is the machine that holds it.
    await expect(ed.page.locator('#qol-net-secret')).toHaveAttribute('type', 'password');

    await ed.page.locator('#qol-net-relay').fill('ws://127.0.0.1:40200/agent');
    await ed.page.locator('#qol-net-secret').fill('a-secret-the-lobby-issued');
    await ed.page.locator('#qol-apply').click();
    await expect(ed.page.locator('#qol-msg')).toContainText('settings written', { timeout: 30_000 });

    const written = readFileSync(NET_FILE, 'utf8');
    expect(written, 'the relay is in the file the extension reads').toMatch(/^relay ws:\/\/127\.0\.0\.1:40200\/agent$/m);
    expect(written, 'and the secret with it').toMatch(/^secret a-secret-the-lobby-issued$/m);
    // Two files, not one: the flags' reader in C knows only names and 0/1.
    expect(readFileSync(QOL_FILE, 'utf8'), 'and not in the flags').not.toContain('a-secret-the-lobby-issued');
  } finally {
    await closeEditor(ed);
  }
});

test('which the panel reads back from the install @nodata', async () => {
  const ed = await launchEditor({ HOMM5_ROOT: BARE, HOMM5_DOCUMENTS: DOCS, HOMM5_DATA: DATA });
  try {
    await ed.page.locator('#qolbtn').click();
    await ed.page.locator('#qol-tab-network').click();
    await expect(ed.page.locator('#qol-net-relay')).toHaveValue('ws://127.0.0.1:40200/agent');
    await expect(ed.page.locator('#qol-net-secret')).toHaveValue('a-secret-the-lobby-issued');
  } finally {
    await closeEditor(ed);
  }
});

test('and the install can be read back into the panel @nodata', async () => {
  const ed = await launchEditor({ HOMM5_ROOT: BARE, HOMM5_DOCUMENTS: DOCS, HOMM5_DATA: DATA });
  try {
    // The file the last test wrote is still there — the panel must show what the
    // install says, not what it remembers, and the tab has to be opened for the
    // switch to be looked at at all.
    await ed.page.locator('#qolbtn').click();
    await ed.page.locator('#qol-tab-network').click();
    await expect(ed.page.locator('#qol-net-agent')).toBeChecked();

    // And off again, all the way to the file.
    await ed.page.locator('#qol-net-agent').uncheck();
    await ed.page.locator('#qol-apply').click();
    await expect(ed.page.locator('#qol-msg')).toContainText('settings written', { timeout: 30_000 });
    expect(readFileSync(QOL_FILE, 'utf8'), 'off in the file too').toMatch(/^net-agent 0$/m);
  } finally {
    await closeEditor(ed);
  }
});
