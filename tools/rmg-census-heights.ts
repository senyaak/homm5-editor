// Every reference map's height plane against the port's, as CLUSTERS.
//
//   node tools/rmg-census-heights.ts                          the first sweep
//   node tools/rmg-census-heights.ts --dir game/bin/rmg-seed2 --seed 987654321
//   node tools/rmg-census-heights.ts --slot 13                just that one
//
// WHY A CENSUS AND NOT A TEST. `test-rmg-heights` holds three references, and
// three references lie: they were bit-identical through a whole month in which
// seven other templates were up to 5.7 units out. This walks every map a sweep
// generated and reports what differs, grouped into connected clusters with the
// peak of each named — because the debt has never once been scatter, and the
// SHAPE of a cluster is what says which pass owns it (a soft-edged disc on an
// Inferno town is the crater; a smooth bowl is the base field's dist term).
//
// WHAT A SLOT IS. `tools/rmg-batch.ts` writes one folder per order, numbered in
// the order given, and this reads the folder rather than a table: the template
// comes out of the slot's own `map.xdb`, the size out of its `GroundTerrain.bin`
// (the plane is (size+1)²), and a slot carrying an `UndergroundTerrain.bin` is
// re-run with the underground flag. So a sweep taken with a different order
// file needs no edit here — which is the whole reason this stopped being a
// scratch script: the hardcoded table it used to carry was already wrong for
// the second seed, whose slots are a different set in a different order.
//
// TWO NUMBERS PER MAP, because one of them hides the other. The clusters use a
// 1e-4 tolerance, which is the right lens for a debt with a shape - but it
// calls a one-ulp plane clean, and a one-ulp plane still writes a different
// `GroundTerrain.bin`. So every line also reports BIT inequality and the worst
// distance in ULPs. A map that is clean by clusters and not by bits has the
// arithmetic debt and nothing else.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { heightsToFile, latePass } from '../src/rmg/heights.ts';
import { parseTerrain, readHeights } from '../src/terrain/terrain.ts';
import { heightsInput, runFull } from './rmg-run.ts';
import { replayTerrain } from './rmg-build.ts';
import { dataDir, gameDir } from './game-dir.ts';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const dir = flag('dir') ?? join(gameDir(), 'bin', 'rmg-batch');
const seed = Number(flag('seed') ?? 1785351845);
const players = Number(flag('players') ?? 2);
const only = flag('slot') === undefined ? null : Number(flag('slot'));

if (!existsSync(dir)) {
  console.error(`no sweep at ${dir}`);
  process.exit(2);
}

/** One order's output, read back rather than remembered. */
interface Slot {
  n: number;
  template: string;
  size: number;
  underground: boolean;
  heights: Float32Array;
}

function readSlot(n: number): Slot | string {
  const at = join(dir, String(n));
  const terrainFile = join(at, 'GroundTerrain.bin');
  const mapFile = join(at, 'map.xdb');
  if (!existsSync(terrainFile) || !existsSync(mapFile)) return 'no GroundTerrain.bin / map.xdb';
  // The template is the only RMGTemplate href the document carries.
  const m = /([A-Za-z0-9_.\-]+)\.xdb#xpointer\(\/RMGTemplate\)/.exec(readFileSync(mapFile, 'latin1'));
  if (!m) return 'map.xdb names no template';
  const heights = readHeights(parseTerrain(readFileSync(terrainFile)));
  const v = Math.round(Math.sqrt(heights.length));
  if (v * v !== heights.length) return `plane of ${heights.length} is not square`;
  return {
    n, template: m[1]!, size: v - 1,
    underground: existsSync(join(at, 'UndergroundTerrain.bin')),
    heights,
  };
}

const slots = readdirSync(dir)
  .filter((name) => /^\d+$/.test(name))
  .map(Number)
  .sort((a, b) => a - b)
  .filter((n) => only === null || n === only);
if (!slots.length) {
  console.error(`${dir} holds no numbered slots`);
  process.exit(2);
}
console.log(`${dir}, seed ${seed}, ${slots.length} slot(s)\n`);

