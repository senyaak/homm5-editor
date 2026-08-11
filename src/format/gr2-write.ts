// -----------------------------------------------------------------------------
// Writing Granny GR2: a skeleton and an animation of our own
// -----------------------------------------------------------------------------
//
// `gr2.ts` reads the game's rigs. This writes them, and it exists because the
// alternative was a donor: the Pandora's Box turned on its axis by borrowing an
// artifact's skeleton binary and an artifact's clip. Borrowed bytes are bytes we
// have not understood, and this file is the understanding.
//
// Everything below is measured against the shipped library, not assumed:
//
//   * the header's CRC is a plain CRC-32 over the file FROM BYTE 88 — where the
//     section table starts — to its end. Checked against all 5656 shipped
//     Granny files: 0 mismatches;
//   * `headerSize` is `88 + 44 × sectionCount`, and the section array offset is
//     relative to byte 32, not to the file (gr2.ts says the same, from the
//     reading side);
//   * the type tree is the standard Granny 2.5 `FileInfo` library — 30
//     structures — and it is TRANSCRIBED below as a table rather than copied
//     out of a file. `tools/test-gr2-write.ts` compares ours against a shipped
//     file's, member by member and kind by kind, which is what makes the
//     transcription a fact rather than a hope;
//   * a section may be stored uncompressed (`compression = 0`); the shipped
//     files use Oodle1 for theirs, but the format's own flag says stored is
//     legal and the reader treats them the same.
//
// Curves here are Granny 2.5's plain ones — `Degree`, `Knots`, `Controls`, all
// Real32 — not the compressed curve zoo of later SDKs, because that is what the
// library's own type tree declares.
// -----------------------------------------------------------------------------

/** The kinds a member can have, in the SDK's enum order — the index IS the tag. */
const KINDS = [
  'End', 'Inline', 'Reference', 'ReferenceToArray', 'ArrayOfReferences',
  'VariantReference', 'RemovedType', 'ReferenceToVariantArray', 'String',
  'Transform', 'Real32', 'Int8', 'UInt8', 'BinormalInt8', 'NormalUInt8',
  'Int16', 'UInt16', 'BinormalInt16', 'NormalUInt16', 'Int32', 'UInt32',
  'Real16', 'EmptyReference',
] as const;

export type Kind = (typeof KINDS)[number];

/** Bytes one element of a kind occupies in the 32-bit flavour. */
const KIND_SIZE: Partial<Record<Kind, number>> = {
  Reference: 4, ReferenceToArray: 8, ArrayOfReferences: 8, VariantReference: 8,
  ReferenceToVariantArray: 12, String: 4, Transform: 68, Real32: 4,
  Int8: 1, UInt8: 1, BinormalInt8: 1, NormalUInt8: 1,
  Int16: 2, UInt16: 2, BinormalInt16: 2, NormalUInt16: 2,
  Int32: 4, UInt32: 4, Real16: 2, EmptyReference: 4,
};

/** One field of a structure. `type` names another entry of the library. */
export interface Member {
  kind: Kind;
  name: string;
  /** The element or target structure, for Inline / Reference / array kinds. */
  type?: string;
  /** Fixed array width for scalars (`Real32[3] Origin`); 1 when absent. */
  width?: number;
}

const m = (kind: Kind, name: string, type?: string, width?: number): Member =>
  ({ kind, name, ...(type ? { type } : {}), ...(width ? { width } : {}) });

/**
 * The standard Granny `FileInfo` type library, as the game's own files declare
 * it — transcribed, and checked against them by the test.
 *
 * The whole tree is written even though a skeleton file fills three of its
 * members: the file's type tree is what the reader on the other side marshals
 * by, and a library that describes only what we happened to use would be a
 * different library. Structures nobody fills cost 32 bytes per member once.
 */
