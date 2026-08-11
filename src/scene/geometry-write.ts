// -----------------------------------------------------------------------------
// Writing bin/Geometries/<uid>: the container, and a mesh built from nothing
// -----------------------------------------------------------------------------
//
// The reader in geometry.ts takes shipped meshes apart. This one puts files back
// together, and it exists because the Pandora's Box spent six game runs proving
// that a mesh assembled INSIDE a donor's container does not draw: bytes we did
// not understand were left as the donor wrote them, and they described the
// donor's mesh, not ours.
//
// So the container is modelled outright, and the proof is a round trip rather
// than a game run: `tools/test-geometry-write.ts` decodes all 3572 shipped
// geometries, re-encodes them with the writer below and compares byte for byte.
// Anything we did not understand would show up there as a diff, on a file the
// game itself draws. Nothing does.
//
// ── The grammar, in full ─────────────────────────────────────────────────────
// A record is  <tag byte> <size field> <payload>, and the size field is
// width-flagged: an ODD byte means a u32 sits there and the payload is (v-1)/2
// long, an EVEN byte IS twice the length. The encoder picks the compact form
// whenever it fits — measured, not assumed: across every shipped file no record
// of 127 bytes or less uses the long form and none longer uses the short one.
//
// A payload is either more records or raw data; which one is in the engine's
// compiled schema, and CONTAINERS below is that schema for the paths we need.
//
//   /4                     u32 version (4)
//   /1                     root
//     /2                   the mesh list
//       /2                 u32 block count
//       /1  …              one per named mesh (<MeshNames>), each:
//         /2               u32 group count
//         /1  …            one per material slice, each a mesh group:
//           /2  positions  count x float3        (the only array with coordinates)
//           /3  vertices   count x 20 bytes      (uv, uv2, normal/tangent/binormal)
//           /4  skin       count x 24 bytes      (absent on static meshes)
//           /5  remap      count x u16           render vertex -> position
//           /6  first twin count x u16           render vertex -> first one at that position
//           /7  triangles  count x 3 u16         into the render vertices
//           /8  { /2: u32 } always zero in every shipped file
//           /9  u32        triangle count (0xffffffff when there are none)
//           /10 float      a small length — see TOLERANCE below
//           /11 byte       0 in a third of the groups, junk in the rest
//           /12 u32        0xffffffff in most groups
//     /3                   one byte
//   /0 /2 /5               three empty records closing the file
//
// Each array is framed as its own record holding `1: u32 count` and `2: data`;
// an empty array keeps the count and drops the data record entirely.
//
// ── What is junk and why we can tell ──────────────────────────────────────────
// Fields 10..12 are uninitialised memory in part of the library: the geometry of
// an empty model (B2448D7C) has "icle", "I" and "ance" in them — slices of the
// string "(ParticleInstance)" left on the exporter's stack. A field the exporter
// is willing to leave as garbage is a field the engine does not read, at least
// not for a mesh with no triangles. We write plausible values anyway (§ below),
// because "plausible" costs nothing and "the engine does not read it" is an
// inference, not a measurement.
// -----------------------------------------------------------------------------

import type { BBox } from './geometry.ts';

/** A record of the container: raw payload, or nested records. */
export interface GeomRecord {
  tag: number;
  /** Set when the payload is nested records. */
  kids?: GeomRecord[];
  /** Set when the payload is raw bytes. */
  data?: Buffer;
}

/**
 * Paths whose payload is nested records rather than data, as `/tag/tag/…`.
 *
 * This is the part of the engine's schema we need, and no more: everything not
 * listed here round-trips as bytes, which is why the writer is exact on files
 * carrying fields we have never looked at.
 */
const CONTAINERS = new Set([
  '/1', '/1/2', '/1/2/1', '/1/2/1/1',
  '/1/2/1/1/2', '/1/2/1/1/3', '/1/2/1/1/4', '/1/2/1/1/5',
  '/1/2/1/1/6', '/1/2/1/1/7', '/1/2/1/1/8',
]);

