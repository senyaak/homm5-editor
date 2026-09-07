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

import { DOUBLES, type Arith } from './arith.ts';

const fl = Math.fround;

export interface VertexHeights {
  /** `level+0x24` — byte heights, `(size+1)^2`, `vy*(size+1)+vx`. */
  bytes: Uint8Array;
  /** `level+0x14` — float heights, same layout. */
  floats: Float32Array;
}

/**
 * `0x874120` in the editor (`0xEB2B60` in the game) — the level grid's
 * constructor, run ONCE PER FLOOR at map-create time, long before any zone
 * exists. Its third argument is the surface flag: `push 1` for floor 0 and,
 * when the map has one, `push 0` for floor 1 (`0x8744C0`).
 *
 * THE FILL. Every one of the `(size+1)^2` vertices starts at the floor's own
 * value — the surface at byte 0x10 and float 6.0, the underground at 0x20 and
 * 36.0, which is ROCK. The surface is then left alone; the underground is
 * lowered.
 *
 * THE LOWERING, and the wall it leaves. Both loops run `0 .. size-1`, so the
 * vertex line at `size` is never written on either axis. Inside, a vertex
 * whose `min(vx, vy)` is under 3 takes the low-edge ramp — bytes
 * `0x10 + trunc(16*(3-m)/3)` and floats `((3-m)/3 + 1) * 18`, which are the
 * 32/26/21 and 36/30/24 measured off the references — and is NOT gated by
 * anything else. Every other vertex is opened to 0x10 / 18.0 only while BOTH
 * indices are below `3 * floor(size / 3)`:
 *
 *     0x874446  sub eax,edx          ; a - (a % 3)
 *     0x874448  cmp esi,eax
 *     0x87444a  jge <leave it rock>
 *
 * So the last `size mod 3` lines of each axis keep the constructor's rock, and
 * the wall is 2 vertices wide at size 176 and 1 at size 136 — which is exactly
 * what a map from the engine has and the port did not. It cost more than a
 * crumb: the subterranean one-tile pass reads this byte to decide whether a
 * tile is rock, so an open vertex is an object the port places and the engine
 * does not, and one extra object moves every draw after it.
 *
 * The carve only ever RAISES to rock, so this band survives it — which is why
 * a lava underground, the class that is never carved at all, shows it plainly.
 */
export function createVertexHeights(size: number, floor: number, ar: Arith = DOUBLES): VertexHeights {
  const n = (size + 1) * (size + 1);
  const underground = floor === 1;
  const bytes = new Uint8Array(n).fill(underground ? 0x20 : 0x10);
  const floats = new Float32Array(n).fill(underground ? 36.0 : 6.0);
  if (!underground) return { bytes, floats };

  const w = size + 1;
  const stop = 3 * Math.floor(size / 3);
  const RAMP_BYTES = [0x20, 26, 21];
  // `((3-m)/3 + 1) * 18`, operation by operation: 36/30/24 on the editor's
  // machine, and on the game's — every step chopped — 36, 29.999998 and
  // 23.999998, which is what its underground plane holds at every ramp
  // vertex (696 of them on a 176 map, all one ulp under, nothing else wrong).
  const RAMP_FLOATS = [0, 1, 2].map((m) => ar.store(ar.mul(ar.add(ar.div(3 - m, 3), 1), 18)));
  for (let vy = 0; vy < size; vy++) {
    for (let vx = 0; vx < size; vx++) {
      const m = Math.min(vx, vy);
      if (m < 3) {
        bytes[vy * w + vx] = RAMP_BYTES[m]!;
        floats[vy * w + vx] = RAMP_FLOATS[m]!;
      } else if (vx < stop && vy < stop) {
        bytes[vy * w + vx] = 0x10;
        floats[vy * w + vx] = 18.0;
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
function smoothCell(size: number, h: VertexHeights, u0: number, v0: number, ar: Arith): void {
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
      // The term is exact on either machine; the ADD is not — on a ramp
      // vertex already one ulp under (see the constructor) the game's chop
      // lands one ulp under again: 32.249996 where nearest gives 32.25.
      h.floats[u * w + v] = ar.store(ar.add(h.floats[u * w + v]!, fl(fl(fl((val - old) * 9) * 2) * fl(0.0625))));
      h.bytes[u * w + v] = val;
    }
  }
}

/** `0xED11D0` — the carve itself. Mutates occupancy and both height grids. */
export function carveMassif(
  size: number, occupancy: Uint8Array, heights: VertexHeights, ar: Arith = DOUBLES,
): void {
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
          smoothCell(size, heights, u0, v0, ar);
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
