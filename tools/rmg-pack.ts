// Generate a random map and write it as a `.h5m`.
//
//   node tools/rmg-pack.ts --game <dir> --seed 1785351845
//   node tools/rmg-pack.ts --game <dir> --seed 7 --template S0-1P2Z2K3.1T --size 72 --underground
//   node tools/rmg-pack.ts --game <dir> --seed 7 --water 2 --name "Two Isles" --out C:\tmp\isles.h5m
//
// This is the generator's last step and the first one that produces something
// playable: the phases are checked against the engine draw for draw, the
// documents against its own files byte for byte, and here they become the
// archive the game opens. The default output is `<game>/Maps/`, which is where
// the editor's own ordered runs land and where the game looks for a map.
//
// The archive's BYTES are not the engine's and cannot be: every entry carries
// the run's wall clock in its DOS stamp, and the engine's deflate beats zlib
// -9 on the minimap by a thousand bytes. What is the engine's is the entry
// set and every entry's contents — `test-rmg-pack` holds that line.

import { join } from 'node:path';

import { dialogChoices, generateMap, writeMap } from '../src/rmg/index.ts';
import { dataAssets, gameDir, gameInstall } from './game-dir.ts';

const install = gameInstall();
const choices = dialogChoices(install);
const MAP_SIZES = choices.sizes.map((s) => s.tiles);

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const num = (name: string): number | undefined => {
  const v = flag(name);
  return v === undefined ? undefined : Number(v);
};

const seed = num('seed');
if (seed === undefined || !Number.isFinite(seed)) {
  console.error('say which seed: --seed <n>  (everything else has a default; --help lists them)');
  process.exit(2);
}
if (args.includes('--help')) {
  console.log("--seed <n>            the order's seed (required)");
  console.log('--template <name>     default S1P2Z2M1');
  console.log(`--size <tiles>        one of ${MAP_SIZES.join(' ')}, default 96`);
  console.log('--underground         two floors');
  console.log("--water <0|1|2>       0 none, 2 island map — what the dialog's checkbox orders");
  console.log("--players <n>         default 2, inside the template's own range");
  console.log('--monsters <0..4>     MonsterLevel, default 1 (medium); it scales every guard');
  console.log('--resource <0..4>     ResourceMultiplier, default 2 (normal)');
  console.log('--exp <0..4>          ExpMultiplier, default 2 (normal)');
  console.log('--grail --random-towns --no-minimap   the three checkboxes');
  console.log('--name <text>         the map name, default "RMG <seed>"');
  console.log('--guid <G>            default random, as CoCreateGuid makes one');
  console.log('--out <file.h5m>      default <game>/Maps/<name>.h5m');
  process.exit(0);
}

const dir = dataAssets();
if (!dir.exists('RMG/Params/Default.xdb')) {
  console.error(`no RMG data in ${dir.roots.join(', ')} — unpack it with \`npm run unpack-data\` first`);
  process.exit(2);
}
const game = gameDir();

const template = flag('template') ?? 'S1P2Z2M1';
const size = num('size') ?? 96;
const sizeIndex = MAP_SIZES.indexOf(size);
if (sizeIndex < 0) {
  console.error(`--size ${size} is not one of the dialog's sizes: ${MAP_SIZES.join(' ')}`);
  process.exit(2);
}
const mapName = flag('name') ?? `RMG ${seed}`;
const order = {
  seed, template, sizeIndex, underground: args.includes('--underground'),
  water: num('water') ?? 0, players: num('players') ?? 2,
  monsterLevel: num('monsters') ?? 1, resourceMultiplier: num('resource') ?? 2, expMultiplier: num('exp') ?? 2,
  grail: args.includes('--grail'), randomTowns: args.includes('--random-towns'), minimap: !args.includes('--no-minimap'),
  mapName, guid: flag('guid'),
};

console.log(`generating ${template} ${size}x${size}, seed ${seed}, ${order.players} players`
  + `, monsters ${order.monsterLevel}${order.underground ? ', underground' : ''}${order.water ? `, water ${order.water}` : ''}`);
const map = generateMap(install, order);
console.log(`  ${map.draws} draws, ${map.objects} objects`);

const out = flag('out') ?? join(game, 'Maps', `${mapName}.h5m`);
const packed = writeMap(map, out, join('_tmp', 'rmg-pack'));
console.log(`${out} — ${packed.entries} entries, ${packed.bytes} bytes`);
