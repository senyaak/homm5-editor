// The multiplayer switch, end to end: one tick on the Network tab, two lines
// in the file the extension reads at startup.
//
// The unit suite (tools/test-qol.ts) already checks that the flags exist on both
// sides — the C reader's vocabulary and the panel's registry — and the file
// writer against the reader. What only this layer can check is the SEAM: that
// the panel asks ONCE for what the file keeps as two flags, that a lobby picked
// by name fills the addresses, and that Apply puts everything where
// `native/net/agent.c` and `native/net/lobby.c` will look.
//
// Against an install of its own. A spec that ticked this in the real game folder
// would leave the agent carrying somebody's next match.

import { test, expect } from '@playwright/test';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

/** What the panel offers by name — the same values renderer/features/qol.ts carries. */
const PRESET = {
  relay: 'wss://relay-h5e.senyaak.work/agent',
  uLobby: 'wss://u-lobby-h5e.senyaak.work/u-lobby',
};

test.beforeAll(() => {
  for (const dir of [BARE, DOCS, DATA]) rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(BARE, 'bin'), { recursive: true });
  mkdirSync(DOCS, { recursive: true });
  mkdirSync(join(DATA, 'MapObjects'), { recursive: true });
});
test.afterAll(() => {
  for (const dir of [BARE, DOCS, DATA]) rmSync(dir, { recursive: true, force: true });
});

test('one switch on its own tab, and its tick reaches BOTH flags @nodata', async () => {
  const ed = await launchEditor({ HOMM5_ROOT: BARE, HOMM5_DOCUMENTS: DOCS, HOMM5_DATA: DATA });
  try {
    await ed.page.locator('#qolbtn').click();

    // Its own tab, and the switch is not among the preferences: playing with
    // somebody else is a different kind of setting, and putting it in the pile
    // is what this tab exists to avoid.
    const network = ed.page.locator('#qol-network');
    await expect(ed.page.locator('#qol-tab-network')).toBeVisible();
    await expect(network).toBeHidden();
    await expect(ed.page.locator('#qol-list #qol-net-on'), 'not on the preferences tab').toHaveCount(0);

    await ed.page.locator('#qol-tab-network').click();
    await expect(network).toBeVisible();
    await expect(ed.page.locator('#qol-list'), 'and that tab goes away when it does').toBeHidden();

    // ONE switch. The two flags it writes have no rows of their own any more:
    // to somebody deciding, playing through a lobby is one thing.
    const box = network.locator('#qol-net-on');
    await expect(box).toBeVisible();
    await expect(box, 'off until somebody asks for it').not.toBeChecked();
    await expect(network.locator('#qol-net-agent'), 'no separate agent row').toHaveCount(0);
    await expect(network.locator('#qol-net-u-lobby'), 'no separate lobby row').toHaveCount(0);

    await box.check();
    await ed.page.locator('#qol-apply').click();
    await expect(ed.page.locator('#qol-msg')).toContainText('settings written', { timeout: 30_000 });

    const written = readFileSync(QOL_FILE, 'utf8');
    expect(written, 'the agent half is on in the file the extension reads').toMatch(/^net-agent 1$/m);
    expect(written, 'and so is the lobby half — one tick, both flags').toMatch(/^net-u-lobby 1$/m);
    expect(written, 'and what was not ticked is written down as off').toMatch(/^second-instance 0$/m);
  } finally {
    await closeEditor(ed);
  }
});

test('a lobby picked by name fills the two addresses, and only them @nodata', async () => {
  const ed = await launchEditor({ HOMM5_ROOT: BARE, HOMM5_DOCUMENTS: DOCS, HOMM5_DATA: DATA });
  try {
    await ed.page.locator('#qolbtn').click();
    await ed.page.locator('#qol-tab-network').click();

    // Nothing filled in yet, so the select owns up to it.
    await expect(ed.page.locator('#qol-net-preset')).toHaveValue('custom');

    // The local port is this machine's, not the lobby's — a second copy here
    // needs a different one — so the name must leave it alone.
    await ed.page.locator('#qol-net-u-lobby-port').fill('8082');
    await ed.page.locator('#qol-net-preset').selectOption('senyaak.work');
    await expect(ed.page.locator('#qol-net-relay')).toHaveValue(PRESET.relay);
    await expect(ed.page.locator('#qol-net-u-lobby-url')).toHaveValue(PRESET.uLobby);
    await expect(ed.page.locator('#qol-net-u-lobby-port'), 'the port is not the name\'s to fill').toHaveValue('8082');

    await ed.page.locator('#qol-apply').click();
    await expect(ed.page.locator('#qol-msg')).toContainText('settings written', { timeout: 30_000 });

    const written = readFileSync(NET_FILE, 'utf8');
    expect(written, 'the relay is in the file the extension reads').toContain(`relay ${PRESET.relay}`);
    expect(written, 'and so is the u-lobby').toContain(`u-lobby ${PRESET.uLobby}`);
    expect(written, 'and the port stayed what the hand set').toMatch(/^u-lobby-port 8082$/m);
    expect(written, 'and nothing claims to be a credential').not.toMatch(/^secret /m);
    // Two files, not one: the flags' reader in C knows only names and 0/1.
    expect(readFileSync(QOL_FILE, 'utf8'), 'no address in the flags').not.toContain('senyaak.work');
  } finally {
    await closeEditor(ed);
  }
});

