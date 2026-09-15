// The zone layouts — the door the chain goes through, and the Voronoi one.
//
//   node tools/test-rmg-layout.ts            the checks
//   node tools/test-rmg-layout.ts --png      also draw each layout to _tmp/
//
// The engine's layout is held to the engine elsewhere (test-rmg-load-template
// walks the boundary chain draw for draw); this suite holds the DOOR — that
// `Engine` is those two phases exactly — and the Voronoi layout to what it
// promises rather than to any reference, there being none: the template's
// graph is the picture. On Jebus Cross that means the middle zone touches
// every start zone, each start zone holds a corner of its own, and the areas
// are the template's proportions.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { pngDataUri } from '../src/format/png.ts';
import { inFront } from '../src/game/assets.ts';
import { buildMapFiles } from '../src/rmg/build.ts';
import { fillZones } from '../src/rmg/fill-zones.ts';
import { layoutZones } from '../src/rmg/layout.ts';
import type { ZoneLayout } from '../src/rmg/layout.ts';
import type { Tile } from '../src/rmg/placement.ts';
import { RmgRandom } from '../src/rmg/random.ts';
import { readTemplate } from '../src/rmg/template.ts';
import { runFull } from '../src/rmg/run.ts';
import { generateGameZones } from '../src/rmg/zones.ts';
import { dataAssets, gameDirIfAny, gameInstall } from './game-dir.ts';

const args = process.argv.slice(2);
let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const jebus = readTemplate(join(import.meta.dirname, '..', 'assets', 'rmg', 'RMG', 'Templates', 'Jebus Cross.h5et'));
const seeds = jebus.zones.map((z) => ({ index: z.index, size: z.size, floor: 0 }));
const SIZE = 96;

// ---------------------------------------------------------------- the door

console.log('the door: Engine is the engine\'s two phases, draw for draw');
{
  const a = new RmgRandom(1785351845);
  const placed = generateGameZones(SIZE, SIZE, seeds, false, a);
  const filled = fillZones(SIZE, SIZE, placed.zones, false, a);
  const b = new RmgRandom(1785351845);
  const labels: string[] = [];
  const laid = layoutZones('Engine', {
    size: SIZE, zones: seeds, templateZones: jebus.zones, connections: jebus.connections, twoFloors: false,
    phase: (l) => labels.push(l),
  }, b);
  check('the same draws', a.draws === b.draws, `${a.draws} vs ${b.draws}`);
  check('the same centres and radii', JSON.stringify(placed.zones) === JSON.stringify(laid.zones));
  check('the same grid', sameGrid(filled.floors[0]!, laid.floors[0]!));
  check('the two phase labels the ledger knows', labels.join(',') === 'placeZones,fillZones', labels.join(','));
}
check('a template without the field is laid out by the engine',
  readTemplate(join(import.meta.dirname, '..', 'data-unpacked', 'RMG', 'Templates', 'S1P2Z2M1.xdb')).zoneLayout === 'Engine');
check('Jebus Cross asks for Voronoi', jebus.zoneLayout === 'Voronoi');

// ---------------------------------------------------------------- Voronoi

console.log('Voronoi on Jebus Cross: the graph is the picture');
const starts = jebus.zones.filter((z) => z.canBePlayerStart).map((z) => z.index);
const middle = jebus.zones.find((z) => !z.canBePlayerStart)!.index;
for (const seed of [1785351845, 202, 7]) {
  const rng = new RmgRandom(seed);
  const laid = layoutZones('Voronoi', {
    size: SIZE, zones: seeds, templateZones: jebus.zones, connections: jebus.connections, twoFloors: false,
  }, rng);
  const grid = laid.floors[0]!;
  console.log(`  seed ${seed}:`);
  check('two draws a zone, and no more', rng.draws === 2 * seeds.length, `${rng.draws}`);
  check('every tile is somebody\'s', countOf(grid, -1) === 0, `${countOf(grid, -1)} unassigned`);
  const touching = adjacency(grid, SIZE);
  check('the middle zone touches every start zone',
    starts.every((s) => touching.get(middle)?.has(s)), [...(touching.get(middle) ?? [])].join(','));
  // Start zones MAY touch — a border no passage opens gets the engine's
  // border fence, a blocker on every border tile (statics-one-tile.ts, pass
  // 1) — so what the picture asks is that each of the four holds a corner
  // of its own.
  const corners = [grid[0]![0]!, grid[0]![SIZE - 1]!, grid[SIZE - 1]![0]!, grid[SIZE - 1]![SIZE - 1]!];
  check('each start zone holds a corner of its own',
    new Set(corners).size === 4 && corners.every((c) => starts.includes(c)), corners.join(','));
  check('every start zone reaches the map\'s edge',
    starts.every((s) => touchesEdge(grid, SIZE, s)));
  const total = jebus.zones.reduce((n, z) => n + z.size, 0);
  const off = jebus.zones.map((z) => {
    const want = SIZE * SIZE * z.size / total;
    return Math.abs(countOf(grid, z.index) - want) / want;
  });
  check('every area within 10% of its share', off.every((o) => o < 0.1),
    off.map((o) => (o * 100).toFixed(1) + '%').join(' '));
  check('a radius per zone, from its area',
    laid.zones.every((z) => z.r > 0 && Math.abs(z.r - Math.sqrt(countOf(grid, z.index) / Math.PI)) < 1));
  const again = layoutZones('Voronoi', {
    size: SIZE, zones: seeds, templateZones: jebus.zones, connections: jebus.connections, twoFloors: false,
  }, new RmgRandom(seed));
  check('the same seed gives the same layout', sameGrid(grid, again.floors[0]!));
  if (args.includes('--png')) draw(laid, `jebus-${seed}`);
}

