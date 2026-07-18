// GroundTerrain.bin reader/writer for Heroes of Might & Magic 5 (Tribes of the East).
//
// Format reverse-engineered empirically (cross-checked against WindBell's 2009
// analysis on heroescommunity.com, TID=32009). The container is a stream of
// arrays, each introduced by a small "framing group":
//
//   <blockTag u8> <u32 sizeA>
//   01 08 <u32 V>            <- marker 01: vertex dimension (tiles+1)
//   02 08 <u32 V>            <- marker 02: vertex dimension again
//   03 <u32 sizeB>           <- marker 03: sizeB = 2*arrayByteLength + 1
//   <arrayByteLength bytes of raw data>
//
// Data is stored per VERTEX, so a T-tile map has (T+1)*(T+1) values per plane.
// Planes (per WindBell): Texture opacity layers (u8) + a .dds path string each,
// then Height (float32), then movement/water planes (u8): Plateau, Ramp,
// WaterDepth, Passable (+ a few extra planes present in ToE maps).
//
// This module locates every framing-anchored array exactly (length is
// self-described), which is all we need to safely read and patch Height — the
// plane WindBell notes is the only one with a *visual* effect on the map.

/** Read a little-endian u32. */
const u32 = (b: Buffer, o: number): number => b.readUInt32LE(o);

/** One self-describing array located in the container. */
export interface TerrainArray {
  tag: number;
  dataOff: number;
  len: number;
  elem: 'u8' | 'f32';
  count: number;
}

/** A texture layer: a per-vertex weight mask plus the tile it paints with. */
export interface TextureLayer {
  maskOff: number;
  count: number;
  path: string | null;
}

/** A parsed GroundTerrain.bin: every array located, nothing copied. */
export interface Terrain {
  /** Grid side in VERTICES (tiles + 1). */
  V: number;
  /** V * V — values per vertex-sized plane. */
  N: number;
  tiles: number;
  arrays: TerrainArray[];
  height: { dataOff: number; count: number } | null;
  raw: Buffer;
}


/**
 * Derive the vertex dimension V from the first framing group, so we don't need
 * the map's TileX/TileY from map-tag.xdb. Looks for `08 <u32 V> 02 08 <u32 V>`.
 * @returns {number} V (vertices per side), or -1 if not found.
 */
function detectVertexDim(b: Buffer): number {
  for (let o = 0; o + 12 <= b.length; o++) {
    if (b[o] !== 0x08) continue;
    const v = u32(b, o + 1);
    if (v < 2 || v > 4096) continue;
    // expect: 08 <v> 02 08 <v>
    if (b[o + 5] === 0x02 && b[o + 6] === 0x08 && u32(b, o + 7) === v) return v;
  }
  return -1;
}

/**
 * Parse a GroundTerrain.bin buffer into a locatable structure.
 * @param {Buffer} b
 * @returns {{
 *   V:number, N:number, tiles:number,
 *   arrays: Array<{tag:number, dataOff:number, len:number, elem:'u8'|'f32', count:number}>,
 *   height: {dataOff:number, count:number}|null,
 *   raw: Buffer,
 * }}
 */
