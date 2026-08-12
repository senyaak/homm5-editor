// Reading code: disassemble a function, see what several functions share, or
// find who touches a structure field.
//
//   node tools/reverse/trace.ts show 0xc77850              disassemble it
//   node tools/reverse/trace.ts calls 0xb1ef70             who calls this
//   node tools/reverse/trace.ts common 0xb2d030 0xb2a790   what both call
//   node tools/reverse/trace.ts field 0x44 0x48 0x4c       who reads these offsets
//   node tools/reverse/trace.ts field 0x638 --all         every instruction, ungrouped
//   node tools/reverse/trace.ts writes 0xfd4f60            who STORES this constant
//   node tools/reverse/trace.ts start 0xd20a19             where that function begins
//   node tools/reverse/trace.ts dump 0xfd4f5c --count 24   words, each code or data
//
// `common` is how the hook point was found: an artifact can leave a hero from
// the hero screen, a script, a quest or a death, so whatever they share is
// where the engine actually does the work. `field` is the opposite direction —
// given a structure offset, who reads it.

import { resolve } from 'node:path';

import { PEFile } from '../../src/exe/pe.ts';
import { gameDir } from '../game-dir.ts';
import { disassemble, functionBody, type Instruction } from '../../src/exe/disasm.ts';

const args = process.argv.slice(2);
const flagValue = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const rest = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
const [command, ...operands] = rest;
const addresses = operands.map((a) => Number.parseInt(a, 16));

// Said, never guessed from the checkout's position (tools/game-dir.ts).
const pe = PEFile.read(flagValue('exe') ?? resolve(gameDir(), 'bin', 'H5_Game_H5E.exe'));

/** A function's instructions, or nothing when the address is not code. */
function body(address: number, maxBytes?: number): Instruction[] {
  const at = pe.offsetOf(address);
  return at === null ? [] : functionBody(pe.buf.subarray(at), address, maxBytes);
}

/** Any string an instruction points at — the fastest way to recognise code. */
function annotate(ins: Instruction): string {
  const notes: string[] = [];
  for (const imm of ins.immediates) {
    const s = pe.stringAt(imm, 60);
    if (s && s.length > 2) notes.push(`"${s}"`);
  }
  if (ins.memory && ins.memory.base === 'None') {
    const s = pe.stringAt(ins.memory.displacement, 60);
    if (s && s.length > 2) notes.push(`"${s}"`);
  }
  return notes.length ? `   ; ${notes.join(' ')}` : '';
}

function show(address: number): void {
  for (const ins of body(address, Number(flagValue('bytes') ?? 0x300))) {
    console.log(`0x${ins.address.toString(16)}  ${ins.text.padEnd(38)}${annotate(ins)}`);
  }
}

/** Direct callees and virtual slots of one function. */
function callees(address: number): { direct: Set<number>; virtual: Set<number> } {
  const direct = new Set<number>();
  const virtual = new Set<number>();
  for (const ins of body(address)) {
    if (ins.mnemonic !== 'call') continue;
    if (ins.branchTarget !== undefined && pe.isCode(ins.branchTarget)) direct.add(ins.branchTarget);
    else if (ins.memory && ins.memory.base !== 'None' && ins.memory.displacement) virtual.add(ins.memory.displacement);
  }
  return { direct, virtual };
}

/** Everything reachable by direct calls, to a depth. */
function reach(root: number, depth: number): Map<number, number> {
  const seen = new Map<number, number>();
  let frontier = new Set([root]);
  for (let level = 1; level <= depth; level++) {
    const next = new Set<number>();
    for (const fn of frontier) {
      for (const callee of callees(fn).direct) {
        if (!seen.has(callee)) { seen.set(callee, level); next.add(callee); }
      }
    }
    frontier = next;
  }
  return seen;
}

