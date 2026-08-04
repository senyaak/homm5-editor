// The battle AI patches, checked against the executable they are aimed at.
//
// A patch that names an address is a claim about a FILE, and the C source is
// the only place that claim is written down. Nothing else in the suite can
// catch it going stale: the extension refuses to write when the bytes are not
// the ones it knows, and refusing is silent — the game plays on with the AI it
// always had, and the switch in the panel does nothing at all.
//
// So the check is the same question the extension asks at load time, asked here
// where a failure is loud: at each RVA the source names, are the bytes it
// expects actually there. Read out of native/qol/combat-ai.c rather than
// repeated, because two copies of an address is exactly the bug this prevents.
//
//   node tools/test-combat-ai.ts --game <dir>
//
// The game half is optional — a checkout with no install configured skips it
// and says so, rather than inventing a path.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { gameDirIfAny } from './game-dir.ts';
import { PEFile } from '../src/exe/pe.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const REPO = join(import.meta.dirname, '..');
const SOURCE = join(REPO, 'native', 'qol', 'combat-ai.c');
const source = readFileSync(SOURCE, 'utf8');

/** One patch as the C declares it: an address, and the two byte rows. */
interface Patch {
  what: string;
  rva: number;
  before: number[];
  after: number[];
}

/** `static const BYTE NAME[n] = { 0x.., ... };` — the rows, by their name. */
function bytesNamed(name: string): number[] | null {
  const m = new RegExp(`${name}\\[[^\\]]*\\]\\s*=\\s*\\{([^}]*)\\}`).exec(source);
  return m ? [...m[1].matchAll(/0x([0-9A-Fa-f]{2})/g)].map((b) => Number.parseInt(b[1], 16)) : null;
}

function rvaNamed(name: string): number | null {
  const m = new RegExp(`#define\\s+${name}\\s+0x([0-9A-Fa-f]+)u?`).exec(source);
  return m ? Number.parseInt(m[1], 16) : null;
}

// The three, named as the install call names them. Adding a fourth patch there
// and forgetting it here is caught by the count check below.
const WANTED: { what: string; rva: string; before: string; after: string }[] = [
  { what: 'the stack\'s worth, squared', rva: 'AI_STACK_WORTH_RVA', before: 'WORTH_SQUARED', after: 'WORTH_LINEAR' },
  { what: 'the spell evaluation\'s bail-out', rva: 'AI_SPELL_BAILOUT_RVA', before: 'BAILOUT_TAKEN', after: 'BAILOUT_GONE' },
  { what: 'the plan\'s starting rank', rva: 'AI_PLAN_RANK_RVA', before: 'RANK_FROM_LEAST', after: 'RANK_FROM_MOST' },
];

const patches: Patch[] = [];
for (const w of WANTED) {
  const rva = rvaNamed(w.rva);
  const before = bytesNamed(w.before);
  const after = bytesNamed(w.after);
  check(`the source declares ${w.rva} and its two rows`, rva !== null && !!before && !!after);
  if (rva === null || !before || !after) continue;
  check(`  ${w.what}: the rows are the same length`, before.length === after.length,
    `${before.length} vs ${after.length}`);
  check(`  ${w.what}: and the patch actually changes something`,
    before.some((b, i) => b !== after[i]));
  patches.push({ what: w.what, rva, before, after });
}

// Every `overwrite_code` call in the installer is one of the three above — a
// patch added to the C and not to this list would otherwise go unchecked.
const calls = [...source.matchAll(/overwrite_code\(([A-Z_]+),/g)].map((m) => m[1]);
check('every patch the installer applies is checked here',
  calls.length === WANTED.length && calls.every((c) => WANTED.some((w) => w.rva === c)),
  calls.join(', '));

// --- against the executable --------------------------------------------------

const game = gameDirIfAny();
const exe = game ? join(game, 'bin', 'H5_Game_H5E.exe') : null;
if (!exe || !existsSync(exe)) {
  console.log(`\n  (skipped the executable half — ${exe ? 'no ' + exe : 'no game folder said'})`);
} else {
  const pe = PEFile.read(exe);
  const base = pe.imageBase;

  for (const p of patches) {
    const at = pe.offsetOf(base + p.rva);
    if (at === null) {
      check(`${p.what}: 0x${p.rva.toString(16)} is inside the image`, false);
      continue;
    }
    const there = [...pe.buf.subarray(at, at + p.before.length)];
    const hex = (b: number[]): string => b.map((x) => x.toString(16).padStart(2, '0')).join(' ');
    check(`${p.what}: the bytes at 0x${p.rva.toString(16)} are the ones the patch expects`,
      there.every((b, i) => b === p.before[i]), `found ${hex(there)}, wanted ${hex(p.before)}`);

    // AND THE CHECK IS NOT VACUOUS. A row of nops matches almost anywhere, and
    // a patch aimed one instruction off would still find "its" bytes in a long
    // enough stretch of them. So the same row must NOT match a byte to either
    // side: an address that is right is right exactly once.
    const slides = [-1, 1].filter((d) => {
      const near = pe.buf.subarray(at + d, at + d + p.before.length);
      return p.before.every((b, i) => near[i] === b);
    });
    check(`${p.what}: and only at that address`, slides.length === 0,
      slides.length ? `also matches ${slides.join(' and ')} byte away` : '');
  }

  // The extension is loaded through this copy and no other; a patch verified
  // against the game's own executable would be verified against the wrong file.
  check('the executable checked is our copy, not the game\'s',
    exe.endsWith('H5_Game_H5E.exe') && existsSync(exe));
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
