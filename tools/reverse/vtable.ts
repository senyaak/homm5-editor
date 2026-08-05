// A class name to its vtable, through RTTI.
//
//   node tools/reverse/vtable.ts CAdvMapHero
//   node tools/reverse/vtable.ts CSwapMoveArtifactCmd 0xc 0x1c
//   node tools/reverse/vtable.ts --list Artefact        just the class names
//
// MSVC lays this out as: a type descriptor holding the decorated name, a
// complete-object locator pointing at the descriptor, and the locator sitting
// one dword before the vtable. Walking that backwards turns a name into the
// address of any virtual function the class declares.
//
// A class with multiple inheritance has several vtables — they are all listed,
// primary first, because which one a call goes through depends on the
// subobject. See docs/engineInternals/ARTIFACTS_AND_EQUIPMENT.md, where this found the hero's stat
// getters.

import { resolve } from 'node:path';

import { PEFile } from '../../src/exe/pe.ts';
import { gameDir } from '../game-dir.ts';
import { functionBody } from '../../src/exe/disasm.ts';

const args = process.argv.slice(2);
const flagValue = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const positional = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));

// Said, never guessed from the checkout's position (tools/game-dir.ts).
const pe = PEFile.read(flagValue('exe') ?? resolve(gameDir(), 'bin', 'H5_Game_H5E.exe'));

const fragment = flagValue('list') ?? positional[0];
if (!fragment) {
  console.error('usage: vtable.ts <class name fragment> [slot ...]');
  process.exit(2);
}
const slots = positional.slice(1).map((s) => Number.parseInt(s, 16));

/** Decorated RTTI names containing `fragment`, with their type descriptors. */
function typeDescriptors(fragment: string): Array<{ name: string; descriptor: number }> {
  const out: Array<{ name: string; descriptor: number }> = [];
  for (const offset of pe.findBytes('.?AV')) {
    const va = pe.addressOf(offset);
    if (va === null) continue;
    const name = pe.stringAt(va, 160);
    // the descriptor starts two dwords before its name
    if (name?.includes(fragment)) out.push({ name, descriptor: va - 8 });
  }
  return out;
}

/** Vtables whose complete-object locator names this descriptor. */
function vtablesFor(descriptor: number): number[] {
  const out: number[] = [];
  for (const ref of pe.pointersTo(descriptor)) {
    const locator = pe.addressOf(ref - 12);     // pTypeDescriptor sits at +12
    if (locator === null) continue;
    for (const back of pe.pointersTo(locator)) {
      const vtable = pe.addressOf(back + 4);    // the locator precedes the vtable
      if (vtable !== null) out.push(vtable);
    }
  }
  return out;
}

/** How many instructions a function has — a rough "is this the real one". */
function size(address: number): number {
  const at = pe.offsetOf(address);
  return at === null ? 0 : functionBody(pe.buf.subarray(at), address).length;
}

for (const { name, descriptor } of typeDescriptors(fragment)) {
  const vtables = vtablesFor(descriptor);
  if (!vtables.length) continue;
  console.log(`${name}  (descriptor 0x${descriptor.toString(16)})`);
  if (flagValue('list') !== undefined) continue;
  for (const vtable of vtables) {
    console.log(`  vtable 0x${vtable.toString(16)}`);
    const wanted = slots.length ? slots : Array.from({ length: 12 }, (_, i) => i * 4);
    for (const slot of wanted) {
      const fn = pe.dwordAt(vtable + slot);
      if (fn === null || !pe.isCode(fn)) continue;
      console.log(`    +0x${slot.toString(16).padEnd(4)} -> 0x${fn.toString(16).padEnd(9)} ${size(fn)} ins`);
    }
  }
}
