// Playing an object's baked particle effect (docs/EFFECTS_FORMAT.md).
//
// The data is a recording — per particle a birth/death frame and keys for
// centre, rotation, size, colour and texture frame — so "simulation" here is
// only interpolation, and it is done ONCE, when the recording is first
// needed: every frame of it is sampled at its own rate into a TABLE — the
// alive particles of frame 0, then of frame 1, … — that lives on the GPU as a
// half-float texture, three texels an entry, one table per effect uid however
// many instances and copies play it (SLICE_fx_performance.md §3.3). Playing
// is then a lookup: the vertex shader reads its particle's entry and builds
// the camera-facing quad.
//
// ONE SIMULATION SERVES EVERY COPY. A map places the same effect over and over
// (182 campfires on one shipped map), and since every copy is at the same
// time on the one clock, a batch — one ParticleInstance payload — is drawn
// once for all its copies: the quad instances run particles × copies, the
// copy's matrix is fetched from a float texture with a row per copy.
//
// AND ONE DRAW SERVES EVERY BATCH THAT WEARS ONE ATLAS. The batches on a floor
// are gathered into POOLS by the frame table they draw with (and the shader,
// and the pivot): a pool is one mesh, one material, one draw. What told the
// batches apart is in textures now, not uniforms — every table in one ARENA
// texture (they share a width, so they stack by rows), every copy's matrix in
// the pool's matrix texture, and the frame's SEGMENTS (below) in a small
// integer texture the vertex shader binary-searches by instance id. A mixed
// stress map drew its 528 batches as 528 calls; they wear 203 atlases.
//
// What is left for the CPU each frame is the TRIGGER TRAIN: which copies of
// each recording are playing and at which frame each is. A batch hands over
// at most eight (table entry, count) segments; the pool lays them out back to
// back with the batch's copy block and lit flag, and the instance count is
// exactly the alive particles times the copies, segment by segment.
//
// The recording is a ONE-SHOT, not a loop: in 1911 of 1921 files the
// population ramps from zero and dies back to zero. What keeps a campfire
// burning is the TRIGGER TRAIN — the engine starts a fresh copy of the
// recording every `endCycle` playback seconds (offset by `offset`,
// `cycleCount` copies in total, 0 = forever), and the die-out of one copy
// overlaps the ramp-in of the next. Looping a single copy instead makes the
// fire visibly die and relight (population 1..40 where the train holds
// 35..45), and a "puff every 7 seconds" instance (recording 1.1s, period 7s)
// puffs six times too often.
//
// Textures: the instance's frame table is packed into one atlas (the baked
// texture index picks the tile), because switching textures per particle would
// break the single draw call. The atlas is one RGBA texture built straight
// from the frames' bytes and shared by every batch whose frame table is the
// same — the shipped effects wear a few hundred distinct frames between
// thousands of instances.

import * as THREE from 'three';
import type { Picture, FxInstancePayload } from '#src/scene/payload.ts';
import type { FxBaked } from '#src/scene/fx-bake.ts';
import { countBake } from '#viewport/bakes.ts';
import { TABLE_ROW, TABLE_W } from '#src/scene/fx-table.ts';
import type { FxTableData } from '#src/scene/fx-table.ts';
import { renderer } from '#viewport/stage.ts';

/**
 * One effect, simulated once and drawn for every copy of it on a floor — as
 * part of its pool's draw.
 *
 * Copies are slots: `addCopy` hands one out, `setCopyMatrix` places it (the
 * object's matrix times the instance's own offset — or a bone's, every frame,
 * for a glued one), `removeCopy` gives it back. The batch draws nothing until
 * it has a copy, and is disposed by whoever removes the last; the last batch
 * out of a pool takes the pool down.
 */
export interface FxBatch {
  /** The payload every copy shares — the key a floor finds the batch by. */
  fx: FxInstancePayload;
  /** Copies placed, i.e. slots in use. */
  copies: number;
  /** Alive particles this frame — the same for every copy, being one simulation. */
  alive: number;
  /**
   * The bone the effect is glued to, when it is — the ghost dragon's eyes on
   * its head. The renderer re-hangs every copy off its own object's bone each
   * frame; `glueLocal` is the transform inside the bone's frame.
   */
  glue?: string;
  glueLocal?: THREE.Matrix4;
  /** The instance's own offset from its object — what a copy's matrix is `object × this`. */
  local: THREE.Matrix4;
  /** What its particles are lit with: the scene's tint on an L_LIT instance, white otherwise. */
  tint: THREE.Color;
  /** Whether the draw it is part of is shown (the Effects toggle). */
  readonly visible: boolean;
  /** Advance the one simulation to `seconds` on the shared clock. */
  update(seconds: number): void;
  /** Take a slot; it draws at the identity until placed. */
  addCopy(): number;
  /** Place a copy: its full matrix, world from the effect's own frame. */
  setCopyMatrix(slot: number, m: THREE.Matrix4): void;
  /** The matrix a copy was last placed with. */
  copyMatrix(slot: number, out: THREE.Matrix4): THREE.Matrix4;
  /**
   * Give a slot back. The LAST slot moves into the hole so the used ones stay
   * contiguous; returns which slot moved there (the caller re-keys it), or -1.
   */
  removeCopy(slot: number): number;
  dispose(): void;
}

/**
 * One playing copy of an effect, driven by hand: the scene player places its
 * actors' fires and a shot's spells by writing `mesh.matrix` itself. A pool of
 * one batch of one copy at the identity, so the mesh matrix IS the copy's
 * placement.
 */
