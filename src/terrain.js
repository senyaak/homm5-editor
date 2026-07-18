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
const u32 = (b, o) => b.readUInt32LE(o);

/**
 * Derive the vertex dimension V from the first framing group, so we don't need
 * the map's TileX/TileY from map-tag.xdb. Looks for `08 <u32 V> 02 08 <u32 V>`.
 * @returns {number} V (vertices per side), or -1 if not found.
 */
function detectVertexDim(b) {
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
export function parseTerrain(b) {
  const V = detectVertexDim(b);
  if (V < 0) throw new Error('Could not detect vertex dimension — not a recognized GroundTerrain.bin');
  const N = V * V;

  // Signature that begins a framing group's vertex-dim markers:
  //   01 08 <V> 02 08 <V>   (we anchor on the `08 <V> 02 08 <V>` core)
  const core = Buffer.alloc(11);
  core[0] = 0x08; core.writeUInt32LE(V, 1);
  core[5] = 0x02; core[6] = 0x08; core.writeUInt32LE(V, 7);

  const arrays = [];
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
    let elem, count;
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
export function readHeights(t) {
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
export function writeHeights(t, heights) {
  if (!t.height) throw new Error('No height plane located');
  if (heights.length !== t.height.count) {
    throw new Error(`height length ${heights.length} != expected ${t.height.count}`);
  }
  const out = Buffer.from(t.raw); // full copy
  for (let i = 0; i < heights.length; i++) out.writeFloatLE(heights[i], t.height.dataOff + i * 4);
  return out;
}

/** Convenience: height at tile-vertex (x,y). */
export const heightAt = (heights, V, x, y) => heights[y * V + x];

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
export function readTextureLayers(t) {
  const heightOff = t.height ? t.height.dataOff : Infinity;
  const layers = [];
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
export function readMask(t, layer) {
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
export function readGroundFlags(t) {
  if (!t.height) return null;
  const a = t.arrays.find((x) => x.elem === 'u8' && x.count === t.N && x.dataOff > t.height.dataOff);
  return a ? t.raw.subarray(a.dataOff, a.dataOff + a.len) : null;
}

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
export function readWaterPlane(t) {
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
      if (len === W * W) return { W, data: b.subarray(mark + 5, mark + 5 + len) };
    }
    idx += 1;
  }
  return null;
}
