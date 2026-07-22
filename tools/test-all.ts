// Run the whole unit-test suite and report a summary.
//
// Discovers every `test-*` script in package.json and runs each in its own
// process, so one failing suite doesn't stop the rest. Self-contained checks
// (format round-trips, generators, schema) always run; suites that need game
// content skip themselves when it is absent. Exits non-zero if any suite fails.
//
// Oracle byte-exact checks (the blank generators vs the editor's own output) run
// when HOMM5_BLANKS points at a folder of pristine blanks and HOMM5_DATA (or
// data-unpacked) has the game data; otherwise those checks are skipped, not
// failed. Usage: `npm test`  (add HOMM5_BLANKS=… to include the oracle checks).

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> };

// Every `test-*` unit suite, in declaration order. `test-e2e` is excluded: it
// launches the real Electron app (slower, needs a build) and runs on its own via
// `npm run test-e2e`.
const suites = Object.entries(pkg.scripts)
  .filter(([name]) => name.startsWith('test-') && name !== 'test-e2e')
  .map(([name, cmd]) => ({ name, cmd }));

const blanks = process.env.HOMM5_BLANKS;
const results: Array<{ name: string; ok: boolean; ms: number }> = [];

for (const { name, cmd } of suites) {
  process.stdout.write(`\n\x1b[1m▶ ${name}\x1b[0m\n`);
  const started = process.hrtime.bigint();
  // Reuse the script's own command (`node tools/test-x.ts`), forwarding a blanks
  // dir to the suites that accept one so their oracle checks run when available.
  const [bin, ...args] = cmd.split(' ');
  if (blanks && /test-(terrain-blank|blank-map|new-map)/.test(name)) args.push(blanks);
  const r = spawnSync(bin!, args, { cwd: root, stdio: 'inherit', env: process.env, shell: process.platform === 'win32' });
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