let clean = 0, exact = 0, failures = 0, worstAll = 0, totalAll = 0, ulpAll = 0;
for (const n of slots) {
  const t0 = Date.now();
  const slot = readSlot(n);
  if (typeof slot === 'string') {
    console.log(`slot ${String(n).padStart(2)} ${''.padEnd(18)}      SKIPPED — ${slot}`);
    continue;
  }
  let line = `slot ${String(slot.n).padStart(2)} ${slot.template.padEnd(18)} ${String(slot.size).padStart(3)}`;
  try {
    const run = runFull(dataDir(), {
      template: slot.template, size: slot.size, players, seed,
      monsterStrength: 1, water: 0, underground: slot.underground || undefined,
    });
    replayTerrain(dataDir(), run);
    latePass(run.heightPlane, heightsInput(run));
    const ours = heightsToFile(run.heightPlane);
    const theirs = slot.heights;
    const v = slot.size + 1;
    if (ours.length !== theirs.length) throw new Error(`plane ${ours.length} vs ${theirs.length}`);

    // Craters are named on the report because a cluster sitting on one is a
    // different story from a cluster in open ground.
    const craters = run.objects.filter((o) => o.craterTown || o.craterDwelling)
      .map((o) => [o.x, o.y, o.craterTown ? 8 : 2.5] as const);
    // The bit layer, which the 1e-4 clusters below cannot see.
    let bitDiffs = 0, worstUlp = 0;
    {
      const ob = new Uint32Array(ours.buffer, ours.byteOffset, ours.length);
      const tb = new Uint32Array(theirs.buffer, theirs.byteOffset, theirs.length);
      for (let i = 0; i < ob.length; i++) {
        if (ob[i] === tb[i]) continue;
        bitDiffs++;
        // Same sign and same exponent here, so the raw distance IS the ulp count.
        const d = Math.abs(ob[i]! - tb[i]!);
        if (d > worstUlp) worstUlp = d;
      }
    }

    const seen = new Uint8Array(v * v);
    const clusters: string[] = [];
    let total = 0, worst = 0;
    for (let y = 0; y < v; y++) {
      for (let x = 0; x < v; x++) {
        const i = y * v + x;
        if (seen[i] || Math.abs(theirs[i]! - ours[i]!) <= 1e-4) continue;
        const stack = [i];
        seen[i] = 1;
        let count = 0, peak = 0, px = x, py = y;
        const deltas: number[] = [];
        while (stack.length) {
          const j = stack.pop()!;
          const jx = j % v, jy = (j - jx) / v;
          const d = theirs[j]! - ours[j]!;
          count++;
          deltas.push(d);
          if (Math.abs(d) > Math.abs(peak)) { peak = d; px = jx; py = jy; }
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
            const nx = jx + dx, ny = jy + dy;
            if (nx < 0 || ny < 0 || nx >= v || ny >= v) continue;
            const k = ny * v + nx;
            if (!seen[k] && Math.abs(theirs[k]! - ours[k]!) > 1e-4) { seen[k] = 1; stack.push(k); }
          }
        }
        total += count;
        worst = Math.max(worst, Math.abs(peak));
        const flat = deltas.filter((d) => Math.abs(d - peak) < 1e-3).length;
        const onCrater = craters.some(([cx, cy, r]) => Math.hypot(cx - px, cy - py) <= r + 3);
        clusters.push(`${peak >= 0 ? '+' : ''}${peak.toFixed(3)}@(${px},${py}) n=${count}`
          + `${flat > count / 4 ? ' PLATEAU' : ''}${onCrater ? ' crater' : ''}`);
      }
    }
    totalAll += total;
    worstAll = Math.max(worstAll, worst);
    if (!total) clean++;
    if (!bitDiffs) exact++;
    ulpAll += bitDiffs;
    line += `  ${String(total).padStart(5)} vertices, worst ${worst.toFixed(4)}, ${clusters.length} clusters`;
    line += bitDiffs ? `; ${bitDiffs} differ in BITS, worst ${worstUlp} ulp` : '; bit-identical';
    const shown = clusters.slice(0, 6);
    if (shown.length) line += `\n        ${shown.join('\n        ')}`;
    if (clusters.length > shown.length) line += `\n        … ${clusters.length - shown.length} more`;
  } catch (e) {
    failures++;
    line += `  FAILED — ${(e as Error).message.slice(0, 90)}`;
  }
  console.log(`${line}   [${((Date.now() - t0) / 1000).toFixed(0)}s]`);
}
console.log(`\n${exact} of ${slots.length} planes BIT-identical`
  + `; ${clean} clean at 1e-4, ${totalAll} differing vertices there, worst ${worstAll.toFixed(4)}`
  + `; ${ulpAll} vertices differ in bits alone`
  + (failures ? `; ${failures} slot(s) the port could not run` : ''));