/** Read the width-flagged size field at `off`. */
function sizeAt(b: Buffer, off: number): { len: number; at: number } {
  const s = b[off]!;
  if (s & 1) { const v = b.readUInt32LE(off); return { len: (v - 1) / 2, at: off + 4 }; }
  return { len: s / 2, at: off + 1 };
}

/** Longest payload the one-byte size field can express. */
const COMPACT_MAX = 127;

/** Write a record header for a payload of `len` bytes, compact when it fits. */
function writeHeader(tag: number, len: number): Buffer {
  if (len <= COMPACT_MAX) return Buffer.from([tag, len * 2]);
  const h = Buffer.alloc(5);
  h[0] = tag;
  h.writeUInt32LE(len * 2 + 1, 1);
  return h;
}

/** Decode a run of records; `path` selects which payloads are containers. */
function decodeRecords(b: Buffer, start: number, end: number, path: string): GeomRecord[] {
  const out: GeomRecord[] = [];
  let p = start;
  while (p + 1 < end) {
    const tag = b[p]!;
    const { len, at } = sizeAt(b, p + 1);
    if (len < 0 || at + len > end) break;
    const here = `${path}/${tag}`;
    out.push(CONTAINERS.has(here)
      ? { tag, kids: decodeRecords(b, at, at + len, here) }
      : { tag, data: b.subarray(at, at + len) });
    p = at + len;
  }
  return out;
}

/** Decode a whole geometry file into its top-level records. */
export function decodeGeometry(b: Buffer): GeomRecord[] {
  return decodeRecords(b, 0, b.length, '');
}

/** Encode records back into a buffer. */
export function encodeGeometry(records: GeomRecord[]): Buffer {
  const parts: Buffer[] = [];
  for (const r of records) {
    const body = r.kids ? encodeGeometry(r.kids) : (r.data ?? Buffer.alloc(0));
    parts.push(writeHeader(r.tag, body.length), body);
  }
  return Buffer.concat(parts);
}

// --- the mesh model ----------------------------------------------------------

/** Bytes per render vertex in the tag-3 stream. */
export const VERTEX_STRIDE = 20;

/** Texture coordinates are 16-bit fixed point over this. */
const UV_SCALE = 2048;

/** One material slice: what the engine draws in a single call. */
export interface GroupData {
  /** Unique positions, `count × 3` floats. */
  positions: Float32Array;
  /** Render vertices, `n × VERTEX_STRIDE` bytes (uv, uv2, normal, tangent, binormal). */
  vertices: Buffer;
  /** Render vertex → position index, `n` entries. */
  remap: Uint16Array;
  /** Triangle list into the render vertices, `tris × 3`. */
  indices: Uint16Array;
  /** Bone binding, `count × 24` bytes, or null for a static mesh. */
  skin?: Buffer | null;
  /** Field 10 — see TOLERANCE. Defaults to the shortest edge. */
  tolerance?: number;
}

/**
 * Field 10, chosen the way the shipped files choose it.
 *
 * It is a length in model units that sits at the very bottom of a mesh's edge
 * distribution: across 1690 groups measured against their own geometry it
 * correlates 0.95 with the mean edge length at a ratio of about a third, and
 * lands below all but ~4% of the edges. A flat 6×6 plane of nine quads stores
 * exactly 2.0 — its quad size, which is also its shortest edge. Whatever the
 * engine calls it (a weld radius is the obvious guess), the shortest edge is
 * both the value the clearest sample carries and a value inside the shipped
 * range, so that is what a mesh of ours declares.
 */
function shortestEdge(g: GroupData): number {
  let mn = Infinity;
  const at = (v: number, c: number): number => g.positions[g.remap[v]! * 3 + c]!;
  for (let i = 0; i + 2 < g.indices.length; i += 3) {
    for (let e = 0; e < 3; e++) {
      const a = g.indices[i + e]!, c = g.indices[i + (e + 1) % 3]!;
      const d = Math.hypot(at(a, 0) - at(c, 0), at(a, 1) - at(c, 1), at(a, 2) - at(c, 2));
      if (d > 1e-9 && d < mn) mn = d;
    }
  }
  return Number.isFinite(mn) ? mn : 1;
}