export interface FxSystem {
  mesh: THREE.Mesh;
  /** Advance to `seconds` on the shared clock. */
  update(seconds: number): void;
  dispose(): void;
}

/** Spare slots a new batch is born with, so placing a few copies does not rebuild it. */
const COPY_HEADROOM = 8;

/** The side of an atlas cell, texels; a frame is decoded no larger (object-effects.ts PARTICLE_FRAME). */
const CELL = 128;

/**
 * One frame table as a texture: the frames in a square-ish grid of CELL
 * tiles, the baked texture index counting through it row by row. Shared by
 * every pool that draws the same frames — the key is the frames' CONTENT,
 * so two instances of one particle, or two loads of it, meet at one texture —
 * and reference-counted like the recording tables.
 *
 * A frame sits in its cell at its OWN size, from the cell's top-left corner
 * (a 64-texel puff fills a quarter of it), and `cell` says per frame how
 * much of the cell it fills, so the shader scales the quad's uv into it and
 * the GPU's sampler does the stretch a bilinear loop here used to do — 140
 * ms of A2C1M1's build, in the one thread the window draws with, for what
 * the sampler does for free. What is left of laying an atlas out is a row
 * copy per frame.
 */
interface FxAtlas {
  tex: THREE.DataTexture;
  /** Per frame, the fraction of its cell it fills, (x, y) — N × 1 texels, read by `texelFetch` at the frame's index. */
  cell: THREE.DataTexture;
  cols: number;
  rows: number;
  refs: number;
  key: string;
}
const atlases = new Map<string, FxAtlas>();
/** A frame's content key, computed once per frame object. */
const frameKeys = new WeakMap<Picture, string>();

/**
 * Two FNV-1a hashes over the texels (64 bits between them: a few hundred
 * distinct frames cannot collide by accident at that width), with the shape.
 * The frames arrive shared — one object per distinct file per IPC message —
 * so this runs once per distinct frame, not once per instance wearing it.
 */
function frameKey(f: Picture): string {
  let key = frameKeys.get(f);
  if (key !== undefined) return key;
  const d = f.rgba;
  let h1 = 0x811c9dc5 | 0, h2 = 0x050c5d1f | 0;
  for (let i = 0; i < d.length; i++) {
    h1 = Math.imul(h1 ^ d[i]!, 0x01000193);
    h2 = Math.imul(h2 ^ d[i]!, 0x01000193) ^ (h2 >>> 15);
  }
  key = `${f.width}x${f.height}:${(h1 >>> 0).toString(16)}${(h2 >>> 0).toString(16)}`;
  frameKeys.set(f, key);
  return key;
}

/** The key an atlas is shared by: the colour space and the frames' content. */
function atlasKey(textures: (Picture | null)[], rawColor: boolean): string {
  // A static system's colour stays RAW: its texel goes to the framebuffer
  // as-authored (the terrain's gamma convention). Decoded as sRGB it would be
  // re-encoded on the way out and the grass would brighten past the game's.
  // Two colour spaces are two textures, so the flag is part of the key.
  return `${rawColor ? 'raw' : 'srgb'}|${textures.map((t) => (t ? frameKey(t) : '-')).join('|')}`;
}

/** The atlas for a frame table — built on first use, shared after. Pair with releaseAtlas. */
function atlasFor(key: string, textures: (Picture | null)[], rawColor: boolean): FxAtlas {
  const have = atlases.get(key);
  if (have) { have.refs++; return have; }
  const t0 = performance.now();
  const cols = Math.max(1, Math.ceil(Math.sqrt(textures.length)));
  const rows = Math.max(1, Math.ceil(textures.length / cols));
  const width = cols * CELL, height = rows * CELL;
  const data = new Uint8Array(width * height * 4); // an empty slot stays transparent
  const cellData = new Float32Array(Math.max(1, textures.length) * 2);
  for (let i = 0; i < textures.length; i++) {
    const t = textures[i];
    if (!t) continue;
    blitCell(t, data, width, (i % cols) * CELL, Math.floor(i / cols) * CELL);
    cellData[i * 2] = t.width / CELL;
    cellData[i * 2 + 1] = t.height / CELL;
  }
  const cell = new THREE.DataTexture(cellData, Math.max(1, textures.length), 1, THREE.RGFormat, THREE.FloatType);
  cell.magFilter = cell.minFilter = THREE.NearestFilter;
  cell.generateMipmaps = false;
  cell.needsUpdate = true;
  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
  // Row 0 of a frame is its top; uploaded flipped, as the canvas path was, so
  // v counts from the bottom and the shaders' tile arithmetic holds.
  tex.flipY = true;
  if (!rawColor) tex.colorSpace = THREE.SRGBColorSpace;
  // The atlas is sampled per tile; letting mips blend neighbouring tiles in
  // smears every frame with its neighbours at distance.
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  // Once on the GPU the bytes are not needed here: three keeps a texture's
  // image referenced for as long as the texture lives, and a big map's
  // atlases are hundreds of megabytes of it. (A lost and restored WebGL
  // context re-uploads from the image, so the effects would come back blank
  // until the map is reopened — a GPU reset in a map editor can have that.)
  tex.onUpdate = () => { (tex.image as { data: Uint8Array | null }).data = null; };
  const atlas: FxAtlas = { tex, cell, cols, rows, refs: 1, key };
  atlases.set(key, atlas);
  countBake('atlas', performance.now() - t0);
  return atlas;
}

function releaseAtlas(atlas: FxAtlas): void {
  if (--atlas.refs > 0) return;
  atlas.tex.dispose();
  atlas.cell.dispose();
  atlases.delete(atlas.key);
}

