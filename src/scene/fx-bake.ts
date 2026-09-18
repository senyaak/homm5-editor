// A particle recording, baked where the scene is built.
//
// The renderer used to receive an effect's uid, fetch the recording's keys
// over their own IPC and sample them into a table in a worker of its own —
// which put the bake after the scene was on screen (the effects were silent
// for a second or two) and put arithmetic in the window that belongs with the
// decode. Now the payload carries the table: whoever makes a particle
// instance (object-effects.ts) asks here, once per recording file, and the
// answer travels with the scene like a texture does.

import { readFileSync } from 'node:fs';
import { transferEffect } from './effects.ts';
import type { FxTransfer } from './effects.ts';
import { bakeTableData } from './fx-table.ts';
import type { FxTableData } from './fx-table.ts';

/** A recording as the renderer plays it: its table, and what the batch needs to know about it. */
export interface FxBaked {
  /** Seconds, and frames a second — the recording's own rate. */
  duration: number;
  rate: number;
  /** Most particles alive on any one frame. */
  maxAlive: number;
  /**
   * STANDING SCENERY, derived from the bake rather than from any XML flag
   * (the instances' <Static> says P_STATIC on all 2709 shipped and separates
   * nothing): a system whose every particle exists for the whole loop and
   * never moves a channel, with enough of them to be a patch of vegetation
   * rather than a lone glow card. The terrain-object grass is 33 one-key
   * blade clumps; a portal's still glow is 1-2 cards and stays a billboard.
   * Standing quads get the upright shader and the texel's own colour —
   * moving effects (fire, surf, wall crashes) keep the billboard path.
   */
  standing: boolean;
  table: FxTableData;
}

/** Whether a recording is standing scenery — see FxBaked.standing. */
export function isStanding(baked: FxTransfer): boolean {
  const frames = baked.duration * baked.rate;
  return baked.particles.length >= 8 && baked.particles.every((p) =>
    p.birth <= 0 && p.death >= frames - 1
    && p.pos.length <= 4 && p.rot.length <= 2 && p.size.length <= 3
    && p.color.length <= 5 && p.tex.length <= 2);
}

/** One recording's bake, from its keys. */
export function bakeEffect(baked: FxTransfer): FxBaked {
  return { duration: baked.duration, rate: baked.rate, maxAlive: baked.maxAlive, standing: isStanding(baked), table: bakeTableData(baked) };
}

/**
 * The bake of the recording at `path` (`bin/effects/<uid>`), once per
 * process: a map names the same campfire two hundred times, and a shared
 * table object is one blob and one texture wherever it goes. Null when the
 * file holds no particles or cannot be read — the instance is dropped then,
 * as it was when the renderer got no keys.
 */
const baked = new Map<string, FxBaked | null>();
export function bakedEffect(path: string): FxBaked | null {
  let have = baked.get(path);
  if (have !== undefined) return have;
  try {
    const t = transferEffect(readFileSync(path));
    have = t.particles.length ? bakeEffect(t) : null;
  } catch { have = null; }
  baked.set(path, have);
  return have;
}