/** `1: count` + `2: data` — the array framing, with the data record dropped when empty. */
function array(tag: number, count: number, data: Buffer | null): GeomRecord {
  const countRec: GeomRecord = { tag: 1, data: u32(count) };
  return { tag, kids: data && data.length ? [countRec, { tag: 2, data }] : [countRec] };
}

const u32 = (v: number): Buffer => { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); return b; };

const bytesOf = (a: Uint16Array): Buffer => Buffer.from(a.buffer, a.byteOffset, a.byteLength);

/**
 * The second remap (field 6), which is NOT a copy of the first: for each render
 * vertex it gives the FIRST render vertex standing at the same position — itself
 * when it is that first one. It is how the split vertices find their way back to
 * each other, which is what anything working per corner rather than per drawn
 * point (skinning, smoothing) needs.
 *
 * Measured, not guessed: over 2585 groups the rule reproduces the shipped array
 * exactly, in every one. The narrower reading — first vertex with the same
 * position AND the same attributes — holds in only 441 of them, so it is the
 * position alone that decides.
 */
function firstTwins(remap: Uint16Array): Uint16Array {
  const out = new Uint16Array(remap.length);
  const first = new Map<number, number>();
  for (let i = 0; i < remap.length; i++) {
    const p = remap[i]!;
    if (!first.has(p)) first.set(p, i);
    out[i] = first.get(p)!;
  }
  return out;
}

/** Assemble one mesh group's records. */
function groupRecord(g: GroupData): GeomRecord {
  const n = g.remap.length;
  const tris = g.indices.length / 3;
  const positions = Buffer.alloc(g.positions.length * 4);
  for (let i = 0; i < g.positions.length; i++) positions.writeFloatLE(g.positions[i]!, i * 4);
  return {
    tag: 1,
    kids: [
      array(2, g.positions.length / 3, positions),
      array(3, n, g.vertices),
      array(4, g.skin ? g.skin.length / 24 : 0, g.skin ?? null),
      array(5, n, bytesOf(g.remap)),
      array(6, n, bytesOf(firstTwins(g.remap))),
      array(7, tris, bytesOf(g.indices)),
      { tag: 8, kids: [{ tag: 2, data: u32(0) }] },
      // Field 9 is the triangle count, and the eight groups in the whole library
      // that disagree are the empty ones, which store -1 instead of 0.
      { tag: 9, data: u32(tris || 0xffffffff) },
      { tag: 10, data: floatBuf(g.tolerance ?? shortestEdge(g)) },
      { tag: 11, data: Buffer.from([0]) },
      { tag: 12, data: u32(0xffffffff) },
    ],
  };
}

const floatBuf = (v: number): Buffer => { const b = Buffer.alloc(4); b.writeFloatLE(v); return b; };

/**
 * Build a complete geometry file out of mesh blocks, each a list of material
 * groups — the same shape the reader hands back, in the same order, so a model
 * document's <MeshNames> and <MaterialQuantities> line up with it as they do
 * for a shipped file.
 */
export function buildGeometry(blocks: GroupData[][]): Buffer {
  return encodeGeometry([
    { tag: 4, data: u32(4) },
    {
      tag: 1,
      kids: [
        {
          tag: 2,
          kids: [
            { tag: 2, data: u32(blocks.length) },
            ...blocks.map((groups): GeomRecord => ({
              tag: 1,
              kids: [{ tag: 2, data: u32(groups.length) }, ...groups.map(groupRecord)],
            })),
          ],
        },
        // One byte, 1 in 3137 of the shipped files and 64 in 422 more. Ours says 1.
        { tag: 3, data: Buffer.from([1]) },
      ],
    },
    // Every shipped file ends on these three empty records.
    { tag: 0, data: Buffer.alloc(0) },
    { tag: 2, data: Buffer.alloc(0) },
    { tag: 5, data: Buffer.alloc(0) },
  ]);
}

// --- building a box ----------------------------------------------------------

/** Pack a unit vector the way the tag-3 stream does: byte 128 is zero. */
function packVector(out: Buffer, at: number, v: readonly [number, number, number]): void {
  for (let c = 0; c < 3; c++) {
    out[at + c] = Math.max(0, Math.min(255, Math.round(v[c]! * 127) + 128));
  }
  out[at + 3] = 0xff; // the pad byte every shipped vertex carries
}