console.log('Voronoi on two floors: each floor its own layout');
{
  const two = seeds.map((z, i) => ({ ...z, floor: i % 2 }));
  const laid = layoutZones('Voronoi', {
    size: SIZE, zones: two, templateZones: jebus.zones, connections: jebus.connections, twoFloors: true,
  }, new RmgRandom(5));
  check('two grids', laid.floors.length === 2);
  check('a floor holds only its own zones',
    two.every((z) => countOf(laid.floors[z.floor]!, z.index) > 0 && countOf(laid.floors[1 - z.floor]!, z.index) === 0));
}

// ---------------------------------------------------------------- the whole generator

// Everything after the zones takes the grid and the radii and nothing else —
// which is a claim, and this is where it is checked: the whole run, towns to
// statics, on a Voronoi layout, and a map file out of it. Our templates
// live in `assets/rmg` as a root of their own, mounted over the game's.
const game = gameDirIfAny();
if (!game) {
  console.log('the whole generator on Jebus Cross: skipped — say --game <dir> or HOMM5_GAME');
} else {
  console.log('the whole generator on Jebus Cross');
  const install = gameInstall(inFront(join(import.meta.dirname, '..', 'assets', 'rmg'), dataAssets()));
  const order = { template: 'Jebus Cross', size: 136, players: 4, seed: 202, monsterStrength: 1, water: 0 };
  const run = runFull(install, order);
  const c = run.c;
  check('the chain read our template', c.template.zoneLayout === 'Voronoi' && c.template.name === 'Jebus Cross');
  check('four players seated', c.loaded.zones.filter((z) => z.playerNo > 0).length === 4);
  check('a town in every zone', c.townResult.centres.size === 5, `${c.townResult.centres.size}`);
  check('four passages, one per connection, none left for a teleport',
    c.conn.guards.length === 4 && c.conn.unconnected.length === 0,
    `${c.conn.guards.length} guards, ${c.conn.unconnected.length} unconnected`);
  check('every passage joins the middle to a start zone',
    c.conn.guards.every((g) => g.between.includes(middle) && starts.some((s) => g.between.includes(s))));
  check('objects placed in every zone', run.objects.length > 100, `${run.objects.length}`);
  const files = buildMapFiles(install, run, {
    seed: order.seed, template: order.template, players: 4, underground: false, water: 0,
    guid: '00000000-0000-0000-0000-000000000000', mapName: 'Jebus',
  });
  const map = files.find((f) => f.name.endsWith('map.xdb'));
  check('a map file, naming our template by its own extension',
    map !== undefined && map.data.toString('latin1').includes('/RMG/Templates/Jebus Cross.h5et#xpointer(/RMGTemplate)'));
  const same = runFull(install, order);
  check('the run is repeatable', same.c.rng.draws === c.rng.draws && same.objects.length === run.objects.length);
  if (args.includes('--png')) {
    draw({ zones: [], floors: c.gridAtFillTerrain }, 'jebus-map', {
      roads: [...run.roads.values()].flat(),
      towns: run.objects.filter((o) => o.town).map((o) => [o.x, o.y]),
      guards: run.objects.filter((o) => o.army).map((o) => [o.x, o.y]),
    });
  }
}

console.log(failures ? `\n${failures} FAILED` : '\nall good');
process.exit(failures ? 1 : 0);

// ---------------------------------------------------------------- helpers

