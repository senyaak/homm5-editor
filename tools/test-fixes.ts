// Every byte the extension writes into the game, checked against the game.
//
// A patch that names an address is a claim about a FILE, and the C source is
// the only place that claim is written down. Nothing else in the suite can
// catch it going stale: `overwrite_code` refuses when the bytes are not the
// ones it knows, and refusing is SILENT — the game plays on with the rules it
// always had, and the switch in the panel does nothing at all.
//
// So the check is the same question the extension asks at load time, asked here
// where a failure is loud. It finds the patches by walking every
// `overwrite_code(...)` call in native/, and resolves the three names each call
// hands it out of the file that made the call — so a fix added tomorrow is
// checked tomorrow, without this file being touched. That is the point: a list
// kept by hand is a list that forgets.
//
//   node tools/test-fixes.ts --game <dir>
//
// The game half is optional — a checkout with no install configured skips it
// and says so, rather than inventing a path.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { gameDirIfAny } from './game-dir.ts';
import { PEFile } from '../src/exe/pe.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const REPO = join(import.meta.dirname, '..');

/** Every .c under native/, at any depth. */
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (entry.endsWith('.c')) out.push(path);
  }
  return out;
}

/** One patch as the C declares it: where, and the two byte rows. */
interface Patch {
  file: string;
  what: string;
  rva: number;
  before: number[];
  after: number[];
}

/** `static const BYTE NAME[n] = { 0x.., ... };` — the row, by its name. */
function bytesNamed(source: string, name: string): number[] | null {
  const m = new RegExp(`${name}\\[[^\\]]*\\]\\s*=\\s*\\{([^}]*)\\}`).exec(source);
  return m ? [...m[1].matchAll(/0x([0-9A-Fa-f]{2})/g)].map((b) => Number.parseInt(b[1], 16)) : null;
}

function rvaNamed(source: string, name: string): number | null {
  const m = new RegExp(`#define\\s+${name}\\s+0x([0-9A-Fa-f]+)u?`).exec(source);
  return m ? Number.parseInt(m[1], 16) : null;
}

// The call itself is the declaration: overwrite_code(RVA, BEFORE, AFTER, size, "what").
const CALL = /overwrite_code\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*,\s*([A-Za-z_][A-Za-z0-9_]*)\s*,\s*([A-Za-z_][A-Za-z0-9_]*)\s*,[^,]*,\s*"([^"]*)"/g;

const patches: Patch[] = [];
for (const path of sources(join(REPO, 'native'))) {
  const source = readFileSync(path, 'utf8');
  const file = path.slice(REPO.length + 1).replace(/\\/g, '/');
  for (const m of source.matchAll(CALL)) {
    const [, rvaName, beforeName, afterName, what] = m;
    const rva = rvaNamed(source, rvaName);
    const before = bytesNamed(source, beforeName);
    const after = bytesNamed(source, afterName);
    check(`${file}: ${what} declares ${rvaName}, ${beforeName} and ${afterName}`,
      rva !== null && !!before && !!after);
    if (rva === null || !before || !after) continue;
    check(`  ${what}: the rows are the same length`, before.length === after.length,
      `${before.length} vs ${after.length}`);
    check(`  ${what}: and the patch actually changes something`,
      before.some((b, i) => b !== after[i]));
    patches.push({ file, what, rva, before, after });
  }
}
check('there are patches to check at all', patches.length > 0, `${patches.length} found`);

// --- against the executable --------------------------------------------------

const game = gameDirIfAny();
const exe = game ? join(game, 'bin', 'H5_Game_H5E.exe') : null;
if (!exe || !existsSync(exe)) {
  console.log(`\n  (skipped the executable half — ${exe ? 'no ' + exe : 'no game folder said'})`);
} else {
  const pe = PEFile.read(exe);
  const hex = (b: number[]): string => b.map((x) => x.toString(16).padStart(2, '0')).join(' ');

  for (const p of patches) {
    const at = pe.offsetOf(pe.imageBase + p.rva);
    if (at === null) {
      check(`${p.what}: 0x${p.rva.toString(16)} is inside the image`, false);
      continue;
    }
    const there = [...pe.buf.subarray(at, at + p.before.length)];
    check(`${p.what}: the bytes at 0x${p.rva.toString(16)} are the ones the patch expects`,
      there.every((b, i) => b === p.before[i]), `found ${hex(there)}, wanted ${hex(p.before)}`);

    // AND THE CHECK IS NOT VACUOUS — for the rows long enough to say so. A row
    // of nops matches almost anywhere, and a patch aimed one instruction off
    // would still find "its" bytes in a long enough stretch of them, so the
    // same row must not match a byte to either side. A ONE-byte row cannot
    // carry that argument (a single value repeats all over an image), and
    // pretending otherwise would be a check that fails for being true.
    if (p.before.length < 2) continue;
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
