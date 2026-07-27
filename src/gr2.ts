// Reader for Granny GR2 — the container `bin/Skeletons/*` and `bin/animations/*`
// are written in. Unlike everything else in `bin/`, this is not Nival's own
// format: the files carry RAD Game Tools' Granny magic and were written by
// "Granny Standard Exporter, SDK version 2.5.0.5" out of Maya 6.
//
// The good news, and the reason this file is short for what it does: a GR2
// DESCRIBES ITSELF. Every file carries a type-definition tree naming each field
// of every structure it stores, so nothing here is guessed from offsets the way
// the mesh container had to be. We read the type tree, then read objects through
// it — `Bones`, `ParentIndex`, `InverseWorldTransform` come out by name.
//
// Sections compressed with Oodle1 — every file under bin/Skeletons, and a sixth
// of bin/animations — are decompressed on the way in by src/oodle.ts, so a
// caller never sees the difference.
//
// One limit is deliberate: only the 32-bit little-endian flavour is read. It is
// the only one the game ships (checked across all 5656 files), and pointer size
// is baked into every structure size, so a second flavour would be a second
// layout table.

import { decompressSection } from './oodle.ts';

/** A location inside the file: which section, and the byte offset within it. */
export interface GR2Ref { sec: number; off: number }

/** One section of the file. `data` is null only when it could not be read. */
export interface GR2Section {
  index: number;
  /** 0 = stored, 1 = Oodle0, 2 = Oodle1. */
  compression: number;
  offset: number;
  size: number;
  /** Decompressed size; equals `size` for a stored section. */
  rawSize: number;
  data: Buffer | null;
  /**
   * Pointer fixups, keyed by the offset of the pointer FIELD within this
   * section. A GR2 stores pointers as file-relative nulls and lists, per
   * section, where each one points; a field with no entry here is a null
   * pointer. This is why the reader never dereferences a raw stored value.
   */
  reloc: Map<number, GR2Ref>;
}

/** Granny's member kinds, in the SDK's enum order — the index IS the stored tag. */
const MEMBER_KINDS = [
  'End', 'Inline', 'Reference', 'ReferenceToArray', 'ArrayOfReferences',
  'VariantReference', 'RemovedType', 'ReferenceToVariantArray', 'String',
  'Transform', 'Real32', 'Int8', 'UInt8', 'BinormalInt8', 'NormalUInt8',
  'Int16', 'UInt16', 'BinormalInt16', 'NormalUInt16', 'Int32', 'UInt32',
  'Real16', 'EmptyReference',
] as const;

export type MemberKind = (typeof MEMBER_KINDS)[number];

/** Bytes one element of a member kind occupies in the 32-bit layout. */
const MEMBER_SIZE: Partial<Record<MemberKind, number>> = {
  Reference: 4, ReferenceToArray: 8, ArrayOfReferences: 8, VariantReference: 8,
  ReferenceToVariantArray: 12, String: 4, Transform: 68, Real32: 4,
  Int8: 1, UInt8: 1, BinormalInt8: 1, NormalUInt8: 1,
  Int16: 2, UInt16: 2, BinormalInt16: 2, NormalUInt16: 2,
  Int32: 4, UInt32: 4, Real16: 2, EmptyReference: 4,
};

/** One field of a structure, as the file's own type tree describes it. */
export interface TypeMember {
  kind: MemberKind;
  name: string | null;
  /** The element type, for Inline/Reference/array kinds. */
  refType: GR2Ref | null;
  /** Fixed array width for scalars (`Real32[3] Origin`); 1 when not an array. */
  arrayWidth: number;
  /** Byte offset of this member inside its structure. */
  offset: number;
  /** Total bytes this member occupies. */
  size: number;
}

/** A Granny transform: a flag word plus position, orientation and 3x3 scale-shear. */
export interface GrannyTransform {
  /** Bit 0 = position present, bit 1 = orientation, bit 2 = scale-shear. */
  flags: number;
  position: [number, number, number];
  /** Quaternion, stored x, y, z, w. */
  orientation: [number, number, number, number];
  scaleShear: number[];
}

const MAGIC_LE32 = 0xcab067b8;
/** sizeof(granny_data_type_definition) in the 32-bit layout. */
const TYPE_MEMBER_STRIDE = 32;
/** Guard against a corrupt type record looping forever. */
const MAX_MEMBERS = 512;

/**
 * A parsed GR2 file: sections, relocations, and the type tree they describe.
 *
 * Reading is lazy and cached — a type definition is decoded once, however many
 * objects reference it, which matters because the tree is recursive (a bone's
 * ExtendedData can point back at a type already being read).
 */
export class GrannyFile {
  readonly version: number;
  readonly typeTag: number;
  readonly sections: GR2Section[] = [];
  readonly rootType: GR2Ref;
  readonly rootObject: GR2Ref;
  private readonly typeCache = new Map<string, TypeMember[]>();