export const GRANNY_TYPES: Record<string, Member[]> = {
  FileInfo: [
    m('Reference', 'ArtToolInfo', 'ArtToolInfo'),
    m('Reference', 'ExporterInfo', 'ExporterInfo'),
    m('String', 'FromFileName'),
    m('ArrayOfReferences', 'Textures', 'Texture'),
    m('ArrayOfReferences', 'Materials', 'Material'),
    m('ArrayOfReferences', 'Skeletons', 'Skeleton'),
    m('ArrayOfReferences', 'VertexDatas', 'VertexData'),
    m('ArrayOfReferences', 'TriTopologies', 'TriTopology'),
    m('ArrayOfReferences', 'Meshes', 'Mesh'),
    m('ArrayOfReferences', 'Models', 'Model'),
    m('ArrayOfReferences', 'TrackGroups', 'TrackGroup'),
    m('ArrayOfReferences', 'Animations', 'Animation'),
    m('VariantReference', 'ExtendedData'),
  ],
  ArtToolInfo: [
    m('String', 'FromArtToolName'),
    m('Int32', 'ArtToolMajorRevision'),
    m('Int32', 'ArtToolMinorRevision'),
    m('Real32', 'UnitsPerMeter'),
    m('Real32', 'Origin', undefined, 3),
    m('Real32', 'RightVector', undefined, 3),
    m('Real32', 'UpVector', undefined, 3),
    m('Real32', 'BackVector', undefined, 3),
  ],
  ExporterInfo: [
    m('String', 'ExporterName'),
    m('Int32', 'ExporterMajorRevision'),
    m('Int32', 'ExporterMinorRevision'),
    m('Int32', 'ExporterCustomization'),
    m('Int32', 'ExporterBuildNumber'),
  ],
  Texture: [
    m('String', 'FromFileName'),
    m('Int32', 'TextureType'),
    m('Int32', 'Width'),
    m('Int32', 'Height'),
    m('Int32', 'Encoding'),
    m('Int32', 'SubFormat'),
    m('Inline', 'Layout', 'PixelLayout'),
    m('ReferenceToArray', 'Images', 'Image'),
    m('VariantReference', 'ExtendedData'),
  ],
  PixelLayout: [
    m('Int32', 'BytesPerPixel'),
    m('Int32', 'ShiftForComponent', undefined, 4),
    m('Int32', 'BitsForComponent', undefined, 4),
  ],
  Image: [m('ReferenceToArray', 'MIPLevels', 'MIPLevel')],
  MIPLevel: [
    m('Int32', 'Stride'),
    m('ReferenceToArray', 'Pixels', 'UInt8Element'),
  ],
  UInt8Element: [m('UInt8', 'UInt8')],
  Material: [
    m('String', 'Name'),
    m('ReferenceToArray', 'Maps', 'MaterialMap'),
    m('Reference', 'Texture', 'Texture'),
    m('VariantReference', 'ExtendedData'),
  ],
  MaterialMap: [
    m('String', 'Usage'),
    m('Reference', 'Map', 'Material'),
  ],
  Skeleton: [
    m('String', 'Name'),
    m('ReferenceToArray', 'Bones', 'Bone'),
  ],
  Bone: [
    m('String', 'Name'),
    m('Int32', 'ParentIndex'),
    m('Transform', 'Transform'),
    m('Real32', 'InverseWorldTransform', undefined, 16),
    m('Reference', 'LightInfo', 'LightInfo'),
    m('Reference', 'CameraInfo', 'CameraInfo'),
    m('VariantReference', 'ExtendedData'),
  ],
  LightInfo: [m('VariantReference', 'ExtendedData')],
  CameraInfo: [m('VariantReference', 'ExtendedData')],
  VertexData: [
    m('ReferenceToVariantArray', 'Vertices'),
    m('ReferenceToArray', 'VertexComponentNames', 'StringElement'),
    m('ReferenceToArray', 'VertexAnnotationSets', 'VertexAnnotationSet'),
  ],
  StringElement: [m('String', 'String')],
  VertexAnnotationSet: [
    m('String', 'Name'),
    m('ReferenceToVariantArray', 'VertexAnnotations'),
    m('Int32', 'IndicesMapFromVertexToAnnotation'),
    m('ReferenceToArray', 'VertexAnnotationIndices', 'Int32Element'),
  ],
  Int32Element: [m('Int32', 'Int32')],
  TriTopology: [
    m('ReferenceToArray', 'Groups', 'TriMaterialGroup'),
    m('ReferenceToArray', 'Indices', 'Int32Element'),
    m('ReferenceToArray', 'Indices16', 'Int16Element'),
    m('ReferenceToArray', 'VertexToVertexMap', 'Int32Element'),
    m('ReferenceToArray', 'VertexToTriangleMap', 'Int32Element'),
    m('ReferenceToArray', 'SideToNeighborMap', 'Int32Element'),
    m('ReferenceToArray', 'BonesForTriangle', 'Int32Element'),
    m('ReferenceToArray', 'TriangleToBoneIndices', 'Int32Element'),
    m('ReferenceToArray', 'TriAnnotationSets', 'TriAnnotationSet'),
  ],
  TriMaterialGroup: [
    m('Int32', 'MaterialIndex'),
    m('Int32', 'TriFirst'),
    m('Int32', 'TriCount'),
  ],
  Int16Element: [m('Int16', 'Int16')],
  TriAnnotationSet: [
    m('String', 'Name'),
    m('ReferenceToVariantArray', 'TriAnnotations'),
    m('Int32', 'IndicesMapFromTriToAnnotation'),
    m('ReferenceToArray', 'TriAnnotationIndices', 'Int32Element'),
  ],
  Mesh: [
    m('String', 'Name'),
    m('Reference', 'PrimaryVertexData', 'VertexData'),
    m('ReferenceToArray', 'MorphTargets', 'MorphTarget'),
    m('Reference', 'PrimaryTopology', 'TriTopology'),
    m('ReferenceToArray', 'MaterialBindings', 'MaterialBinding'),
    m('ReferenceToArray', 'BoneBindings', 'BoneBinding'),
    m('VariantReference', 'ExtendedData'),
  ],
  MorphTarget: [
    m('String', 'ScalarName'),
    m('Reference', 'VertexData', 'VertexData'),
  ],
  MaterialBinding: [m('Reference', 'Material', 'Material')],
  BoneBinding: [
    m('String', 'BoneName'),
    m('Real32', 'OBBMin', undefined, 3),
    m('Real32', 'OBBMax', undefined, 3),
    m('ReferenceToArray', 'TriangleIndices', 'Int32Element'),
  ],
  Model: [
    m('String', 'Name'),
    m('Reference', 'Skeleton', 'Skeleton'),
    m('Transform', 'InitialPlacement'),
    m('ReferenceToArray', 'MeshBindings', 'ModelMeshBinding'),
  ],
  ModelMeshBinding: [m('Reference', 'Mesh', 'Mesh')],
  TrackGroup: [
    m('String', 'Name'),
    m('ReferenceToArray', 'VectorTracks', 'VectorTrack'),
    m('ReferenceToArray', 'TransformTracks', 'TransformTrack'),
    m('ReferenceToArray', 'TransformLODErrors', 'Real32Element'),
    m('ReferenceToArray', 'TextTracks', 'TextTrack'),
    m('Transform', 'InitialPlacement'),
    m('Int32', 'AccumulationFlags'),
    m('Real32', 'LoopTranslation', undefined, 3),
    m('Reference', 'PeriodicLoop', 'PeriodicLoop'),
    m('Reference', 'RootMotion', 'TransformTrack'),
    m('VariantReference', 'ExtendedData'),
  ],
  VectorTrack: [
    m('String', 'Name'),
    m('Int32', 'Dimension'),
    m('Inline', 'ValueCurve', 'Curve'),
  ],
  Curve: [
    m('Int32', 'Degree'),
    m('ReferenceToArray', 'Knots', 'Real32Element'),
    m('ReferenceToArray', 'Controls', 'Real32Element'),
  ],
  Real32Element: [m('Real32', 'Real32')],
  TransformTrack: [
    m('String', 'Name'),
    m('Inline', 'PositionCurve', 'Curve'),
    m('Inline', 'OrientationCurve', 'Curve'),
    m('Inline', 'ScaleShearCurve', 'Curve'),
  ],
  TextTrack: [
    m('String', 'Name'),
    m('ReferenceToArray', 'Entries', 'TextTrackEntry'),
  ],
  TextTrackEntry: [
    m('Real32', 'TimeStamp'),
    m('String', 'Text'),
  ],
  PeriodicLoop: [
    m('Real32', 'Radius'),
    m('Real32', 'dAngle'),
    m('Real32', 'dZ'),
    m('Real32', 'BasisX', undefined, 3),
    m('Real32', 'BasisY', undefined, 3),
    m('Real32', 'Axis', undefined, 3),
  ],
  Animation: [
    m('String', 'Name'),
    m('Real32', 'Duration'),
    m('Real32', 'TimeStep'),
    m('Real32', 'Oversampling'),
    m('ArrayOfReferences', 'TrackGroups', 'TrackGroup'),
  ],
};

