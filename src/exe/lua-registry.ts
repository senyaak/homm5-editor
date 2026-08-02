// The functions the game hands to Lua, read out of the executable.
//
// They are registered as arrays of {name pointer, function pointer} pairs in
// `.data`. Each function then opens by copying two strings to the heap — an
// argument format and its own name — and giving both to one shared parser, so
// the real signature of every function is in the binary whether the shipped
// manuals mention it or not.
//
// The format is a small grammar: `s` string, `n` number, `b` bool, `f` float,
// and `[default]` marking an optional argument. `GiveArtefact` carries
// `snn[0]`, which is the manual's `GiveArtefact(hero, id, [bindToHero = 0])`.
//
// docs/EXE_LUA_REGISTRY.md is generated from this; docs/engineInternals/LUA.md
// says what it was used for.

import { PEFile } from './pe.ts';
import { disassemble } from './disasm.ts';

export interface LuaFunction {
  name: string;
  /** Where its code starts. */
  address: number;
  /** The registration entry, for anyone wanting to repoint it. */
  entry: number;
  /** Which table it is in. */
  table: number;
  /** Raw format string, '' when none was found. */
  signature: string;
}

const TYPE_LETTERS = new Set('snbfotv');
const FORMAT_CHARS = new Set([...TYPE_LETTERS, ...'[],.-0123456789']);

/** Does this look like an argument format rather than an ordinary string? */
function looksLikeFormat(s: string): boolean {
  return s.length > 0 && s.length <= 24
    && [...s].every((c) => FORMAT_CHARS.has(c))
    && [...s].some((c) => TYPE_LETTERS.has(c))
    && TYPE_LETTERS.has(s[0]!);
}

/** `snn[0]` becomes `(string, number, number = 0)`. */
export function describeSignature(signature: string): string {
  const names: Record<string, string> = {
    s: 'string', n: 'number', b: 'bool', f: 'float', o: 'object', t: 'table', v: 'var',
  };
  const args: string[] = [];
  for (let i = 0; i < signature.length; i++) {
    const c = signature[i]!;
    if (!names[c]) continue;
    let arg = names[c];
    if (signature[i + 1] === '[') {
      const close = signature.indexOf(']', i);
      const end = close < 0 ? signature.length : close;
      arg += ` = ${signature.slice(i + 2, end) || '?'}`;
      i = end;
    }
    args.push(arg);
  }
  return `(${args.join(', ')})`;
}

/** Every {name, function} pair array in the data sections. */
function findTables(pe: PEFile): Array<{ at: number; entries: Array<{ name: string; address: number; entry: number }> }> {
  const tables: Array<{ at: number; entries: Array<{ name: string; address: number; entry: number }> }> = [];
  for (const section of pe.sections.filter((s) => s.name.includes('data'))) {
    const end = section.raw + section.rawSize - 8;
    let at = section.raw;
    while (at < end) {
      const entries: Array<{ name: string; address: number; entry: number }> = [];
      let cursor = at;
      while (cursor < end) {
        const namePtr = pe.buf.readUInt32LE(cursor);
        const fnPtr = pe.buf.readUInt32LE(cursor + 4);
        if (!namePtr || !pe.isCode(fnPtr)) break;
        const name = pe.stringAt(namePtr, 60);
        if (!name || name.length < 2 || !/^\w+$/.test(name)) break;
        entries.push({ name, address: fnPtr, entry: cursor });
        cursor += 8;
      }
      // Six in a row is far past coincidence, and the real tables hold dozens.
      if (entries.length >= 6) {
        tables.push({ at, entries });
        at = cursor;
      } else {
        at += 4;
      }
    }
  }
  return tables;
}

/**
 * The format string a function checks its arguments against.
 *
 * Long formats are copied from a constant (`mov edx, <pointer to "snn">`);
 * short ones the compiler stores inline as an immediate. Both appear before
 * the function's own name, so the first candidate that is not the name wins.
 * Scanning stops at the next function rather than at the first `ret`, since
 * several return early before ever parsing anything.
 */
function readSignature(pe: PEFile, address: number, name: string, until?: number): string {
  const start = pe.offsetOf(address);
  if (start === null) return '';
  const span = until && until > address ? Math.min(until - address, 0x1200) : 0x600;
  for (const ins of disassemble(pe.buf.subarray(start, start + span), address)) {
    if (ins.mnemonic !== 'mov') continue;
    for (const imm of ins.immediates) {
      const pointed = pe.stringAt(imm, 40);
      if (pointed && pointed !== name && looksLikeFormat(pointed)) return pointed;
      // an inline immediate: its own bytes are the format
      const bytes = Buffer.alloc(4);
      bytes.writeUInt32LE(imm >>> 0);
      const inline = bytes.toString('latin1').split('\0')[0]!;
      if (inline && inline !== name && looksLikeFormat(inline)) return inline;
    }
  }
  return '';
}

/** Every Lua-callable function in this executable, with its signature. */
export function readLuaRegistry(pe: PEFile): LuaFunction[] {
  const tables = findTables(pe);
  const addresses = [...new Set(tables.flatMap((t) => t.entries.map((e) => e.address)))].sort((a, b) => a - b);
  const next = new Map<number, number>();
  addresses.forEach((va, i) => { if (i + 1 < addresses.length) next.set(va, addresses[i + 1]!); });

  const out: LuaFunction[] = [];
  for (const table of tables) {
    for (const e of table.entries) {
      out.push({
        name: e.name,
        address: e.address,
        entry: e.entry,
        table: table.at,
        signature: readSignature(pe, e.address, e.name, next.get(e.address)),
      });
    }
  }
  return out;
}