/** The six faces of a box: outward normal, and the two edge directions of its quad. */
const FACES: { normal: [number, number, number]; u: [number, number, number]; v: [number, number, number] }[] = [
  { normal: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },   // top
  { normal: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] }, // bottom
  { normal: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },   // +X
  { normal: [-1, 0, 0], u: [0, -1, 0], v: [0, 0, 1] }, // -X
  { normal: [0, 1, 0], u: [-1, 0, 0], v: [0, 0, 1] },  // +Y
  { normal: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },  // -Y
];

/**
 * A box of our own: eight positions, twenty-four render vertices, twelve
 * triangles, and one full copy of the texture on every face.
 *
 * Six faces cannot share vertices — each corner needs three different normals
 * and three different texture coordinates — which is exactly what the container's
 * remap is for: the eight corners are stored once as positions and referenced
 * four times each as render vertices. This is the shape of every mesh we will
 * ever author here, and the box is the smallest honest example of it.
 *
 * Winding is counter-clockwise seen from OUTSIDE, which gives the body a
 * positive signed volume — the convention every closed shipped mesh follows, and
 * the one that decides which side a single-sided material culls.
 */
export function boxGroup(
  centre: readonly [number, number, number],
  half: readonly [number, number, number],
): GroupData {
  const positions = new Float32Array(8 * 3);
  const corner = (i: number): [number, number, number] => [
    centre[0]! + (i & 1 ? 1 : -1) * half[0]!,
    centre[1]! + (i & 2 ? 1 : -1) * half[1]!,
    centre[2]! + (i & 4 ? 1 : -1) * half[2]!,
  ];
  for (let i = 0; i < 8; i++) {
    const p = corner(i);
    for (let c = 0; c < 3; c++) positions[i * 3 + c] = p[c]!;
  }
  /** Which of the eight corners lies at these signs. */
  const cornerIndex = (s: readonly number[]): number =>
    (s[0]! > 0 ? 1 : 0) | (s[1]! > 0 ? 2 : 0) | (s[2]! > 0 ? 4 : 0);

  const remap = new Uint16Array(24);
  const vertices = Buffer.alloc(24 * VERTEX_STRIDE);
  const indices = new Uint16Array(36);
  for (const [f, face] of FACES.entries()) {
    // The quad's four corners, walked counter-clockwise about the normal.
    const quad: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    // The binormal completes the basis; for a flat face it is normal × tangent.
    const bin: [number, number, number] = [
      face.normal[1]! * face.u[2]! - face.normal[2]! * face.u[1]!,
      face.normal[2]! * face.u[0]! - face.normal[0]! * face.u[2]!,
      face.normal[0]! * face.u[1]! - face.normal[1]! * face.u[0]!,
    ];
    for (const [k, [su, sv]] of quad.entries()) {
      const v = f * 4 + k;
      const signs = [0, 1, 2].map((c) => face.normal[c]! + su * face.u[c]! + sv * face.v[c]!);
      remap[v] = cornerIndex(signs);
      const at = v * VERTEX_STRIDE;
      // One full copy of the texture per face: the quad's corners are its corners.
      vertices.writeUInt16LE(Math.round(((su + 1) / 2) * UV_SCALE), at);
      vertices.writeUInt16LE(Math.round(((1 - sv) / 2) * UV_SCALE), at + 2);
      packVector(vertices, at + 8, face.normal);
      packVector(vertices, at + 12, face.u);
      packVector(vertices, at + 16, bin);
    }
    const base = f * 4;
    indices.set([base, base + 1, base + 2, base, base + 2, base + 3], f * 6);
  }
  return { positions, vertices, remap, indices };
}

