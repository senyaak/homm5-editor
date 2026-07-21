// Synthesize a blank GroundTerrain.bin from scratch — the terrain half of "New Map".
//
// The container (see terrain.ts) is a stream of size-prefixed framed arrays. A
// freshly-created map — what the original editor writes for "New Map" before any
// editing — is the SIMPLEST possible instance of it, and that is what we build
// here. Decoded from the pristine blanks the editor exports at every size
// (72..320), cross-checked to be byte-identical and fully deterministic:
//
//   header(50) → Grass mask(N, all 0xFF) → [Grass tile path + height frame]
//   → height(N floats, all 2.0) → flags(N, all 16) → zero plane(N, all 0)
//   → water(W², all 0) → trailer(51)
//
// where V = tiles+1 vertices per side, N = V², W = 2V-1 (the half-tile water
// grid). Only three quantities scale with size — N, 4N (the float heights) and
// W² — so the whole file is `272 + 7·N + W²` bytes.
//
// Every length field is one of two forms, both verified across all seven sizes:
//   * an array's own size prefix  = 2·(byteLength) + 1
//   * the "block wrapper" before it = 2·(byteLength) + 35  (it wraps the 17-byte
//     framing plus the data; 2·17 + 1 = 35)
// and the header carries three running counters keyed off N (D, E, F below) plus
// the whole-file size A. Because a blank's structure is fixed, these reduce to
// closed forms in N — nothing guessed, and buildBlankTerrain(t) reproduces the
// editor's output for tile size t byte-for-byte (see tools/test-terrain-blank.ts).

// The single texture a blank floor paints everywhere, at full weight, plus its
// flat height and ground-tier flag. The surface is grass at the default ground
// level; a second (underground) floor is subterranean rock, one tier up.
const SURFACE = { tile: '/MapObjects/_(AdvMapTile)/Grass/Grass.xdb#xpointer(/AdvMapTile)', height: 2.0, flag: 16 };
const UNDERGROUND = { tile: '/MapObjects/_(AdvMapTile)/SubTerrain/SubTerrain.xdb#xpointer(/AdvMapTile)', height: 36.0, flag: 32 };

/** Which floor a blank terrain is for — picks the default tile, height and flag. */
export type BlankFloor = 'surface' | 'underground';

// The trailer — a small fixed epilogue (three empty framed sub-blocks + a 6-byte
// end marker). Identical, byte-for-byte, in every blank regardless of size.
const TRAILER = Buffer.from([
  0x0d, 0x18, 0x01, 0x08, 0x00, 0x00, 0x00, 0x00, 0x02, 0x08, 0x00, 0x00, 0x00, 0x00,
  0x0e, 0x02, 0x00,
  0x0f, 0x18, 0x01, 0x08, 0x00, 0x00, 0x00, 0x00, 0x02, 0x08, 0x00, 0x00, 0x00, 0x00,
  0x10, 0x18, 0x01, 0x08, 0x00, 0x00, 0x00, 0x00, 0x02, 0x08, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x02, 0x00, 0x05, 0x00,
]);

const u32 = (n: number): Buffer => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0, 0); return b; };
const byte = (n: number): Buffer => Buffer.from([n & 0xff]);

/** The 16-byte anchor introducing a framed array of `byteLen` bytes at dimension `dim`. */
function anchor(dim: number, byteLen: number): Buffer {
  return Buffer.concat([byte(0x08), u32(dim), byte(0x02), byte(0x08), u32(dim), byte(0x03), u32(2 * byteLen + 1)]);
}

/** A `<tag> <2·byteLen+35> 01` wrapper that precedes an array's anchor. */
function wrapper(tag: number, byteLen: number): Buffer {
  return Buffer.concat([byte(tag), u32(2 * byteLen + 35), byte(0x01)]);
}

/**
 * Build a blank terrain file for a map of `tiles`×`tiles` tiles (72, 96, 136,
 * 176, 216, 256, 320 — the New Map sizes). Flat, a single layer, everything
 * passable, no water. `floor` picks the surface (grass, height 2.0, tier 1) or
 * the underground (subterranean rock, height 36.0, tier 2) — the two blanks the
 * original editor writes for a fresh map. Returns those exact bytes.
 */
export function buildBlankTerrain(tiles: number, floor: BlankFloor = 'surface'): Buffer {
  const f = floor === 'underground' ? UNDERGROUND : SURFACE;
  const tileLen = f.tile.length; // latin1: the path is ASCII, so bytes === chars
  const V = tiles + 1;         // vertices per side
  const N = V * V;             // per-vertex plane length
  const W = 2 * V - 1;         // half-tile water grid side
  const WN = W * W;
  const H4 = 4 * N;            // height plane is N little-endian float32s

  // 209 fixed bytes + the tile-path string block (path + its 10 framing bytes).
  const fileLen = 209 + tileLen + 7 * N + WN;
  const A = 2 * fileLen - 33;  // whole-file running size
  const B = A - 10;
  // Header counters. D and E are cumulative sizes that scope the tile-path
  // string, so they carry a 2·tileLen term (grass: 2·63+75=201, 2·63+53=179).
  const D = 2 * N + 2 * tileLen + 75;
  const E = 2 * N + 2 * tileLen + 53;
  const F = 2 * N + 35;        // a u8 plane's block wrapper — independent of the path

  // Header (50 bytes): format/dimension counters and the layer count (1).
  const header = Buffer.concat([
    byte(0x04), byte(0x08), u32(4),
    byte(0x01), u32(A),
    byte(0x01), u32(B),
    byte(0x02), byte(0x08), u32(tiles),
    byte(0x03), byte(0x08), u32(tiles),
    byte(0x04), u32(D),
    byte(0x02), byte(0x08), u32(1),
    byte(0x01), u32(E),
    byte(0x02), u32(F),
    byte(0x01),
  ]);

  // The layer mask (full weight), then its tile-path string and the height
  // block's wrapper. The string prefix is `03 2·(len+2) 03 2·len` (single bytes;
  // the two blank tiles are well under 128 chars).
  const maskData = Buffer.alloc(N, 0xff);
  const tilePath = Buffer.concat([
    byte(0x03), byte(2 * (tileLen + 2)), byte(0x03), byte(2 * tileLen),
    Buffer.from(f.tile, 'latin1'),
    byte(0x05), u32(2 * H4 + 35), byte(0x01),       // height block wrapper
  ]);

  // Height: N float32s at the floor's flat level.
  const heightData = Buffer.alloc(H4);
  for (let i = 0; i < N; i++) heightData.writeFloatLE(f.height, i * 4);

  return Buffer.concat([
    header,
    anchor(V, N), maskData,
    tilePath,
    anchor(V, H4), heightData,
    wrapper(0x07, N), anchor(V, N), Buffer.alloc(N, f.flag), // ground flags (tier)
    wrapper(0x08, N), anchor(V, N), Buffer.alloc(N, 0),      // second u8 plane = 0
    wrapper(0x0a, WN), anchor(W, WN), Buffer.alloc(WN, 0),   // water = 0
    TRAILER,
  ]);
}

/** The tile sizes the New Map dialog offers (Tiny … Impossible). */
export const MAP_SIZES: number[] = [72, 96, 136, 176, 216, 256, 320];
