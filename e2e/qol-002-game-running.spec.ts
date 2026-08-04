// Applying settings while the game is open — the panel says so, and stops.
//
// WHY THIS EXISTS. Everything the editor installs goes into `bin`, and Windows
// will not let a file be replaced while a process holds it. Until now the panel
// met that as whatever Node threw: `EBUSY` about a path ending in `.new`, from a
// button that said Apply. It is the most ordinary thing a person can do —
// tweaking a setting with the game still up — and the least ordinary thing to
// read.
//
// HOW THE GAME IS FAKED. Not by starting one: by holding the same lock a running
// one holds. Windows opens a loaded image without FILE_SHARE_WRITE, and that is
// exactly what `openSync(exe, 'r+')` in another process runs into, so a handle
// held here is indistinguishable from a game being played as far as every write
// in the editor is concerned. Which is also the point of testing it this way —
// what is being checked is the editor's behaviour against a locked file, and a
// locked file is what the check itself asks about.
//
// AND ONLY OURS. `H5_Game.exe` is never written to, so the unmodded game being
// open is no reason to refuse anything. The last case here holds that one and
// expects the apply to go through.

import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT, launchEditor } from './launch.ts';

// The whole subject is Windows sharing semantics — what a loaded image denies,
// and what the editor does about it. There is nothing to assert elsewhere.
test.skip(process.platform !== 'win32', 'the lock this is about is Windows\' own');

const GAME = join(REPO_ROOT, '_tmp', 'e2e-qol-running');
const DOCS = join(REPO_ROOT, '_tmp', 'e2e-qol-running-docs');
const OURS = join(GAME, 'bin', 'H5_Game_H5E.exe');
const SHIPPED = join(GAME, 'bin', 'H5_Game.exe');
const QOL_FILE = join(GAME, 'bin', 'homm5-editor-qol.txt');

/**
 * Hold a file the way a running game holds it, for the length of one block.
 *
 * NOT `fs.openSync`. Node opens files on Windows with every share mode set, so a
 * handle it hands out denies nothing and a second writer sails straight past it
 * — which is how the first version of this spec came to watch an apply succeed
 * while it believed it had the file locked. The loader is not so generous: an
 * image being executed is opened for read and delete and NOT for writing, and
 * that is the refusal every write in the editor actually meets.
 *
 * So: `Read, Delete` from .NET, which is the loader's share mode exactly.
 * `None` is the obvious thing to reach for and is WRONG — it denies readers as
 * well, and the editor reads the executable to see whether it already names the
 * extension. Against `None` that read fails, and the spec would be asserting on
 * a state no running game ever produces.
 */
async function whileLocked(path: string, body: () => Promise<void>): Promise<void> {
  const holder = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `$f=[System.IO.File]::Open('${path}','Open',[System.IO.FileAccess]::Read,`
    + "([System.IO.FileShare]'Read, Delete'));"
    + " Write-Output 'held'; while ($true) { Start-Sleep -Seconds 1 }"]);
  try {
    await new Promise<void>((resolve, reject) => {
      holder.stdout.on('data', (d: Buffer) => { if (d.toString().includes('held')) resolve(); });
      holder.on('exit', () => { reject(new Error(`could not hold ${path}`)); });
      setTimeout(() => { reject(new Error(`timed out holding ${path}`)); }, 20_000);
    });
    await body();
  } finally {
    holder.kill();
  }
}

test.beforeAll(() => {
  rmSync(GAME, { recursive: true, force: true });
  rmSync(DOCS, { recursive: true, force: true });
  mkdirSync(join(GAME, 'bin'), { recursive: true });
  // Not real executables — nothing here runs them. What matters is that the
  // files exist at the two names the editor tells apart, so that one can be
  // locked and the other left alone.
  writeFileSync(OURS, 'not an executable, but a file that can be held');
  writeFileSync(SHIPPED, 'the game\'s own, which this editor never writes to');
});
test.afterAll(() => {
  rmSync(GAME, { recursive: true, force: true });
  rmSync(DOCS, { recursive: true, force: true });
});

test('applying with the game open says so instead of failing on a temp file @nodata', async () => {
  const ed = await launchEditor({ HOMM5_ROOT: GAME, HOMM5_DOCUMENTS: DOCS });
  try {
    await ed.page.locator('#qolbtn').click();
    await ed.page.locator('#qol-combat-ai-fix').check();

    await whileLocked(OURS, async () => {
      await ed.page.locator('#qol-apply').click();
      const msg = ed.page.locator('#qol-msg');

      // The sentence a person can act on: which file, and what to do.
      await expect(msg, 'the panel says the game is open')
        .toContainText('the game is running', { timeout: 30_000 });
      await expect(msg, 'and names the file it is holding').toContainText('H5_Game_H5E.exe');
      await expect(msg, 'and says what to do about it').toContainText('Close the game');

      // Not the raw failure it used to be. `.new` is the temporary an exe patch
      // renames over the target, and EBUSY is what Windows calls the refusal —
      // between them they were the whole of what the panel used to show.
      await expect(msg, 'and not the plumbing').not.toContainText('EBUSY');
      await expect(msg, 'nor a temporary file nobody asked about').not.toContainText('.new');
    });

    // The answers are kept even so: they are what was asked for, and the reason
    // they are not in effect yet is a sentence, not a reason to discard them.
    const written = readFileSync(QOL_FILE, 'utf8');
    expect(written, 'the setting is saved anyway').toMatch(/^combat-ai-fix 1$/m);

    // A LOCKED FILE IS AN EXPECTED STATE, not a broken renderer. Nothing here
    // may throw — an apply that reported the right sentence and left an
    // uncaught error behind is still a bug, and this is the assertion that
    // tells the two apart without waiting out a timeout somewhere else.
    expect(ed.errors, 'and nothing was thrown along the way').toEqual([]);
  } finally {
    await ed.app.close();
  }
});

test('the unmodded game being open stops nothing @nodata', async () => {
  const ed = await launchEditor({ HOMM5_ROOT: GAME, HOMM5_DOCUMENTS: DOCS });
  try {
    await ed.page.locator('#qolbtn').click();
    await ed.page.locator('#qol-borderless').check();

    await whileLocked(SHIPPED, async () => {
      await ed.page.locator('#qol-apply').click();
      const msg = ed.page.locator('#qol-msg');
      await expect(msg, 'the apply goes through').toContainText('settings written', { timeout: 30_000 });
      // The distinction this whole feature rests on: our copy is what the
      // editor writes, so the game's own being open is somebody else's
      // business. Refusing here would be refusing for no reason at all.
      await expect(msg, 'and the game\'s own file is not mistaken for ours')
        .not.toContainText('the game is running');
    });
    expect(ed.errors, 'and nothing was thrown along the way').toEqual([]);
  } finally {
    await ed.app.close();
  }
});
