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
// time on the one clock, a batch — one ParticleInstance payload — draws once
// for all its copies: the quad instances run particles × copies, the copy is
// `gl_InstanceID % capacity`, its matrix is fetched from a small float
// texture with a row per copy, and a copy past `uCopies` collapses to nothing.
//
// What is left for the CPU each frame is the TRIGGER TRAIN (below): which
// copies of the recording are playing and at which frame each is. That is at
// most eight (frame, first entry, count) segments handed over as uniforms;
// the shader finds its segment by cumulative count.
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
// break the single draw call.

import * as THREE from 'three';
import type { FxInstancePayload } from '#src/scene/payload.ts';
import type { FxTransfer } from '#src/scene/effects.ts';

/**
 * One effect, simulated once and drawn for every copy of it on a floor.
 *
 * Copies are slots: `addCopy` hands one out, `setCopyMatrix` places it (the
 * object's matrix times the instance's own offset — or a bone's, every frame,
 * for a glued one), `removeCopy` gives it back. The batch draws nothing until
 * it has a copy, and is disposed by whoever removes the last.
 */
export interface FxBatch {
  mesh: THREE.Mesh;
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
 * actors' fires and a shot's spells by writing `mesh.matrix` itself. A batch of
 * one copy at the identity, so the mesh matrix IS the copy's placement.
 */
export interface FxSystem {
  mesh: THREE.Mesh;
  /** Advance to `seconds` on the shared clock. */
  update(seconds: number): void;
  dispose(): void;
}

/** Spare slots a new batch is born with, so placing a few copies does not rebuild it. */
const COPY_HEADROOM = 8;

const loadImg = (src: string): Promise<HTMLImageElement | null> =>
  new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });

/**
 * The instance's frame table as two square-ish atlases (colour + alpha) and
 * their grid shape. Two, because the frames travel as separate colour/alpha
 * images: a browser canvas premultiplies, so colour under alpha 0 — which is
 * exactly what fire IS in this art — would arrive black in a single image.
 */
async function buildAtlas(
  textures: ({ c: string; a: string } | null)[], cell = 128, rawColor = false,
): Promise<{ tex: THREE.Texture; alpha: THREE.Texture; cols: number; rows: number }> {
  const cols = Math.max(1, Math.ceil(Math.sqrt(textures.length)));
  const rows = Math.max(1, Math.ceil(textures.length / cols));
  const make = async (pick: (t: { c: string; a: string }) => string, srgb: boolean): Promise<THREE.Texture> => {
    const cv = document.createElement('canvas');
    cv.width = cols * cell; cv.height = rows * cell;
    const cx = cv.getContext('2d');
    if (cx) {
      for (let i = 0; i < textures.length; i++) {
        const t = textures[i];
        if (!t) continue; // empty slot stays transparent
        const img = await loadImg(pick(t));
        if (img) cx.drawImage(img, (i % cols) * cell, Math.floor(i / cols) * cell, cell, cell);
      }
    }
    const tex = new THREE.CanvasTexture(cv);
    if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
    // The atlas is sampled per tile; letting mips blend neighbouring tiles in
    // smears every frame with its neighbours at distance.
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    return tex;
  };
  // A static system's colour stays RAW: its texel goes to the framebuffer
  // as-authored (the terrain's gamma convention). Decoded as sRGB it would be
  // re-encoded on the way out and the grass would brighten past the game's.
  return { tex: await make((t) => t.c, !rawColor), alpha: await make((t) => t.a, false), cols, rows };
}

/** Entries per texture row: the width is `TABLE_ROW × 3` texels, well under any GPU's limit. */
const TABLE_ROW = 1024;
const TABLE_W = TABLE_ROW * 3;

