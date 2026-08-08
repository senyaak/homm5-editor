// Every place the extension recognises by its bytes, checked against the game.
//
//   node tools/test-native-anchors.ts
//
// WHAT THIS CATCHES. The extension never trusts an address on its own: each one
// comes with the first few bytes of the code that should be there, and
// `code_at`/`detour` refuse to touch anything that does not match. That refusal
// is the safety net, but it only fires WHILE THE GAME IS RUNNING, and by then
// the feature is quietly missing and somebody has to read a log to find out.
// The same check costs nothing here, against the executable on disk.
//
// A mismatch means one of two things and both are worth knowing before a
// launch: the address is wrong (a digit, a copy-paste from a neighbour), or the
// code moved and every reading taken from it needs looking at again.
//
// The convention this reads is the one the sources already keep — `FOO_RVA`
// beside `FOO_HEAD` — so an anchor written the usual way is tested by having
// been written, and one written some other way is reported as untested rather
// than passed over in silence.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { PEFile } from '../src/exe/pe.ts';
import { CLEAN_EXE } from '../src/exe/exe-unwrap.ts';
import { gameDirIfAny } from './game-dir.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

/** Where the game's code sits once loaded; an RVA plus this is an address. */
const IMAGE_BASE = 0x400000;

const NATIVE = join(import.meta.dirname, '..', 'native');

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== 'build') out.push(...sources(path));
    } else if (name.endsWith('.c') || name.endsWith('.h')) {
      out.push(path);
    }
  }
  return out;
}

interface Anchor {
  name: string;
  file: string;
  rva: number;
  head: number[];
}

const anchors: Anchor[] = [];
const headless: string[] = [];

for (const file of sources(NATIVE)) {
  const text = readFileSync(file, 'utf8');
  const short = file.slice(NATIVE.length + 1).replace(/\\/g, '/');

  const heads = new Map<string, number[]>();
  const headOf = /static const BYTE ([A-Z0-9_]+)_HEAD\s*\[[^\]]*\]\s*=\s*\{([^}]*)\}/g;
  for (const m of text.matchAll(headOf)) {
    // The bytes are written with the instructions they spell out beside them,
    // and a comment saying `sub esp,8` has a comma and an 8 in it — which is a
    // seventh byte to anything reading the list naively. This test read one, and
    // reported the source as wrong about the game.
    const listed = m[2]!.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const bytes = listed.split(',').map((b) => b.trim()).filter(Boolean)
      .map((b) => (/^0x[0-9a-fA-F]{1,2}$/.test(b) ? Number.parseInt(b, 16) : NaN));
    if (bytes.length && bytes.every((b) => Number.isInteger(b))) heads.set(m[1]!, bytes);
  }

  const rvaOf = /#define ([A-Z0-9_]+)_RVA (0x[0-9a-f]+)u/g;
  for (const m of text.matchAll(rvaOf)) {
    const name = m[1]!;
    const head = heads.get(name);
    if (head) anchors.push({ name, file: short, rva: Number(m[2]), head });
    else headless.push(`${short}: ${name}`);
  }
}

console.log(`=== ${anchors.length} anchors with bytes to check ===`);

// SKIPPING IS NOT PASSING, and it says which. Nobody having said where the game
// is means this half cannot run; an unwrapped executable that is not there yet
// means the same. Either way the anchors are unchecked and the line says so.
const game = gameDirIfAny();
const exePath = game ? join(game, CLEAN_EXE) : null;
if (!exePath || !existsSync(exePath)) {
  console.log(game
    ? `  (no ${CLEAN_EXE} — run \`npm run unwrap-exe\`; nothing was checked)`
    : '  (nobody said where the game is — HOMM5_GAME or --game; nothing was checked)');
  process.exit(0);
}
const exe = PEFile.read(exePath);

for (const a of anchors.sort((x, y) => x.name.localeCompare(y.name))) {
  const at = exe.offsetOf(a.rva + IMAGE_BASE);
  if (at === null) {
    check(a.name, false, `0x${(a.rva + IMAGE_BASE).toString(16)} is not in the image (${a.file})`);
    continue;
  }
  const found = [...exe.buf.subarray(at, at + a.head.length)];
  const same = found.every((b, i) => b === a.head[i]);
  const hex = (bs: number[]) => bs.map((b) => b.toString(16).padStart(2, '0')).join(' ');
  check(a.name, same, same
    ? `0x${(a.rva + IMAGE_BASE).toString(16)} reads ${hex(found)}`
    : `0x${(a.rva + IMAGE_BASE).toString(16)} reads ${hex(found)}, expected ${hex(a.head)} (${a.file})`);
}

// NAMED, not hidden. An anchor with no bytes beside it is one this test cannot
// speak for, and a count that quietly shrinks is how a check stops checking.
console.log(`\n=== ${headless.length} addresses with no bytes to recognise them by ===`);
console.log('   (a vtable, a global, or a patch site whose bytes are written elsewhere)');
for (const one of headless) console.log(`   ${one}`);

console.log(failures ? `\nFAILED: ${failures}` : '\nall good');
process.exit(failures ? 1 : 0);