export function parseTerrain(b: Buffer): Terrain {
  const V = detectVertexDim(b);
  if (V < 0) throw new Error('Could not detect vertex dimension — not a recognized GroundTerrain.bin');
  const N = V * V;

  // Signature that begins a framing group's vertex-dim markers:
  //   01 08 <V> 02 08 <V>   (we anchor on the `08 <V> 02 08 <V>` core)
  const core = Buffer.alloc(11);
  core[0] = 0x08; core.writeUInt32LE(V, 1);
  core[5] = 0x02; core[6] = 0x08; core.writeUInt32LE(V, 7);

  const arrays: TerrainArray[] = [];
  let idx = 0;
  while ((idx = b.indexOf(core, idx)) >= 0) {
    // After the 11-byte core comes marker `03 <u32 sizeB>` then the array.
    const mark03 = idx + 11;
    if (b[mark03] !== 0x03) { idx += 1; continue; }
    const sizeB = u32(b, mark03 + 1);
    const byteLen = (sizeB - 1) / 2;              // sizeB = 2*byteLen + 1
    if (!Number.isInteger(byteLen) || byteLen <= 0) { idx += 1; continue; }
    const dataOff = mark03 + 5;
    const tag = b[idx - 12] ?? -1;                // blockTag sits before sizeA (approx)
    let elem: TerrainArray['elem'], count: number;
    if (byteLen === N * 4) { elem = 'f32'; count = N; }
    else if (byteLen === N) { elem = 'u8'; count = N; }
    else { elem = 'u8'; count = byteLen; }
    arrays.push({ tag, dataOff, len: byteLen, elem, count });
    idx = dataOff + byteLen;                       // skip past the array data
  }

  const height = arrays.find((a) => a.elem === 'f32') ?? null;

  return { V, N, tiles: V - 1, arrays, height, raw: b };
}

/** Read the height plane as a Float32Array (copy). Index = y*V + x. */
export function readHeights(t: Terrain): Float32Array {
  if (!t.height) throw new Error('No height plane located');
  const out = new Float32Array(t.height.count);
  for (let i = 0; i < out.length; i++) out[i] = t.raw.readFloatLE(t.height.dataOff + i * 4);
  return out;
}

/**
 * Write a modified height plane back, returning a NEW buffer. All other bytes
 * are copied verbatim from the original, so the output differs from the input
 * only in the height plane's byte range.
 * @param {ReturnType<typeof parseTerrain>} t
 * @param {Float32Array|number[]} heights length must equal t.height.count
 */
export function writeHeights(t: Terrain, heights: Float32Array | number[]): Buffer {
  return writeTerrain(t, { heights });
}

/** Convenience: height at tile-vertex (x,y). */
export const heightAt = (heights: Float32Array | number[], V: number, x: number, y: number): number => heights[y * V + x]!;

/**
 * Read the terrain's texture layers. Each layer is a per-vertex u8 weight mask
 * (0..255 opacity) followed by the path to an `(AdvMapTile).xdb` that names the
 * ground texture (Grass, Dirt, StoneRoad, Sand, Water, …). The engine splats
 * these by weight to paint the ground — including roads.
 *
 * Only masks that appear BEFORE the height plane are texture layers; the u8
 * planes after height are movement data (Passable/Plateau/…), which carry no
 * tile path.
 *
 * @returns {{maskOff:number, count:number, path:string|null}[]}
 */
export function readTextureLayers(t: Terrain): TextureLayer[] {
  const heightOff = t.height ? t.height.dataOff : Infinity;
  const layers: TextureLayer[] = [];
  for (const a of t.arrays) {
    if (a.elem !== 'u8' || a.count !== t.N || a.dataOff >= heightOff) continue;
    // The AdvMapTile path is an ASCII run shortly after the mask data.
    const from = a.dataOff + a.len, to = Math.min(t.raw.length, from + 400);
    const m = t.raw.toString('latin1', from, to).match(/\/MapObjects\/_\(AdvMapTile\)\/[\x20-\x7e]+?\.xdb/);
    layers.push({ maskOff: a.dataOff, count: a.count, path: m ? m[0] : null });
  }
  return layers;
}

/** Read a layer's weight mask as a Uint8Array (view into the raw buffer). */
export function readMask(t: Terrain, layer: TextureLayer): Uint8Array {
  return t.raw.subarray(layer.maskOff, layer.maskOff + layer.count);
}

