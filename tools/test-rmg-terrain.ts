// FillTerrain — the texture masks, held to a real map's bytes.
//
//   node tools/test-rmg-terrain.ts
//
// The phase draws nothing, so the only oracle is the output: the reference
// editor run's GroundTerrain.bin (an ordered map of seed 1785351845). The
// chain runs every ported phase, paints, and the five land layers must
// match the file LAYER BY LAYER, byte for byte — the two road layers after
// them belong to the roads phase and are not ours yet.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createMap } from '../src/rmg/create-map.ts';
import { fillZones } from '../src/rmg/fill-zones.ts';
import { loadTemplate } from '../src/rmg/load-template.ts';
import { mapSetup } from '../src/rmg/map-setup.ts';
import { readParams } from '../src/rmg/params.ts';
import { readPresets, readTileInfo } from '../src/rmg/preset-table.ts';
import { RmgRandom } from '../src/rmg/random.ts';
import { readTemplate } from '../src/rmg/template.ts';
import { fillTerrain } from '../src/rmg/terrain.ts';
import { generateGameZones } from '../src/rmg/zones.ts';
import { parseTerrain, readMask, readTextureLayers } from '../src/terrain/terrain.ts';
import { dataDir } from './game-dir.ts';

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

console.log('the reference chain, painted');

const t = readTemplate(join(dir, 'RMG', 'Templates', 'S1P2Z2M1.xdb'));
const p = readParams(join(dir, 'RMG', 'Params', 'Default.xdb'));
const presets = readPresets(dir);
const transitive = p.defaultTransitiveTile ? readTileInfo(dir, p.defaultTransitiveTile) : null;
check('the transitive tile resolves to the Necropolis dark ground',
  transitive !== null && transitive.path.includes('Necropolis/DarkGround') && transitive.priority === 70,
  transitive?.path ?? 'null');

const rng = new RmgRandom(1785351845);
const made = createMap(t, { players: 2, size: 8 }, rng);
const setup = mapSetup(p, { monsterStrength: 1, water: false }, rng);
const lt = loadTemplate(t, {
  twoFloors: made.twoFloors, dwarvenUnderground: setup.dwarvenUnderground, water: setup.water,
  playerCount: made.players, mapSize: 96, pointLightZoneRadius: p.pointLightParams.zoneRadius,
}, rng);
const zones = generateGameZones(96, 96,
  lt.zones.map((z) => ({ index: z.index, size: z.size, floor: z.floor })), made.twoFloors, rng);
const filled = fillZones(96, 96, zones.zones, made.twoFloors, rng);

const before = rng.draws;
const layers = fillTerrain(96, 96, lt.zones, filled.floors, presets, transitive)[0]!;
check('the phase spends no draws', rng.draws === before, `${rng.draws - before}`);
// Four: Dunes twice over (two Academy zones share it), Cracked, Lava, and
// the transitive DarkGround. Dead_Land and the roads belong to the next phase.
check('four land layers painted', layers.length === 4, layers.map((l) => l.path).join(' '));
check('ordered by ascending priority', layers.every((l, i) => i === 0 || layers[i - 1]!.priority <= l.priority),
  layers.map((l) => l.priority).join(','));

console.log('\nagainst the real GroundTerrain.bin');

const reference = join('_tmp', 'oracle', 'run-3-editor', 'GroundTerrain.bin');
if (!existsSync(reference)) {
  console.log(`  no ${reference} — the byte diff needs the reference run; skipping`);
} else {
  const terr = parseTerrain(readFileSync(reference));
  const fileLayers = readTextureLayers(terr);
  // Matched by PATH: the roads phase interleaves its layers by priority
  // (Dead_Land at 60 lands between our 23 and 64), so position cannot align.
  check('our layers keep their relative order in the file', (() => {
    const idx = layers.map((l) => fileLayers.findIndex((fl) => fl.path === l.path));
    return idx.every((n) => n >= 0) && idx.every((n, i) => i === 0 || idx[i - 1]! < n);
  })(), layers.map((l) => `${l.path.split('/').pop()}@${fileLayers.findIndex((fl) => fl.path === l.path)}`).join(' '));

  // Dead_Land is Inferno's SECONDARY ROAD tile and still land-class, so the
  // roads phase repaints it INTO our masks later — stealing weight from Lava
  // wherever a road runs. Until roads are ported, a difference is legitimate
  // exactly where the file's Dead_Land is painted and only downward.
  const deadLand = fileLayers.find((x) => x.path?.includes('Dead_Land'));
  const deadMask = deadLand ? readMask(terr, deadLand) : null;

  for (const layer of layers) {
    const fl = fileLayers.find((x) => x.path === layer.path);
    if (!fl) { check(`${layer.path} exists in the file`, false); continue; }
    const fileMask = readMask(terr, fl);
    const ours = layer.mask;
    if (fileMask.length !== ours.length) {
      check(`${layer.path.split('/').pop()} mask matches`, false, `sizes ${fileMask.length}/${ours.length}`);
      continue;
    }
    let exact = 0;
    let roadExplained = 0;
    let unexplained = -1;
    for (let k = 0; k < ours.length; k++) {
      if (fileMask[k] === ours[k]) { exact++; continue; }
      if (deadMask && deadMask[k]! > 0 && ours[k]! >= fileMask[k]!) { roadExplained++; continue; }
      if (unexplained === -1) unexplained = k;
    }
    check(`${layer.path.split('/').pop()} mask matches, roads-in-waiting aside`, unexplained === -1,
      unexplained >= 0
        ? `vertex ${unexplained} (${Math.trunc(unexplained / 97)}:${Math.trunc(unexplained % 97)}): file ${fileMask[unexplained]} ours ${ours[unexplained]}`
        : roadExplained ? `${exact} exact, ${roadExplained} awaiting the roads phase` : 'byte-identical');
  }
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