  private constructor(buf: Buffer) {
    this.version = buf.readUInt32LE(32);
    this.typeTag = buf.readUInt32LE(68);
    this.rootType = { sec: buf.readUInt32LE(52), off: buf.readUInt32LE(56) };
    this.rootObject = { sec: buf.readUInt32LE(60), off: buf.readUInt32LE(64) };

    // The section array offset is relative to the info header, which starts at
    // byte 32 — not to the file. Read it as file-absolute and every field of
    // every section comes out shifted by eight bytes, which still parses and
    // still looks plausible; the tell is that `headerSize` no longer equals
    // 88 + 44 * sectionCount.
    const sectionArray = 32 + buf.readUInt32LE(44);
    const sectionCount = buf.readUInt32LE(48);
    for (let i = 0; i < sectionCount; i++) {
      const s = sectionArray + i * 44;
      const compression = buf.readUInt32LE(s);
      const offset = buf.readUInt32LE(s + 4);
      const size = buf.readUInt32LE(s + 8);
      const rawSize = buf.readUInt32LE(s + 12);
      // Where the 32-bit run of the section ends and the 16-bit one does: Granny
      // splits a section by field width and compresses each run as its own
      // stream, and these are the only record of how long each one is.
      const stop0 = buf.readUInt32LE(s + 20);
      const stop1 = buf.readUInt32LE(s + 24);
      const relocOffset = buf.readUInt32LE(s + 28);
      const relocCount = buf.readUInt32LE(s + 32);
      let data: Buffer | null = null;
      if (compression === 0 && offset + size <= buf.length) {
        data = buf.subarray(offset, offset + size);
      } else if (rawSize > 0 && offset + size <= buf.length) {
        // Oodle1. Decoded rather than skipped since the port landed; a failure
        // leaves the section null, exactly as an unreadable one used to be, so
        // a file we cannot unpack degrades instead of taking the editor down.
        try {
          data = Buffer.from(decompressSection(buf, offset, size, rawSize, stop0, stop1));
        } catch { data = null; }
      }
      const stored = data !== null;
      const reloc = new Map<number, GR2Ref>();
      if (stored) {
        for (let r = 0; r < relocCount; r++) {
          const o = relocOffset + r * 12;
          if (o + 12 > buf.length) break;
          reloc.set(buf.readUInt32LE(o), { sec: buf.readUInt32LE(o + 4), off: buf.readUInt32LE(o + 8) });
        }
      }
      this.sections.push({ index: i, compression, offset, size, rawSize, data, reloc });
    }
  }

  /**
   * Parse a GR2, or return null if the buffer is not one we read (wrong magic,
   * a big-endian or 64-bit flavour, or truncated).
   */
  static open(buf: Buffer): GrannyFile | null {
    if (buf.length < 132 || buf.readUInt32LE(0) !== MAGIC_LE32) return null;
    const file = new GrannyFile(buf);
    // A header that lines up is the cheap proof we read the right flavour.
    const expected = 88 + file.sections.length * 44;
    if (buf.readUInt32LE(16) !== expected) return null;
    return file;
  }

  /**
   * Whether any section that carries bytes could NOT be read.
   *
   * Compression alone no longer means that: Oodle1 sections are decoded on the
   * way in (src/oodle.ts). This is the honest question — is there data in this
   * file we cannot see — and it is what callers should branch on.
   */
  get isUnreadable(): boolean {
    return this.sections.some((s) => s.rawSize > 0 && !s.data);
  }

  /** The bytes of a ref's section, or null when that section is compressed. */
  data(ref: GR2Ref): Buffer | null {
    return this.sections[ref.sec]?.data ?? null;
  }

  /**
   * Follow the pointer stored AT `ref`; null when it is a null pointer.
   *
   * Takes a null `ref` too, and says null back. Callers walk a type tree that
   * may not hold the field they asked for — which became a real case, not a
   * theoretical one, once Oodle sections started being decoded: a file whose
   * last stream failed still parses, and its structures can name fields that
   * are not there.
   */
  pointer(ref: GR2Ref | null): GR2Ref | null {
    if (!ref) return null;
    return this.sections[ref.sec]?.reloc.get(ref.off) ?? null;
  }

  /** Read the C string a `String` member at `ref` points to. */
  string(ref: GR2Ref | null): string | null {
    const target = this.pointer(ref);
    if (!target) return null;
    const d = this.data(target);
    if (!d) return null;
    let end = target.off;
    while (end < d.length && d[end] !== 0) end++;
    return d.toString('latin1', target.off, end);
  }