/**
 * Read the per-vertex ground-kind flags — the first vertex-sized u8 plane after
 * the height plane.
 *
 * Values seen across every shipped map: 0, 16, 32 (and rare combinations).
 * A map authored from scratch pins them down exactly — on Senya's map 12,
 * flag 0 covers precisely the 49 vertices at height 0, and flag 32 precisely
 * the 50 at height 5.05:
 *
 *   0  -> WATER. Terraforming's `lower` digs the ground to height 0 and marks
 *         it; the engine floods it. Confirmed across 59 of 232 shipped maps and
 *         corroborated by their names — BoatArena is 100% flag 0,
 *         SmallSpecialArena_Sea 66.7%, every Beach_* 43-53%.
 *   16 -> ordinary ground (the 2.0 default level).
 *   32 -> plateau, raised ground with cliff edges.
 *
 * This is what marks the SEA. The half-tile plane in readWaterPlane marks
 * painted RIVERS instead — the two are different features, and a map can have
 * either without the other (map 12 has sea and an entirely empty river plane).
 *
 * @returns {Uint8Array|null} length t.N, indexed y*V + x
 */
export function readGroundFlags(t: Terrain): Uint8Array | null {
  const a = groundFlagsPlane(t);
  return a ? t.raw.subarray(a.dataOff, a.dataOff + a.len) : null;
}

/** Locate the ground-flag plane without copying it — the write path needs its offset. */
export function groundFlagsPlane(t: Terrain): TerrainArray | null {
  const height = t.height;
  if (!height) return null;
  return t.arrays.find((x) => x.elem === 'u8' && x.count === t.N && x.dataOff > height.dataOff) ?? null;
}

/**
 * Read the passability plane: the THIRD vertex-sized u8 plane after height.
 * `0` marks a vertex you cannot walk onto, `1` one you can.
 *
 * Identified by what it correlates with across all 232 shipped maps, against a
 * 9.0% background rate of blocked vertices:
 *
 *   Sand/Sand_Rock          92.4%      a rock tile is a wall
 *   Grass/Rock_Floor_grass  75.5%
 *   steep drop (> 2 units)  25.0%      cliffs block
 *   Water/LavaFlow          26.4%      river brushes block 2-3x more than ground
 *   Water/Bog               24.6%
 *   sea (flag 0)             6.4%      BELOW background — flag 0 means NAVIGABLE,
 *                                       so there is nothing to block: boats cross it
 *
 * It is authored, not derived. Depth explains nothing: the bed being flat with
 * its bank or more than 1.5 below it gives 23.8% and 22.1% blocked, and every
 * bucket between sits within a point of that. Whether you can wade a river is a
 * decision the designer records here, not a consequence of how deep it looks.
 *
 * @returns {Uint8Array|null} length t.N, indexed y*V + x
 */
export function readPassability(t: Terrain): Uint8Array | null {
  const p = passabilityPlane(t);
  return p ? t.raw.subarray(p.dataOff, p.dataOff + p.len) : null;
}

/** Locate the passability plane without copying it. */
export function passabilityPlane(t: Terrain): TerrainArray | null {
  const height = t.height;
  if (!height) return null;
  const after = t.arrays.filter((x) => x.elem === 'u8' && x.count === t.N && x.dataOff > height.dataOff);
  // [0] is the ground flags, [1] a plane that is near-uniformly 0, [2] passability.
  return after[2] ?? null;
}

export const PASSABLE = 1;
export const BLOCKED = 0;

export const FLAG_WATER = 0;
export const FLAG_GROUND = 16;
export const FLAG_PLATEAU = 32;

/**
 * Locate the water plane — a u8 field on a HALF-TILE grid of (2V-1)², framed
 * like the other arrays but at its own dimension, which is why the vertex-sized
 * scan in parseTerrain skips it.
 *
 * It is the authoritative record of where water is: measured on A1M5, it is
 * non-zero on 91.7% of water-textured vertices and only 2.7% elsewhere. Values
 * are graded rather than binary (255 in open water, small values along the
 * edge), which is what gives the game its soft shorelines — the tile mask alone
 * only yields blocky tile-aligned ones, and misses water that was never painted
 * with the Water texture at all.
 *
 * @returns {{W:number, data:Uint8Array}|null}
 */
export function readWaterPlane(t: Terrain): { W: number; data: Uint8Array } | null {
  const p = waterPlane(t);
  return p ? { W: p.W, data: t.raw.subarray(p.dataOff, p.dataOff + p.len) } : null;
}