/** Bytes one structure of the library occupies. */
export function structSize(name: string): number {
  return (GRANNY_TYPES[name] ?? []).reduce((total, mem) => total + memberSize(mem), 0);
}

function memberSize(mem: Member): number {
  const width = mem.width ?? 1;
  if (mem.kind === 'Inline') return structSize(mem.type!) * width;
  return (KIND_SIZE[mem.kind] ?? 4) * width;
}

// --- the container -----------------------------------------------------------

/** A pointer waiting to be told where it points. */
interface Fixup { at: number; sec: number; off: number }

/**
 * One section under construction: a growing buffer, its relocations, and a
 * string pool that lands at the very end.
 *
 * Strings last is not tidiness. Granny sorts a section by field width — 32-bit
 * fields, then 16-bit, then bytes — and `stop0`/`stop1` record where each run
 * ends. Ours has no 16-bit run, so both stops sit where the strings begin, and
 * the file describes its own layout truthfully.
 */
class SectionWriter {
  private chunks: Buffer[] = [];
  private length = 0;
  readonly fixups: Fixup[] = [];
  private readonly strings = new Map<string, number>();
  private stringPool: Buffer[] = [];
  private stringLength = 0;

  readonly index: number;

  constructor(index: number) { this.index = index; }

  /** Reserve `size` bytes, 4-aligned, and answer where they start. */
  alloc(size: number): number {
    const pad = (4 - (this.length % 4)) % 4;
    if (pad) { this.chunks.push(Buffer.alloc(pad)); this.length += pad; }
    const at = this.length;
    this.chunks.push(Buffer.alloc(size));
    this.length += size;
    return at;
  }