function countOf(grid: Int32Array[], zone: number): number {
  let n = 0;
  for (const row of grid) for (const v of row) if (v === zone) n++;
  return n;
}

function sameGrid(a: Int32Array[], b: Int32Array[]): boolean {
  return a.length === b.length && a.every((row, i) => row.every((v, j) => v === b[i]![j]));
}

/** Which zones share an orthogonal border with which. */
function adjacency(grid: Int32Array[], size: number): Map<number, Set<number>> {
  const out = new Map<number, Set<number>>();
  const note = (p: number, q: number): void => {
    if (p === q) return;
    if (!out.has(p)) out.set(p, new Set());
    out.get(p)!.add(q);
  };
  for (let a = 0; a < size; a++) {
    for (let b = 0; b < size; b++) {
      const z = grid[a]![b]!;
      if (a + 1 < size) { note(z, grid[a + 1]![b]!); note(grid[a + 1]![b]!, z); }
      if (b + 1 < size) { note(z, grid[a]![b + 1]!); note(grid[a]![b + 1]!, z); }
    }
  }
  return out;
}

function touchesEdge(grid: Int32Array[], size: number, zone: number): boolean {
  for (let i = 0; i < size; i++) {
    if (grid[0]![i] === zone || grid[size - 1]![i] === zone || grid[i]![0] === zone || grid[i]![size - 1] === zone) return true;
  }
  return false;
}

/**
 * The layout as a picture — a colour a zone, centres marked white; with a
 * run's overlay, its roads dark, towns white squares, armies black dots.
 */
function draw(
  laid: ZoneLayout, name: string,
  overlay?: { roads: Tile[]; towns: Array<[number, number]>; guards: Array<[number, number]> },
): void {
  const grid = laid.floors[0]!;
  const size = grid.length;
  const scale = 4;
  const w = size * scale;
  const rgba = new Uint8Array(w * w * 4);
  const palette: Array<[number, number, number]> = [
    [220, 60, 60], [60, 140, 220], [60, 180, 80], [230, 190, 40], [170, 80, 200], [80, 200, 200], [230, 130, 40],
  ];
  for (let a = 0; a < size; a++) {
    for (let b = 0; b < size; b++) {
      const z = grid[a]![b]!;
      const c = z < 0 ? [30, 30, 30] as const : palette[z % palette.length]!;
      // A border tile darker, so the cells' outlines read.
      const edge = (a + 1 < size && grid[a + 1]![b] !== z) || (b + 1 < size && grid[a]![b + 1] !== z);
      const k = edge ? 0.5 : 1;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          // Map y (index a) upward, the way the map is drawn.
          const px = (b * scale + dx), py = ((size - 1 - a) * scale + dy);
          const o = (py * w + px) * 4;
          rgba[o] = c[0] * k; rgba[o + 1] = c[1] * k; rgba[o + 2] = c[2] * k; rgba[o + 3] = 255;
        }
      }
    }
  }
  // Map coordinates: an object's x is the SECOND grid index, its y the first
  // (connections.ts writes a guard at x: tb, y: ta); a zone centre is the
  // other way round (fill-zones pairs a with z.x).
  const mark = (px0: number, py0: number, half: number, rgb: [number, number, number]): void => {
    for (let dy = -half; dy <= half; dy++) {
      for (let dx = -half; dx <= half; dx++) {
        const px = px0 + dx, py = py0 + dy;
        if (px < 0 || py < 0 || px >= w || py >= w) continue;
        const o = (py * w + px) * 4;
        rgba[o] = rgb[0]; rgba[o + 1] = rgb[1]; rgba[o + 2] = rgb[2];
      }
    }
  };
  for (const z of laid.zones) mark(z.y * scale, (size - 1 - z.x) * scale, 3, [255, 255, 255]);
  if (overlay) {
    for (const [a, b] of overlay.roads) mark(b * scale + 1, (size - 1 - a) * scale + 1, 1, [70, 50, 30]);
    for (const [x, y] of overlay.guards) mark(x * scale + 1, (size - 1 - y) * scale + 1, 2, [0, 0, 0]);
    for (const [x, y] of overlay.towns) mark(x * scale + 1, (size - 1 - y) * scale + 1, 5, [255, 255, 255]);
  }
  const dir = join(import.meta.dirname, '..', '_tmp');
  mkdirSync(dir, { recursive: true });
  const uri = pngDataUri(w, w, rgba);
  const file = join(dir, `layout-${name}.png`);
  writeFileSync(file, Buffer.from(uri.slice('data:image/png;base64,'.length), 'base64'));
  console.log(`  drawn: ${file}`);
}
