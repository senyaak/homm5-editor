// Is this install ready to be a source of truth for the port?
//
//   node tools/rmg-oracle.ts              check it
//   node tools/rmg-oracle.ts --seed 42    check it, and ask for that seed
//   node tools/rmg-oracle.ts --read       read back what the last run wrote
//   node tools/rmg-oracle.ts --compare a b   two generated maps, side by side
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
// Two generated maps, side by side
//
// Raw bytes are the wrong question — every run gets a fresh GUID, and one run
// differed from its own repeat by a single byte that no parser reads. So this
// compares what a map IS: the terrain as parsed, and where the .xdb first
// diverges. It is how "the generator is deterministic" stopped being an
// assumption, and it is what the port will be measured with.

if (args.includes('--compare')) {
  const i = args.indexOf('--compare');
  const [left, right] = [args[i + 1], args[i + 2]];
  if (!left || !right) {
    console.error('usage: --compare <dir> <dir>   (each holding map.xdb and GroundTerrain.bin)');
    process.exit(2);
  }
  const { parseTerrain, readHeights, readGroundFlags, readPassability, readTextureLayers, readMask } =
    await import('../src/terrain/terrain.ts');

  const a = parseTerrain(readFileSync(join(left, 'GroundTerrain.bin')));
  const b = parseTerrain(readFileSync(join(right, 'GroundTerrain.bin')));
  let differences = 0;

  const plane = (name: string, x: ArrayLike<number> | null, y: ArrayLike<number> | null): void => {
    if (!x || !y) return console.log(`  ${name.padEnd(22)} absent in one`);
    if (x.length !== y.length) {
      differences++;
      return console.log(`  ${name.padEnd(22)} LENGTHS ${x.length} vs ${y.length}`);
    }
    let diff = 0;
    let firstAt = -1;
    for (let k = 0; k < x.length; k++) {
      if (x[k] !== y[k]) {
        if (firstAt < 0) firstAt = k;
        diff++;
      }
    }
    if (diff) differences++;
    console.log(`  ${name.padEnd(22)} ${diff ? `${diff} differ, first at ${firstAt}` : 'identical'}`);
  };

  plane('heights', readHeights(a), readHeights(b));
  plane('ground flags', readGroundFlags(a), readGroundFlags(b));
  plane('passability', readPassability(a), readPassability(b));
  const layersA = readTextureLayers(a);
  const layersB = readTextureLayers(b);
  console.log(`  texture layers         ${layersA.length} vs ${layersB.length}`);
  for (let k = 0; k < Math.min(layersA.length, layersB.length); k++) {
    const name = (layersA[k]!.path ?? `#${k}`).split('/').pop()!;
    if (layersA[k]!.path !== layersB[k]!.path) {
      differences++;
      console.log(`  layer ${k} is a different texture: ${layersA[k]!.path} vs ${layersB[k]!.path}`);
    }
    plane(`layer ${k} ${name}`.slice(0, 22), readMask(a, layersA[k]!), readMask(b, layersB[k]!));
  }

  // Where the description first parts company. A run's own repeat diverges at
  // its GUID and nowhere earlier, so this number IS the answer for objects.
  const xa = readFileSync(join(left, 'map.xdb'));
  const xb = readFileSync(join(right, 'map.xdb'));
  let at = -1;
  for (let k = 0; k < Math.min(xa.length, xb.length); k++) {
    if (xa[k] !== xb[k]) {
      at = k;
      break;
    }
  }
  const guidAt = xa.indexOf('<RMGguid>');
  console.log(`  map.xdb                ${at < 0 ? 'identical' : `first difference at ${at}` }`
    + (at >= 0 && guidAt >= 0 ? at >= guidAt ? ' — at or after the GUID, so everything before it matches' : ' — BEFORE the GUID' : ''));
  process.exit(0);
}

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
  const sweeps: Array<[number, number]> = [];
  const steps: Array<{ draws: number; zone: number; what: string }> = [];
  for (const line of readFileSync(path, 'latin1').split(/\r?\n/)) {
    const run = /^run seed (-?\d+) (\d+)$/.exec(line);
    // A second run restarts the reading: the log appends, and the numbers that
    // matter are the last complete set rather than every set ever recorded.
    if (run) {
      seed = Number(run[1]);
      phases.length = 0;
      sweeps.length = 0;
      steps.length = 0;
    }
    const phase = /^phase (\d+) (\d+)$/.exec(line);
    if (phase) phases.push(Number(phase[2]));
    // The editor's finer reading: FillZones draws at every tenth sweep.
    const sweep = /^sweep (\d+) (\d+)$/.exec(line);
    if (sweep) sweeps.push([Number(sweep[1]), Number(sweep[2])]);
    // And the finer one still: every step the generator says it finished,
    // which is the only reading MainObjects has.
    const step = /^step (\d+) (-?\d+) (.+)$/.exec(line);
    if (step) steps.push({ draws: Number(step[1]), zone: Number(step[2]), what: step[3] });
  }
  if (seed === null) {
    console.log('the log has no run in it');
    process.exit(1);
  }
  console.log(`seed ${seed}`);
  console.log(`draws at each of ${phases.length} phase boundaries:`);
  phases.forEach((n, i) => console.log(`  ${String(i + 1).padStart(2)}  ${n}`));
  if (sweeps.length) {
    console.log('FillZones draws at every tenth sweep:');
    console.log('  ' + sweeps.map(([s, d]) => `${s}:${d}`).join(' '));
  }
  if (steps.length) {
    // Each step's own draws, not the running total — the total is what the log
    // holds, and what a port is compared on is how much THIS step spent.
    console.log(`draws at each of ${steps.length} step boundaries:`);
    // From the seed, which is where the counter was zeroed — the step lines
    // and the phase lines interleave, so each step's predecessor is the step
    // before it, and the first one's is the start of the run.
    let before = 0;
    for (const step of steps) {
      const spent = step.draws - before;
      before = step.draws;
      const where = step.zone < 0 ? '' : ` (zone ${step.zone})`;
      console.log(`  ${String(step.draws).padStart(7)}  ${String(spent).padStart(6)}  ${step.what}${where}`);
    }
  }
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
// `trace` survives a `--seed`, and `--trace` turns it on. Rewriting the config
// without it used to switch the draw trace OFF silently, which is the worst
// possible way for it to be off: the run happens, the map comes out, and only
// `rmg-diff-draws` afterwards says the log has no traced run in it. A run
// nobody can repeat cheaply should not be lost to a flag that was dropped.
const tracing =
  args.includes('--trace') ||
  (existsSync(configPath) && /^\s*trace\s*$/m.test(readFileSync(configPath, 'latin1')));
