// The height plane — the late pass `0xECF760` over all three reference
// runs, held to each reference GroundTerrain.bin's float plane bit for
// bit. The pass touches floor 0 only; the underground floor's heights
// are the massif carve's, already held by test-rmg-underground.
//
//   node tools/test-rmg-heights.ts
//
// The full runs replay through tools/rmg-run.ts, which collects every
// placement in the map's slot order — the pass needs the OBJECT LIST:
// the craters read the Inferno towns and dwellings, the footprint
// flatten reads every non-static object's shared tiles, and the
// mountain relief cones write the plane during the statics.
//
// The arithmetic is the EDITOR's x87 (double intermediates, one rounding
// per store) — see src/rmg/heights.ts; the surface plateau's 4,414 exact
// 9.0 vertices are the proof the game's SSE codegen could not leave.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { heightsToFile, latePass } from '../src/rmg/heights.ts';
import { parseTerrain, readHeights } from '../src/terrain/terrain.ts';
import type { ChainOptions } from './rmg-chain.ts';
import { runFull } from './rmg-run.ts';
import { dataDir } from './game-dir.ts';
import {
  REFERENCE_TERRAIN, REFERENCE_UG_TERRAIN, REFERENCE_WATER_TERRAIN,
} from './rmg-reference.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const dir = dataDir();
if (!existsSync(join(dir, 'RMG'))) {
  console.log('no unpacked RMG data — skipping');
  process.exit(0);
}

const RUNS: Array<{ label: string; options: ChainOptions; endDraws: number; terrain: string }> = [
  { label: 'surface', options: {}, endDraws: 92438, terrain: REFERENCE_TERRAIN },
  { label: 'water', options: { water: 2 }, endDraws: 65421, terrain: REFERENCE_WATER_TERRAIN },
  {
    label: 'underground', options: { template: 'S0-1P2Z2K3.1T', size: 72, underground: true },
    endDraws: 70799, terrain: REFERENCE_UG_TERRAIN,
  },
];

for (const run of RUNS) {
  console.log(`\nthe ${run.label} run`);
  const r = runFull(dir, run.options);
  const c = r.c;
  check(`the run ends on the traced ${run.endDraws}`, c.rng.draws === run.endDraws, `${c.rng.draws}`);

  latePass(r.heightPlane, {
    size: c.size, occupancy: c.occ, border: c.border,
    objects: r.objects,
  });
  const ours = heightsToFile(r.heightPlane);

  if (!existsSync(run.terrain)) {
    console.log(`  (no ${run.terrain} — the comparison half is skipped)`);
    continue;
  }
  const ref = readHeights(parseTerrain(readFileSync(run.terrain)));
  check('plane sizes agree', ref.length === ours.length, `${ref.length} vs ${ours.length}`);

  const a = new Uint32Array(ours.buffer, ours.byteOffset, ours.length);
  const bBytes = Float32Array.from(ref);
  const b = new Uint32Array(bBytes.buffer, bBytes.byteOffset, bBytes.length);
  let diffs = 0;
  let maxAbs = 0;
  const first: string[] = [];
  const V = c.size + 1;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    diffs++;
    const d = Math.abs(ours[i]! - ref[i]!);
    if (d > maxAbs) maxAbs = d;
    if (first.length < 8) {
      first.push(`(${i % V}:${Math.trunc(i / V)}) ours ${ours[i]} ref ${ref[i]}`);
    }
  }
  check('the height plane is bit-identical to the reference', diffs === 0,
    diffs ? `${diffs}/${a.length} differ, max |д| ${maxAbs}` : `${a.length} vertices`);
  for (const line of first) console.log(`    ${line}`);
  if (diffs && process.env['H5E_DBG_HEIGHTS']) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join('_tmp', `ours-heights-${run.label}.bin`),
      Buffer.from(ours.buffer, ours.byteOffset, ours.byteLength));
    console.log(`  (ours dumped to _tmp/ours-heights-${run.label}.bin)`);
  }
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