/** Locate the half-tile river plane without copying it. */
export function waterPlane(t: Terrain): { W: number; dataOff: number; len: number } | null {
  const b = t.raw;
  const W = 2 * t.V - 1;
  const core = Buffer.alloc(11);
  core[0] = 0x08; core.writeUInt32LE(W, 1);
  core[5] = 0x02; core[6] = 0x08; core.writeUInt32LE(W, 7);
  let idx = 0;
  while ((idx = b.indexOf(core, idx)) >= 0) {
    const mark = idx + 11;
    if (b[mark] === 0x03) {
      const len = (u32(b, mark + 1) - 1) / 2;
      if (len === W * W) return { W, dataOff: mark + 5, len };
    }
    idx += 1;
  }
  return null;
}

// --- writing -------------------------------------------------------------
//
// Every plane in the container is fixed-size and self-describing, and editing
// one never changes how many values it holds: a map is W×W vertices for its
// whole life. So writing is a byte-for-byte overwrite in place — no records
// move, no sizes are recomputed, and the output differs from the input only in
// the ranges we touched.
//
// The one edit that does NOT fit this model is painting with a tile the map has
// no layer for. That means inserting a new mask array plus its (AdvMapTile) path
// into the stream, shifting everything after it. Not supported yet; the palette
// marks which tiles a map already carries (`inMap`).

/** A set of plane edits to apply in one pass. Omitted planes are left alone. */
export interface TerrainEdit {
  /** Vertex heights, length t.N. */
  heights?: Float32Array | number[];
  /** Ground-kind flags, length t.N. See FLAG_WATER / FLAG_GROUND / FLAG_PLATEAU. */
  flags?: Uint8Array | number[];
  /** Per-layer weight masks, each length t.N. Layers come from readTextureLayers(). */
  masks?: { layer: TextureLayer; data: Uint8Array | number[] }[];
  /** The half-tile river plane, length (2V-1)². */
  water?: Uint8Array | number[];
  /** Passability, length t.N. See PASSABLE / BLOCKED. */
  passable?: Uint8Array | number[];
}

function expect(name: string, got: number, want: number): void {
  if (got !== want) throw new Error(`${name} length ${got} != expected ${want}`);
}

/**
 * Apply `edit` to a parsed terrain and return a NEW buffer.
 *
 * Lengths are checked against what the file declares rather than trusted: a
 * short mask would otherwise write into whatever record follows it, and the
 * result would still parse — a corruption that only shows up in game.
 */
export function writeTerrain(t: Terrain, edit: TerrainEdit): Buffer {
  const out = Buffer.from(t.raw); // full copy; every write below is in place

  if (edit.heights) {
    if (!t.height) throw new Error('No height plane located');
    expect('heights', edit.heights.length, t.height.count);
    for (let i = 0; i < edit.heights.length; i++) out.writeFloatLE(edit.heights[i]!, t.height.dataOff + i * 4);
  }

  if (edit.flags) {
    const p = groundFlagsPlane(t);
    if (!p) throw new Error('No ground-flag plane located');
    expect('flags', edit.flags.length, p.count);
    for (let i = 0; i < edit.flags.length; i++) out[p.dataOff + i] = edit.flags[i]!;
  }

  for (const { layer, data } of edit.masks ?? []) {
    expect(`mask ${layer.path ?? '?'}`, data.length, layer.count);
    for (let i = 0; i < data.length; i++) out[layer.maskOff + i] = data[i]!;
  }

  if (edit.passable) {
    const p = passabilityPlane(t);
    if (!p) throw new Error('No passability plane located');
    expect('passable', edit.passable.length, p.count);
    for (let i = 0; i < edit.passable.length; i++) out[p.dataOff + i] = edit.passable[i]!;
  }

  if (edit.water) {
    const p = waterPlane(t);
    if (!p) throw new Error('No river plane located');
    expect('water', edit.water.length, p.len);
    for (let i = 0; i < edit.water.length; i++) out[p.dataOff + i] = edit.water[i]!;
  }

  return out;
}