  /** Write bytes into space already reserved. */
  put(at: number, bytes: Buffer): void {
    let seen = 0;
    for (const chunk of this.chunks) {
      if (at < seen + chunk.length) {
        bytes.copy(chunk, at - seen);
        return;
      }
      seen += chunk.length;
    }
    throw new Error(`gr2: write at ${at} is past the section`);
  }

  writeU32(at: number, value: number): void {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(value >>> 0);
    this.put(at, b);
  }

  writeF32(at: number, value: number): void {
    const b = Buffer.alloc(4);
    b.writeFloatLE(value);
    this.put(at, b);
  }

  /** Record that the pointer field at `at` targets `sec:off`. */
  point(at: number, sec: number, off: number): void {
    this.fixups.push({ at, sec, off });
  }

  /** Intern a string; answers its offset within this section. */
  string(text: string): number {
    const had = this.strings.get(text);
    if (had !== undefined) return had;
    const at = this.stringLength;
    const b = Buffer.from(`${text}\0`, 'latin1');
    this.stringPool.push(b);
    this.stringLength += b.length;
    this.strings.set(text, at);
    return at;
  }

  /** Finish: the bytes, and where the string run starts. */
  finish(): { data: Buffer; stringStart: number } {
    const pad = (4 - (this.length % 4)) % 4;
    if (pad) { this.chunks.push(Buffer.alloc(pad)); this.length += pad; }
    const stringStart = this.length;
    // String offsets were handed out relative to the pool; move them home.
    for (const f of this.fixups) if (f.sec === this.index && f.off < 0) f.off = stringStart + (-f.off - 1);
    const data = Buffer.concat([...this.chunks, ...this.stringPool]);
    return { data, stringStart };
  }

  /** A string's eventual offset, encoded so `finish` can relocate it. */
  stringRef(text: string): number {
    return -(this.string(text) + 1);
  }
}

/** Standard CRC-32, the one the header carries. */
function crc32(buf: Buffer, from: number, to: number): number {
  let c = 0xffffffff;
  for (let i = from; i < to; i++) c = (CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8)) >>> 0;
  return (c ^ 0xffffffff) >>> 0;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) >>> 0 : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

