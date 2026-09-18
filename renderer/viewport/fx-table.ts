// A recording sampled into a table — the arithmetic of particles.ts's tables,
// kept apart from the textures and the scene so a worker can run it.

import { DataUtils } from 'three';
import type { FxTransfer } from '#src/scene/effects.ts';

/** A baked table before it is a texture: the texels, and per frame where its entries are. */
export interface FxTableData {
  /** RGBA16F texels, TABLE_W × rows. */
  data: Uint16Array;
  rows: number;
  base: Int32Array;
  count: Int32Array;
  frames: number;
  entries: number;
}

/** Entries per texture row: the width is `TABLE_ROW × 3` texels, well under any GPU's limit. */
export const TABLE_ROW = 1024;
export const TABLE_W = TABLE_ROW * 3;

/** Strides of the flat [frame, ...values] channel arrays. */
const STRIDE = { pos: 4, rot: 2, size: 3, color: 5, tex: 2 } as const;
type Chan = keyof typeof STRIDE;

/**
 * Sample every frame of a recording into a table.
 *
 * Walks the frames in order with a cursor per particle and channel, exactly
 * as the per-frame sampler did — the same lerp between the same keys, at the
 * recording's own integer frames. Two passes: count the entries so the
 * texture is allocated once, then fill.
 *
 * Pure arithmetic on typed arrays and nothing else, so that a worker can run
 * it (workers/bake.ts): the table for a long recording takes a quarter of a
 * second, and a map opens with dozens.
 */
export function bakeTableData(baked: FxTransfer): FxTableData {
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
  const half = DataUtils.toHalfFloat;
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
      // An angle, so it is written wrapped to (−π, π]: the shader takes its
      // cos and sin, which see no difference, and a half float holds 65504 at
      // most — the Storm Lord's Flow_Initial spins its particles to 28 million
      // radians, which clamped to that and warned 4900 times per map load.
      data[o + 3] = half(wrapAngle(v[0]!));
      ch('size', p.size, true);
      data[o + 4] = half(Math.abs(v[0]!)); data[o + 5] = half(Math.abs(v[1]!));
      ch('color', p.color, true);
      data[o + 8] = half(v[0]! / 255); data[o + 9] = half(v[1]! / 255);
      data[o + 10] = half(v[2]! / 255); data[o + 11] = half(v[3]! / 255);
      e++;
    }
  }
  return { data, rows, base, count, frames, entries };
}

const TAU = Math.PI * 2;
/** `a` brought into (−π, π]. */
function wrapAngle(a: number): number {
  const r = a - TAU * Math.round(a / TAU);
  return r <= -Math.PI ? r + TAU : r;
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
