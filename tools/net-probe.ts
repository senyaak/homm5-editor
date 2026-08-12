// Where the game's online play talks to Ubisoft — the strings, who references
// them, and the code around each reference.
//
// Exploratory: it prints, it asserts nothing. Run it against the retail exe:
//   node tools/net-probe.ts [path-to-exe] [string...]

import { PEFile } from '#src/exe/pe.ts';
import { disassemble, functionBody, type Instruction } from '#src/exe/disasm.ts';
import { gameDir } from './game-dir.ts';

const DEFAULT_STRINGS = [
  'http://gsconnect.ubisoft.com/gsinit.php?dp=',
  'ubi_servers.ini',
  'p2pdir.cfg',
  'net_lan_match_maker_port',
  'net_ubi_cdkey_port',
  'net_game_port',
];

/**
 * Start of the function containing `va`, found by walking back to MSVC padding.
 *
 * A candidate is a byte right after `int3`/`nop` padding whose linear decode
 * reaches `va` exactly — and does NOT cross padding on the way, which is what
 * rules out the *previous* function (its decode runs on past its own `ret`).
 * The earliest surviving candidate is the real entry.
 */
function functionStartOf(pe: PEFile, va: number, back = 0x2000): number | null {
  const text = pe.section('.text');
  const code = pe.bytesOf(text);
  const base = pe.imageBase + text.va;
  const at = va - base;
  for (let i = Math.max(1, at - back); i <= at; i++) {
    const prev = code[i - 1]!;
    if (prev !== 0xcc && prev !== 0x90) continue;
    if (code[i] === 0xcc || code[i] === 0x90) continue;
    let reached = false;
    for (const ins of disassemble(code.subarray(i, at + 16), base + i)) {
      if (ins.address === va) {
        reached = true;
        break;
      }
      if (ins.address > va || ins.mnemonic === 'int3') break;
    }
    if (reached) return base + i;
  }
  return null;
}

function annotate(pe: PEFile, ins: Instruction): string {
  const notes: string[] = [];
  for (const imm of ins.immediates) {
    const s = pe.stringAt(imm);
    if (s && s.length >= 3) notes.push(`"${s}"`);
  }
  if (ins.branchTarget !== undefined) notes.push(`-> ${ins.branchTarget.toString(16)}`);
  return notes.length ? `   ; ${notes.join(' ')}` : '';
}

const [, , exeArg, ...wanted] = process.argv;
const exe = exeArg ?? `${gameDir()}/bin/H5_Game.exe.orig`;
const pe = PEFile.read(exe);
console.log(`${exe}\nimage base 0x${pe.imageBase.toString(16)}, sections: ${pe.sections.map((s) => s.name).join(' ')}\n`);

/**
 * `--imports [filter]`: the import table as address -> DLL!function.
 *
 * An indirect `call dword ptr [0xF4180C]` in the disassembly is a call through
 * the import address table, and this is what turns that number into a name.
 */
if (wanted[0] === '--imports') {
  const filter = wanted[1]?.toLowerCase();
  const buf = pe.buf;
  const peAt = buf.readUInt32LE(0x3c);
  const optional = peAt + 24;
  const importRva = buf.readUInt32LE(optional + 96 + 8);
  const rvaOffset = (rva: number) => pe.offsetOf(pe.imageBase + rva);
  for (let d = rvaOffset(importRva)!; ; d += 20) {
    const lookupRva = buf.readUInt32LE(d);
    const nameRva = buf.readUInt32LE(d + 12);
    const iatRva = buf.readUInt32LE(d + 16);
    if (!nameRva && !iatRva) break;
    const dll = pe.stringAt(pe.imageBase + nameRva) ?? '?';
    for (let i = 0; ; i++) {
      const lookup = buf.readUInt32LE(rvaOffset((lookupRva || iatRva) + i * 4)!);
      if (!lookup) break;
      const slot = pe.imageBase + iatRva + i * 4;
      const name = lookup & 0x80000000 ? `#${lookup & 0xffff}` : (pe.stringAt(pe.imageBase + lookup + 2) ?? '?');
      const line = `${slot.toString(16)}  ${dll}!${name}`;
      if (!filter || line.toLowerCase().includes(filter)) console.log(line);
    }
  }
  process.exit(0);
}

// `--push <value>`: every `push imm32` of a value, with the function it is in.
// How a libcurl option number, an error code or a magic constant is located.
if (wanted[0] === '--push') {
  for (const arg of wanted.slice(1)) {
    const value = Number(arg);
    const bytes = Buffer.alloc(5);
    bytes[0] = 0x68;
    bytes.writeUInt32LE(value >>> 0, 1);
    console.log(`--- push 0x${value.toString(16)} (${value})`);
    const text = pe.section('.text');
    for (const off of pe.findBytes(bytes.toString('latin1'))) {
      if (off < text.raw || off >= text.raw + text.rawSize) continue;
      const va = pe.addressOf(off)!;
      console.log(`  ${va.toString(16)} in function ${functionStartOf(pe, va)?.toString(16) ?? '?'}`);
    }
  }
  process.exit(0);
}