/** Granny's section roles; we fill the first and the type one, as the game does. */
const SECTION_COUNT = 8;
const OBJECT_SECTION = 0;
const TYPE_SECTION = 6;

const MAGIC = Buffer.from('b867b0caf86db10f84728c7e5e19001e', 'hex');
const TYPE_MEMBER_STRIDE = 32;

/** A value a struct member can take, in the shape the library expects. */
export type Value =
  | number | number[] | string | null
  | { struct: string; fields: Fields }
  | Array<{ struct: string; fields: Fields } | number>
  | GrannyTransformValue;

export interface GrannyTransformValue {
  flags: number;
  position: [number, number, number];
  orientation: [number, number, number, number];
  scaleShear: number[];
}

export type Fields = Record<string, Value>;

/**
 * Serialise a `FileInfo` tree into a GR2.
 *
 * Objects are written children-first, so by the time a parent's pointer field is
 * filled the child already has an address — which is why this needs no second
 * pass and no patch list beyond the relocations the format itself wants.
 */
export function writeGR2(root: Fields): Buffer {
  const objects = new SectionWriter(OBJECT_SECTION);
  const types = new SectionWriter(TYPE_SECTION);

  // --- the type library, first: every structure gets an address, then bodies,
  // because the tree is cyclic (a Material's Map points back at a Material).
  const typeAt = new Map<string, number>();
  for (const [name, members] of Object.entries(GRANNY_TYPES)) {
    typeAt.set(name, types.alloc((members.length + 1) * TYPE_MEMBER_STRIDE));
  }
  for (const [name, members] of Object.entries(GRANNY_TYPES)) {
    let at = typeAt.get(name)!;
    for (const mem of members) {
      types.writeU32(at, KINDS.indexOf(mem.kind));
      types.point(at + 4, TYPE_SECTION, types.stringRef(mem.name));
      if (mem.type) types.point(at + 8, TYPE_SECTION, typeAt.get(mem.type)!);
      types.writeU32(at + 12, mem.width ?? 0);
      at += TYPE_MEMBER_STRIDE;
    }
    // The list ends with an all-zero member: kind 0 is End.
  }

  /**
   * Write one structure and answer its offset in the object section.
   *
   * The same JS object handed in twice is written ONCE and pointed at twice —
   * which is not an optimisation but the shape of the thing: a clip's track
   * group is listed both by the file and by the animation inside it, and two
   * copies of it would be two groups that merely look alike.
   */
  const written = new Map<Fields, number>();
  const writeStruct = (name: string, fields: Fields): number => {
    const members = GRANNY_TYPES[name];
    if (!members) throw new Error(`gr2: no type called ${name}`);
    const already = written.get(fields);
    if (already !== undefined) return already;
    const base = objects.alloc(structSize(name));
    written.set(fields, base);
    fillStruct(name, fields, base);
    return base;
  };

  /** Fill an already-reserved structure at `base`. */
  const fillStruct = (name: string, fields: Fields, base: number): void => {
    let off = base;
    for (const mem of GRANNY_TYPES[name]!) {
      const value = fields[mem.name] ?? null;
      writeMember(mem, value, off);
      off += memberSize(mem);
    }
  };

  const asStruct = (v: Value): { struct: string; fields: Fields } => {
    if (!v || typeof v !== 'object' || Array.isArray(v) || !('struct' in v)) {
      throw new Error(`gr2: expected a structure, got ${JSON.stringify(v)}`);
    }
    return v;
  };

  /** An array member: the elements go down first, then the count and pointer. */
  const writeArray = (elementType: string, items: Value, at: number, ofReferences: boolean): void => {
    const list = Array.isArray(items) ? items : [];
    objects.writeU32(at, list.length);
    if (!list.length) return;
    if (ofReferences) {
      // The pointer targets an array OF POINTERS, each to its own object.
      const addresses = list.map((item) => {
        const s = asStruct(item as Value);
        return writeStruct(s.struct, s.fields);
      });
      const table = objects.alloc(4 * addresses.length);
      addresses.forEach((address, i) => objects.point(table + i * 4, OBJECT_SECTION, address));
      objects.point(at + 4, OBJECT_SECTION, table);
      return;
    }
    // A contiguous run of structures — and a run of scalars is that too, when
    // the element type is a single scalar member (`Real32Element` is how the
    // library spells "an array of floats").
    const size = structSize(elementType);
    const scalar = GRANNY_TYPES[elementType]!.length === 1 && GRANNY_TYPES[elementType]![0]!.kind !== 'Inline'
      && typeof list[0] === 'number';
    const run = objects.alloc(size * list.length);
    list.forEach((item, i) => {
      if (scalar) {
        const only = GRANNY_TYPES[elementType]![0]!;
        writeScalar(only.kind, item as number, run + i * size);
      } else {
        const s = asStruct(item as Value);
        fillStruct(s.struct, s.fields, run + i * size);
      }
    });
    objects.point(at + 4, OBJECT_SECTION, run);
  };

  const writeScalar = (kind: Kind, value: number, at: number): void => {
    if (kind === 'Real32') objects.writeF32(at, value);
    else if (kind === 'Int16' || kind === 'UInt16') {
      const b = Buffer.alloc(2);
      if (kind === 'Int16') b.writeInt16LE(value); else b.writeUInt16LE(value);
      objects.put(at, b);
    } else if (kind === 'Int8' || kind === 'UInt8') {
      objects.put(at, Buffer.from([value & 0xff]));
    } else objects.writeU32(at, value);
  };

  const writeMember = (mem: Member, value: Value, at: number): void => {
    switch (mem.kind) {
      case 'String':
        if (typeof value === 'string') objects.point(at, OBJECT_SECTION, objects.stringRef(value));
        return;
      case 'Reference':
        if (value) {
          const s = asStruct(value);
          objects.point(at, OBJECT_SECTION, writeStruct(s.struct, s.fields));
        }
        return;
      case 'ReferenceToArray':
        writeArray(mem.type!, value, at, false);
        return;
      case 'ArrayOfReferences':
        writeArray(mem.type!, value, at, true);
        return;
      case 'Inline': {
        const s = value ? asStruct(value) : { struct: mem.type!, fields: {} };
        fillStruct(s.struct, s.fields, at);
        return;
      }
      case 'Transform': {
        const t = (value ?? { flags: 0, position: [0, 0, 0], orientation: [0, 0, 0, 1], scaleShear: IDENTITY3 }) as GrannyTransformValue;
        objects.writeU32(at, t.flags);
        t.position.forEach((v, i) => objects.writeF32(at + 4 + i * 4, v));
        t.orientation.forEach((v, i) => objects.writeF32(at + 16 + i * 4, v));
        t.scaleShear.forEach((v, i) => objects.writeF32(at + 32 + i * 4, v));
        return;
      }
      case 'VariantReference':
      case 'ReferenceToVariantArray':
      case 'EmptyReference':
        return; // left null, which is what no relocation entry means
      default: {
        const width = mem.width ?? 1;
        const list = Array.isArray(value) ? value : [value ?? 0];
        const step = KIND_SIZE[mem.kind] ?? 4;
        for (let i = 0; i < width; i++) writeScalar(mem.kind, (list[i] as number) ?? 0, at + i * step);
      }
    }
  };

  const rootAt = objects.alloc(structSize('FileInfo'));
  fillStruct('FileInfo', root, rootAt);

  // --- assemble ---------------------------------------------------------------
  const built = [objects, types].map((s) => ({ writer: s, ...s.finish() }));
  const bySection = new Map(built.map((b) => [b.writer.index, b]));

  const headerSize = 88 + SECTION_COUNT * 44;
  const parts: Buffer[] = [];
  let cursor = headerSize;
  const table: { compression: number; offset: number; size: number; stop: number; reloc: number; relocCount: number }[] = [];

  // Section payloads first, then each one's relocation table — the shipped
  // layout, and the reason relocations stay readable when a payload is not.
  const payloadAt = new Map<number, number>();
  for (let i = 0; i < SECTION_COUNT; i++) {
    const b = bySection.get(i);
    payloadAt.set(i, cursor);
    if (b) { parts.push(b.data); cursor += b.data.length; }
  }
  for (let i = 0; i < SECTION_COUNT; i++) {
    const b = bySection.get(i);
    const fixups = b ? [...b.writer.fixups].sort((x, y) => x.at - y.at) : [];
    const reloc = Buffer.alloc(fixups.length * 12);
    fixups.forEach((f, k) => {
      reloc.writeUInt32LE(f.at, k * 12);
      reloc.writeUInt32LE(f.sec, k * 12 + 4);
      reloc.writeUInt32LE(f.off, k * 12 + 8);
    });
    table.push({
      compression: 0,
      offset: payloadAt.get(i)!,
      size: b ? b.data.length : 0,
      stop: b ? b.stringStart : 0,
      reloc: cursor,
      relocCount: fixups.length,
    });
    if (reloc.length) parts.push(reloc);
    cursor += reloc.length;
  }

  const header = Buffer.alloc(headerSize);
  MAGIC.copy(header, 0);
  header.writeUInt32LE(headerSize, 16);
  header.writeUInt32LE(0, 20); // header format: uncompressed
  header.writeUInt32LE(6, 32); // version
  header.writeUInt32LE(cursor, 36); // total size
  header.writeUInt32LE(56, 44); // section array, relative to byte 32
  header.writeUInt32LE(SECTION_COUNT, 48);
  header.writeUInt32LE(TYPE_SECTION, 52);
  header.writeUInt32LE(typeAt.get('FileInfo')!, 56);
  header.writeUInt32LE(OBJECT_SECTION, 60);
  header.writeUInt32LE(rootAt, 64);
  // The type tag stamps WHICH library the tree above is. Two of them are in
  // wide use here — 2836 shipped files say 0x80000013 and 2787 say 0x80000011 —
  // and their libraries are byte-for-byte the same tree, so ours takes the
  // commoner stamp. (A third, 0x80000010, is the older library with
  // `ScalarTracks` where this one has `VectorTracks`; 32 files still use it.)
  header.writeUInt32LE(0x80000013, 68);
  for (const [i, s] of table.entries()) {
    const at = 88 + i * 44;
    header.writeUInt32LE(s.compression, at);
    header.writeUInt32LE(s.offset, at + 4);
    header.writeUInt32LE(s.size, at + 8);
    header.writeUInt32LE(s.size, at + 12); // stored: expanded size is the same
    header.writeUInt32LE(4, at + 16); // alignment
    header.writeUInt32LE(s.stop, at + 20); // where the 32-bit run ends
    header.writeUInt32LE(s.stop, at + 24); // …and the (empty) 16-bit one
    header.writeUInt32LE(s.reloc, at + 28);
    header.writeUInt32LE(s.relocCount, at + 32);
  }

  const file = Buffer.concat([header, ...parts]);
  file.writeUInt32LE(crc32(file, 88, file.length), 40);
  return file;
}