/** What the atlases hold right now — for view.perf(). */
export function fxAtlasStats(): { atlases: number; bytes: number } {
  let bytes = 0;
  for (const a of atlases.values()) bytes += a.tex.image.width * a.tex.image.height * 4;
  return { atlases: atlases.size, bytes };
}

/**
 * A frame into its cell of the atlas, at its own size, from the cell's
 * top-left corner — a row copy per row (a frame never exceeds the cell:
 * object-effects.ts decodes it no larger). The stretch to the full tile a
 * 64-texel puff is authored to be is the sampler's, through `FxAtlas.cell`.
 */
function blitCell(f: Picture, data: Uint8Array, width: number, x0: number, y0: number): void {
  const src = f.rgba, w = Math.min(f.width, CELL), h = Math.min(f.height, CELL);
  for (let y = 0; y < h; y++) data.set(src.subarray(y * f.width * 4, y * f.width * 4 + w * 4), ((y0 + y) * width + x0) * 4);
}

/**
 * Segments per row of a pool's segment texture; a segment is two texels. A
 * narrow texture, grown by rows: it is re-uploaded whole whenever a train in
 * the pool moves on, and most pools hold a few batches — 200 pools uploading
 * 16 KB each every frame was a visible share of the frame.
 */
const SEG_ROW = 16;

// Which segment this quad instance belongs to, and through it its particle
// and its copy. The pool's segments are laid out back to back, segment i
// being two RGBA32I texels: (instance end, table entry base, count, copy
// block base) and (copies, lit, -, -). The instance ends are cumulative, so
// a binary search on them finds the segment; inside it the instance counts
// copies fastest.
//
// The particle is an entry of the ARENA — three texels wide, the batch's
// table rows stacked with everyone else's — and the copy a row of four texels
// in uMat.
const COPY = `
uniform sampler2D uMat;
uniform highp isampler2D uSegs;
uniform int uSegCount;
uniform sampler2D uTable;
uniform vec3 uTint; // scene light on an L_LIT batch; white when unlit
ivec4 segAt(int i, int t) { return texelFetch(uSegs, ivec2((i % ${SEG_ROW}) * 2 + t, i / ${SEG_ROW}), 0); }
mat4 copyMatrix(int c) {
  return mat4(texelFetch(uMat, ivec2(0, c), 0), texelFetch(uMat, ivec2(1, c), 0),
              texelFetch(uMat, ivec2(2, c), 0), texelFetch(uMat, ivec2(3, c), 0));
}
struct Particle { vec3 center; vec3 sizeRot; vec4 color; float tex; };
Particle particle(int e) {
  ivec2 t = ivec2((e % ${TABLE_ROW}) * 3, e / ${TABLE_ROW});
  vec4 a = texelFetch(uTable, t, 0);
  vec4 b = texelFetch(uTable, t + ivec2(1, 0), 0);
  vec4 c = texelFetch(uTable, t + ivec2(2, 0), 0);
  return Particle(a.xyz, vec3(b.xy, a.w), c, b.z);
}
// The segment, its particle and its copy for this instance; the particle's
// colour comes back already tinted.
void locate(out Particle P, out mat4 M) {
  int lo = 0, hi = uSegCount - 1;
  for (int i = 0; i < 20; i++) {
    if (lo >= hi) break;
    int mid = (lo + hi) >> 1;
    if (gl_InstanceID < segAt(mid, 0).x) hi = mid; else lo = mid + 1;
  }
  ivec4 A = segAt(lo, 0), B = segAt(lo, 1);
  int start = lo > 0 ? segAt(lo - 1, 0).x : 0;
  int li = gl_InstanceID - start;
  int ci = li % B.x, pi = li / B.x;
  P = particle(A.y + pi);
  P.color.rgb *= B.y == 1 ? uTint : vec3(1.0);
  M = copyMatrix(A.w + ci);
}`;

const VERT = `
out vec2 vUv;
out vec4 vColor;
out float vTex;
${COPY}
void main() {
  Particle P; mat4 M;
  locate(P, M);
  vec4 c = viewMatrix * modelMatrix * M * vec4(P.center, 1.0);
  float cr = cos(P.sizeRot.z), sr = sin(P.sizeRot.z);
  vec2 corner = position.xy * P.sizeRot.xy;
  c.xy += vec2(corner.x * cr - corner.y * sr, corner.x * sr + corner.y * cr);
  gl_Position = projectionMatrix * c;
  vUv = uv;
  vColor = P.color;
  vTex = P.tex;
}`;

// A STANDING system (derived from its bake in createFxBatch — every particle
// alive the whole loop, no channel moving, enough of them to be vegetation) —
// the terrain-object grass. Its quads
// stand UPRIGHT in the world (a cylindrical billboard: yaw follows the camera
// so a clump never degenerates to an edge, pitch stays vertical), anchored per
// the instance's <Pivot> ((0,-1) = bottom edge, a blade grows up from where it
// stands), rolled by the baked rotation. Full camera-facing quads are what
// turned a field of grass into glowing scribble: seen from a low camera every
// card tipped toward the lens and the clumps piled into a web.
const VERT_STATIC = `
uniform vec2 uPivot;
out vec2 vUv;
out vec4 vColor;
out float vTex;
${COPY}
void main() {
  Particle P; mat4 M;
  locate(P, M);
  vec3 center = (modelMatrix * M * vec4(P.center, 1.0)).xyz;
  vec3 toCam = cameraPosition - center;
  vec2 h = toCam.xy;
  h = dot(h, h) > 1e-8 ? normalize(h) : vec2(1.0, 0.0);
  vec3 rightW = vec3(-h.y, h.x, 0.0);
  float cr = cos(P.sizeRot.z), sr = sin(P.sizeRot.z);
  vec2 corner = (position.xy - 0.5 * uPivot) * P.sizeRot.xy;
  vec2 rc = vec2(corner.x * cr - corner.y * sr, corner.x * sr + corner.y * cr);
  vec3 world = center + rightW * rc.x + vec3(0.0, 0.0, 1.0) * rc.y;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  vUv = uv;
  vColor = P.color;
  vTex = P.tex;
}`;

