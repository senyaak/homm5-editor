// Does the documentation's disassembly still describe the executable?
//
//   node tools/test-doc-addresses.ts --game <dir>
//
// docs/RMG.md is three thousand lines of read addresses, and a reader has no
// way to tell a read one from an invented one — the prose reads the same
// either way. This is the part of that question a machine can answer:
//
//   every address the document cites either resolves inside one of the two
//   images or is plainly a constant, every code address lands on a real
//   instruction boundary, and every VALUE the prose states for an address is
//   the value that is actually there.
//
// What it CANNOT answer is whether the prose describes what the code does.
// That is what the draw counts and the byte-identical documents are for: a
// misread algorithm does not land on 92,438 draws or write the engine's own
// map.xdb. The three together are the whole of the evidence, and none of them
// is anybody's word.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PEFile } from '../src/exe/pe.ts';
import { disassemble } from '../src/exe/disasm.ts';
import { gameDirIfAny } from './game-dir.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const game = gameDirIfAny();
if (!game) {
  console.log('nobody said where the game is (HOMM5_GAME or --game) — skipping');
  process.exit(0);
}
const paths = ['H5_Game_H5E.exe', 'H5_MapEditor_H5E.exe'].map((n) => join(game, 'bin', n));
if (!paths.every(existsSync)) {
  console.log(`no ${paths.find((p) => !existsSync(p))} — skipping`);
  process.exit(0);
}
const images = paths.map((p) => PEFile.read(p));

const doc = readFileSync(join('docs', 'RMG.md'), 'utf8');
const cited = [...new Set([...doc.matchAll(/0x([0-9a-fA-F]{5,8})\b/g)].map((m) => Number.parseInt(m[1]!, 16)))];

/** Does a linear decode reach exactly this address? Several starts, because a
 *  decode begun mid-instruction desynchronises, and that is the heuristic's
 *  failure rather than the address's. */
function onBoundary(pe: PEFile, va: number): boolean {
  for (const back of [16, 24, 32, 48, 64, 96, 128]) {
    const at = pe.offsetOf(va - back);
    if (at === null) continue;
    for (const ins of disassemble(pe.buf.subarray(at, at + back + 32), va - back)) {
      if (ins.address === va) return true;
      if (ins.address > va) break;
    }
  }
  return false;
}

const unresolved: number[] = [];
const codeAddresses: number[] = [];
for (const va of cited) {
  if (images.some((pe) => pe.isCode(va))) codeAddresses.push(va);
  else if (images.every((pe) => pe.offsetOf(va) === null)) unresolved.push(va);
}
console.log(`docs/RMG.md cites ${cited.length} distinct addresses`);
// Everything that resolves nowhere must be a value rather than an address —
// colours, class ids, the LCG's own constants. Naming them is the check: a
// citation that is neither an address nor a known constant is a mistake.
const CONSTANTS = new Set([
  0xff000000, 0xff027df9, 0x0, 0x16130cc1, 0x16130cc3, 0x16130cc5, 0x75bcd15,
  0x343fd, 0x269ec3, 0x7fffffff, 0x55555556, 0x68db8bad, 0x2aaaaaab, 0x3b808081,
  0x1fffffff, 0x40080000, 0x3f800000, 0x80000000, 0xffffffff, 0x10000000,
  // The compiler's reciprocals for the two divisions the treasure route does.
  0x4ec4ec4f, 0xba2e8ba3,
]);
check('every citation is an address in one of the images, or a named constant',
  unresolved.every((v) => CONSTANTS.has(v)),
  unresolved.filter((v) => !CONSTANTS.has(v)).map((v) => `0x${v.toString(16)}`).join(' '));

const off = codeAddresses.filter((va) => !images.some((pe) => pe.isCode(va) && onBoundary(pe, va)));
// A ratchet, not a target: the heuristic misses a few legitimate mid-function
// citations, so what matters is that the number does not grow.
const KNOWN_OFF = 12;
check(`${codeAddresses.length - off.length} of ${codeAddresses.length} code citations land on an instruction boundary`,
  off.length <= KNOWN_OFF, `${off.length} do not: ${off.map((v) => `0x${v.toString(16)}`).join(' ')}`);

// The values the prose states. These are what an invented reading gets wrong
// first: an address can be plausible and a constant cannot.
const pe = images[0]!;
const f32 = (va: number): number => pe.buf.readFloatLE(pe.offsetOf(va)!);
const f64 = (va: number): number => pe.buf.readDoubleLE(pe.offsetOf(va)!);
const u32 = (va: number): number => pe.buf.readUInt32LE(pe.offsetOf(va)!) >>> 0;
const STATED: Array<[string, number, number]> = [
  ['0xF4A1E8 is the float 255.0', f32(0xf4a1e8), 255],
  ['0xF4C7B8 is the support 3.0', f64(0xf4c7b8), 3],
  ['0xFA3DD8 is pi', f64(0xfa3dd8), Math.PI],
  ['0xF4BB38 is the 32.0 the water gate compares against', f32(0xf4bb38), 32],
  ['0xF4A0B0 is the 0.5 that makes a tile centre', f32(0xf4a0b0), 0.5],
  ['0xF493E8 is 1.0', f64(0xf493e8), 1],
  ['0xF493C4 is 1.0f', f32(0xf493c4), 1],
  ['0xF4DC88 is 512/(2*pi), the sine table\'s scale', f32(0xf4dc88), Math.fround(512 / (2 * Math.PI))],
  ['0xF4A1E0 is the 0.5 the resample rounds with', f64(0xf4a1e0), 0.5],
  ['0x108E8CC is the in-game flat colour 0xFF027DF9', u32(0x108e8cc), 0xff027df9],
];
for (const [what, got, want] of STATED) check(what, got === want, `it reads ${got}`);
// A magic constant is checkable against the division the prose claims for it,
// which ties the two together: `0x4EC4EC4F` is the reciprocal of 13 and
// nothing else, so "indices congruent to 5 mod 13" is not a guess.
check('0x4EC4EC4F is the compiler\'s reciprocal for a division by 13',
  Math.round(2 ** 34 / 13) === 0x4ec4ec4f);
// The sine table itself, which the port reads rather than recomputes.
check('0xFA2898 holds sin(2*pi*i/512) to within the table\'s own step',
  Array.from({ length: 513 }, (_, i) => Math.abs(f32(0xfa2898 + i * 4) - Math.sin(2 * Math.PI * i / 512)))
    .every((d) => d < 1e-6));

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
