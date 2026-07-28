// Reading a Windows executable — sections, addresses, strings, references.
//
// Everything here is read-only and knows nothing about Heroes: it is the layer
// under the reverse-engineering tools in tools/reverse, the same way pak.ts sits
// under everything that touches an archive.
//
// The one idea worth stating: a **virtual address** is what the code uses at
// runtime and what a disassembler prints; a **file offset** is where those bytes
// live in the file on disk. Section headers map between them, and mixing the two
// up is the classic way to read garbage and believe it.

import { readFileSync } from 'node:fs';

export interface Section {
  name: string;
  /** Relative virtual address — add the image base for a real one. */
  va: number;
  /** How much space it takes at runtime; can exceed its size on disk. */
  virtualSize: number;
  /** Where its bytes start in the file. */
  raw: number;
  rawSize: number;
}

export class PEFile {
  readonly buf: Buffer;
  readonly imageBase: number;
  readonly sections: readonly Section[];

  constructor(buf: Buffer) {
    this.buf = buf;
    if (buf.length < 0x40 || buf.readUInt16LE(0) !== 0x5a4d) throw new Error('not a PE file (no MZ)');
    const pe = buf.readUInt32LE(0x3c);
    if (buf.readUInt32LE(pe) !== 0x4550) throw new Error('not a PE file (no PE signature)');
    const count = buf.readUInt16LE(pe + 6);
    const optionalSize = buf.readUInt16LE(pe + 20);
    const optional = pe + 24;
    this.imageBase = buf.readUInt32LE(optional + 28);
    const table = optional + optionalSize;
    const sections: Section[] = [];
    for (let i = 0; i < count; i++) {
      const at = table + i * 40;
      sections.push({
        name: buf.toString('latin1', at, at + 8).replace(/\0.*$/, ''),
        virtualSize: buf.readUInt32LE(at + 8),
        va: buf.readUInt32LE(at + 12),
        rawSize: buf.readUInt32LE(at + 16),
        raw: buf.readUInt32LE(at + 20),
      });
    }
    this.sections = sections;
  }

  static read(path: string): PEFile {
    return new PEFile(readFileSync(path));
  }

  /** File offset holding this virtual address, or null if nothing does. */
  offsetOf(va: number): number | null {
    const rva = va - this.imageBase;
    for (const s of this.sections) {
      if (rva >= s.va && rva < s.va + s.virtualSize) {
        const off = s.raw + (rva - s.va);
        return off < this.buf.length ? off : null;
      }
    }
    return null;
  }

  /** The virtual address these file bytes will live at. */
  addressOf(offset: number): number | null {
    for (const s of this.sections) {
      if (offset >= s.raw && offset < s.raw + s.rawSize) {
        return this.imageBase + s.va + (offset - s.raw);
      }
    }
    return null;
  }

  section(name: string): Section {
    const s = this.sections.find((x) => x.name === name);
    if (!s) throw new Error(`no ${name} section`);
    return s;
  }

  /** The bytes of a section, as they are on disk. */
  bytesOf(section: Section): Buffer {
    return this.buf.subarray(section.raw, section.raw + section.rawSize);
  }

  /** Is this address inside executable code? */
  isCode(va: number): boolean {
    const t = this.section('.text');
    const rva = va - this.imageBase;
    return rva >= t.va && rva < t.va + t.virtualSize;
  }

  /**
   * The NUL-terminated ASCII string at `va`, or null when the bytes there are
   * not one. Anything non-printable disqualifies it, so a pointer into the
   * middle of code does not come back as a plausible-looking string.
   */
  stringAt(va: number, max = 120): string | null {
    const start = this.offsetOf(va);
    if (start === null) return null;
    let out = '';
    for (let i = start; i < Math.min(start + max, this.buf.length); i++) {
      const c = this.buf[i]!;
      if (c === 0) return out.length ? out : null;
      if (c < 9 || c > 126) return null;
      out += String.fromCharCode(c);
    }
    return null;
  }

  /** Addresses of every string exactly equal to `text`. */
  findString(text: string): number[] {
    const needle = Buffer.from(`${text}\0`, 'latin1');
    const out: number[] = [];
    for (let i = this.buf.indexOf(needle); i >= 0; i = this.buf.indexOf(needle, i + 1)) {
      // must start a string: preceded by a terminator or padding
      const before = i === 0 ? 0 : this.buf[i - 1]!;
      if (before !== 0 && before !== 0xcc) continue;
      const va = this.addressOf(i);
      if (va !== null) out.push(va);
    }
    return out;
  }

  /** File offsets where `text` occurs, wherever it sits. */
  findBytes(text: string): number[] {
    const needle = Buffer.from(text, 'latin1');
    const out: number[] = [];
    for (let i = this.buf.indexOf(needle); i >= 0; i = this.buf.indexOf(needle, i + 1)) out.push(i);
    return out;
  }

  /**
   * File offsets holding the little-endian dword `va`.
   *
   * This is how a pointer to something is found: RTTI locators, vtables, the
   * name pointers in a function-registration table.
   */
  pointersTo(va: number): number[] {
    const needle = Buffer.alloc(4);
    needle.writeUInt32LE(va >>> 0);
    const out: number[] = [];
    for (let i = this.buf.indexOf(needle); i >= 0; i = this.buf.indexOf(needle, i + 1)) out.push(i);
    return out;
  }

  /** Read a little-endian dword at a virtual address. */
  dwordAt(va: number): number | null {
    const off = this.offsetOf(va);
    return off === null || off + 4 > this.buf.length ? null : this.buf.readUInt32LE(off);
  }

  /**
   * Every `call`/`jmp rel32` in `.text` that lands on `target`.
   *
   * Scans opcodes directly rather than disassembling the section, because a
   * linear disassembly of a whole `.text` misaligns on data and this only needs
   * the two five-byte forms.
   */
  callsTo(target: number): Array<{ from: number; kind: 'call' | 'jmp' }> {
    const text = this.section('.text');
    const out: Array<{ from: number; kind: 'call' | 'jmp' }> = [];
    const end = text.raw + text.rawSize - 5;
    for (let o = text.raw; o < end; o++) {
      const op = this.buf[o]!;
      if (op !== 0xe8 && op !== 0xe9) continue;
      const from = this.addressOf(o);
      if (from === null) continue;
      if (from + 5 + this.buf.readInt32LE(o + 1) === target) {
        out.push({ from, kind: op === 0xe8 ? 'call' : 'jmp' });
      }
    }
    return out;
  }
}