/**
 * Where in the atlas a quad's uv lands: the frame's cell, and within it the
 * frame's own extent (`uCell`, its size over the cell's). Atlas row 0 is the
 * TOP and the texture is flipY'd, so v counts from the bottom — a tile on
 * atlas row r spans v rows [rows-1-r, rows-r]. A frame laid from its cell's
 * top-left corner stays at the cell's TOP once the whole image is flipped
 * (the flip turns the image over, the cell with it): its v runs over the
 * last `fill.y` of the cell, its u over the first `fill.x`.
 */
const ATLAS_UV = `
uniform sampler2D uAtlas;  // the frame table, straight RGBA
uniform sampler2D uCell;   // per frame: the fraction of its cell it fills
uniform vec2 uGrid; // cols, rows
vec2 atlasUv(float t, vec2 quadUv) {
  float col = mod(t, uGrid.x), row = floor(t / uGrid.x);
  vec2 fill = texelFetch(uCell, ivec2(int(t), 0), 0).xy;
  return vec2(col + quadUv.x * fill.x, (uGrid.y - row) - fill.y + quadUv.y * fill.y) / uGrid;
}`;

const FRAG = `
precision highp float;
${ATLAS_UV}
in vec2 vUv;
in vec4 vColor;
in float vTex;
out vec4 outColor;
void main() {
  if (vTex < -0.5) discard; // hidden frame
  float t = floor(vTex + 0.5);
  vec4 s = texture(uAtlas, atlasUv(t, vUv));
  // The era's particle pipeline in two lines. Colour: modulate-x2 (baked
  // colours are authored around 128 = full brightness — the ghost dragon's
  // mist peaks at 57), faded by the baked alpha curve; the lit tint is
  // already in vColor. Blend (see the material): ONE / ONE_MINUS_SRC_ALPHA
  // with STRAIGHT colour, so rgb is what a texel ADDS and alpha is what it
  // OCCLUDES — fire painted on black with a zero alpha channel is purely
  // additive, smoke with real alpha covers, and one instance can mix both
  // kinds of frame. No blending heuristic; this is the art's own convention.
  vec3 rgb = s.rgb * vColor.rgb * 2.0 * vColor.a;
  float a = s.a * vColor.a;
  if (a < 0.003 && max(rgb.r, max(rgb.g, rgb.b)) < 0.004) discard;
  outColor = vec4(rgb, a);
}`;

// The static-scenery end of it: the game's candidate shader (0xc77e94) leaves
// the texel's rgb UNTOUCHED — no baked-colour tint, no modulate — and uses the
// particle colour only through its alpha. Grass in the game is exactly the
// texture's own dark green. The texel is premultiplied by alpha here because
// the material blends ONE / ONE_MINUS_SRC_ALPHA: without it every soft edge
// ADDS its colour over the scene, which is where the neon glow came from.
const FRAG_STATIC = `
precision highp float;
${ATLAS_UV}
in vec2 vUv;
in vec4 vColor;
in float vTex;
out vec4 outColor;
void main() {
  if (vTex < -0.5) discard;
  float t = floor(vTex + 0.5);
  vec4 s = texture(uAtlas, atlasUv(t, vUv));
  float a = s.a * vColor.a;
  if (a < 0.01) discard;
  outColor = vec4(s.rgb * a, a);
}`;

/**
 * One recording, sampled frame by frame and laid out for the GPU.
 *
 * Entry `e` is three RGBA16F texels: `x y z rot`, `w h tex −`, `r g b a`.
 * Frame `f`'s alive particles are the entries `base[f] .. base[f] + count[f]`;
 * hidden ones (tex −1) are left out, as the sampler left them out. Shared by
 * uid across every instance and copy that plays the effect, and reference-
 * counted so the last batch to go takes its rows with it.
 *
 * The texels live in the ARENA (below) from `rowStart` on; a batch's entry
 * index is `rowStart × TABLE_ROW + base[f]`. Until the bake lands the table
 * has no rows and no entries, so the batches over it draw nothing.
 */
export interface FxTable {
  /** The texels, TABLE_W × rows — kept for laying the arena out again; null until baked. */
  data: Uint16Array | null;
  rows: number;
  /** First row in the arena, -1 while not there (unbaked, or no room). */
  rowStart: number;
  base: Int32Array;
  count: Int32Array;
  /** Frames the table has: the recording's whole length, 0 … frames-1. */
  frames: number;
  entries: number;
  refs: number;
}
const tables = new Map<string, FxTable>();

/**
 * Every table's texels in ONE texture, so that one draw can play any number of
 * recordings: the tables all have the arena's width and stack by rows. Rows
 * are handed out from the top; a table that lands while there is room is
 * written into its rows in place (texSubImage2D — never a whole re-upload),
 * one that does not fit has the arena laid out again, compacted and doubled.
 * Rows a released table leaves behind are dead until then; the last table
 * out takes the arena with it.
 */