/** The bounding box of a group's positions, as the geometry document states it. */
export function groupBBox(groups: GroupData[]): BBox {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const g of groups) {
    for (let i = 0; i < g.positions.length; i += 3) {
      for (let c = 0; c < 3; c++) {
        const v = g.positions[i + c]!;
        if (v < lo[c]!) lo[c] = v;
        if (v > hi[c]!) hi[c] = v;
      }
    }
  }
  return {
    cx: (lo[0]! + hi[0]!) / 2, cy: (lo[1]! + hi[1]!) / 2, cz: (lo[2]! + hi[2]!) / 2,
    sx: hi[0]! - lo[0]!, sy: hi[1]! - lo[1]!, sz: hi[2]! - lo[2]!,
  };
}

// --- the document beside the binary ------------------------------------------

/** One material of a model we author: a texture and how it is drawn. */
export interface ModelMaterial {
  /** Path to the texture document, as the engine resolves hrefs. */
  texture: string;
  /** Draw the faces turned away too. A closed body does not need it. */
  twoSided?: boolean;
  /** `AM_OPAQUE` for a solid, `AM_ALPHA_TEST` for cut-out foliage. */
  alphaMode?: 'AM_OPAQUE' | 'AM_ALPHA_TEST' | 'AM_ALPHA' | 'AM_OVERLAY';
  /** `L_NORMAL` takes the sun; `L_SELFILLUM` ignores it. */
  lighting?: 'L_NORMAL' | 'L_SELFILLUM';
}

const XML_EOL = '\r\n';

/**
 * INLINE REFERENCES ARE NOT AN OPTION, and the game said so by crashing.
 *
 * A model can carry its materials and its geometry in its own file, written
 * `href="#n:inline(Material)"`, and our first documents did. The game died
 * loading the map: the crash handler put the fault at an access violation on a
 * null `this`, and the code there compares three bytes — `#`, `n`, `:` — takes
 * the branch, calls a resolver and dereferences what comes back without ever
 * testing it. The corpus says what it wanted: **all 4385 inline references in
 * the shipped models carry an `id="item_<guid>"`, and not one lacks it**. Ours
 * had none, so the lookup answered nothing and the engine read address 0x60.
 *
 * Rather than guess what an id has to be, the model is written the OTHER shipped
 * way: materials and geometry as documents of their own, referenced by path.
 * That is how `Artefakt.(Model).xdb` is written and how 1277 shipped models
 * point at their geometry — an href we already write correctly everywhere else.
 *
 * The materials are listed in the order the mesh's groups are written, because
 * that is the correspondence the engine uses — group i is drawn with material i,
 * and `MaterialQuantities` states how many groups each named mesh owns.
 */
export function materialDocument(m: ModelMaterial): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Material>',
    `\t<Texture href="${m.texture}#xpointer(/Texture)"/>`,
    '\t<Bump/>',
    '\t<SpecFactor>0</SpecFactor>',
    ...vec('SpecColor', [0, 0, 0], '\t'),
    '\t<Gloss/>',
    '\t<MetalMirror>0</MetalMirror>',
    '\t<DielMirror>0</DielMirror>',
    '\t<Mirror/>',
    '\t<CastShadow>true</CastShadow>',
    '\t<ReceiveShadow>true</ReceiveShadow>',
    '\t<Priority>0</Priority>',
    ...vec('TranslucentColor', [0, 0, 0], '\t'),
    '\t<FloatParam>0</FloatParam>',
    '\t<DetailTexture/>',
    '\t<DetailScale>5</DetailScale>',
    '\t<ProjectOnTerrain>false</ProjectOnTerrain>',
    `\t<LightingMode>${m.lighting ?? 'L_NORMAL'}</LightingMode>`,
    '\t<DynamicMode>DM_DONT_CARE</DynamicMode>',
    `\t<Is2Sided>${!!m.twoSided}</Is2Sided>`,
    '\t<Effect>M_GENERIC</Effect>',
    `\t<AlphaMode>${m.alphaMode ?? 'AM_OPAQUE'}</AlphaMode>`,
    '\t<AffectedByFog>true</AffectedByFog>',
    '\t<AddPlaced>false</AddPlaced>',
    '\t<IgnoreZBuffer>false</IgnoreZBuffer>',
    '\t<BackFaceCastShadow>false</BackFaceCastShadow>',
    '</Material>',
  ].join(XML_EOL) + XML_EOL;
}