  /**
   * The members of the structure type defined at `ref`, with each member's
   * offset inside the structure already accumulated.
   */
  type(ref: GR2Ref | null): TypeMember[] {
    if (!ref) return [];
    const key = `${ref.sec}:${ref.off}`;
    const cached = this.typeCache.get(key);
    if (cached) return cached;
    const members: TypeMember[] = [];
    // Publish before filling: types reference each other, and a type that
    // reaches itself must find the in-progress list rather than recurse.
    this.typeCache.set(key, members);
    const d = this.data(ref);
    if (!d) return members;

    let at = ref.off;
    let offset = 0;
    for (let i = 0; i < MAX_MEMBERS; i++) {
      if (at + TYPE_MEMBER_STRIDE > d.length) break;
      const tag = d.readUInt32LE(at);
      if (tag === 0 || tag >= MEMBER_KINDS.length) break; // 0 = End
      const kind = MEMBER_KINDS[tag]!;
      const member: TypeMember = {
        kind,
        name: this.string({ sec: ref.sec, off: at + 4 }),
        refType: this.pointer({ sec: ref.sec, off: at + 8 }),
        arrayWidth: d.readInt32LE(at + 12) || 1,
        offset,
        size: 0,
      };
      member.size = this.memberSize(member);
      offset += member.size;
      members.push(member);
      at += TYPE_MEMBER_STRIDE;
    }
    return members;
  }

  /** Bytes one structure of the type at `ref` occupies. */
  structSize(ref: GR2Ref | null): number {
    if (!ref) return 0;
    return this.type(ref).reduce((total, m) => total + m.size, 0);
  }

  private memberSize(m: TypeMember): number {
    if (m.kind === 'Inline') return this.structSize(m.refType) * m.arrayWidth;
    return (MEMBER_SIZE[m.kind] ?? 4) * m.arrayWidth;
  }

  /** Look a member up by name in a type; null when the type has no such field. */
  member(type: TypeMember[], name: string): TypeMember | null {
    return type.find((m) => m.name === name) ?? null;
  }

  /** Where a named member of a structure at `base` lives, or null. */
  field(type: TypeMember[], base: GR2Ref, name: string): GR2Ref | null {
    const m = this.member(type, name);
    return m ? { sec: base.sec, off: base.off + m.offset } : null;
  }

  // --- typed reads -----------------------------------------------------------

  int32(ref: GR2Ref | null): number | null {
    const d = ref && this.data(ref);
    return d ? d.readInt32LE(ref!.off) : null;
  }

  real32(ref: GR2Ref | null): number | null {
    const d = ref && this.data(ref);
    return d ? d.readFloatLE(ref!.off) : null;
  }

  /** A `Real32[n]` member read as a plain array. */
  reals(ref: GR2Ref | null, count: number): number[] | null {
    const d = ref && this.data(ref);
    if (!d) return null;
    const out: number[] = [];
    for (let i = 0; i < count; i++) out.push(d.readFloatLE(ref!.off + i * 4));
    return out;
  }

  /**
   * A `Transform` member: 68 bytes of flags, position, quaternion and 3x3.
   * A component the flags mark absent is returned as its identity, which is
   * what the flags mean — the file leaves those bytes at whatever they were.
   */
  transform(ref: GR2Ref | null): GrannyTransform | null {
    const d = ref && this.data(ref);
    if (!d) return null;
    const at = ref!.off;
    const flags = d.readUInt32LE(at);
    const f = (i: number): number => d.readFloatLE(at + 4 + i * 4);
    return {
      flags,
      position: (flags & 1) ? [f(0), f(1), f(2)] : [0, 0, 0],
      orientation: (flags & 2) ? [f(3), f(4), f(5), f(6)] : [0, 0, 0, 1],
      scaleShear: (flags & 4)
        ? [f(7), f(8), f(9), f(10), f(11), f(12), f(13), f(14), f(15)]
        : [1, 0, 0, 0, 1, 0, 0, 0, 1],
    };
  }

  /**
   * A `ReferenceToArray` member — a count and a pointer to `count` structures
   * laid out end to end. Returns the location of each element.
   */
  array(ref: GR2Ref | null, elementType: GR2Ref | null): GR2Ref[] {
    const d = ref && this.data(ref);
    if (!d) return [];
    const count = d.readInt32LE(ref!.off);
    const first = this.pointer({ sec: ref!.sec, off: ref!.off + 4 });
    if (!first || count <= 0) return [];
    const stride = this.structSize(elementType);
    if (stride <= 0) return [];
    const out: GR2Ref[] = [];
    for (let i = 0; i < count; i++) out.push({ sec: first.sec, off: first.off + i * stride });
    return out;
  }

  /**
   * An `ArrayOfReferences` member — a count and a pointer to `count` POINTERS.
   * Elements are scattered, so each one is resolved through the relocations;
   * a null entry is dropped rather than returned as a hole.
   */
  refArray(ref: GR2Ref | null): GR2Ref[] {
    const d = ref && this.data(ref);
    if (!d) return [];
    const count = d.readInt32LE(ref!.off);
    const first = this.pointer({ sec: ref!.sec, off: ref!.off + 4 });
    if (!first || count <= 0) return [];
    const out: GR2Ref[] = [];
    for (let i = 0; i < count; i++) {
      const e = this.pointer({ sec: first.sec, off: first.off + i * 4 });
      if (e) out.push(e);
    }
    return out;
  }
}
