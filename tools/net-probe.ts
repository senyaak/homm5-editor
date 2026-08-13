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

/**
 * How many bytes of arguments a function pops on its way out — the `N` of `ret N`.
 *
 * Every `ret` in a function agrees on it (the compiler has one epilogue's worth of
 * truth), so the first one found is the answer; 0 for a cdecl callee, and 0 for
 * anything not decodable, which errs towards leaving the count alone.
 */
const cleanups = new Map<number, number>();
function cleanup(pe: PEFile, target: number): number {
  const known = cleanups.get(target);
  if (known !== undefined) return known;
  cleanups.set(target, 0); // Against recursion, before the walk.
  let found = 0;
  if (pe.isCode(target)) {
    const section = pe.sections.find((s) => target - pe.imageBase >= s.va && target - pe.imageBase < s.va + s.virtualSize);
    if (section) {
      const code = pe.bytesOf(section).subarray(target - (pe.imageBase + section.va));
      for (const ins of functionBody(code, target, 0x400)) {
        // masm writes `ret 8` and `ret 0Ch` — hex only when it has to say so.
        const ret = /^ret ([0-9A-Fa-f]+h|\d+)$/.exec(ins.text);
        if (ret) {
          const n = ret[1]!;
          found = n.endsWith('h') ? Number.parseInt(n.slice(0, -1), 16) : Number(n);
          break;
        }
        if (ins.text === 'ret') break;
      }
    }
  }
  cleanups.set(target, found);
  return found;
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

// `--dword <addr>`: the value sitting at an address in the image as shipped —
// what a config variable's default is before anything overrides it.
if (wanted[0] === '--dword') {
  for (const arg of wanted.slice(1)) {
    const va = Number(arg);
    const value = pe.dwordAt(va);
    console.log(
      value === null
        ? `  ${va.toString(16)} is not in the image`
        : `  ${va.toString(16)} = ${value} (0x${value.toString(16)}) — as a float ${new DataView(new Uint8Array([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]).buffer).getFloat32(0, true)}`,
    );
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
if (wanted[0] === '--func' || wanted[0] === '--frame') {
  // `--frame` is `--func` with the stack pointer accounted for. In these functions
  // every argument and every local is `[esp+N]`, and N moves with each push — which
  // is exactly what a reader gets wrong: the same slot is `[esp+8]` before two pushes
  // and `[esp+0x10]` after them. So this tracks the offset from the function's own
  // entry and rewrites each access as `arg1`, `arg2`, … or `local(-N)`, which is
  // stable. Arithmetic nobody should do by eye three times in a row.
  const asFrame = wanted[0] === '--frame';
  // How far esp has moved since entry: 0 at the first instruction, negative after a
  // push. `ebp` is followed too, for the frames that set it up. `sure` goes false
  // where the count stops being arithmetic and starts being a guess.
  interface Frame {
    esp: number;
    ebp: number | null;
    sure: boolean;
  }
  const walk = (start: number) => {
    const section = pe.sections.find((s) => start - pe.imageBase >= s.va && start - pe.imageBase < s.va + s.virtualSize)!;
    const code = pe.bytesOf(section).subarray(start - (pe.imageBase + section.va));
    const body = functionBody(code, start, 0x800);
    // What an indirect call is assumed to clean up: the run of pushes that leads into
    // it, four bytes each — unless the caller cleans them itself right afterwards
    // (`add esp,N`), which is the cdecl case and counting it twice would be worse.
    const assumed = new Map<number, number>();
    for (let i = 0; i < body.length; i++) {
      const ins = body[i]!;
      if (ins.mnemonic !== 'call' || ins.branchTarget !== undefined) continue;
      if (/^add esp,/.test(body[i + 1]?.text ?? '')) continue;
      let pushes = 0;
      for (let j = i - 1; j >= 0; j--) {
        const before = body[j]!;
        if (/^push\b/.test(before.text)) {
          pushes++;
          continue;
        }
        // Anything that ends the argument block, or that moves esp on its own account.
        if (/^(call|ret|j|pop|sub esp|add esp|leave)/.test(before.text)) break;
      }
      assumed.set(ins.address, pushes * 4);
    }
    const after = (ins: Instruction, frame: Frame): Frame => {
      const text = ins.text;
      const step = (esp: number, ebp = frame.ebp, sure = frame.sure): Frame => ({ esp, ebp, sure });
      if (/^push\b/.test(text)) return step(frame.esp - 4);
      if (/^pop\b/.test(text)) return step(frame.esp + 4);
      const sub = /^sub esp,([0-9A-Fa-f]+)h?$/.exec(text);
      if (sub) return step(frame.esp - Number.parseInt(sub[1]!, 16));
      const add = /^add esp,([0-9A-Fa-f]+)h?$/.exec(text);
      if (add) return step(frame.esp + Number.parseInt(add[1]!, 16));
      if (text === 'mov ebp,esp') return step(frame.esp, frame.esp);
      if (text === 'mov esp,ebp' && frame.ebp !== null) return step(frame.ebp);
      // A CALLEE that cleans up. Almost everything here is stdcall or thiscall, so the
      // arguments a caller pushed are gone once the call returns — without this the
      // count drifts by four bytes per call and every slot after the first call is
      // named wrong. Which is precisely the mistake this mode exists to prevent, so it
      // is worth reading the callee's own `ret` to find out.
      if (ins.mnemonic === 'call') {
        // Through a vtable or the import table there is no `ret` to read, so the arity
        // is counted from the pushes that lead into the call and the frame is marked as
        // a guess from there on. Ignoring it instead would be a guess too — the silent
        // kind, four bytes per argument, and it is what made this mode necessary.
        if (ins.branchTarget === undefined) return step(frame.esp + (assumed.get(ins.address) ?? 0), frame.ebp, false);
        return step(frame.esp + cleanup(pe, ins.branchTarget));
      }
      return step(frame.esp);
    };
    // The frame at each instruction, carried along the BRANCHES rather than down the
    // page. A function's epilogue is rarely its last instruction — the early-out
    // returns in the middle, and the code after it is reached by a jump from before,
    // still inside the frame. Read linearly, everything past that `ret` was named from
    // esp 0 and read as arguments when they are locals.
    const index = new Map(body.map((ins, i) => [ins.address, i]));
    const frames = new Map<number, Frame>();
    const disputed = new Set<number>();
    const work: Array<{ address: number; frame: Frame }> = [{ address: start, frame: { esp: 0, ebp: null, sure: true } }];
    while (work.length) {
      const { address, frame } = work.pop()!;
      const i = index.get(address);
      if (i === undefined) continue;
      const seen = frames.get(address);
      if (seen) {
        // Two paths disagreeing means one of them was mis-decoded; keep the first and
        // say which address to distrust, instead of quietly overwriting.
        if (seen.esp !== frame.esp) disputed.add(address);
        continue;
      }
      frames.set(address, frame);
      const ins = body[i]!;
      if (ins.mnemonic === 'ret') continue;
      const next = after(ins, frame);
      const jump = ins.mnemonic !== 'call' && ins.branchTarget !== undefined;
      if (jump) work.push({ address: ins.branchTarget!, frame: next });
      if (!jump || ins.mnemonic !== 'jmp') {
        const fallthrough = body[i + 1];
        if (fallthrough) work.push({ address: fallthrough.address, frame: next });
      }
    }
    return { body, frames, disputed };
  };

  for (const arg of wanted.slice(1)) {
    // An address written down in the notes is usually a place INSIDE a function — the
    // instruction something was noticed at. Decoding from there names every slot from
    // the wrong esp and hides the prologue, so walk back to the entry first and say so.
    const asked = Number(arg);
    const candidate = functionStartOf(pe, asked) ?? asked;
    let start = candidate;
    let { body, frames, disputed } = walk(candidate);
    // Neighbours with no padding between them look like one function to the walk back,
    // and then the address asked about sits in code the entry never reaches. That is the
    // tell that it is an entry of its own, so decode it as one.
    if (start !== asked && !frames.has(asked)) {
      start = asked;
      ({ body, frames, disputed } = walk(asked));
    }
    const inside = start === asked ? (candidate === asked ? '' : ` (0x${candidate.toString(16)} runs into it, but never reaches it)`) : ` (0x${asked.toString(16)} is inside it)`;
    console.log(`--- function 0x${start.toString(16)}${inside}${asFrame ? ' (stack slots named from the entry esp)' : ''}`);
    let reached = true;
    for (const ins of body) {
      const frame = frames.get(ins.address);
      const { esp, ebp } = frame ?? { esp: 0, ebp: null };
      let text = ins.text;
      if (asFrame && frame) {
        // At entry `[esp+0]` is the return address, `[esp+4]` the first argument. So a
        // slot at entry+4k is argument k, and anything at or below entry is a local.
        const name = (at: number): string => (at >= 4 && at % 4 === 0 ? `arg${at / 4}` : `local${at}`);
        // The formatter writes masm numbers: `[esp+2Ch]`, `[esp-8]`, `[esp]`.
        const displacement = (sign: string | undefined, digits: string | undefined): number => {
          if (!digits) return 0;
          const value = digits.endsWith('h') ? Number.parseInt(digits.slice(0, -1), 16) : Number(digits);
          return sign === '-' ? -value : value;
        };
        // A guessed frame is marked on every slot it names, so a reading taken from
        // this listing carries the doubt with it: `[local-40?]`, not `[local-40]`.
        const doubt = frame.sure ? '' : '?';
        const slot = (from: number) => (_: string, sign: string, digits: string) =>
          `[${name(from + displacement(sign, digits))}${doubt}]`;
        text = text.replace(/\[esp(?:([+-])([0-9a-fA-F]+h|\d+))?\]/g, slot(esp));
        if (ebp !== null) text = text.replace(/\[ebp(?:([+-])([0-9a-fA-F]+h|\d+))?\]/g, slot(ebp));
      }
      // Said once per run of unreached code, not once per line: a jump table's cases are
      // all unreached from here, and a note on each would bury the listing.
      const doubted = asFrame && !frame && reached ? '   ; nothing reaches this and what follows — slots left as written' : '';
      reached = frame !== undefined;
      const contested = asFrame && disputed.has(ins.address) ? '   ; two paths arrive with different esp' : '';
      console.log(`  ${ins.address.toString(16)}  ${text}${annotate(pe, ins)}${doubted}${contested}`);
    }
  }
  process.exit(0);
}

// `--grep <text>`: every string CONTAINING the text, with what references it.
//
// The plain lookup matches a whole literal, so asking for a name that lives inside a
// longer one ("FriendsSend_AddFriend" inside "NUbi::CClient2::FriendsSend_AddFriend(")
// answers "no such string" about a string that is plainly there. That false negative
// has cost a day once already; this is the way round it.
if (wanted[0] === '--grep') {
  for (const needle of wanted.slice(1)) {
    console.log(`--- strings containing "${needle}"`);
    for (const section of pe.sections) {
      if (section.name === '.text') continue;
      const bytes = pe.bytesOf(section);
      const base = pe.imageBase + section.va;
      for (let at = 0; at < bytes.length; at++) {
        if (bytes[at] === 0 || bytes[at]! < 0x20 || bytes[at]! > 0x7e) continue;
        let end = at;
        while (end < bytes.length && bytes[end]! >= 0x20 && bytes[end]! <= 0x7e) end++;
        const text = Buffer.from(bytes.subarray(at, end)).toString('latin1');
        if (bytes[end] === 0 && text.includes(needle)) {
          const va = base + at;
          const refs = pe.pointersTo(va).map((off) => pe.addressOf(off)?.toString(16) ?? '?');
          console.log(`  ${va.toString(16)}  ${JSON.stringify(text)}${refs.length ? `   referenced at ${refs.join(' ')}` : ''}`);
        }
        at = end;
      }
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