/** Three vector components, indented — every document here is full of them. */
function vec(tag: string, v: readonly number[], pad: string): string[] {
  return [
    `${pad}<${tag}>`,
    ...['x', 'y', 'z'].map((k, i) => `${pad}\t<${k}>${v[i]!.toFixed(5)}</${k}>`),
    `${pad}</${tag}>`,
  ];
}

/** The `(Geometry).xdb`: which binary, how big it is, and how its groups split. */
export function geometryDocument(o: {
  uid: string;
  bbox: BBox;
  /** Names the engine and the editor show; one per mesh block. */
  meshNames?: string[];
  /** Groups per mesh block, defaulting to one group on one mesh. */
  groupsPerMesh?: number[];
  /**
   * The bone the mesh hangs from, for an animated model — the shipped ones name
   * it here as well as in the skeleton, and an artifact's says `Artefact`.
   */
  rootJoint?: string;
}): string {
  const meshNames = o.meshNames ?? ['mesh'];
  const groups = o.groupsPerMesh ?? [1];
  const b = o.bbox;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Geometry>',
    '\t<SrcName/>',
    `\t<uid>${o.uid}</uid>`,
    `\t<RootMesh>${meshNames[0]}</RootMesh>`,
    o.rootJoint ? `\t<RootJoint>${o.rootJoint}</RootJoint>` : '\t<RootJoint/>',
    ...vec('Size', [b.sx, b.sy, b.sz], '\t'),
    ...vec('Center', [b.cx, b.cy, b.cz], '\t'),
    ...vec('BestFitPoint', [b.cx, b.cy, b.cz], '\t'),
    '\t<Dir>',
    ...['x', 'y', 'z', 'w'].map((k) => `\t\t<${k}>0</${k}>`),
    '\t</Dir>',
    '\t<AIGeometry/>',
    `\t<NumMeshes>${meshNames.length}</NumMeshes>`,
    '\t<MaterialQuantities>',
    ...groups.map((n) => `\t\t<Item>${n}</Item>`),
    '\t</MaterialQuantities>',
    '\t<MeshNames>',
    ...meshNames.map((n) => `\t\t<Item>${n}</Item>`),
    '\t</MeshNames>',
    '\t<MeshAnimated/>',
    '\t<MeshWindAffected/>',
    '</Geometry>',
  ].join(XML_EOL) + XML_EOL;
}

/**
 * The `(Skeleton).xdb`: a name for a `bin/Skeletons/<uid>` and the joint its
 * tree hangs from.
 *
 * The bones themselves are Granny (docs/GR2_FORMAT.md) and we do not write
 * those yet, so a rig of ours is a document of ours over a shipped skeleton
 * binary. That is not a compromise here: the artifact rig the box uses is ONE
 * bone called `Artefact` whose rest transform is the identity, so binding a
 * mesh to it moves nothing until the animation does.
 */
export function skeletonDocument(o: { uid: string; rootJoint: string }): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Skeleton>',
    '\t<SrcName/>',
    `\t<RootJoint>${o.rootJoint}</RootJoint>`,
    '\t<MSRFormat>true</MSRFormat>',
    '\t<Animations/>',
    `\t<uid>${o.uid}</uid>`,
    '</Skeleton>',
  ].join(XML_EOL) + XML_EOL;
}

/** The `(BasicSkelAnim).xdb`: a name for a `bin/animations/<uid>` clip. */
export function skelAnimDocument(o: { uid: string; rootJoint: string }): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<BasicSkelAnim>',
    '\t<SrcName/>',
    `\t<uid>${o.uid}</uid>`,
    '\t<ExpSrcClip/>',
    `\t<ExpRootTransform>${o.rootJoint}</ExpRootTransform>`,
    '\t<ExpFrameFirst>0</ExpFrameFirst>',
    '\t<ExpFrameLast>0</ExpFrameLast>',
    '\t<ExpSettingsFile href=""/>',
    '\t<MovementSpeed>0</MovementSpeed>',
    '\t<SpeedFactor>1</SpeedFactor>',
    '\t<Sound/>',
    '\t<Effect/>',
    '\t<SpeedLineFallTime>250</SpeedLineFallTime>',
    '\t<SpeedLineMaterial/>',
    '</BasicSkelAnim>',
  ].join(XML_EOL) + XML_EOL;
}

