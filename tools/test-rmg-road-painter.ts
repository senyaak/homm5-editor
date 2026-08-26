// The road painter — the last writer of GroundTerrain.bin, held to it whole.
//
//   node tools/test-rmg-road-painter.ts
//
// The chain replays through the first loop of MainObjects and the roads
// phase, so the occupancy carries the 0x08 and 0x10 networks; fillTerrain
// paints the land the way test-rmg-terrain already proves, and paintRoads
// then adds the road layers. From here the comparison needs no forgiveness:
// EVERY layer of the reference file, including Dead_Land's theft from Lava,
// must match byte for byte — the assertion test-rmg-terrain could only make
// with a roads-in-waiting escape hatch.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Tile } from '../src/rmg/placement.ts';
import { readTileInfo } from '../src/rmg/preset-table.ts';
import { buildZoneRoadsPhase } from '../src/rmg/roads-phase.ts';
import { fillTerrain, paintRoads } from '../src/rmg/terrain.ts';
import { floorIterationOrder } from '../src/rmg/zones.ts';
import { parseTerrain, readMask, readTextureLayers } from '../src/terrain/terrain.ts';
import { runChain, SIZE, ZoneFill } from './rmg-chain.ts';
import { dataDir } from './game-dir.ts';
import { hasReference, REFERENCE_MISSING, REFERENCE_TERRAIN } from './rmg-reference.ts';

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

const c = runChain(dir);
c.rng.next(); // the MainObjects prologue draw

console.log('the run through the roads phase, replayed');

const mineActives = new Map<number, Tile[]>();
for (const zone of [1, 2, 3, 4]) {
  const fill = new ZoneFill(c, zone);
  mineActives.set(zone, fill.mines().flatMap((m) => m.actives));
  fill.dwellings();
  fill.upgradeBuildings();
  fill.shrines();
  fill.resourceBuildings();
  fill.treasuryBuildings();
  fill.luckMorale();
  fill.shops();
  fill.observatories();
  fill.treasures();
  fill.chests();
  fill.road();
}
check('the first loop ends on the traced 20039', c.rng.draws === 20039, `${c.rng.draws}`);

const engineOrder = floorIterationOrder(c.loaded.zones.filter((z) => z.floor === 0));
for (const z of engineOrder) {
  const zone = c.zone(z.index);
  const centre = c.townResult.centres.get(z.index);
  buildZoneRoadsPhase({
    size: SIZE, grid: c.grid, border: c.border, occupancy: c.occ, zoneIndex: z.index,
    townEntry: zone.town && centre ? [centre.b, centre.a] : null,
    connectionPoints: (c.conn.passages.get(z.index) ?? []).map(([a, b]) => [b, a] as Tile),
    mineActives: mineActives.get(z.index) ?? [],
  }, c.rng);
}
check('the roads phase ends on the traced 20420', c.rng.draws === 20420, `${c.rng.draws}`);

console.log('\nthe terrain, painted land then roads');

const transitive = c.params.defaultTransitiveTile ? readTileInfo(dir, c.params.defaultTransitiveTile) : null;
const layers = fillTerrain(SIZE, SIZE, c.loaded.zones, [c.grid], c.presets, transitive)[0]!;
const before = c.rng.draws;

paintRoads(layers, SIZE, c.grid, c.occ, engineOrder.map((z) => {
  const preset = c.presets.get(c.loaded.zones.find((lz) => lz.index === z.index)!.terrainRace);
  return {
    zoneIndex: z.index,
    roadTile: preset?.roadTile ?? null,
    secondaryRoadTile: preset?.secondaryRoadTile ?? null,
  };
}));

check('the painter spends no draws', c.rng.draws === before, `${c.rng.draws - before}`);
check('seven layers painted', layers.length === 7, layers.map((l) => l.path.split('/').pop()).join(' '));

console.log('\nagainst the real GroundTerrain.bin, no forgiveness left');

if (!hasReference()) {
  console.log(`  ${REFERENCE_MISSING}`);
} else {
  const terr = parseTerrain(readFileSync(REFERENCE_TERRAIN));
  const fileLayers = readTextureLayers(terr);
  check('the file carries the same seven', fileLayers.length === layers.length, `${fileLayers.length}`);

  for (const fl of fileLayers) {
    const ours = layers.find((l) => l.path === fl.path);
    const short = fl.path?.split('/').pop() ?? '?';
    if (!ours) { check(`${short} painted by the port`, false); continue; }
    const fileMask = readMask(terr, fl);
    let bad = -1;
    let painted = 0;
    for (let k = 0; k < fileMask.length; k++) {
      if (fileMask[k]! > 0) painted++;
      if (fileMask[k] !== ours.mask[k] && bad === -1) bad = k;
    }
    check(`${short} byte-identical`, bad === -1,
      bad >= 0
        ? `vertex ${bad} (${Math.trunc(bad / 97)}:${bad % 97}): file ${fileMask[bad]} ours ${ours.mask[bad]}`
        : `${painted} painted vertices`);
  }
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
