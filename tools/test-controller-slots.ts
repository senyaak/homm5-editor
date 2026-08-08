// Our count window's controller, slot by slot, against the engine's own.
//
//   node tools/test-controller-slots.ts
//
// WHAT THIS CATCHES, and it is the one class of mistake that costs a launch of
// the game: a virtual of this engine's takes its own arguments off the stack,
// so a slot of ours that disagrees about HOW MANY there are leaves the caller's
// stack four bytes out. Nothing complains. The function that called it returns
// into whatever was next on the stack, and the crash lands somewhere with no
// relation to the mistake — ours landed INSIDE OUR OWN DATA, because the thing
// next on the stack was the controller we had passed to `Show`.
//
// ARITY COMES FROM THE `ret`, of the function being replaced. Never from the
// shape of the call site: `+0x24` is called as `push ebp; call [eax+24h]`, and
// that push is a saved register whose `pop` is at the far end of the block.
// Read as an argument, it crashed the game; the engine's own slot is a bare
// `ret` and says so in one byte.
//
// So this reads both sides. Ours comes out of the built DLL — `build_controller`
// writes each slot as `mov dword ptr [<vtable+k*4>], <function>`, so the
// assignments name themselves — and the engine's out of `CBaseDragStackController`'s
// vtable. Both are disassembled to their first `ret`.

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { PEFile } from '../src/exe/pe.ts';
import { disassemble } from '../src/exe/disasm.ts';
import { CLEAN_EXE } from '../src/exe/exe-unwrap.ts';
import { gameDir } from './game-dir.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const DLL = join(import.meta.dirname, '..', 'native', 'build', 'homm5-editor.dll');
/** `CBaseDragStackController`'s first vtable — what a split window drives. */
const ENGINE_VTABLE = 0xf6a374;
/** How far a slot may run before we give up looking for its `ret`. */
const SLOT_INSTRUCTIONS = 200;

/** How many bytes of arguments a function takes off the stack itself. */
function argBytesOf(pe: PEFile, va: number): number | null {
  const at = pe.offsetOf(va);
  if (at === null) return null;
  const code = pe.buf.subarray(at, at + 0x800);
  let n = 0;
  for (const ins of disassemble(code, va)) {
    const m = /^ret(?:\s+([0-9A-Fa-f]+)h?)?$/.exec(ins.text.trim());
    if (m) return m[1] ? parseInt(m[1], 16) : 0;
    if (++n > SLOT_INSTRUCTIONS) return null;
  }
  return null;
}

// --- what WE put in each slot ------------------------------------------------

// Skipped rather than failed when there is nothing to read, the way every other
// suite here treats content it did not build.
if (!existsSync(DLL)) {
  console.log(`  (no extension at ${DLL} — run "npm run build-native" to check it)`);
  process.exit(0);
}
const dll = PEFile.read(DLL);
const dllText = dll.sections.find((s) => s.name === '.text')!;
const dllData = dll.sections.find((s) => s.name === '.data')!;
const dataLow = dll.imageBase + dllData.va;
const dataHigh = dataLow + dllData.virtualSize;
const textLow = dll.imageBase + dllText.va;
const textHigh = textLow + dllText.virtualSize;

const stores: { at: number; value: number }[] = [];
for (const ins of disassemble(dll.buf.subarray(dllText.raw, dllText.raw + dllText.rawSize), textLow)) {
  const m = /^mov dword ptr \[([0-9A-Fa-f]+)h\],([0-9A-Fa-f]+)h$/.exec(ins.text.trim());
  if (!m) continue;
  const at = parseInt(m[1]!, 16);
  if (at >= dataLow && at < dataHigh) stores.push({ at, value: parseInt(m[2]!, 16) });
}

// The controller's first word IS its vtable, and that is the only place where
// one of our .data addresses is written into another.
const vtableStore = stores.filter((s) => s.value >= dataLow && s.value < dataHigh);
check('the controller is given its vtable, once', vtableStore.length === 1,
  vtableStore.map((s) => s.value.toString(16)).join());
if (vtableStore.length !== 1) process.exit(1);
const vtable = vtableStore[0]!.value;

const ours = new Map<number, number>();
for (const s of stores) {
  if (s.at < vtable || s.at >= vtable + 0x40) continue;
  if (s.value < textLow || s.value >= textHigh) continue;
  ours.set(s.at - vtable, s.value);
}
check('every measured slot is filled in by name', ours.size === 9, `${ours.size} of 9`);

// --- and what the engine's own controller has there --------------------------

const exe = join(gameDir(), CLEAN_EXE);
if (!existsSync(exe)) {
  console.log(`\n  (no ${CLEAN_EXE} — the engine's half was not checked)`);
  process.exit(failures ? 1 : 0);
}
const game = PEFile.read(exe);
const slotsAt = game.offsetOf(ENGINE_VTABLE);
check("the engine's controller vtable is where it was measured", slotsAt !== null);
if (slotsAt === null) process.exit(1);

for (const [offset, fn] of [...ours].sort((a, b) => a[0] - b[0])) {
  const theirs = game.buf.readUInt32LE(slotsAt + offset);
  const wanted = argBytesOf(game, theirs);
  const got = argBytesOf(dll, fn);
  const name = `slot +0x${offset.toString(16).padStart(2, '0')}`;
  if (wanted === null || got === null) {
    check(`${name} could be read on both sides`, false, `theirs ${wanted}, ours ${got}`);
    continue;
  }
  check(`${name} takes the same arguments as the engine's`, wanted === got,
    `engine's 0x${theirs.toString(16)} ends ret ${wanted}, ours ret ${got}`);
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
