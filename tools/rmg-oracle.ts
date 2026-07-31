// Is this install ready to be a source of truth for the port?
//
//   node tools/rmg-oracle.ts              check it
//   node tools/rmg-oracle.ts --seed 42    check it, and ask for that seed
//   node tools/rmg-oracle.ts --read       read back what the last run wrote
//
// WHY IT EXISTS. A copied install can be *inconsistent* in a way nothing
// notices until the game refuses to start, and the first time cost a launch:
// the copy took the patched executable but not `H5E/homm5-editor.h5u`, so a
// ceiling raised to 181 creatures met data that defines 180 of them, and the
// game came up with "Empty pointer to creature # 180". The ceiling and the
// archive that fills it are ONE PAIR — half of it is a broken install.
//
// So the rule this checks is: for a vanilla oracle, both ceilings must be the
// shipped ones AND no mod archive may be present. Everything else it looks at
// is what the run needs to say anything at all — our extension imported, the
// oracle's config in place, somewhere for the map to be saved.
//
// Cheap to run, and it runs before asking anybody to start a game.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { imports } from '../src/exe/exe-import.ts';
import { ORIGINAL_ARTIFACTS, readArtifactLimit, SITES_FILE } from '../src/exe/artifact-limit.ts';
import { ORIGINAL_LIMIT, readExe } from '../src/exe/creature-limit.ts';
import { gameDir } from './game-dir.ts';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && !args[i + 1]?.startsWith('--') ? args[i + 1] : undefined;
};

// Said, never guessed from the checkout's position (tools/game-dir.ts) — and
// here that matters twice over: this tool is about ONE install being consistent
// with itself, and the one it should be asked about is this branch's copy.
const root = gameDir();

/** Beside the executable, next to the extension that writes it. */
export const ORACLE_CONFIG = join('bin', 'homm5-editor-rmg.txt');
export const ORACLE_LOG = join('bin', 'homm5-editor-rmg.log');

// ---------------------------------------------------------------------------
// Reading a run back

if (args.includes('--read')) {
  const path = join(root, ORACLE_LOG);
  if (!existsSync(path)) {
    console.log(`nothing yet — ${path} does not exist`);
    process.exit(0);
  }
  let seed: number | null = null;
  const phases: number[] = [];
  for (const line of readFileSync(path, 'latin1').split(/\r?\n/)) {
    const run = /^run seed (-?\d+) (\d+)$/.exec(line);
    // A second run restarts the reading: the log appends, and the numbers that
    // matter are the last complete set rather than every set ever recorded.
    if (run) {
      seed = Number(run[1]);
      phases.length = 0;
    }
    const phase = /^phase (\d+) (\d+)$/.exec(line);
    if (phase) phases.push(Number(phase[2]));
  }
  if (seed === null) {
    console.log('the log has no run in it');
    process.exit(1);
  }
  console.log(`seed ${seed}`);
  console.log(`draws at each of ${phases.length} phase boundaries:`);
  phases.forEach((n, i) => console.log(`  ${String(i + 1).padStart(2)}  ${n}`));
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Checking the install

let bad = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) bad++;
}

console.log(root);

const exePath = join(root, 'bin', 'H5_Game_H5E.exe');
if (!existsSync(exePath)) {
  console.error(`no ${exePath} — run \`npm run unwrap-exe\``);
  process.exit(1);
}
const exe = readFileSync(exePath);

const sitesPath = join(root, SITES_FILE);
const sites = existsSync(sitesPath) ? JSON.parse(readFileSync(sitesPath, 'utf8')) : undefined;
const creatures = readExe(exe).limit;
const artifacts = readArtifactLimit(exe, sites).limit;

// The pair that broke it, stated as a pair.
check('the creature ceiling is the shipped one', creatures === ORIGINAL_LIMIT, `${creatures}`);
check('the artifact ceiling is the shipped one', artifacts === ORIGINAL_ARTIFACTS, `${artifacts}`);

// A `.h5u` anywhere the game mounts from is loaded at startup and applies
// globally — it can redefine the very data being measured, and one of them is
// what the raised ceilings above were for.
const archives: string[] = [];
for (const dir of ['H5E', 'UserMODs']) {
  const at = join(root, dir);
  if (!existsSync(at)) continue;
  for (const name of readdirSync(at)) {
    if (/\.h5u$/i.test(name)) archives.push(`${dir}/${name}`);
  }
}
check('no mod archive is mounted', archives.length === 0, archives.join(', '));

check('our extension is imported', imports(exe).includes('homm5-editor.dll'));
check('the extension is beside it', existsSync(join(root, 'bin', 'homm5-editor.dll')));

const configPath = join(root, ORACLE_CONFIG);
const seed = flag('seed');
if (seed !== undefined) {
  writeFileSync(
    configPath,
    [
      '# The random map generator\'s oracle — see docs/RMG.md.',
      '# Written by tools/rmg-oracle.ts. Its presence turns the hooks on.',
      `seed ${Number(seed) | 0}`,
      '',
    ].join('\n'),
    'latin1',
  );
  console.log(`  wrote ${configPath} — seed ${Number(seed) | 0}`);
}
check('the oracle config is in place', existsSync(configPath));

const h5e = join(root, 'H5E');
if (!existsSync(h5e)) mkdirSync(h5e, { recursive: true });
check('there is somewhere to save the map', existsSync(h5e));

if (bad) {
  console.log(`\n${bad} thing(s) would make the run meaningless — fix before launching`);
} else {
  console.log('\nready. Generate a random map, then: node tools/rmg-oracle.ts --read');
}
process.exit(bad ? 1 : 0);
