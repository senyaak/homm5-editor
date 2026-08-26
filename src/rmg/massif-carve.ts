// The subterranean massif carve — `0xED11D0` on the terrain processor
// (`[[zone+0x134]+0x60]`), reached from every subterranean zone's vtable
// `+0x40` (`0xEC7050`/`0xEC4A50`/`0xEC92B0` are verbatim copies:
// recomputeRoom(0x3C, all) then a tail-jump here). DRAWLESS, and
// hardcoded to FLOOR 1 through the levels-vector base.
//
// The underground level carries two VERTEX grids, `(size+1)^2`, that the
// surface never touches after init (`0xEB2B60`: floor 1 starts byte 0x10
// / float 6.0, floor 0 byte 0x20 / float 36.0 — and 36/4 = 9.0 is the
// long-suspected surface height base): `level+0x24` the byte heights the
// rock tests read, `level+0x14` the float heights the map keeps. Both
// are ROW-INDEXED BY THE B AXIS — transposed against the tile grids,
// which for this port's flat layout means the ordinary `vy*(size+1)+vx`.
//
// The carve walks the 3x3-tile lattice (i over a/x, j over b/y, both
// from 1 to trunc(size/3)-2): wherever the 9x9 occupancy patch around a
// lattice cell is clean of the byte mask 0x3E (objects 2/4, roads
// 8/0x10/0x20 block; 0x40/0x80 and the truncated wider bits pass), it
// raises the 4x4 vertex block to rock (byte 0x20, float 36.0), smooths
// the 16 surrounding lattice cells (`0xEB27D0`, bilinear over the four
// fixed corners — lattice points are identity writes, so corners stay
// clean, but the float accumulation is order-dependent: block order and
// smooth-call order are copied exactly), and stamps the patch 0x40.
// One conversion pass then turns every cell that is EXACTLY 0x40 into 2
// — so only the FIRST subterranean zone's `+0x34` actually carves; every
// later zone's call scans an already-carved level and no-ops.
//
// An out-of-bounds corner READS the constant rock byte 0x20
// (`0x1093900`); out-of-bounds WRITES land in BSS sinks and never touch
// the grids, so the port skips them.

const fl = Math.fround;

export interface VertexHeights {
  /** `level+0x24` — byte heights, `(size+1)^2`, `vy*(size+1)+vx`. */
  bytes: Uint8Array;
  /** `level+0x14` — float heights, same layout. */
  floats: Float32Array;
}

/** `0xEB2B60` — floor 1 starts 0x10/18.0, floor 0 0x20/36.0. */
export function createVertexHeights(size: number, floor: number): VertexHeights {
  const n = (size + 1) * (size + 1);
  const bytes = new Uint8Array(n).fill(floor === 1 ? 0x10 : 0x20);
  const floats = new Float32Array(n).fill(floor === 1 ? 18.0 : 36.0);
  if (floor === 1) {
    // The reference's underground starts with a rock frame (writer not
    // yet located in the disasm — held to the reference measurement):
    // the LAST vertex line of each axis is plain wall (byte 0x20, float
    // 36), and the LOW edges carry a three-vertex ramp — floats linear
    // 36/30/24 by distance, bytes the smoother's own trunc interpolation
    // from 32 toward 16 (32, 26, 21). The gradient seen near the far
    // walls in the reference is not initial: it is the carve's smoothing
    // reading the wall line as a corner.
    const w = size + 1;
    const RAMP_BYTES = [0x20, 26, 21];
    const RAMP_FLOATS = [36.0, 30.0, 24.0];
    for (let vy = 0; vy <= size; vy++) {
      for (let vx = 0; vx <= size; vx++) {
        const d = vx === size || vy === size ? 0 : Math.min(vx, vy);
        if (d > 2) continue;
        bytes[vy * w + vx] = RAMP_BYTES[d]!;
        floats[vy * w + vx] = RAMP_FLOATS[d]!;
      }
    }
  }
  return { bytes, floats };
}

/**
 * `0xEB27D0` — one lattice cell's bilinear smooth. `u` is the b/y axis,
 * `v` the a/x axis; the four corners are read once (out of bounds reads
 * rock, 0x20) and the 3x3 interior is interpolated over them, the float
 * grid taking `(val - old) * 1.125` per write (exact in single
 * precision: an integer times 9, times 2, times 1/16).
 */
function smoothCell(size: number, h: VertexHeights, u0: number, v0: number): void {
  const w = size + 1;
  const corner = (u: number, v: number): number =>
    u >= 0 && u < w && v >= 0 && v < w ? h.bytes[u * w + v]! : 0x20;
  const g00 = corner(u0, v0);
  const g10 = corner(u0 + 3, v0);
  const g01 = corner(u0, v0 + 3);
  const g11 = corner(u0 + 3, v0 + 3);
  for (let m = 0; m <= 2; m++) {
    const u = u0 + m;
    for (let k = 0; k <= 2; k++) {
      const v = v0 + k;
      if (u < 0 || u >= w || v < 0 || v >= w) continue;
      const colL = (3 - m) * g00 + m * g10;
      const colR = (3 - m) * g01 + m * g11;
      const val = Math.trunc((colL * (3 - k) + colR * k) / 9);
      const old = h.bytes[u * w + v]!;
      h.floats[u * w + v] = fl(h.floats[u * w + v]! + fl(fl(fl((val - old) * 9) * 2) * fl(0.0625)));
      h.bytes[u * w + v] = val;
    }
  }
}

/** `0xED11D0` — the carve itself. Mutates occupancy and both height grids. */
export function carveMassif(size: number, occupancy: Uint8Array, heights: VertexHeights): void {
  const w = size + 1;
  const q = Math.trunc(size / 3) - 1;
  for (let i = 1; i < q; i++) {
    for (let j = 1; j < q; j++) {
      let dirty = false;
      for (let x = 3 * i - 3; x <= 3 * i + 5 && !dirty; x++) {
        for (let y = 3 * j - 3; y <= 3 * j + 5; y++) {
          if ((occupancy[y * size + x]! & 0x3e) !== 0) { dirty = true; break; }
        }
      }
      if (dirty) continue;
      for (let t = 0; t <= 3; t++) {
        for (let s = 0; s <= 3; s++) {
          heights.bytes[(3 * j + t) * w + (3 * i + s)] = 0x20;
          heights.floats[(3 * j + t) * w + (3 * i + s)] = 36.0;
        }
      }
      for (let u0 = 3 * j - 3; u0 <= 3 * j + 6; u0 += 3) {
        for (let v0 = 3 * i - 3; v0 <= 3 * i + 6; v0 += 3) {
          smoothCell(size, heights, u0, v0);
        }
      }
      for (let x = 3 * i - 3; x <= 3 * i + 5; x++) {
        for (let y = 3 * j - 3; y <= 3 * j + 5; y++) {
          occupancy[y * size + x] = 0x40;
        }
      }
    }
  }
  for (let k = 0; k < size * size; k++) {
    if (occupancy[k] === 0x40) occupancy[k] = 2;
  }
}
