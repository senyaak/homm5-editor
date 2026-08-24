// The RMGParameters reader.
//
//   node tools/test-rmg-params.ts
//
// Runs against the game's real file — `RMG/Params/Default.xdb` is the only one
// shipped — because a reader tested on a fixture only proves it can read the
// fixture. Skips itself when there is no unpacked data, the way the rest of the
// suite does. The expected numbers are copied from the file, so this is the
// reader being held to the data rather than to itself.

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { readParams } from '../src/rmg/params.ts';
import { dataDir } from './game-dir.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const dir = join(dataDir(), 'RMG', 'Params');
if (!existsSync(dir)) {
  console.log('no unpacked RMG params — run `npm run unpack-data`; skipping');
  process.exit(0);
}

console.log('params');

const files = readdirSync(dir).filter((f) => f.endsWith('.xdb'));
check('Default.xdb is the only parameter file shipped', files.length === 1 && files[0] === 'Default.xdb',
  files.join(','));

const p = readParams(join(dir, 'Default.xdb'));

check('the file calls itself version 37', p.rmgVersion === 37, `${p.rmgVersion}`);

// The mine rings: each tier reaches further out from the town than the last.
check('tier-1 mines sit 7..20 tiles out', p.mine1LevelMinRadius === 7 && p.mine1LevelMaxRadius === 20);
check('tier-2 mines 15..40', p.mine2LevelMinRadius === 15 && p.mine2LevelMaxRadius === 40);
check('tier-3 mines 25..45', p.mine3LevelMinRadius === 25 && p.mine3LevelMaxRadius === 45);
check('the gold mine has the strongest guard', p.mineGoldGuardLevel === 18
  && p.mineGoldGuardLevel > p.mine2LevelGuardLevel && p.mine2LevelGuardLevel > p.mine1LevelGuardLevel);
check('a passage guard is level 2', p.connectionGuardLevel === 2);
check('and a lever guard starts from power 1000', p.basicLeverGuardPower === 1000);

check('teleports keep 2..10 tiles from the border', p.teleportMinBorderDistance === 2 && p.teleportMaxBorderDistance === 10);
check('junctions keep 5', p.junctionMinBorderDistance === 5);
check('treasure blocks stand 8 apart, 5 at the least', p.distBetweenTreasureBlocks === 8
  && p.minDistanceBetweenTreasureBlocks === 5);
check('a guard stack is 5..70 creatures', p.creatureMinStackAmount === 5 && p.creatureMaxStackAmount === 70);
check('scaled from a basic 25 within 6..100', p.creatureStackParams.basicAmount === 25
  && p.creatureStackParams.minAmount === 6 && p.creatureStackParams.maxAmount === 100);

// The underground lights.
const l = p.pointLightParams;
check('point lights: radius 40, spacing 11, z 2..7', l.zoneRadius === 40 && l.minDist === 11
  && l.zMin === 2 && l.zMax === 7);
check('thirteen colours to pick from', l.colors.length === 13, `${l.colors.length}`);
// 0.615686 has no exact float32 — the reader must store what the ENGINE stores,
// not what the file prints.
check('held in single precision', l.colors[0]!.y === Math.fround(0.615686), `${l.colors[0]!.y}`);
check('the first is the reddish one', l.colors[0]!.x === 1 && l.colors[0]!.y === l.colors[0]!.z);

// The references, kept verbatim down to their xpointer suffixes.
check('the default ground is Haven dark grass',
  p.defaultSurfaceTile === '/RMG/Tiles/Haven/Dark_Grass.xdb#xpointer(/AdvMapTile)', p.defaultSurfaceTile);
check('the underground floor is Dungeon subterrain',
  p.defaultSubterraTile === '/RMG/Tiles/Dungeon/SubTerrain.xdb#xpointer(/AdvMapTile)');
check('deep water has a tile and a bed', p.deepWaterTile.endsWith('Water.xdb#xpointer(/AdvMapTile)')
  && p.deepWaterBottom.endsWith('River-bed.xdb#xpointer(/AdvMapTile)'));
check('zone borders blend through the Necropolis dark ground at intensity 200',
  p.defaultTransitiveTile.includes('Necropolis/DarkGround') && p.transitiveTileIntensity === 200);

// The lists, counted: a parser that read the wrong Items reads the wrong count.
check('seven size names — one per entry of the CreateMap size table', p.mapSizeNames.length === 7,
  `${p.mapSizeNames.length}`);
check('five monster strength names', p.monsterStrenghtNames.length === 5);
check('five ground lights to draw from', p.groundTerrainLights.length === 5);
check('eight resource mine colours, all left black', p.resourceMineColors.length === 8
  && p.resourceMineColors.every((c) => c.x === 0 && c.y === 0 && c.z === 0));
check('eight water treasures', p.waterTreasures.length === 8);
check('an obelisk and a grail to place', p.obelisk.includes('Obelisk') && p.grail.includes('Graal'));

// Empty on purpose in the shipped file — a reader that invents entries here
// would hand a phase something the engine never saw.
check('Templates and MonsterLevelCoef ship empty', p.templates.length === 0 && p.monsterLevelCoef.length === 0);

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
