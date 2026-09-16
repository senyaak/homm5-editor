// Run the whole unit-test suite and report a summary.
//
// Discovers every `test-*` script in package.json and runs each in its own
// process, so one failing suite doesn't stop the rest. Self-contained checks
// (format round-trips, generators, schema) always run; suites that need game
// content skip themselves when it is absent. Exits non-zero if any suite fails.
//
// THREE LEVELS, the e2e specs' three tags. A suite says what it needs in one
// line near its top — `// needs: data` (the unpacked data) or `// needs: game`
// (a real install: the executable, its archives) — and a suite that says
// nothing needs nothing. `--level nodata|data|game` runs one level's suites
// and that level's e2e (`test-e2e-<level>`) in place of the full e2e set;
// `--only <text>` narrows to the suites whose name contains it (`rmg-` is the
// generator's forty); `--list` says what would run and runs nothing. The
// level is read from the file, not kept in a list here: a list would drift,
// and a suite is the one that knows.
//
// Oracle byte-exact checks (the blank generators vs the editor's own output) run
// when HOMM5_BLANKS points at a folder of pristine blanks and HOMM5_DATA (or
// data-unpacked) has the game data; otherwise those checks are skipped, not
// failed. Usage: `npm test`  (add HOMM5_BLANKS=… to include the oracle checks).

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';

const root = join(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> };

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
type Level = 'nodata' | 'data' | 'game';
const level = flag('level') as Level | undefined;
if (level && !['nodata', 'data', 'game'].includes(level)) {
  console.error(`--level takes nodata, data or game, not ${level}`);
  process.exit(2);
}
const only = flag('only');

/** What a suite says it needs — its `// needs:` line, or nothing. */
function needs(cmd: string): Level {
  const file = /node (\S+)/.exec(cmd)?.[1];
  if (!file) return 'nodata';
  let text = '';
  try { text = readFileSync(join(root, file), 'utf8'); } catch { return 'nodata'; }
  return (/^\/\/ needs: (data|game)$/m.exec(text)?.[1] as Level | undefined) ?? 'nodata';
}

// Every `test-*` unit suite, in declaration order. Left out: `test-e2e` (the
// release gate, on its own), the level and module runs (they are this file),
// and the e2e levels (`playwright test --grep`), of which one is run below in
// place of `test-e2e-fast` when a level is asked for.
const isE2e = (_name: string, cmd: string): boolean => /playwright|tools\/e2e-/.test(cmd);
const suites = Object.entries(pkg.scripts)
  .filter(([name, cmd]) => name.startsWith('test-') && !/test-all\.ts/.test(cmd))
  .filter(([name, cmd]) => !isE2e(name, cmd) || name === (level ? `test-e2e-${level}` : 'test-e2e-fast'))
  .filter(([name, cmd]) => !level || isE2e(name, cmd) || needs(cmd) === level)
  .filter(([name]) => !only || name.includes(only))
  .map(([name, cmd]) => ({ name, cmd }));
if (!suites.length) {
  console.error(`nothing to run${level ? ` at level ${level}` : ''}${only ? ` matching ${only}` : ''}`);
  process.exit(2);
}
console.log(`${suites.length} suite(s)${level ? ` — level ${level}` : ''}${only ? ` — only ${only}` : ''}`);
// `--list`: the suites and their levels, and nothing run — for checking what a
// level would take before taking the minutes.
if (argv.includes('--list')) {
  for (const s of suites) console.log(`  ${s.name.padEnd(26)} ${isE2e(s.name, s.cmd) ? 'e2e' : needs(s.cmd)}`);
  process.exit(0);
}

const blanks = process.env.HOMM5_BLANKS;
const results: Array<{ name: string; ok: boolean; ms: number }> = [];

for (const { name, cmd } of suites) {
  process.stdout.write(`\n\x1b[1m▶ ${name}\x1b[0m\n`);
  const started = process.hrtime.bigint();
  // Reuse the script's own command (`node tools/test-x.ts`), forwarding a blanks
  // dir to the suites that accept one so their oracle checks run when available.
  const [bin, ...args] = cmd.split(' ');
  if (blanks && /test-(terrain-blank|blank-map|new-map)/.test(name)) args.push(blanks);
  // Run it the way `npm run` would: a script naming a package's own binary
  // (`playwright test …`) finds it in node_modules/.bin, and this runner has to
  // put that on PATH itself — spawned bare, those two suites failed in 0.0s
  // with "playwright is not recognised" and read as a broken test run.
  const bin_ = join(root, 'node_modules', '.bin');
  const env = { ...process.env, PATH: `${bin_}${delimiter}${process.env.PATH ?? ''}` };
  const r = spawnSync(bin!, args, { cwd: root, stdio: 'inherit', env, shell: process.platform === 'win32' });
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  results.push({ name, ok: r.status === 0, ms });
}

console.log('\n\x1b[1m── summary ──\x1b[0m');
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  const tag = r.ok ? '\x1b[32mpass\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
  console.log(`  ${tag}  ${r.name.padEnd(22)} ${(r.ms / 1000).toFixed(1)}s`);
}
console.log(`\n${results.length - failed}/${results.length} suites passed`);
process.exit(failed ? 1 : 0);
