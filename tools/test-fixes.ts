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
import { disassemble } from '../src/exe/disasm.ts';

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

/**
 * One claim about the file as the C declares it: where, and the byte rows.
 *
 * `after` only for a patch that WRITES. A detour writes a jump of its own
 * making, and a landmark writes nothing at all — but all three say "these bytes
 * are at this address", and that is the claim that goes stale.
 */
interface Patch {
  file: string;
  what: string;
  rva: number;
  before: number[];
  after?: number[];
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

  // AND EVERY OTHER ADDRESS THE FILE NAMES. `overwrite_code` is one of three
  // ways in: a DETOUR replaces a function's head with a jump, and a LANDMARK is
  // read and never written — the bytes that say "the branch we borrow is still
  // the branch we borrow" before a stub is pointed at it. Neither goes through
  // the call above, and eighteen detours were going unchecked; the same stale
  // address that makes `overwrite_code` refuse silently makes a detour land in
  // the middle of an instruction, and that one crashes a battle.
  //
  // Found by the naming rather than by a list: `#define X_RVA` with a byte row
  // called `X_HEAD` or `X_MARK` beside it IS the declaration. A convention the
  // files already follow, so a hook added tomorrow is checked tomorrow.
  for (const m of source.matchAll(/#define\s+(\w+)_RVA\s+0x[0-9A-Fa-f]+u?/g)) {
    const stem = m[1]!;
    if (patches.some((p) => p.file === file && p.rva === rvaNamed(source, `${stem}_RVA`))) continue;
    const before = bytesNamed(source, `${stem}_HEAD`) ?? bytesNamed(source, `${stem}_MARK`);
    const rva = rvaNamed(source, `${stem}_RVA`);
    if (!before || rva === null) continue;
    patches.push({ file, what: stem, rva, before });
  }

  // AND THE STUBS, WHICH ARE THE OTHER HALF OF THE SAME RISK.
  //
  // A stub is hand-assembled: bytes typed out in a comment-annotated array, and
  // an installer that pokes relative distances into them at counted offsets.
  // Nothing checks the counting. A stub one byte long in the wrong place still
  // compiles, still installs, and executes garbage inside a battle — and the
  // count moves whenever an instruction is added, which the indirect jump in
  // spell-cast.c had just done.
  //
  // So: decode each `*_STUB` and require it to be WHOLE INSTRUCTIONS ending
  // exactly at the length it declares. That is the property the counting rests
  // on — every offset the installer writes is inside one of these instructions,
  // and a miscount shows up here as a stub that runs past its end or stops
  // short.
  for (const m of source.matchAll(/(\w*STUB)\[(\w+)\]\s*=\s*\{/g)) {
    const bytes = bytesNamed(source, m[1]!);
    const size = m[2]!;
    // The size is either a literal or a `#define` — and the defines here are
    // written as plain decimal, unlike the addresses `rvaNamed` reads.
    const declared = /^\d+$/.test(size) ? Number(size)
      : Number(new RegExp(`#define\\s+${size}\\s+(\\d+)`).exec(source)?.[1] ?? NaN);
    if (!bytes) continue;
    check(`${file}: ${m[1]} declares its own length`, bytes.length === declared,
      `${bytes.length} bytes, ${size} says ${declared}`);
    let at = 0;
    const boundaries = new Set<number>();
    const jumps: { from: number; to: number }[] = [];
    for (const ins of disassemble(Uint8Array.from(bytes), 0)) {
      if (at >= bytes.length) break;
      boundaries.add(at);
      // A branch INSIDE the stub — its distance is typed out by hand and moves
      // whenever an instruction between it and its target is added. The
      // placeholders the installer overwrites read as a jump to the very next
      // instruction, which is a boundary too, so they pass either way.
      if (ins.branchTarget !== undefined) jumps.push({ from: at, to: ins.branchTarget });
      at += ins.length;
    }
    boundaries.add(at);
    check(`  ${m[1]}: decodes to whole instructions, ending exactly at its length`,
      at === bytes.length, `ends at ${at} of ${bytes.length}`);
    // Landing between two instructions is the failure a length check cannot see:
    // the bytes stay the right number and the stub executes from the middle of
    // an operand. Only the jumps that stay INSIDE are ours to judge — the one
    // home leaves, and the installer writes its distance.
    for (const j of jumps) {
      if (j.to < 0 || j.to > bytes.length) continue;
      check(`  ${m[1]}: the jump at ${j.from} lands on an instruction`, boundaries.has(j.to),
        `it lands at ${j.to}`);
    }
    // AND WHERE THE INSTALLER POKES. Each `*(DWORD *)(stub + N) = …` fills in a
    // distance the byte row left at zero, and N is counted by hand off the
    // comments. Off by one it overwrites the tail of one instruction and the
    // head of the next — bytes that still decode, jumps that still land, and a
    // stub that does something else. So N has to be the LAST FOUR BYTES of an
    // instruction of THIS stub, which is the only place a rel32 or an absolute
    // can sit. It is the mistake that keeps happening: two of them in one
    // afternoon, both after an instruction was added above.
    //
    // The installer is found by the line that copies the row — every one of them
    // reads `for (…) stub[i] = <NAME>[i];` — and its writes are the ones from
    // there to the end of that function. Without that scoping this compares
    // every stub against every write in the file and can never fail.
    const copy = source.indexOf(`stub[i] = ${m[1]}[i]`);
    const installer = copy < 0 ? '' : source.slice(copy, source.indexOf('\n}', copy));
    // The rule is not "the last four bytes": an instruction can carry a
    // displacement AND an immediate — `cmp dword ptr [addr],0` is
    // `83 3D <disp32> <imm8>`, whose dword sits four bytes from the END minus
    // one. What always holds is that the four bytes must lie inside ONE
    // instruction and must not start at its opcode.
    const spans = [...disassemble(Uint8Array.from(bytes), 0)]
      .filter((ins) => ins.address + ins.length <= bytes.length)
      .map((ins) => ({ from: ins.address, to: ins.address + ins.length }));
    for (const w of installer.matchAll(/\*\(DWORD \*\)\(stub \+ (\d+)\)\s*=/g)) {
      const at = Number(w[1]);
      const inside = spans.find((s) => at > s.from && at + 4 <= s.to);
      check(`  ${m[1]}: the installer's byte ${at} is inside one instruction`, !!inside,
        inside ? '' : `it is not — the instructions are ${spans.map((s) => `${s.from}..${s.to}`).join(', ')}`);
    }
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