// The copy this quad instance belongs to, and its matrix — a row of four
// texels in uMat. A slot past the copies in use draws nothing: its corner
// scale is zeroed, so the quad has no area.
//
// And the particle: instance / capacity counts through the segments the CPU
// handed over this frame — segment k is entries uSegBase[k] … of the table,
// uSegEnd[k] particles in from the start — to an entry, three texels wide.
const COPY = `
uniform sampler2D uMat;
uniform int uCapacity;
uniform int uCopies;
uniform sampler2D uTable;
uniform int uSegs;
uniform int uSegBase[8];
uniform int uSegEnd[8];
int copyIndex() { return gl_InstanceID % uCapacity; }
mat4 copyMatrix(int c) {
  return mat4(texelFetch(uMat, ivec2(0, c), 0), texelFetch(uMat, ivec2(1, c), 0),
              texelFetch(uMat, ivec2(2, c), 0), texelFetch(uMat, ivec2(3, c), 0));
}
int entryIndex() {
  int pi = gl_InstanceID / uCapacity;
  int start = 0;
  for (int k = 0; k < 8; k++) {
    if (k >= uSegs) break;
    if (pi < uSegEnd[k]) return uSegBase[k] + (pi - start);
    start = uSegEnd[k];
  }
  return 0;
}
struct Particle { vec3 center; vec3 sizeRot; vec4 color; float tex; };
Particle particle(int e) {
  ivec2 t = ivec2((e % ${TABLE_ROW}) * 3, e / ${TABLE_ROW});
  vec4 a = texelFetch(uTable, t, 0);
  vec4 b = texelFetch(uTable, t + ivec2(1, 0), 0);
  vec4 c = texelFetch(uTable, t + ivec2(2, 0), 0);
  return Particle(a.xyz, vec3(b.xy, a.w), c, b.z);
}`;

const VERT = `
out vec2 vUv;
out vec4 vColor;
out float vTex;
${COPY}
void main() {
  int ci = copyIndex();
  Particle P = particle(entryIndex());
  vec4 c = viewMatrix * modelMatrix * copyMatrix(ci) * vec4(P.center, 1.0);
  float cr = cos(P.sizeRot.z), sr = sin(P.sizeRot.z);
  vec2 corner = position.xy * P.sizeRot.xy * (ci < uCopies ? 1.0 : 0.0);
  c.xy += vec2(corner.x * cr - corner.y * sr, corner.x * sr + corner.y * cr);
  gl_Position = projectionMatrix * c;
  vUv = uv;
  vColor = P.color;
  vTex = P.tex;
}`;

