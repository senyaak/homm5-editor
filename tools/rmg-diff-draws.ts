// Diff the engine's draw trace against the port's, draw by draw.
//
//   node tools/rmg-diff-draws.ts [--game <dir>]
//
// Reads the last run's `t*` lines out of bin/homm5-editor-rmg.log (written by
// the oracle when the config says `trace`), replays the same seed through the
// ported chain with the trace listener on, and names the FIRST draw where the
// two disagree — kind or value. For a jitter draw the port also knows which
// tile it was deciding, which is where the reading of the condition around it
// starts. The reference setup (template S1P2Z2M1, 2 players, size index 8,
// 96 tiles) is assumed — the same one every ordered run so far has used.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createMap } from '../src/rmg/create-map.ts';
import { fillZones } from '../src/rmg/fill-zones.ts';
import { loadTemplate } from '../src/rmg/load-template.ts';
import { mapSetup } from '../src/rmg/map-setup.ts';
import { readParams } from '../src/rmg/params.ts';
import { RmgRandom } from '../src/rmg/random.ts';
import { readTemplate } from '../src/rmg/template.ts';
import { generateGameZones } from '../src/rmg/zones.ts';
import { dataDir, gameDir } from './game-dir.ts';

const logPath = join(gameDir(), 'bin', 'homm5-editor-rmg.log');
if (!existsSync(logPath)) {
  console.error(`no ${logPath} — generate a map with \`trace\` in the oracle config first`);
  process.exit(1);
}

// The last run's lines: seed, then every draw in order.
let seed: number | null = null;
let engine: Array<{ kind: string; counter: number; value: number }> = [];
for (const line of readFileSync(logPath, 'latin1').split(/\r?\n/)) {
  const run = /^run seed (-?\d+) (\d+)$/.exec(line);
  if (run) {
    seed = Number(run[1]);
    engine = [];
  }
  const t = /^t([nb6f]) (\d+) (-?\d+)$/.exec(line);
  if (t) engine.push({ kind: t[1]!, counter: Number(t[2]), value: Number(t[3]) });
}
if (seed === null || engine.length === 0) {
  console.error('the log has no traced run — was `trace` in the config when the map was generated?');
  process.exit(1);
}
console.log(`engine: seed ${seed}, ${engine.length} draws traced`);

// The port's half, same seed, reference settings.
const template = readTemplate(join(dataDir(), 'RMG', 'Templates', 'S1P2Z2M1.xdb'));
const params = readParams(join(dataDir(), 'RMG', 'Params', 'Default.xdb'));
const rng = new RmgRandom(seed);
const port: Array<{ kind: string; value: number }> = [];
rng.onDraw = (kind, value) => port.push({ kind, value });
const jitterTiles = new Map<number, { sweep: number; a: number; b: number }>();

const made = createMap(template, { players: 2, size: 8 }, rng);
const setup = mapSetup(params, {}, rng);
const loaded = loadTemplate(template, {
  twoFloors: made.twoFloors,
  dwarvenUnderground: setup.dwarvenUnderground,
  water: setup.water,
  playerCount: made.players,
  mapSize: 96,
  pointLightZoneRadius: params.pointLightParams.zoneRadius,
}, rng);
const placed = generateGameZones(96, 96,
  loaded.zones.map((z) => ({ index: z.index, size: z.size, floor: z.floor })), made.twoFloors, rng);
fillZones(96, 96, placed.zones, made.twoFloors, rng, {
  // port.length is the index the NEXT draw will take — the jitter draw this
  // call announces.
  jitter: (sweep, a, b) => jitterTiles.set(port.length, { sweep, a, b }),
});
console.log(`port:   ${port.length} draws through FillZones`);

const describe = (i: number): string => {
  const context = jitterTiles.get(i);
  return context ? ` (port: sweep ${context.sweep}, tile ${context.a}:${context.b})` : '';
};

let diverged = -1;
const shared = Math.min(engine.length, port.length);
for (let i = 0; i < shared; i++) {
  if (engine[i]!.kind !== port[i]!.kind || engine[i]!.value !== port[i]!.value) { diverged = i; break; }
}

if (diverged === -1) {
  if (port.length <= engine.length) {
    console.log(`\nthe port matches the engine for all ${shared} draws it makes — FillZones ends aligned;`);
    console.log(`the engine goes on for ${engine.length - port.length} more (the phases not yet ported).`);
  } else {
    console.log(`\nno mismatch in ${shared} draws, but the PORT keeps drawing after the engine stopped —`);
    console.log(`${port.length - engine.length} extra, the first at index ${shared}${describe(shared)}`);
  }
  process.exit(0);
}

console.log(`\nFIRST DIVERGENCE at draw ${diverged + 1} (engine counter ${engine[diverged]!.counter}):`);
console.log(`  engine: t${engine[diverged]!.kind} value ${engine[diverged]!.value}`);
console.log(`  port:   t${port[diverged]!.kind} value ${port[diverged]!.value}${describe(diverged)}`);
console.log('\ncontext (engine | port):');
for (let i = Math.max(0, diverged - 5); i < Math.min(shared, diverged + 6); i++) {
  const mark = i === diverged ? ' <-- here' : '';
  console.log(`  #${i + 1}  t${engine[i]!.kind} ${engine[i]!.value}  |  t${port[i]!.kind} ${port[i]!.value}${describe(i)}${mark}`);
}
process.exit(1);
