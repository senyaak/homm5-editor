// x86 disassembly, in the shape the reverse-engineering tools actually ask for.
//
// WHY iced-x86 AND NOT CAPSTONE. The tools do not read assembly, they filter it:
// "which functions read offset +0x44 of a record", "what does this one call",
// "what immediate does it load". That needs the *decoded operands* — a
// displacement as a number, a base register, an index scale — not a line of
// text to run a regular expression over. Of the JavaScript options only
// iced-x86 gives them: `capstone-wasm` exposes text and nothing else, and
// `@alexaltea/capstone-js` exposes a detail struct whose fields come back as
// garbage (a displacement reading 0x3900000000, which is the opcode bytes).
// iced-x86 is also a decoder rather than a binding, so there is no native
// build step and no second language in the repo.

import { Decoder, DecoderOptions, Formatter, FormatterSyntax, OpKind, Register } from 'iced-x86';

export interface MemoryOperand {
  /** The constant part: `[eax + 0x44]` is 0x44. */
  displacement: number;
  /** Register name, or 'None' when the address has no base. */
  base: string;
  index: string;
  scale: number;
}

export interface Instruction {
  /** Virtual address. */
  address: number;
  length: number;
  mnemonic: string;
  /** The whole instruction as text, e.g. `mov eax,[esp+10h]`. */
  text: string;
  /** Present when an operand addresses memory. */
  memory?: MemoryOperand;
  /** Every immediate the instruction carries. */
  immediates: number[];
  /** Where a direct call or jump goes. */
  branchTarget?: number;
}

const formatter = new Formatter(FormatterSyntax.Intel);

/**
 * Decode instructions starting at `address`.
 *
 * Linear from the first byte, like every disassembler: pointed at data it will
 * produce nonsense, which is why callers start at a known function.
 */
export function* disassemble(code: Uint8Array, address: number, limit = Infinity): Generator<Instruction> {
  const decoder = new Decoder(32, code, DecoderOptions.None);
  decoder.ip = BigInt(address >>> 0);
  let produced = 0;
  while (decoder.position < decoder.maxPosition && produced < limit) {
    const ins = decoder.decode();
    const out: Instruction = {
      address: Number(ins.ip),
      length: ins.length,
      mnemonic: formatter.formatMnemonic(ins),
      text: formatter.format(ins),
      immediates: [],
    };
    for (let i = 0; i < ins.opCount; i++) {
      switch (ins.opKind(i)) {
        case OpKind.Memory:
          out.memory = {
            displacement: Number(ins.memoryDisplacement),
            base: Register[ins.memoryBase] ?? String(ins.memoryBase),
            index: Register[ins.memoryIndex] ?? String(ins.memoryIndex),
            scale: ins.memoryIndexScale,
          };
          break;
        case OpKind.Immediate8:
        case OpKind.Immediate8to16:
        case OpKind.Immediate8to32:
        case OpKind.Immediate16:
        case OpKind.Immediate32:
          out.immediates.push(Number(ins.immediate(i)) >>> 0);
          break;
        case OpKind.NearBranch16:
        case OpKind.NearBranch32:
          out.branchTarget = Number(ins.nearBranchTarget);
          break;
        default:
          break;
      }
    }
    yield out;
    produced++;
  }
}

/**
 * A function's instructions, stopping where it plainly ends.
 *
 * MSVC pads between functions with `int3`, so a return followed by padding is
 * the end. Without a marker the caller's `maxBytes` decides — this makes no
 * attempt to follow branches and find the real extent.
 */
export function functionBody(code: Uint8Array, address: number, maxBytes = 0x2000): Instruction[] {
  const out: Instruction[] = [];
  let sawReturn = false;
  for (const ins of disassemble(code.subarray(0, maxBytes), address)) {
    if (sawReturn && ins.mnemonic === 'int3') break;
    sawReturn = ins.mnemonic === 'ret';
    out.push(ins);
  }
  return out;
}