// A STANDING system (derived from its bake in createFxSystem — every particle
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
  int ci = copyIndex();
  Particle P = particle(entryIndex());
  vec3 center = (modelMatrix * copyMatrix(ci) * vec4(P.center, 1.0)).xyz;
  vec3 toCam = cameraPosition - center;
  vec2 h = toCam.xy;
  h = dot(h, h) > 1e-8 ? normalize(h) : vec2(1.0, 0.0);
  vec3 rightW = vec3(-h.y, h.x, 0.0);
  float cr = cos(P.sizeRot.z), sr = sin(P.sizeRot.z);
  vec2 corner = (position.xy - 0.5 * uPivot) * P.sizeRot.xy * (ci < uCopies ? 1.0 : 0.0);
  vec2 rc = vec2(corner.x * cr - corner.y * sr, corner.x * sr + corner.y * cr);
  vec3 world = center + rightW * rc.x + vec3(0.0, 0.0, 1.0) * rc.y;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  vUv = uv;
  vColor = P.color;
  vTex = P.tex;
}`;

const FRAG = `
precision highp float;
uniform sampler2D uAtlas;  // frame colour, opaque
uniform sampler2D uAlpha;  // frame alpha, as gray
uniform vec2 uGrid; // cols, rows
uniform vec3 uTint; // scene light on an L_LIT instance; white when unlit
in vec2 vUv;
in vec4 vColor;
in float vTex;
out vec4 outColor;
void main() {
  if (vTex < -0.5) discard; // hidden frame
  float t = floor(vTex + 0.5);
  float col = mod(t, uGrid.x), row = floor(t / uGrid.x);
  // Canvas row 0 is the TOP; the texture is flipY'd, so v counts from the
  // bottom — a tile on canvas row r spans v rows [rows-1-r, rows-r].
  vec2 uv = vec2(col + vUv.x, (uGrid.y - 1.0 - row) + vUv.y) / uGrid;
  vec4 s = vec4(texture(uAtlas, uv).rgb, texture(uAlpha, uv).r);
  // The era's particle pipeline in two lines. Colour: modulate-x2 (baked
  // colours are authored around 128 = full brightness — the ghost dragon's
  // mist peaks at 57), faded by the baked alpha curve. Blend (see the
  // material): ONE / ONE_MINUS_SRC_ALPHA with STRAIGHT colour, so rgb is
  // what a texel ADDS and alpha is what it OCCLUDES — fire painted on black
  // with a zero alpha channel is purely additive, smoke with real alpha
  // covers, and one instance can mix both kinds of frame. No blending
  // heuristic; this is the art's own convention.
  vec3 rgb = s.rgb * vColor.rgb * 2.0 * vColor.a * uTint;
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
uniform sampler2D uAtlas;
uniform sampler2D uAlpha;
uniform vec2 uGrid;
in vec2 vUv;
in vec4 vColor;
in float vTex;
out vec4 outColor;
void main() {
  if (vTex < -0.5) discard;
  float t = floor(vTex + 0.5);
  float col = mod(t, uGrid.x), row = floor(t / uGrid.x);
  vec2 uv = vec2(col + vUv.x, (uGrid.y - 1.0 - row) + vUv.y) / uGrid;
  vec4 s = vec4(texture(uAtlas, uv).rgb, texture(uAlpha, uv).r);
  float a = s.a * vColor.a;
  if (a < 0.01) discard;
  outColor = vec4(s.rgb * a, a);
}`;

/** Strides of the flat [frame, ...values] channel arrays. */
const STRIDE = { pos: 4, rot: 2, size: 3, color: 5, tex: 2 } as const;
type Chan = keyof typeof STRIDE;

/**
 * One recording, sampled frame by frame and laid out for the GPU.
 *
 * Entry `e` is three RGBA16F texels: `x y z rot`, `w h tex −`, `r g b a`.
 * Frame `f`'s alive particles are the entries `base[f] .. base[f] + count[f]`;
 * hidden ones (tex −1) are left out, as the sampler left them out. Shared by
 * uid across every instance and copy that plays the effect, and reference-
 * counted so the last batch to go takes the texture with it.
 */
export interface FxTable {
  tex: THREE.DataTexture;
  base: Int32Array;
  count: Int32Array;
  /** Frames the table has: the recording's whole length, 0 … frames-1. */
  frames: number;
  entries: number;
  refs: number;
}
const tables = new Map<string, FxTable>();

/** The table for a uid — baked on first use, shared after. Pair with releaseTable. */
function tableFor(uid: string, baked: FxTransfer): FxTable {
  const have = tables.get(uid);
  if (have) { have.refs++; return have; }
  const t0 = performance.now();
  const t = bakeTable(baked);
  tables.set(uid, t);
  const ms = performance.now() - t0;
  if (ms > 20) console.log(`[perf] fx table ${uid.slice(0, 8)}: ${t.entries} entries over ${t.frames} frames in ${ms | 0}ms`);
  return t;
}

function releaseTable(uid: string): void {
  const t = tables.get(uid);
  if (!t || --t.refs > 0) return;
  t.tex.dispose();
  tables.delete(uid);
}

/** What the tables hold right now — for view.perf(). */
export function fxTableStats(): { tables: number; entries: number; bytes: number } {
  let entries = 0, bytes = 0;
  for (const t of tables.values()) { entries += t.entries; bytes += (t.tex.image.data as Uint16Array).byteLength; }
  return { tables: tables.size, entries, bytes };
}

/**
 * Sample every frame of a recording into a table.
 *
 * Walks the frames in order with a cursor per particle and channel, exactly
 * as the per-frame sampler did — the same lerp between the same keys, at the
 * recording's own integer frames. Two passes: count the entries so the
 * texture is allocated once, then fill.
 */
export function bakeTable(baked: FxTransfer): FxTable {
  const parts = baked.particles;
  const frames = Math.max(1, Math.ceil(baked.duration * baked.rate));
  const base = new Int32Array(frames + 1), count = new Int32Array(frames);
  // Particles sorted by birth: frame f's candidates are a prefix of this order,
  // and a particle whose death has passed is skipped, not scanned twice.
  const order = [...parts.keys()].sort((a, b) => parts[a]!.birth - parts[b]!.birth);
  let entries = 0, born = 0;
  for (let f = 0; f < frames; f++) {
    while (born < order.length && parts[order[born]!]!.birth <= f) born++;
    let c = 0;
    for (let i = 0; i < born; i++) {
      const p = parts[order[i]!]!;
      if (f > p.death) continue;
      // Hidden frames are decided by the tex channel alone — it is stepped, so
      // the value at f is the last key at or before it.
      if (texAt(p.tex, f) < 0) continue;
      c++;
    }
    base[f] = entries; count[f] = c; entries += c;
  }
  base[frames] = entries;
  const rows = Math.max(1, Math.ceil(entries / TABLE_ROW));
  const data = new Uint16Array(TABLE_W * rows * 4);
  const cursors = { pos: new Int32Array(parts.length), rot: new Int32Array(parts.length), size: new Int32Array(parts.length), color: new Int32Array(parts.length), tex: new Int32Array(parts.length) };
  const v: number[] = [0, 0, 0, 0];
  const half = THREE.DataUtils.toHalfFloat;
  let e = 0;
  born = 0;
  for (let f = 0; f < frames; f++) {
    while (born < order.length && parts[order[born]!]!.birth <= f) born++;
    for (let i = 0; i < born; i++) {
      const pi = order[i]!, p = parts[pi]!;
      if (f > p.death) continue;
      const ch = (name: Chan, arr: Float32Array, lerp: boolean): void => {
        cursors[name][pi] = sample(arr, STRIDE[name], cursors[name][pi]!, f, v, lerp);
      };
      ch('tex', p.tex, false);
      if (v[0]! < 0) continue;
      const o = e * 12;
      data[o + 6] = half(v[0]!);
      ch('pos', p.pos, true);
      data[o] = half(v[0]!); data[o + 1] = half(v[1]!); data[o + 2] = half(v[2]!);
      ch('rot', p.rot, true);
      data[o + 3] = half(v[0]!);
      ch('size', p.size, true);
      data[o + 4] = half(Math.abs(v[0]!)); data[o + 5] = half(Math.abs(v[1]!));
      ch('color', p.color, true);
      data[o + 8] = half(v[0]! / 255); data[o + 9] = half(v[1]! / 255);
      data[o + 10] = half(v[2]! / 255); data[o + 11] = half(v[3]! / 255);
      e++;
    }
  }
  const tex = new THREE.DataTexture(data, TABLE_W, rows, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return { tex, base, count, frames, entries, refs: 1 };
}

/** The tex channel's value at frame f: stepped, so the last key at or before f. */
function texAt(a: Float32Array, f: number): number {
  let k = 0;
  while ((k + 1) * 2 < a.length && a[(k + 1) * 2]! <= f) k++;
  return a[k * 2 + 1]!;
}

/**
 * Sample a flat channel at frame `f`, linearly interpolated, into `out`
 * starting at `at`. `cur` is this channel's cursor (last key at or before f),
 * advanced in place — frames only move forward between calls until the loop
 * wraps and the caller resets it.
 */
function sample(a: Float32Array, stride: number, cur: number, f: number, out: number[], lerp: boolean): number {
  const keys = a.length / stride;
  while (cur + 1 < keys && a[(cur + 1) * stride]! <= f) cur++;
  const k0 = cur * stride, k1 = Math.min(cur + 1, keys - 1) * stride;
  const f0 = a[k0]!, f1 = a[k1]!;
  const t = lerp && f1 > f0 ? Math.min(1, Math.max(0, (f - f0) / (f1 - f0))) : 0;
  for (let i = 1; i < stride; i++) out[i - 1] = a[k0 + i]! + (a[k1 + i]! - a[k0 + i]!) * t;
  return cur;
}

/** The unlit instances' fixed tint — one shared object, never mutated. */
const WHITE_TINT = { value: new THREE.Color(1, 1, 1) };

export function createFxBatch(
  fx: FxInstancePayload, baked: FxTransfer, litTint: { value: THREE.Color } = WHITE_TINT,
): { batch: FxBatch; ready: Promise<void> } {
  // STANDING SCENERY, derived from the bake rather than from any XML flag
  // (the instances' <Static> says P_STATIC on all 2709 shipped and separates
  // nothing): a system whose every particle exists for the whole loop and
  // never moves a channel, with enough of them to be a patch of vegetation
  // rather than a lone glow card. The terrain-object grass is 33 one-key
  // blade clumps; a portal's still glow is 1-2 cards and stays a billboard.
  // Standing quads get the upright shader and the texel's own colour —
  // moving effects (fire, surf, wall crashes) keep the billboard path.
  const recFramesAll = baked.duration * baked.rate;
  const standing = baked.particles.length >= 8 && baked.particles.every((p) =>
    p.birth <= 0 && p.death >= recFramesAll - 1
    && p.pos.length <= 4 && p.rot.length <= 2 && p.size.length <= 3
    && p.color.length <= 5 && p.tex.length <= 2);
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
  // Copies of the recording alive at once become the shader's segments, of
  // which there are 8: the library maxes out at 6 (adventure-reachable), and
  // 8 caps a hypothetical pathological file, not anything observed.
  const table = tableFor(fx.uid, baked);
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
  // Nothing per instance in the geometry: a quad instance finds its particle
  // in the table and its copy in the matrix texture from gl_InstanceID alone.
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.getAttribute('position'));
  geo.setAttribute('uv', uv);
  geo.instanceCount = 0;
  let capacity = 1 + COPY_HEADROOM;
  // A row of four texels per copy: its matrix, column by column.
  let matData = new Float32Array(capacity * 16);
  let matTex = makeMatrixTexture(matData, capacity);

  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: standing ? VERT_STATIC : VERT,
    fragmentShader: standing ? FRAG_STATIC : FRAG,
    uniforms: {
      uAtlas: { value: null },
      uAlpha: { value: null },
      uGrid: { value: new THREE.Vector2(1, 1) },
      // Shared by reference: the app mutates the lit tint in place when the
      // preset (or the Light toggle) changes, like the terrain uniforms.
      uTint: fx.lit ? litTint : WHITE_TINT,
      uMat: { value: matTex },
      uCapacity: { value: capacity },
      uCopies: { value: 0 },
      uTable: { value: table.tex },
      uSegs: { value: 0 },
      uSegBase: { value: new Array<number>(8).fill(0) },
      uSegEnd: { value: new Array<number>(8).fill(0) },
      ...(standing ? { uPivot: { value: new THREE.Vector2(fx.pivot?.[0] ?? 0, fx.pivot?.[1] ?? 0) } } : {}),
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

  const mesh = new THREE.Mesh(geo, mat);
  // Positions live in the table and the copies all over the map: three.js
  // cannot know the bounds, and a culled fire that pops in at the screen edge
  // is worse than the cost of always issuing the draw.
  mesh.frustumCulled = false;
  // Identity: a copy's matrix carries its whole placement. The scene player
  // is the one caller that writes this matrix instead (createFxSystem).
  mesh.matrixAutoUpdate = false;
  const local = new THREE.Matrix4().compose(
    new THREE.Vector3(...(fx.pos as [number, number, number])),
    new THREE.Quaternion(fx.quat[0], fx.quat[1], fx.quat[2], fx.quat[3]),
    new THREE.Vector3(fx.scale, fx.scale, fx.scale),
  );
  mesh.renderOrder = 3; // over the water sheet and the ground overlay

  const ready = buildAtlas(fx.textures, 128, standing).then(({ tex, alpha, cols, rows }) => {
    mat.uniforms.uAtlas!.value = tex;
    mat.uniforms.uAlpha!.value = alpha;
    (mat.uniforms.uGrid!.value as THREE.Vector2).set(cols, rows);
  });

  // A finite train fires its copies once. On a clip-hung effect the engine
  // replays the whole effect every animation cycle — `retrigger` carries the
  // clip length — so the phoenix's one-burst wing whoosh repeats per flap.
  // An object effect's finite train really does play only once (7 instances
  // map-wide): a birth flash the editor shows at map open, then quiet. [~]
  const retrigger = copies !== Infinity && fx.retrigger ? fx.retrigger : 0;
  const segBase = mat.uniforms.uSegBase!.value as number[];
  const segEnd = mat.uniforms.uSegEnd!.value as number[];

  const batch: FxBatch = {
    mesh, fx, local, copies: 0, alive: 0,
    // The trigger train, as the sampler ran it: copies k whose recording is
    // under way at t, each at its own frame. Every alive copy is a segment of
    // the table; the shader draws them back to back.
    update(seconds: number) {
      if (!this.copies) return;
      // Every copy of an effect is at the same t. The per-placement phase
      // that used to be added here (so thirty campfires would not flicker in
      // step) was the editor's own invention, not the game's, and it was the
      // one thing that kept two copies of one effect from sharing a frame —
      // which is what lets them share a simulation (SLICE_fx_performance §3).
      let t = seconds - fx.offset;
      if (retrigger > 0) t = ((t % retrigger) + retrigger) % retrigger;
      const kMax = Math.min(Math.floor(t / period), copies - 1);
      const kMin = Math.max(0, Math.ceil((t - recPlaySec) / period));
      let segs = 0, total = 0;
      for (let k = kMin; k <= kMax && segs < 8; k++) {
        const f = Math.floor((t - k * period) * fx.speed * baked.rate);
        if (f < 0 || f >= table.frames) continue;
        const c = table.count[f]!;
        if (!c) continue;
        segBase[segs] = table.base[f]!;
        total += c;
        segEnd[segs] = total;
        segs++;
      }
      mat.uniforms.uSegs!.value = segs;
      this.alive = total;
      // Every alive particle, once per slot — the unused slots collapse in the
      // shader.
      geo.instanceCount = total * capacity;
    },
    addCopy() {
      if (this.copies === capacity) grow();
      const slot = this.copies++;
      matData.set(IDENTITY, slot * 16);
      matTex.needsUpdate = true;
      mat.uniforms.uCopies!.value = this.copies;
      return slot;
    },
    setCopyMatrix(slot, m) {
      matData.set(m.elements, slot * 16);
      matTex.needsUpdate = true;
    },
    copyMatrix(slot, out) {
      return out.fromArray(matData, slot * 16);
    },
    removeCopy(slot) {
      const last = --this.copies;
      mat.uniforms.uCopies!.value = this.copies;
      if (slot === last) return -1;
      matData.copyWithin(slot * 16, last * 16, last * 16 + 16);
      matTex.needsUpdate = true;
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
      geo.dispose();
      mat.dispose();
      matTex.dispose();
      releaseTable(fx.uid);
      (mat.uniforms.uAtlas!.value as THREE.Texture | null)?.dispose();
      (mat.uniforms.uAlpha!.value as THREE.Texture | null)?.dispose();
    },
  };

  /** Twice the slots: a wider matrix texture, and the instances count over it. */
  function grow(): void {
    const alive = geo.instanceCount / capacity;
    capacity *= 2;
    const wider = new Float32Array(capacity * 16);
    wider.set(matData);
    matData = wider;
    matTex.dispose();
    matTex = makeMatrixTexture(matData, capacity);
    mat.uniforms.uMat!.value = matTex;
    mat.uniforms.uCapacity!.value = capacity;
    geo.instanceCount = alive * capacity;
  }

  return { batch, ready };
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

/**
 * One copy of an effect whose placement is the mesh matrix — the scene
 * player's way of holding a system: it composes `mesh.matrix` itself each
 * frame from the actor's frame and the instance's own offset (`local`).
 */
export function createFxSystem(
  fx: FxInstancePayload, baked: FxTransfer, objectMatrix: THREE.Matrix4,
  litTint: { value: THREE.Color } = WHITE_TINT,
): { system: FxSystem; ready: Promise<void> } {
  const { batch, ready } = createFxBatch(fx, baked, litTint);
  batch.addCopy();
  batch.mesh.matrix.multiplyMatrices(objectMatrix, batch.local);
  return { system: batch, ready };
}