const arena = {
  tex: null as THREE.DataTexture | null,
  /** Rows the texture has. */
  rows: 0,
  /** Rows handed out so far, dead ones included. */
  used: 0,
  /** Rows of tables that were released since the last layout. */
  dead: 0,
};
const ARENA_MIN_ROWS = 256;

/**
 * The table for a uid — placed in the arena on first use from the bake the
 * payload carries, shared after. Pair with releaseTable.
 */
function tableFor(uid: string, baked: FxBaked): FxTable {
  const have = tables.get(uid);
  if (have) { have.refs++; return have; }
  const d = baked.table;
  const t: FxTable = { data: null, rows: 0, rowStart: -1, base: d.base, count: d.count, frames: d.frames, entries: 0, refs: 1 };
  tables.set(uid, t);
  placeTable(t, d);
  return t;
}

/** A baked table into the arena: its rows in place, or a new layout when they do not fit. */
function placeTable(t: FxTable, d: FxTableData): void {
  t.data = d.data; t.rows = d.rows; t.base = d.base; t.count = d.count; t.entries = d.entries;
  if (!arena.tex || arena.used + d.rows > arena.rows) { layoutArena(arena.used - arena.dead + d.rows); return; }
  t.rowStart = arena.used;
  arena.used += d.rows;
  // The source is a texture that is never uploaded on its own: three copies
  // its texels straight into the arena's rows.
  const src = new THREE.DataTexture(d.data, TABLE_W, d.rows, THREE.RGBAFormat, THREE.HalfFloatType);
  renderer.copyTextureToTexture(src, arena.tex, null, new THREE.Vector2(0, t.rowStart));
  src.dispose(); // never uploaded on its own; this only lets the object go
}

/**
 * The arena anew, `need` rows or more: every baked table gets its rows
 * again, back to back, and the texture is uploaded whole — once per doubling,
 * not once per table. A table past the GPU's tallest texture stays out
 * (rowStart -1) and its batches stay silent, with a word in the console.
 */