if (seed !== undefined || args.includes('--trace')) {
  writeFileSync(
    configPath,
    [
      '# The random map generator\'s oracle — see docs/RMG.md.',
      '# Written by tools/rmg-oracle.ts. Its presence turns the hooks on.',
      ...(seed !== undefined ? [`seed ${Number(seed) | 0}`] : []),
      ...(tracing ? ['trace'] : []),
      '',
    ].join('\n'),
    'latin1',
  );
  console.log(
    `  wrote ${configPath} — ${seed !== undefined ? `seed ${Number(seed) | 0}` : 'seed unchanged'}` +
      `, draw trace ${tracing ? 'ON' : 'off'}`,
  );
}
check('the oracle config is in place', existsSync(configPath));
if (existsSync(configPath)) {
  const has = /^\s*trace\s*$/m.test(readFileSync(configPath, 'latin1'));
  console.log(`  ${has ? 'ok  ' : '    '}  the draw trace is ${has ? 'on' : 'OFF — pass --trace to turn it on'}`);
}

const h5e = join(root, 'H5E');
if (!existsSync(h5e)) mkdirSync(h5e, { recursive: true });
check('there is somewhere to save the map', existsSync(h5e));

if (bad) {
  console.log(`\n${bad} thing(s) would make the run meaningless — fix before launching`);
} else {
  console.log('\nready. Generate a random map, then: node tools/rmg-oracle.ts --read');
}
process.exit(bad ? 1 : 0);