// `--icalls <slot>`: every `call dword ptr [slot]` — how an imported function's
// callers are found, since its call is indirect through the import table.
if (wanted[0] === '--icalls') {
  for (const arg of wanted.slice(1)) {
    const slot = Number(arg);
    const bytes = Buffer.alloc(6);
    bytes[0] = 0xff;
    bytes[1] = 0x15;
    bytes.writeUInt32LE(slot >>> 0, 2);
    console.log(`--- call [0x${slot.toString(16)}]`);
    const text = pe.section('.text');
    for (const off of pe.findBytes(bytes.toString('latin1'))) {
      if (off < text.raw || off >= text.raw + text.rawSize) continue;
      const va = pe.addressOf(off)!;
      console.log(`  ${va.toString(16)} in function ${functionStartOf(pe, va)?.toString(16) ?? '?'}`);
    }
  }
  process.exit(0);
}

// `--bytes <pattern>`: find a byte pattern in `.text`, `??` matching anything.
// How a known constant is located when it is not pushed but stored — an error
// triple written into three stack slots, say.
if (wanted[0] === '--bytes') {
  for (const arg of wanted.slice(1)) {
    const pattern = arg.replace(/\s+/g, '').match(/../g) ?? [];
    const bytes = pattern.map((pair) => (pair === '??' ? -1 : parseInt(pair, 16)));
    console.log(`--- ${arg}`);
    const text = pe.section('.text');
    const code = pe.bytesOf(text);
    for (let at = 0; at <= code.length - bytes.length; at++) {
      let hit = true;
      for (let i = 0; i < bytes.length && hit; i++) hit = bytes[i]! < 0 || code[at + i] === bytes[i];
      if (!hit) continue;
      const va = pe.imageBase + text.va + at;
      console.log(`  ${va.toString(16)} in function ${functionStartOf(pe, va)?.toString(16) ?? '?'}`);
    }
  }
  process.exit(0);
}

// `--calls <addr>`: every direct call or jump that lands on an address.
if (wanted[0] === '--calls') {
  for (const arg of wanted.slice(1)) {
    const target = Number(arg);
    console.log(`--- callers of 0x${target.toString(16)}`);
    for (const ref of pe.callsTo(target)) {
      const from = functionStartOf(pe, ref.from);
      console.log(`  ${ref.kind} at ${ref.from.toString(16)} in function ${from === null ? '?' : from.toString(16)}`);
    }
  }
  process.exit(0);
}

// `--func <addr>`: disassemble one function, annotated.
if (wanted[0] === '--func') {
  for (const arg of wanted.slice(1)) {
    const start = Number(arg);
    const section = pe.sections.find((s) => start - pe.imageBase >= s.va && start - pe.imageBase < s.va + s.virtualSize)!;
    const code = pe.bytesOf(section).subarray(start - (pe.imageBase + section.va));
    console.log(`--- function 0x${start.toString(16)}`);
    for (const ins of functionBody(code, start, 0x800)) {
      console.log(`  ${ins.address.toString(16)}  ${ins.text}${annotate(pe, ins)}`);
    }
  }
  process.exit(0);
}

// `--strings <from> <to>`: every string in an address range, in address order.
if (wanted[0] === '--strings') {
  const from = Number(wanted[1]);
  const to = Number(wanted[2]);
  for (let va = from; va < to; ) {
    const s = pe.stringAt(va, 200);
    if (s === null) {
      va++;
      continue;
    }
    console.log(`${va.toString(16)}  ${s}`);
    va += s.length + 1;
  }
  process.exit(0);
}

for (const text of wanted.length ? wanted : DEFAULT_STRINGS) {
  console.log(`=== "${text}"`);
  // A `0x…` argument is an address to find references to, not a string to look up.
  const addresses = /^0x[0-9a-f]+$/i.test(text) ? [Number(text)] : pe.findString(text);
  if (!addresses.length) {
    console.log('  (no such string)\n');
    continue;
  }
  for (const va of addresses) {
    console.log(`  string at 0x${va.toString(16)}`);
    const refs = pe.pointersTo(va).map((off) => ({ off, va: pe.addressOf(off) }));
    for (const ref of refs) {
      const site = ref.va;
      if (site === null || !pe.isCode(site)) {
        console.log(`    pointer in data at file 0x${ref.off.toString(16)} (va ${site?.toString(16) ?? '?'})`);
        continue;
      }
      // The dword is an operand; the instruction begins a byte or two earlier.
      let start: number | null = null;
      let insVa = 0;
      for (const lead of [1, 2, 3]) {
        insVa = site - lead;
        start = functionStartOf(pe, insVa);
        if (start !== null) break;
      }
      console.log(`    referenced at 0x${insVa.toString(16)}, function 0x${(start ?? 0).toString(16)}`);
      if (start === null) continue;
      const section = pe.sections.find((s) => start! - pe.imageBase >= s.va && start! - pe.imageBase < s.va + s.virtualSize)!;
      const code = pe.bytesOf(section).subarray(start - (pe.imageBase + section.va));
      for (const ins of functionBody(code, start, 0x600)) {
        const mark = ins.address === insVa ? '>' : ' ';
        console.log(`    ${mark} ${ins.address.toString(16)}  ${ins.text}${annotate(pe, ins)}`);
      }
    }
    console.log('');
  }
}
