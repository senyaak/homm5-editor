// Is our build of the game open — and a glance is not a game
// (src/game/running.ts).
//
// About a second after the executable in `bin/` is replaced, something on
// the machine opens it without sharing writes for some twelve milliseconds
// (measured 09.10.2026). A live e2e run's next install landed in that window
// and refused: "the game has H5_Game_H5E.exe open", with no game anywhere.
// So the checks: a lock that lets go within the glance is not the game, one
// that stays is; and a write over a file held for a glance waits it out.
//
// The lock is taken the way the game's loader takes it — from another
// process, read and delete shared and write not (e2e/015 says why Node's own
// handles will not do).
//
//   node tools/test-game-running.ts

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { heldByRunningGame, replaceFile } from '../src/game/running.ts';
import { PATCHED_EXE } from '../src/exe/creature-limit.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

if (process.platform !== 'win32') {
  console.log('the lock this is about is Windows\' own — nothing to check here');
  process.exit(0);
}

/** Hold `path` from another process for `ms` (0: until killed); resolves once it is held. */
function hold(path: string, ms: number): Promise<{ released: Promise<void>; kill: () => void }> {
  const wait = ms ? `Start-Sleep -Milliseconds ${ms}; $f.Close()` : 'while ($true) { Start-Sleep -Seconds 1 }';
  const holder = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `$f=[System.IO.File]::Open('${path}','Open',[System.IO.FileAccess]::Read,([System.IO.FileShare]'Read, Delete'));`
    + ` Write-Output 'held'; ${wait}`]);
  const released = new Promise<void>((resolve) => holder.on('exit', () => resolve()));
  return new Promise((resolve, reject) => {
    holder.stdout.on('data', (d: Buffer) => { if (d.toString().includes('held')) resolve({ released, kill: () => holder.kill() }); });
    holder.on('exit', () => reject(new Error(`could not hold ${path}`)));
    setTimeout(() => reject(new Error(`timed out holding ${path}`)), 20_000);
  });
}

const root = mkdtempSync(join(tmpdir(), 'h5e-running-'));
const exe = join(root, PATCHED_EXE);
mkdirSync(join(root, 'bin'), { recursive: true });
writeFileSync(exe, 'not an executable, but a file that can be held');

try {
  console.log('what counts as the game');
  check('nothing held: not running', heldByRunningGame(root) === null);

  const glance = await hold(exe, 100);
  const t0 = Date.now();
  const during = heldByRunningGame(root);
  check('held for a glance: not the game', during === null, `${Date.now() - t0} ms to decide`);
  await glance.released;

  const game = await hold(exe, 0);
  const t1 = Date.now();
  const held = heldByRunningGame(root);
  check('held for good: the game, and which file', held === exe, `${held} after ${Date.now() - t1} ms`);
  game.kill();
  await game.released;

  console.log('writing over it');
  const temp = `${exe}.new`;
  writeFileSync(temp, 'the new bytes');
  const brief = await hold(exe, 100);
  try { replaceFile(temp, exe); } catch (e) { check('a write over a glance', false, (e as Error).message); }
  check('a write over a glance waits it out', readFileSync(exe, 'utf8') === 'the new bytes' && !existsSync(temp));
  await brief.released;

  writeFileSync(temp, 'newer still');
  const kept = await hold(exe, 0);
  let threw = '';
  try { replaceFile(temp, exe); } catch (e) { threw = (e as NodeJS.ErrnoException).code ?? 'thrown'; }
  check('a write over the game still fails, with the system\'s word', /EBUSY|EPERM|EACCES/.test(threw), threw);
  kept.kill();
  await kept.released;
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log(failures ? `${failures} FAILED` : 'all good');
process.exit(failures ? 1 : 0);