function layoutArena(need: number): void {
  const max = renderer.capabilities.maxTextureSize as number;
  let rows = Math.max(ARENA_MIN_ROWS, arena.rows);
  while (rows < need && rows < max) rows *= 2;
  rows = Math.min(rows, max);
  const data = new Uint16Array(TABLE_W * rows * 4);
  let used = 0;
  for (const t of tables.values()) {
    if (!t.data) continue;
    if (used + t.rows > rows) {
      console.warn(`[fx] the table arena is full (${rows} rows): a recording of ${t.rows} rows is left out`);
      t.rowStart = -1;
      continue;
    }
    t.rowStart = used;
    data.set(t.data, used * TABLE_W * 4);
    used += t.rows;
  }
  arena.tex?.dispose();
  const tex = new THREE.DataTexture(data, TABLE_W, rows, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  // The tables keep their own texels; the arena's copy is not needed once uploaded.
  tex.onUpdate = () => { (tex.image as { data: Uint16Array | null }).data = null; };
  arena.tex = tex;
  arena.rows = rows;
  arena.used = used;
  arena.dead = 0;
}

function releaseTable(uid: string): void {
  const t = tables.get(uid);
  if (!t || --t.refs > 0) return;
  tables.delete(uid);
  if (t.rowStart >= 0) arena.dead += t.rows;
  if (!tables.size && arena.tex) {
    arena.tex.dispose();
    arena.tex = null;
    arena.rows = arena.used = arena.dead = 0;
  }
}

/** The tables still registered, with their reference counts — for the close-time check in world.ts. */
export function fxTablesLeft(): string[] {
  return [...tables.entries()].map(([uid, t]) => `${uid} ×${t.refs}`);
}

/** What the tables hold right now — for view.perf(). */
export function fxTableStats(): { tables: number; entries: number; bytes: number; arenaBytes: number } {
  let entries = 0, bytes = 0;
  for (const t of tables.values()) { entries += t.entries; bytes += t.data?.byteLength ?? 0; }
  return { tables: tables.size, entries, bytes, arenaBytes: arena.rows * TABLE_W * 8 };
}

/** The unlit batches' fixed tint — one shared object, never mutated. */
const WHITE_TINT = { value: new THREE.Color(1, 1, 1) };

/** Copy rows a pool's matrix texture is born with. */
const MAT_MIN_ROWS = 64;

/** A batch as its pool sees it: its copy block, and the segments it handed over this frame. */
interface Member extends FxBatch {
  pool: FxPool;
  table: FxTable;
  /** First row of its copy block in the pool's matrix texture, and the block's size. */
  copyBase: number;
  capacity: number;
  lit: boolean;
  /** This frame's segments: arena entry base and count, `segN` of them. */
  segEntry: Int32Array;
  segCount: Int32Array;
  segN: number;
}

/**
 * Every batch on one parent (a floor's object group; a scene's stage) that
 * wears one atlas, one shader and one pivot — and so can be ONE draw.
 *
 * The pool owns the mesh, the material and the three textures the draw reads
 * beyond the atlas and the arena: the copies' matrices (a block per member,
 * bump-allocated, compacted when the texture has to grow), and the segments,
 * rebuilt from the members' trains right before the draw (`onBeforeRender`),
 * which is also when the instance count is set. Members come and go through
 * createFxBatch / FxBatch.dispose; the last one out disposes the pool.
 */
class FxPool {
  readonly mesh: THREE.Mesh;
  readonly members: Member[] = [];
  readonly key: string;
  readonly atlas: FxAtlas;
  /** The object the mesh hangs under — none for a scene player's system, which places the mesh itself. */
  readonly parent: THREE.Object3D | null;
  private readonly geo: THREE.InstancedBufferGeometry;
  private readonly mat: THREE.ShaderMaterial;
  private mats: Float32Array;
  private matTex: THREE.DataTexture;
  private matRows: number;
  private matUsed = 0;
  private segs: Int32Array;
  private segTex: THREE.DataTexture;
  private segCap: number;
  /** The segments changed (a train moved on, a copy came or went): lay them out before the draw. */
  segsDirty = true;
  /** A copy matrix was written: upload the matrix texture before the draw. */
  matsDirty = false;

  constructor(
    key: string, atlas: FxAtlas, standing: boolean, pivot: readonly number[] | undefined,
    litTint: { value: THREE.Color }, parent: THREE.Object3D | null,
  ) {
    this.key = key;
    this.atlas = atlas;
    this.parent = parent;
    const quad = new THREE.PlaneGeometry(1, 1);
    // A PARTICLE FRAME IS AUTHORED UPSIDE DOWN: the art's "up" is the image's
    // BOTTOM row, so the quad's v runs the other way from three's (which puts
    // v = 1 at the top corner). Measured on the two families whose up is
    // unmistakable, and they agree: a grass clump has its dense base in the
    // image's TOP half (alpha mass 657k against 142k) with the blades hanging
    // down, and a candle flame is widest along the top rows and tapers to a
    // point at the bottom (the last rows are empty). Left unflipped, every
    // effect is drawn mirrored — invisible on a fire, which reads as fire
    // either way, and unmistakable on grass: a lawn of blades pointing at the
    // sky, roots in the air. The corpus at large cannot settle this (379 of 900
    // frames are top-heavy, 209 bottom-heavy, the rest even) because most
    // particles are round puffs with no up at all, which is why the two
    // asymmetric families are the measurement.
    const uv = quad.getAttribute('uv').clone();
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    // Nothing per instance in the geometry: a quad instance finds its segment,
    // particle and copy from gl_InstanceID alone.
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = quad.index;
    this.geo.setAttribute('position', quad.getAttribute('position'));
    this.geo.setAttribute('uv', uv);
    this.geo.instanceCount = 0;
    this.matRows = MAT_MIN_ROWS;
    this.mats = new Float32Array(this.matRows * 16);
    this.matTex = makeMatrixTexture(this.mats, this.matRows);
    this.segCap = SEG_ROW;
    this.segs = new Int32Array(this.segCap * 8);
    this.segTex = makeSegmentTexture(this.segs, this.segCap);
    this.mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: standing ? VERT_STATIC : VERT,
      fragmentShader: standing ? FRAG_STATIC : FRAG,
      uniforms: {
        uAtlas: { value: atlas.tex },
        uCell: { value: atlas.cell },
        uGrid: { value: new THREE.Vector2(atlas.cols, atlas.rows) },
        // Shared by reference: the app mutates the lit tint in place when the
        // preset (or the Light toggle) changes, like the terrain uniforms.
        uTint: litTint,
        uMat: { value: this.matTex },
        uSegs: { value: this.segTex },
        uSegCount: { value: 0 },
        uTable: { value: arena.tex },
        ...(standing ? { uPivot: { value: new THREE.Vector2(pivot?.[0] ?? 0, pivot?.[1] ?? 0) } } : {}),
      },
      transparent: true,
      depthWrite: false,
      // ONE / ONE_MINUS_SRC_ALPHA with straight colour — the FRAG explains why
      // this single mode covers both the additive fire and the covering smoke.
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    // Positions live in the arena and the copies all over the map: three.js
    // cannot know the bounds, and a culled fire that pops in at the screen edge
    // is worse than the cost of always issuing the draw.
    this.mesh.frustumCulled = false;
    // Identity: a copy's matrix carries its whole placement. The scene player
    // is the one caller that writes this matrix instead (createFxSystem).
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = 3; // over the water sheet and the ground overlay
    this.mesh.onBeforeRender = () => this.flush();
    if (parent) {
      this.mesh.visible = poolsShown;
      parent.add(this.mesh);
    }
  }

  /** `n` rows of the matrix texture for a member's copy block; grows (and compacts) the texture when they are not there. */
  allocBlock(n: number): number {
    if (this.matUsed + n > this.matRows) this.layoutMats(n);
    const at = this.matUsed;
    this.matUsed += n;
    return at;
  }

  /** The matrix texture anew: every member's block back to back, with room for `extra` rows more. */
  private layoutMats(extra: number): void {
    let live = 0;
    for (const m of this.members) if (m.copyBase >= 0) live += m.capacity;
    let rows = Math.max(MAT_MIN_ROWS, this.matRows);
    while (rows < live + extra) rows *= 2;
    const mats = new Float32Array(rows * 16);
    let used = 0;
    for (const m of this.members) {
      if (m.copyBase < 0) continue;
      mats.set(this.mats.subarray(m.copyBase * 16, (m.copyBase + m.capacity) * 16), used * 16);
      m.copyBase = used;
      used += m.capacity;
    }
    this.mats = mats;
    this.matUsed = used;
    this.matRows = rows;
    this.matTex.dispose();
    this.matTex = makeMatrixTexture(mats, rows);
    this.mat.uniforms.uMat!.value = this.matTex;
    this.matsDirty = false;
    this.segsDirty = true; // the blocks moved
  }

  /** The matrix rows, to write a copy into (at its block's row). */
  get matrices(): Float32Array { return this.mats; }

  /** Right before the draw: the members' segments laid out, the textures uploaded, the instance count set. */
  private flush(): void {
    const u = this.mat.uniforms;
    if (u.uTable!.value !== arena.tex) u.uTable!.value = arena.tex;
    if (this.matsDirty) { this.matTex.needsUpdate = true; this.matsDirty = false; }
    if (!this.segsDirty) return;
    this.segsDirty = false;
    let n = 0;
    for (const m of this.members) n += m.segN;
    if (n > this.segCap) {
      let cap = this.segCap;
      while (cap < n) cap *= 2;
      this.segCap = cap;
      this.segs = new Int32Array(cap * 8);
      this.segTex.dispose();
      this.segTex = makeSegmentTexture(this.segs, cap);
      u.uSegs!.value = this.segTex;
    }
    const s = this.segs;
    let i = 0, total = 0;
    for (const m of this.members) {
      for (let k = 0; k < m.segN; k++, i += 8) {
        total += m.segCount[k]! * m.copies;
        s[i] = total; s[i + 1] = m.segEntry[k]!; s[i + 2] = m.segCount[k]!; s[i + 3] = m.copyBase;
        s[i + 4] = m.copies; s[i + 5] = m.lit ? 1 : 0; s[i + 6] = 0; s[i + 7] = 0;
      }
    }
    u.uSegCount!.value = n;
    this.segTex.needsUpdate = true;
    this.geo.instanceCount = total;
  }

  /** A member is gone; the last one takes the pool with it. */
  drop(m: Member): void {
    const i = this.members.indexOf(m);
    if (i >= 0) this.members.splice(i, 1);
    this.segsDirty = true;
    if (this.members.length) return;
    this.mesh.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
    this.matTex.dispose();
    this.segTex.dispose();
    releaseAtlas(this.atlas);
    if (this.parent) pools.get(this.parent)?.delete(this.key);
  }
}

/** The shared pools, by the object they hang under and then by key. */
const pools = new Map<THREE.Object3D, Map<string, FxPool>>();
/** The Effects toggle, as the pools are born under it. */
let poolsShown = true;

/** Show or hide every pool — the Effects toggle. */
export function setFxVisible(on: boolean): void {
  poolsShown = on;
  for (const byKey of pools.values()) for (const p of byKey.values()) p.mesh.visible = on;
}

/** How many draws the effects under `parent` are. */
export function fxPoolCount(parent: THREE.Object3D): number {
  return pools.get(parent)?.size ?? 0;
}

/**
 * One batch: the payload's copies, in the pool for its atlas under `parent`
 * — or, with no parent, in a pool of its own whose mesh the caller places
 * (createFxSystem).
 */
export function createFxBatch(
  fx: FxInstancePayload, litTint: { value: THREE.Color } = WHITE_TINT, parent: THREE.Object3D | null = null,
): FxBatch {
  // The recording, baked where the scene was built (src/scene/fx-bake.ts):
  // standing scenery or billboards is decided there too.
  const baked = fx.baked;
  const standing = baked.standing;
  const recFrames = Math.max(1, baked.duration * baked.rate);
  // One copy's length in real (playback) seconds: `<Speed>` scales the
  // instance's clock, so 0.8 plays the recording at 0.8× and it lasts longer.
  const recPlaySec = recFrames / baked.rate / fx.speed;
  // The retrigger period is in that SAME scaled clock, not in real seconds —
  // slowing an instance down slows its retriggering with it. Read as real
  // seconds instead, a slowed instance retriggers far too often: the shipped
  // library then wants up to 36 copies of one fog bake alive at once (period 3
  // against a 16-second recording at Speed 0.15), and the Fountain of Fortune
  // grows a second rainbow over the first while it is still at full strength —
  // which is what sent us looking. Measured over all 625 instances that carry
  // a period, this reading needs at most 6 copies and one for 56% of them,
  // against a maximum of 36 the other way. endCycle 0 (rare, one-shots) →
  // back-to-back copies.
  const recSec = recFrames / baked.rate;
  const period = (fx.endCycle > 0 ? fx.endCycle : recSec) / fx.speed;
  const copies = fx.cycleCount > 0 ? fx.cycleCount : Infinity;
  // Copies of the recording alive at once become the batch's segments, of
  // which there are 8: the library maxes out at 6 (adventure-reachable), and
  // 8 caps a hypothetical pathological file, not anything observed.
  const table = tableFor(fx.uid, baked);

  // The pool: the atlas, the shader and (standing) the pivot tell draws apart.
  const aKey = atlasKey(fx.textures, standing);
  const key = standing ? `${aKey}|pivot ${fx.pivot?.[0] ?? 0},${fx.pivot?.[1] ?? 0}` : aKey;
  let pool = parent ? pools.get(parent)?.get(key) : undefined;
  if (!pool) {
    pool = new FxPool(key, atlasFor(aKey, fx.textures, standing), standing, fx.pivot, litTint, parent);
    if (parent) (pools.get(parent) ?? pools.set(parent, new Map()).get(parent)!).set(key, pool);
  }

  const local = new THREE.Matrix4().compose(
    new THREE.Vector3(...(fx.pos as [number, number, number])),
    new THREE.Quaternion(fx.quat[0], fx.quat[1], fx.quat[2], fx.quat[3]),
    new THREE.Vector3(fx.scale, fx.scale, fx.scale),
  );

  // A finite train fires its copies once. On a clip-hung effect the engine
  // replays the whole effect every animation cycle — `retrigger` carries the
  // clip length — so the phoenix's one-burst wing whoosh repeats per flap.
  // An object effect's finite train really does play only once (7 instances
  // map-wide): a birth flash the editor shows at map open, then quiet. [~]
  const retrigger = copies !== Infinity && fx.retrigger ? fx.retrigger : 0;

  const m: Member = {
    pool, table, fx, local, copies: 0, alive: 0,
    copyBase: -1, capacity: 1 + COPY_HEADROOM, lit: !!fx.lit,
    segEntry: new Int32Array(8), segCount: new Int32Array(8), segN: 0,
    tint: fx.lit ? litTint.value : WHITE_TINT.value,
    get visible() { return pool!.mesh.visible; },
    // The trigger train, as the sampler ran it: copies k whose recording is
    // under way at t, each at its own frame. Every alive copy is a segment of
    // the table; the pool draws them back to back.
    update(seconds: number) {
      // Whether anything below differs from last frame: the table steps at
      // its own rate (30 Hz) under a loop that runs faster, and a pool whose
      // segments all stand still is not laid out or uploaded again.
      let changed = false;
      const was = this.segN;
      this.segN = 0;
      this.alive = 0;
      if (this.copies && table.rowStart >= 0) {
        // Every copy of an effect is at the same t. The per-placement phase
        // that used to be added here (so thirty campfires would not flicker in
        // step) was the editor's own invention, not the game's, and it was the
        // one thing that kept two copies of one effect from sharing a frame —
        // which is what lets them share a simulation (SLICE_fx_performance §3).
        let t = seconds - fx.offset;
        if (retrigger > 0) t = ((t % retrigger) + retrigger) % retrigger;
        const kMax = Math.min(Math.floor(t / period), copies - 1);
        const kMin = Math.max(0, Math.ceil((t - recPlaySec) / period));
        const off = table.rowStart * TABLE_ROW;
        let segs = 0, total = 0;
        for (let k = kMin; k <= kMax && segs < 8; k++) {
          const f = Math.floor((t - k * period) * fx.speed * baked.rate);
          if (f < 0 || f >= table.frames) continue;
          const c = table.count[f]!;
          if (!c) continue;
          const entry = off + table.base[f]!;
          if (this.segEntry[segs] !== entry || this.segCount[segs] !== c) changed = true;
          this.segEntry[segs] = entry;
          this.segCount[segs] = c;
          total += c;
          segs++;
        }
        this.segN = segs;
        this.alive = total;
      }
      if (changed || this.segN !== was) pool!.segsDirty = true;
    },
    addCopy() {
      if (this.copies === this.capacity) {
        // Twice the block: a new one at the end, the copies moved over.
        const wider = this.capacity * 2;
        const at = pool!.allocBlock(wider); // may lay the texture out again and move copyBase
        pool!.matrices.copyWithin(at * 16, this.copyBase * 16, (this.copyBase + this.copies) * 16);
        this.copyBase = at;
        this.capacity = wider;
      }
      const slot = this.copies++;
      pool!.matrices.set(IDENTITY, (this.copyBase + slot) * 16);
      pool!.matsDirty = true;
      pool!.segsDirty = true;
      return slot;
    },
    setCopyMatrix(slot, mat) {
      pool!.matrices.set(mat.elements, (this.copyBase + slot) * 16);
      pool!.matsDirty = true;
    },
    copyMatrix(slot, out) {
      return out.fromArray(pool!.matrices, (this.copyBase + slot) * 16);
    },
    removeCopy(slot) {
      const last = --this.copies;
      pool!.segsDirty = true;
      if (slot === last) return -1;
      const rows = pool!.matrices;
      rows.copyWithin((this.copyBase + slot) * 16, (this.copyBase + last) * 16, (this.copyBase + last + 1) * 16);
      pool!.matsDirty = true;
      return last;
    },
    ...(fx.glue ? {
      glue: fx.glue.bone,
      glueLocal: new THREE.Matrix4().compose(
        new THREE.Vector3(...(fx.glue.pos as [number, number, number])),
        new THREE.Quaternion(fx.glue.quat[0], fx.glue.quat[1], fx.glue.quat[2], fx.glue.quat[3]),
        new THREE.Vector3(fx.glue.scale, fx.glue.scale, fx.glue.scale),
      ),
    } : {}),
    dispose() {
      pool!.drop(this);
      releaseTable(fx.uid);
    },
  };
  pool.members.push(m);
  m.copyBase = pool.allocBlock(m.capacity);
  return m;
}

const IDENTITY = new THREE.Matrix4().elements;

/** `rows` copies' matrices as a 4×rows float texture, read with texelFetch. */
function makeMatrixTexture(data: Float32Array, rows: number): THREE.DataTexture {
  const t = new THREE.DataTexture(data, 4, rows, THREE.RGBAFormat, THREE.FloatType);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

/** `cap` segments, two RGBA32I texels each, SEG_ROW to a row. */
function makeSegmentTexture(data: Int32Array, cap: number): THREE.DataTexture {
  const t = new THREE.DataTexture(data, SEG_ROW * 2, cap / SEG_ROW, THREE.RGBAIntegerFormat, THREE.IntType);
  t.internalFormat = 'RGBA32I';
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

/**
 * One copy of an effect whose placement is the mesh matrix — the scene
 * player's way of holding a system: it composes `mesh.matrix` itself each
 * frame from the actor's frame and the instance's own offset (`local`).
 */
export function createFxSystem(
  fx: FxInstancePayload, objectMatrix: THREE.Matrix4,
  litTint: { value: THREE.Color } = WHITE_TINT,
): FxSystem {
  const batch = createFxBatch(fx, litTint) as Member;
  batch.addCopy();
  const mesh = batch.pool.mesh;
  mesh.matrix.multiplyMatrices(objectMatrix, batch.local);
  return { mesh, update: (s) => batch.update(s), dispose: () => batch.dispose() };
}
