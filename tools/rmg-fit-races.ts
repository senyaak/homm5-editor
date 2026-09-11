// Which race each random town STANDS AS in the engine's world — fitted per
// zone from the minimap, one zone at a time (their pixels do not overlap).
// This is the instrument that showed the world builds real towns for the
// placeholders (src/rmg/world-race.ts now derives the race; this measures it).
//
//   node tools/rmg-fit-races.ts --game <dir> [--game-build] <map.h5m | run folder>
import { join } from 'node:path';
import { buildMapFiles } from './rmg-build.ts';
import { readOrder } from './rmg-order.ts';
import { runFull } from './rmg-run.ts';
import { dataDir, gameDir } from './game-dir.ts';
import { RACE } from '../src/rmg/load-template.ts';

const argv = process.argv.slice(2);
const gameBuild = argv.includes('--game-build');
const args = argv.filter((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--game');
const map = args[0]!;
const read = readOrder(map); if (typeof read === 'string') throw new Error(read);
const { order, files: theirs } = read;
const LV = ['MONSTER_LEVEL_WEAK','MONSTER_LEVEL_MEDIUM','MONSTER_LEVEL_STRONG','MONSTER_LEVEL_VERY_STRONG','MONSTER_LEVEL_IMPOSSIBLE'];
const dir = dataDir();
const exe = join(gameDir(), 'bin', 'H5_Game_H5E.exe');
const captions = [...theirs.keys()].filter((n) => /^caption-text-\d+\.txt$/.test(n)).length;
const captionBase = Math.max(0, captions - order.players);

const RACES = [RACE.HEAVEN, RACE.PRESERVE, RACE.ACADEMY, RACE.DUNGEON, RACE.NECROMANCY, RACE.INFERNO, RACE.DWARF, RACE.STRONGHOLD];
const name = (r: number) => Object.entries(RACE).find(([, v]) => v === r)![0];

function minimapDiff(races: ReadonlyMap<number, number>): number {
  const run = runFull(dir, {
    gameBuild, players: order.players, seed: order.seed, template: order.template, size: order.size,
    underground: order.underground, water: order.water || undefined, monsterStrength: LV.indexOf(order.monster),
    resourceMultiplier: order.extras.resourceIndex, expMultiplier: order.extras.expIndex,
    grail: order.extras.grail, randomTowns: order.extras.randomTowns, randomTownRaceOverride: races,
  });
  const ours = buildMapFiles(dir, exe, run,
    { seed: order.seed, template: order.template, players: order.players, underground: order.underground, water: order.water,
      guid: order.guid, mapName: order.mapName, minimap: order.minimap, gameBuild, birds: order.birds }, { captionBase });
  let bytes = 0;
  for (const f of ours) {
    if (!f.name.startsWith('minimap_floor_') || !f.name.endsWith('.dds')) continue;
    const want = theirs.get(f.name)!;
    for (let i = 0; i < f.data.length; i++) if (f.data[i] !== want[i]) bytes++;
  }
  return bytes;
}

const probe = runFull(dir, { gameBuild, players: order.players, seed: order.seed, template: order.template, size: order.size,
  underground: order.underground, water: order.water || undefined, monsterStrength: LV.indexOf(order.monster),
  resourceMultiplier: order.extras.resourceIndex, expMultiplier: order.extras.expIndex, grail: order.extras.grail, randomTowns: order.extras.randomTowns });
const zones = probe.c.template.zones.map((z) => z.index).filter((z) => probe.c.townResult.townNames.has(z) || probe.c.zone(z).dwellings.some((n) => n > 0)).sort((a, b) => a - b);
console.log(`${map}: seed ${order.seed}, zones with towns ${zones.join(' ')}, baseline ${minimapDiff(new Map())} bytes`);
const chosen = new Map<number, number>();
for (const z of zones) {
  const scores = RACES.map((r) => { const m = new Map(chosen); m.set(z, r); return [r, minimapDiff(m)] as const; });
  scores.sort((a, b) => a[1] - b[1]);
  const best = scores[0]!;
  const ties = scores.filter((s) => s[1] === best[1]).map((s) => name(s[0]));
  console.log(`  zone ${z}: ${ties.join('/')} -> ${best[1]} bytes  (${scores.map((s) => `${name(s[0])}=${s[1]}`).join(' ')})`);
  chosen.set(z, best[0]);
}
console.log(`  final ${minimapDiff(chosen)} bytes: ${[...chosen].map(([z, r]) => `${z}:${name(r)}`).join(' ')}`);