test('which the panel reads back, and knows by name @nodata', async () => {
  const ed = await launchEditor({ HOMM5_ROOT: BARE, HOMM5_DOCUMENTS: DOCS, HOMM5_DATA: DATA });
  try {
    await ed.page.locator('#qolbtn').click();
    await ed.page.locator('#qol-tab-network').click();
    await expect(ed.page.locator('#qol-net-relay')).toHaveValue(PRESET.relay);
    await expect(ed.page.locator('#qol-net-u-lobby-url')).toHaveValue(PRESET.uLobby);
    await expect(ed.page.locator('#qol-net-u-lobby-port')).toHaveValue('8082');
    // The select is derived from the fields, so a file that names the lobby's
    // addresses reads back as the lobby's name — not as the Custom it was
    // never told about.
    await expect(ed.page.locator('#qol-net-preset')).toHaveValue('senyaak.work');
    await expect(ed.page.locator('#qol-net-on'), 'and the switch survived the round trip').toBeChecked();
  } finally {
    await closeEditor(ed);
  }
});

test('a hand on a field makes it Custom, and loses nothing else @nodata', async () => {
  const ed = await launchEditor({ HOMM5_ROOT: BARE, HOMM5_DOCUMENTS: DOCS, HOMM5_DATA: DATA });
  try {
    await ed.page.locator('#qolbtn').click();
    await ed.page.locator('#qol-tab-network').click();

    await ed.page.locator('#qol-net-relay').fill('ws://127.0.0.1:40200/agent');
    // The select follows the fields the moment they stop matching the name.
    await expect(ed.page.locator('#qol-net-preset')).toHaveValue('custom');

    await ed.page.locator('#qol-apply').click();
    await expect(ed.page.locator('#qol-msg')).toContainText('settings written', { timeout: 30_000 });

    const written = readFileSync(NET_FILE, 'utf8');
    expect(written, 'the hand-typed relay is in the file').toMatch(/^relay ws:\/\/127\.0\.0\.1:40200\/agent$/m);
    // THE POINT: writing one answer must not lose the other. The file is
    // rewritten whole on every Apply, so the u-lobby is exactly what a careless
    // rewrite would drop.
    expect(written, 'and the u-lobby the earlier test wrote is still there').toContain(`u-lobby ${PRESET.uLobby}`);
  } finally {
    await closeEditor(ed);
  }
});

test('a file mixed by hand shows as the mixed state it is @nodata', async () => {
  // One flag on, the other off — the state the panel cannot make but a text
  // editor can, and the switch must not claim either answer.
  writeFileSync(QOL_FILE, 'net-agent 1\nnet-u-lobby 0\n', 'utf8');
  const ed = await launchEditor({ HOMM5_ROOT: BARE, HOMM5_DOCUMENTS: DOCS, HOMM5_DATA: DATA });
  try {
    await ed.page.locator('#qolbtn').click();
    await ed.page.locator('#qol-tab-network').click();

    const box = ed.page.locator('#qol-net-on');
    await expect(box).not.toBeChecked();
    expect(await box.evaluate((el) => (el as HTMLInputElement).indeterminate), 'indeterminate, not a guess').toBe(true);

    // An Apply that did not touch the switch keeps saying what the file said.
    await ed.page.locator('#qol-apply').click();
    await expect(ed.page.locator('#qol-msg')).toContainText('settings written', { timeout: 30_000 });
    let written = readFileSync(QOL_FILE, 'utf8');
    expect(written, 'the half that was on is still on').toMatch(/^net-agent 1$/m);
    expect(written, 'the half that was off is still off').toMatch(/^net-u-lobby 0$/m);

    // A click resolves it — to on, both halves, like any indeterminate checkbox.
    await box.click();
    await expect(box).toBeChecked();
    await ed.page.locator('#qol-apply').click();
    await expect(ed.page.locator('#qol-msg')).toContainText('settings written', { timeout: 30_000 });
    written = readFileSync(QOL_FILE, 'utf8');
    expect(written).toMatch(/^net-agent 1$/m);
    expect(written, 'the click made it one answer again').toMatch(/^net-u-lobby 1$/m);
  } finally {
    await closeEditor(ed);
  }
});
