// The GroundTerrain.bin writer — the whole container for a finished RMG
// run: N texture layers, the height plane, the ground flags, the zero
// plane, the water half-grid and the passability plane, framed the way
// the editor's save writes them.
//
// The framing generalises `terrain-blank.ts` from one layer to N, with
// the multi-layer counters read off the reference files and verified to
// the byte: each layer is [anchor + mask + path record], layers are
// separated by an `01 <E_next> 02 <F> 01` bridge (the header carries the
// FIRST layer's E), E_i = 2N + 2*len_i + 53, F = 2N + 35, and the
// header's D spans the whole layers region: D = 2*regionBytes + 3.
//
// The tail differs from a blank's trailer in one place: an editor-saved
// map carries a FULL passability plane in the 0x0f slot (a blank leaves
// it empty). The GAME's RMG never writes passability — it serializes the
// init-time all-ones — while the ordered references, being editor
// re-saves, carry the editor's scene-geometry derivation (docs/RMG.md);
// this writer emits the RMG's own all-ones unless told otherwise.

export interface TerrainFileInput {
  tiles: number;
  /** Priority order, paths with their xpointer — the file's identity. */
  layers: Array<{ path: string; mask: Uint8Array }>;
  /** The height plane in file orientation, (tiles+1)^2 floats. */
  heights: Float32Array;
  /** The ground flags, (tiles+1)^2 bytes. */
  flags: Uint8Array;
  /** The water half-grid, (2*(tiles+1)-1)^2 bytes; omit for all-dry. */
  water?: Uint8Array;
  /** The passability plane; omit for the RMG's all-ones. */
  passability?: Uint8Array;
}

const u32 = (n: number): Buffer => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0, 0); return b; };
const byte = (n: number): Buffer => Buffer.from([n & 0xff]);

/** The 16-byte anchor introducing a framed array (terrain-blank.ts). */
function anchor(dim: number, byteLen: number): Buffer {
  return Buffer.concat([byte(0x08), u32(dim), byte(0x02), byte(0x08), u32(dim), byte(0x03), u32(2 * byteLen + 1)]);
}

function wrapper(tag: number, byteLen: number): Buffer {
  return Buffer.concat([byte(tag), u32(2 * byteLen + 35), byte(0x01)]);
}

/** `03 <2(len+2)> 03 <2len>` + the path — single-byte prefixes. */
function pathRecord(path: string): Buffer {
  if (2 * (path.length + 2) > 0xff) throw new Error(`tile path too long: ${path}`);
  return Buffer.concat([
    byte(0x03), byte(2 * (path.length + 2)), byte(0x03), byte(2 * path.length),
    Buffer.from(path, 'latin1'),
  ]);
}

/** An empty `<tag>` framed sub-block, as the trailer holds them. */
function emptyBlock(tag: number): Buffer {
  return Buffer.concat([byte(tag), byte(0x18), byte(0x01), byte(0x08), u32(0), byte(0x02), byte(0x08), u32(0)]);
}

export function buildTerrainFile(input: TerrainFileInput): Buffer {
  const { tiles, layers } = input;
  if (!layers.length) throw new Error('a terrain file needs at least one layer');
  const V = tiles + 1;
  const N = V * V;
  const W = 2 * V - 1;
  const WN = W * W;
  const H4 = 4 * N;
  if (input.heights.length !== N) throw new Error(`heights: ${input.heights.length} != ${N}`);
  if (input.flags.length !== N) throw new Error(`flags: ${input.flags.length} != ${N}`);

  const F = 2 * N + 35;
  const E = (len: number): number => 2 * N + 2 * len + 53;

  // The layers region: `02 08 <count> 01 <E1> 02 <F> 01`, then per layer
  // the mask and its path, bridged by `01 <E_next> 02 <F> 01`.
  const region: Buffer[] = [
    byte(0x02), byte(0x08), u32(layers.length),
    byte(0x01), u32(E(layers[0]!.path.length)), byte(0x02), u32(F), byte(0x01),
  ];
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i]!;
    if (layer.mask.length !== N) throw new Error(`${layer.path}: mask ${layer.mask.length} != ${N}`);
    region.push(anchor(V, N), Buffer.from(layer.mask), pathRecord(layer.path));
    if (i + 1 < layers.length) {
      region.push(byte(0x01), u32(E(layers[i + 1]!.path.length)), byte(0x02), u32(F), byte(0x01));
    }
  }
  const layersRegion = Buffer.concat(region);
  const D = 2 * layersRegion.length + 1; // the blank's 2N+2len+75, generalised

  const heightData = Buffer.alloc(H4);
  for (let i = 0; i < N; i++) heightData.writeFloatLE(input.heights[i]!, i * 4);

  const body = Buffer.concat([
    layersRegion,
    byte(0x05), u32(2 * H4 + 35), byte(0x01), anchor(V, H4), heightData,
    wrapper(0x07, N), anchor(V, N), Buffer.from(input.flags),
    wrapper(0x08, N), anchor(V, N), Buffer.alloc(N, 0),
    wrapper(0x0a, WN), anchor(W, WN), input.water ? Buffer.from(input.water) : Buffer.alloc(WN, 0),
    emptyBlock(0x0d),
    byte(0x0e), byte(0x02), byte(0x00),
    wrapper(0x0f, N), anchor(V, N), input.passability ? Buffer.from(input.passability) : Buffer.alloc(N, 1),
    emptyBlock(0x10),
    Buffer.from([0x00, 0x00, 0x02, 0x00, 0x05, 0x00]),
  ]);

  // The header: format marker, the whole-file counters A/B, the two tile
  // dimensions and the layers-region counter D (all verified against the
  // reference files to the byte). A = 2*fileLen - 33, B = A - 10.
  const totalLen = 33 + body.length; // 33 fixed header bytes before the region
  const A = 2 * totalLen - 33;
  const header = Buffer.concat([
    byte(0x04), byte(0x08), u32(4),
    byte(0x01), u32(A),
    byte(0x01), u32(A - 10),
    byte(0x02), byte(0x08), u32(tiles),
    byte(0x03), byte(0x08), u32(tiles),
    byte(0x04), u32(D),
  ]);
  return Buffer.concat([header, body]);
}
