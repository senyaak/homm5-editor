// Describe the SHAPE of a GroundTerrain.bin — what a reconstruction has to
// reproduce, and by which tools.
//
//   node tools/terrain-shape.ts <GroundTerrain.bin|dir> [...]
//
// The diff tool says how far apart two terrains are. This one says what a
// terrain is made of, which is the question you ask before trying to rebuild
// it: how much of it is flat default ground, how much sits on whole steps that
// the plateau brush can reach, and how much is smoothed to values no sequence
// of steps lands on. The discrete part (tiers, ramps, water, passability) is
// reproducible by construction; the continuous part is what needs a tool that
// can set a height outright.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseTerrain, readHeights, readGroundFlags, readPassability, readTextureLayers,
  readWaterPlane, tierOf, RAMP_BIT,
} from '../src/terrain.ts';

const args = process.argv.slice(2);
if (!args.length) {
  console.error('usage: node tools/terrain-shape.ts <GroundTerrain.bin|dir> [...]');
  process.exit(2);
}

/** One step between tiers, in world units — see docs/TERRAIN_FORMAT.md. */
const STEP = 2.0;
/** A blank map is flat here. */
const FLAT = 2.0;

const pct = (n: number, total: number): string => `${((100 * n) / total).toFixed(1)}%`;

for (const arg of args) {
  const path = existsSync(arg) && statSync(arg).isDirectory() ? join(arg, 'GroundTerrain.bin') : arg;
  if (!existsSync(path)) { console.error(`no such file: ${path}`); process.exit(2); }

  const t = parseTerrain(readFileSync(path));
  const h = readHeights(t), flags = readGroundFlags(t), pass = readPassability(t);
  const N = h.length;

  console.log(`\n${path}`);
  console.log(`  ${t.tiles}x${t.tiles} tiles, ${readTextureLayers(t).length} texture layers`);

  // --- heights -------------------------------------------------------------
  let min = Infinity, max = -Infinity, atFlat = 0, onStep = 0;
  const uniq = new Map<number, number>();
  for (const v of h) {
    if (v < min) min = v;
    if (v > max) max = v;
    if (v === FLAT) atFlat++;
    // "On a step" = a value the plateau/raise brushes can land on exactly.
    if (Math.abs(v / STEP - Math.round(v / STEP)) < 1e-4) onStep++;
    uniq.set(v, (uniq.get(v) ?? 0) + 1);
  }
  console.log(`  heights ${min.toFixed(3)} .. ${max.toFixed(3)}, ${uniq.size} distinct values over ${N} vertices`);
  console.log(`    still at the blank's ${FLAT.toFixed(1)}: ${atFlat} (${pct(atFlat, N)})`);
  console.log(`    on a whole ${STEP.toFixed(1)} step:     ${onStep} (${pct(onStep, N)})  <- reachable by stepping brushes`);
  console.log(`    smoothed off the step grid:  ${N - onStep} (${pct(N - onStep, N)})  <- needs an exact-height tool`);
  const common = [...uniq].sort((a, b) => b[1] - a[1]).slice(0, 6);
  console.log(`    most common: ${common.map(([v, n]) => `${v.toFixed(3)}×${n}`).join('  ')}`);

  // --- tiers and ramps -----------------------------------------------------
  if (flags) {
    const byFlag = new Map<number, number>();
    for (const v of flags) byFlag.set(v, (byFlag.get(v) ?? 0) + 1);
    const parts = [...byFlag].sort((a, b) => b[1] - a[1])
      .map(([v, n]) => `${v}=tier ${tierOf(v)}${v & RAMP_BIT ? '+ramp' : ''} ×${n}`);
    console.log(`  ground flags: ${parts.join(', ')}`);
  }

  // --- water ---------------------------------------------------------------
  const water = readWaterPlane(t);
  if (water) {
    let wet = 0;
    for (const v of water.data) if (v) wet++;
    console.log(`  river plane: ${wet}/${water.data.length} non-zero (${pct(wet, water.data.length)})`);
  } else console.log('  river plane: none');

  // --- passability ---------------------------------------------------------
  if (pass) {
    let blocked = 0;
    for (const v of pass) if (v === 0) blocked++;
    console.log(`  passability: ${blocked} blocked tiles (${pct(blocked, pass.length)})`);
  } else console.log('  passability: NO PLANE (a blank map has none — see docs/TERRAIN_FORMAT.md)');
}