const IDENTITY3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const IDENTITY4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Who made the file — ours, and it says so. */
const OURS = {
  ArtToolInfo: {
    struct: 'ArtToolInfo',
    fields: {
      FromArtToolName: 'homm5-editor',
      ArtToolMajorRevision: 1,
      ArtToolMinorRevision: 0,
      UnitsPerMeter: 1,
      Origin: [0, 0, 0],
      // The game's own axes, read off its files: X right, Z up, -Y back.
      RightVector: [1, 0, 0],
      UpVector: [0, 0, 1],
      BackVector: [0, -1, 0],
    },
  },
  ExporterInfo: {
    struct: 'ExporterInfo',
    fields: {
      ExporterName: 'homm5-editor gr2 writer',
      ExporterMajorRevision: 2,
      ExporterMinorRevision: 5,
      ExporterCustomization: 0,
      ExporterBuildNumber: 1,
    },
  },
} as const;

/** One bone of a skeleton we author. */
export interface BoneSpec {
  name: string;
  parentIndex?: number;
  /** Rest transform; the identity when absent. */
  rest?: GrannyTransformValue;
  /** Inverse bind matrix, row-major; the identity when absent. */
  inverseWorld?: number[];
}

/** A skeleton file: a name and its bones. */
export function writeSkeletonGR2(name: string, bones: BoneSpec[]): Buffer {
  return writeGR2({
    ArtToolInfo: OURS.ArtToolInfo as unknown as Value,
    ExporterInfo: OURS.ExporterInfo as unknown as Value,
    FromFileName: `${name}.skeleton`,
    Skeletons: [{
      struct: 'Skeleton',
      fields: {
        Name: name,
        Bones: bones.map((b) => ({
          struct: 'Bone',
          fields: {
            Name: b.name,
            ParentIndex: b.parentIndex ?? -1,
            // All three channels present, all of them the identity: a bone that
            // moves nothing until a clip moves it.
            Transform: b.rest ?? { flags: 7, position: [0, 0, 0], orientation: [0, 0, 0, 1], scaleShear: IDENTITY3 },
            InverseWorldTransform: b.inverseWorld ?? IDENTITY4,
          },
        })),
      },
    }],
  });
}