switch (command) {
  case 'show':
    show(addresses[0]!);
    break;

  // The bytes at an address, written the way the extension writes them.
  //
  // Every hook in native/ names a head it refuses to install over unless the
  // bytes still match, and those heads used to be typed out from the mnemonics
  // in `show` — which is how `mov esi,edx` got written as 8B D2 (it is 8B F2),
  // and the refusal only turned up in a game run. This prints the encoding, one
  // instruction a line, so a head is copied rather than recalled.
  case 'bytes': {
    const count = Number(flagValue('bytes') ?? 16);
    let taken = 0;
    for (const ins of body(addresses[0]!, count + 16)) {
      if (taken >= count) break;
      const at = pe.offsetOf(ins.address)!;
      const raw = [...pe.buf.subarray(at, at + ins.length)]
        .map((b) => `0x${b.toString(16).toUpperCase().padStart(2, '0')},`).join(' ');
      console.log(`  ${raw.padEnd(30)} // ${ins.text}`);
      taken += ins.length;
    }
    break;
  }

  case 'calls': {
    const found = pe.callsTo(addresses[0]!);
    console.log(`${found.length} references to 0x${addresses[0]!.toString(16)}`);
    for (const { from, kind } of found) console.log(`  ${kind} from 0x${from.toString(16)}`);
    break;
  }

  // WHO WRITES THIS CONSTANT — how a constructor is found from its vtable.
  //
  // `calls` answers for code that is CALLED; a vtable address is never called,
  // it is STORED, and `mov [ecx], <vtable>` at the top of a constructor is the
  // one instruction that says which class an object is about to be. The same
  // question finds who stores a string pointer, an id, a table base.
  //
  //   node tools/reverse/trace.ts writes 0xfd4f60
  case 'writes': {
    const wanted = addresses[0]!;
    const text = pe.section('.text');
    const found: Instruction[] = [];
    for (const ins of disassemble(pe.bytesOf(text), pe.imageBase + text.va)) {
      if (ins.immediates.includes(wanted)) found.push(ins);
    }
    console.log(`${found.length} instructions carry 0x${wanted.toString(16)}`);
    for (const ins of found) console.log(`  0x${ins.address.toString(16)}  ${ins.text}`);
    break;
  }

  // WHERE THIS FUNCTION BEGINS — the address `show` should be given.
  //
  // `writes` and `field` answer with an address in the MIDDLE of a function,
  // and disassembling from there reads the tail of one instruction as the head
  // of another: the listing is plausible and wrong. A start is recognised by
  // somebody CALLING it, so this walks back and reports every address in reach
  // that the executable calls, nearest first.
  //
  //   node tools/reverse/trace.ts start 0xd20a19 [--back 0x600]
  case 'start': {
    const inside = addresses[0]!;
    const back = Number(flagValue('back') ?? 0x600);
    const found: Array<{ at: number; callers: number }> = [];
    for (let at = inside; at >= inside - back; at--) {
      const callers = pe.callsTo(at).length;
      if (callers) found.push({ at, callers });
    }
    if (!found.length) {
      console.log(`nothing within 0x${back.toString(16)} bytes before 0x${inside.toString(16)}`
        + ' is called — it may be reached only through a vtable, or the window is too short');
      break;
    }
    // AND THE CANDIDATE HAS TO REACH THE ADDRESS. `callsTo` scans BYTES, so an
    // 0xE8 or 0xE9 inside a constant reads as a call — `sub ecx,0B4h` supplied
    // one, and the false start it produced looked as ordinary as a true one.
    // Disassembling from a real start lands ON the address; from a false one
    // the stream runs through it or dies, and that is the difference printed
    // here. Verified beats plausible: the misread cost an hour once already.
    console.log(`0x${inside.toString(16)} sits inside one of these:`);
    for (const f of found) {
      const lands = body(f.at, inside - f.at + 0x20).some((ins) => ins.address === inside);
      console.log(`  0x${f.at.toString(16)}  ${f.callers} caller(s), `
        + `0x${(inside - f.at).toString(16)} bytes before it`
        + `${lands ? '  — reaches it' : '  — does NOT reach it (a byte-scan false start)'}`);
    }
    break;
  }

  // THE WORDS AT AN ADDRESS, each said to be code or not.
  //
  // A vtable is data, and its LENGTH is the thing that cannot be guessed: the
  // slot listing of a class with several vtables runs straight past the end of
  // one into the next, and a slot read from the wrong table answers plausibly
  // and wrongly. What ends a table is a word that is not a function — the RTTI
  // pointer the next one carries in front of it — so this prints each word with
  // that verdict beside it.
  //
  //   node tools/reverse/trace.ts dump 0xfd4f5c --count 24
  case 'dump': {
    const from = addresses[0]!;
    const count = Number(flagValue('count') ?? 16);
    for (let i = 0; i < count; i++) {
      const at = from + i * 4;
      const off = pe.offsetOf(at);
      if (off === null) { console.log(`  0x${at.toString(16)}  (not mapped)`); continue; }
      const word = pe.buf.readUInt32LE(off);
      const what = pe.isCode(word) ? 'code' : (pe.stringAt(word, 40) ? `"${pe.stringAt(word, 40)}"` : 'data');
      console.log(`  0x${at.toString(16)}  0x${word.toString(16).padStart(8, '0')}  ${what}`);
    }
    break;
  }

  // WHERE A VALUE SITS IN DATA — which table holds this slot.
  //
  // `writes` finds a constant in CODE; a vtable entry is not written by any
  // instruction, it is assembled into .rdata. Given a function's address this
  // says which tables list it, and a thunk found by `start` is placed the same
  // way — that is how a virtual is traced back to the slot it answers.
  //
  //   node tools/reverse/trace.ts where 0xd21b0a
  case 'where': {
    const wanted = addresses[0]!;
    let hits = 0;
    for (const s of ['.rdata', '.data', '.text']) {
      let section;
      try { section = pe.section(s); } catch { continue; }
      const bytes = pe.bytesOf(section);
      for (let o = 0; o + 4 <= bytes.length; o += 4) {
        if (bytes.readUInt32LE(o) !== wanted) continue;
        console.log(`  0x${(pe.imageBase + section.va + o).toString(16)}  in ${s}`);
        hits++;
      }
    }
    if (!hits) console.log(`0x${wanted.toString(16)} appears in no aligned data word`);
    break;
  }

  case 'common': {
    const depth = Number(flagValue('depth') ?? 2);
    for (const root of addresses) {
      const { direct, virtual } = callees(root);
      console.log(`0x${root.toString(16)} calls ${direct.size} directly, virtual slots: `
        + [...virtual].sort((a, b) => a - b).map((s) => `+0x${s.toString(16)}`).join(' '));
    }
    const reached = addresses.map((a) => reach(a, depth));
    const shared = [...reached[0]!.keys()].filter((fn) => reached.every((r) => r.has(fn)));
    console.log(`\nreached by all ${addresses.length}: ${shared.length} functions`);
    for (const fn of shared.sort((a, b) => Math.max(...reached.map((r) => r.get(a)!)) - Math.max(...reached.map((r) => r.get(b)!)))) {
      const where = addresses.map((a, i) => `0x${a.toString(16)}@${reached[i]!.get(fn)}`).join(', ');
      console.log(`  0x${fn.toString(16).padEnd(9)}  ${where}`);
    }
    break;
  }

  case 'field': {
    // Find code that reads SEVERAL of these displacements close together —
    // the fingerprint of something walking one structure, rather than the
    // countless places that happen to touch +0x44 of something else.
    //
    // Linear disassembly of a whole .text misaligns on data and invents
    // instructions, so this is a lead generator: what it turns up gets read,
    // not believed.
    const wanted = new Set(addresses);
    const minimum = Number(flagValue('min') ?? Math.min(3, addresses.length));
    const window = Number(flagValue('window') ?? 0x160);
    const text = pe.section('.text');
    const hits: Array<{ at: number; displacement: number }> = [];
    for (const ins of disassemble(pe.bytesOf(text), pe.addressOf(text.raw)!)) {
      const m = ins.memory;
      if (m && m.base !== 'None' && wanted.has(m.displacement)) {
        hits.push({ at: ins.address, displacement: m.displacement });
      }
    }
    // Every hit, in address order. Grouping answers "who walks this structure";
    // this answers "who touches this field AT ALL", which is the question when
    // the field is one number rather than a record — the dark energy pool has
    // five such places in the whole executable, and reading all five is what
    // showed there is no setter to find. See docs/engineInternals/NECROMANCY.md.
    if (args.includes('--all')) {
      console.log(`${hits.length} instruction(s) touch those offsets`);
      for (const h of hits) {
        const at = pe.offsetOf(h.at);
        const text = at === null ? '' : functionBody(pe.buf.subarray(at), h.at, 16)[0]?.text ?? '';
        console.log(`  0x${h.at.toString(16)}  ${text}`);
      }
      break;
    }
    const groups: Array<{ at: number; fields: Set<number> }> = [];
    for (let i = 0; i < hits.length; i++) {
      const near = new Set<number>();
      for (let j = i; j < hits.length && hits[j]!.at - hits[i]!.at <= window; j++) near.add(hits[j]!.displacement);
      if (near.size < minimum) continue;
      const last = groups.at(-1);
      if (last && hits[i]!.at - last.at <= window) for (const d of near) last.fields.add(d);
      else groups.push({ at: hits[i]!.at, fields: near });
    }
    console.log(`${hits.length} reads of those offsets; ${groups.length} places read ${minimum}+ within ${window} bytes`);
    for (const g of groups) {
      console.log(`  0x${g.at.toString(16)}  ${[...g.fields].sort((a, b) => a - b).map((d) => `+0x${d.toString(16)}`).join(' ')}`);
    }
    break;
  }

  default:
    console.error('usage: trace.ts show|calls|common|field <address ...>');
    process.exit(2);
}