/**
 * The `(AnimSet).xdb`: which clip plays for which kind.
 *
 * `idle00` is the kind an object standing on the map plays, which is the only
 * one anything of ours needs so far.
 */
export function animSetDocument(o: { clips: { kind: string; anim: string }[]; rootJoint: string }): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<AnimSet>',
    '\t<animations>',
    ...o.clips.flatMap((c) => [
      '\t\t<Item>',
      `\t\t\t<Kind>${c.kind}</Kind>`,
      `\t\t\t<Anim href="${c.anim}#xpointer(/BasicSkelAnim)"/>`,
      '\t\t</Item>',
    ]),
    '\t</animations>',
    '\t<ExpSrcScene/>',
    '\t<ExpSrcClipFolder href=""/>',
    `\t<ExpRootTransform>${o.rootJoint}</ExpRootTransform>`,
    '</AnimSet>',
  ].join(XML_EOL) + XML_EOL;
}

/** The `(Model).xdb`: what it is made of, all of it by path. */
export function modelDocument(o: {
  /** Paths to the material documents, in group order. */
  materials: string[];
  /** Path to the geometry document. */
  geometry: string;
  /**
   * The skeleton document, for a mesh whose vertices carry a bone binding.
   *
   * A model without one is static however its groups are bound: the engine has
   * no bones to move them with. This is the half of "make it turn" that lives
   * in the document — the other half is the binding in the tag-4 array and an
   * AnimSet on the object's shared definition.
   */
  skeleton?: string;
}): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Model>',
    '\t<Materials>',
    ...o.materials.map((m) => `\t\t<Item href="${m}#xpointer(/Material)"/>`),
    '\t</Materials>',
    o.skeleton ? `\t<Skeleton href="${o.skeleton}#xpointer(/Skeleton)"/>` : '\t<Skeleton/>',
    `\t<Geometry href="${o.geometry}#xpointer(/Geometry)"/>`,
    '\t<Animations/>',
    '\t<WindPower>1</WindPower>',
    '</Model>',
  ].join(XML_EOL) + XML_EOL;
}

/**
 * Turn every position of a group about a point — the tilt the box wants, done
 * before the file is written rather than by patching floats afterwards.
 */
export function rotateGroup(
  g: GroupData,
  angles: readonly [number, number, number],
  about: readonly [number, number, number],
): GroupData {
  const positions = new Float32Array(g.positions);
  const [rx, ry, rz] = angles;
  for (let i = 0; i < positions.length; i += 3) {
    let [x, y, z] = [0, 1, 2].map((c) => positions[i + c]! - about[c]!) as [number, number, number];
    let c = Math.cos(rx), s = Math.sin(rx);
    [y, z] = [y * c - z * s, y * s + z * c];
    c = Math.cos(ry); s = Math.sin(ry);
    [x, z] = [x * c + z * s, -x * s + z * c];
    c = Math.cos(rz); s = Math.sin(rz);
    [x, y] = [x * c - y * s, x * s + y * c];
    const p = [x, y, z];
    for (let k = 0; k < 3; k++) positions[i + k] = p[k]! + about[k]!;
  }
  // The normals turn with the body; the texture coordinates do not.
  const vertices = Buffer.from(g.vertices);
  const n = g.remap.length;
  for (let v = 0; v < n; v++) {
    for (const off of [8, 12, 16]) {
      const at = v * VERTEX_STRIDE + off;
      const d = [0, 1, 2].map((c) => (vertices[at + c]! - 128) / 127) as [number, number, number];
      let [x, y, z] = d;
      let c = Math.cos(rx), s = Math.sin(rx);
      [y, z] = [y * c - z * s, y * s + z * c];
      c = Math.cos(ry); s = Math.sin(ry);
      [x, z] = [x * c + z * s, -x * s + z * c];
      c = Math.cos(rz); s = Math.sin(rz);
      [x, y] = [x * c - y * s, x * s + y * c];
      packVector(vertices, at, [x, y, z]);
    }
  }
  return { ...g, positions, vertices };
}