/** One channel of a transform track: knots in seconds, controls per knot. */
export interface CurveSpec {
  degree: number;
  knots: number[];
  /** `knots.length × dim` values, dim 3 for a position, 4 for a quaternion. */
  controls: number[];
}

export interface TrackSpec {
  /** Must equal the BONE's name — that is what binds a track to a bone. */
  name: string;
  position?: CurveSpec;
  orientation?: CurveSpec;
  scaleShear?: CurveSpec;
}

const curve = (c: CurveSpec | undefined): Value => ({
  struct: 'Curve',
  fields: c
    ? { Degree: c.degree, Knots: c.knots, Controls: c.controls }
    : { Degree: 0, Knots: [], Controls: [] },
});

/** An animation file: one clip, one track group, the tracks given. */
export function writeAnimationGR2(name: string, duration: number, tracks: TrackSpec[]): Buffer {
  const group: Value = {
    struct: 'TrackGroup',
    fields: {
      Name: name,
      VectorTracks: [],
      TransformTracks: tracks.map((t) => ({
        struct: 'TransformTrack',
        fields: {
          Name: t.name,
          PositionCurve: curve(t.position),
          OrientationCurve: curve(t.orientation),
          ScaleShearCurve: curve(t.scaleShear),
        },
      })),
      TransformLODErrors: [],
      TextTracks: [],
      InitialPlacement: { flags: 7, position: [0, 0, 0], orientation: [0, 0, 0, 1], scaleShear: IDENTITY3 },
      AccumulationFlags: 0,
      LoopTranslation: [0, 0, 0],
    },
  };
  const steps = Math.max(1, (tracks[0]?.orientation?.knots.length ?? 2) - 1);
  return writeGR2({
    ArtToolInfo: OURS.ArtToolInfo as unknown as Value,
    ExporterInfo: OURS.ExporterInfo as unknown as Value,
    FromFileName: `${name}.animation`,
    TrackGroups: [group],
    Animations: [{
      struct: 'Animation',
      fields: {
        Name: name, Duration: duration, TimeStep: duration / steps, Oversampling: 1,
        TrackGroups: [group],
      },
    }],
  });
}

/**
 * A clip that turns one bone about the vertical, once, and lifts it as it goes.
 *
 * A quaternion cannot express a whole turn in one step — slerp takes the short
 * way round, so 360° reads as standing still and 180° picks a side at random —
 * so the turn is sampled into `steps` linear segments. Sixteen of them is 22.5°
 * apiece, which is smooth at the size a map object is drawn.
 */
export function spinClip(bone: string, seconds: number, rise = 0, steps = 16): { name: string; duration: number; tracks: TrackSpec[] } {
  const knots: number[] = [];
  const controls: number[] = [];
  const bobKnots: number[] = [];
  const bob: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const half = Math.PI * f; // half the yaw: a quaternion carries the half-angle
    knots.push(seconds * f);
    controls.push(0, 0, Math.sin(half), Math.cos(half));
    bobKnots.push(seconds * f);
    bob.push(0, 0, rise * Math.sin(2 * Math.PI * f));
  }
  return {
    name: bone,
    duration: seconds,
    tracks: [{
      name: bone,
      orientation: { degree: 1, knots, controls },
      ...(rise ? { position: { degree: 1, knots: bobKnots, controls: bob } } : {}),
    }],
  };
}
