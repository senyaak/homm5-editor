// What has to be true before the editor is any use, and the file that says where.
//
// The four steps themselves need a game install to do anything to, so what they
// DO is e2e's business (e2e/first-run.spec.ts, which does all four into a
// throwaway install). What can be said here without one: that asking an install
// what it still needs never throws whatever is at that path, that a folder which
// is not a game is refused before anything long starts, and that the env file
// fills fields in without ever talking over the environment it is read into.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { ENV_KEYS, loadEnvFile, parseEnvFile, writeEnvFile } from '../src/game/env-file.ts';
import { STEPS, firstRun, installState, isReady } from '../src/game/first-run.ts';
import type { Install } from '../src/game/first-run.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

// --- the steps, as a list ------------------------------------------------------

check('every step has its own id',
  new Set(STEPS.map((s) => s.id)).size === STEPS.length);
check('and says what it does in the plainest words',
  STEPS.every((s) => s.what.length > 8 && s.what === s.what.toLowerCase()),
  STEPS.map((s) => s.what).join(' · '));
check('the data unpack comes first, because nothing else matters without it',
  STEPS[0]!.id === 'data');
check('and the mod folder is pointed at last, when there is a copy to point',
  STEPS[STEPS.length - 1]!.id === 'paths');

// --- asking about an install that is not one -----------------------------------
//
// done() is asked about whatever the picker's field currently holds, which
// during typing is every prefix of a path. Throwing there would be a crash per
// keystroke.

{
  const nowhere: Install = { gameRoot: join(tmpdir(), 'homm5-nothing-here'), dataRoot: join(tmpdir(), 'homm5-nothing-either'), editorRoot: resolve(import.meta.dirname, '..') };
  let threw = '';
  try {
    const state = installState(nowhere);
    check('an install that does not exist answers "nothing done yet"',
      state.length === STEPS.length && state.every((s) => !s.done));
    check('...and is not ready', !isReady(nowhere));
  } catch (e) {
    threw = e instanceof Error ? e.message : String(e);
  }
  check('asking about a path that is not there does not throw', !threw, threw);
}

{
  const dir = mkdtempSync(join(tmpdir(), 'firstrun-'));
  try {
    let said = '';
    await firstRun({ gameRoot: dir, dataRoot: join(dir, 'data-unpacked'), editorRoot: resolve(import.meta.dirname, '..') })
      .catch((e: unknown) => { said = e instanceof Error ? e.message : String(e); });
    check('a folder that is not a Heroes 5 install is refused up front',
      said.includes('not a Heroes 5 install'), said);
    check('...and nothing was made in it', !existsSync(join(dir, 'H5E')) && !existsSync(join(dir, 'data-unpacked')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- the file that fills the picker in -----------------------------------------

{
  const parsed = parseEnvFile([
    '# a comment',
    '',
    'HOMM5_ROOT=C:\\Games\\Heroes of Might and Magic 5',
    '  HOMM5_DATA = "C:\\Games\\unpacked"  ',
    'MALFORMED',
    '=novalue',
  ].join('\n'));
  check('a path with spaces needs no quoting',
    parsed.HOMM5_ROOT === 'C:\\Games\\Heroes of Might and Magic 5', parsed.HOMM5_ROOT);
  check('...and quotes are taken off anyone who adds them',
    parsed.HOMM5_DATA === 'C:\\Games\\unpacked', parsed.HOMM5_DATA);
  check('comments, blanks and nonsense are skipped rather than guessed at',
    Object.keys(parsed).length === 2, Object.keys(parsed).join(','));
  check('the keys it may carry are named, so a typo is findable',
    Object.keys(ENV_KEYS).join() === 'HOMM5_ROOT,HOMM5_DATA');
}

{
  const dir = mkdtempSync(join(tmpdir(), 'envfile-'));
  try {
    check('no file at all is the ordinary case, not an error',
      loadEnvFile(dir, {}).applied.length === 0);

    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '.env'), 'HOMM5_ROOT=from the file\nHOMM5_DATA=also from the file\n');

    const env: NodeJS.ProcessEnv = { HOMM5_ROOT: 'from the shell' };
    const r = loadEnvFile(dir, env);
    check('what the shell already said is left alone',
      env.HOMM5_ROOT === 'from the shell', env.HOMM5_ROOT);
    check('...and what it did not say is filled in',
      env.HOMM5_DATA === 'also from the file', env.HOMM5_DATA);
    check('...and the report names only what it actually set',
      r.applied.join() === 'HOMM5_DATA', r.applied.join());

    // The setup window writes this file and nothing else, so what it writes has
    // to come back the same — a path with spaces and backslashes included,
    // which is every Steam install on Windows.
    const game = String.raw`C:\Games\Steam\steamapps\common\Heroes of Might and Magic 5 Tribes of the East`;
    const data = join(game, 'homm5-editor', 'data-unpacked');
    const written = writeEnvFile(dir, { HOMM5_ROOT: game, HOMM5_DATA: data });
    check('the setup window writes the file the editor reads', written === join(dir, '.env'));
    const back = parseEnvFile(readFileSync(written, 'utf8'));
    check('a Windows path survives the round trip whole',
      back.HOMM5_ROOT === game && back.HOMM5_DATA === data, `${back.HOMM5_ROOT} | ${back.HOMM5_DATA}`);
    const after: NodeJS.ProcessEnv = {};
    loadEnvFile(dir, after);
    check('...and reading it back sets exactly those two',
      after.HOMM5_ROOT === game && after.HOMM5_DATA === data);
    // Half an answer writes half a file rather than an empty assignment: a
    // `HOMM5_DATA=` line would read as "said, and said nothing".
    writeEnvFile(dir, { HOMM5_ROOT: game });
    check('a key with no value is left out, not written empty',
      !readFileSync(join(dir, '.env'), 'utf8').includes('HOMM5_DATA'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
