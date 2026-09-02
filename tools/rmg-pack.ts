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

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { initProject, packProject } from '../src/map/project.ts';
import { MAP_SIZES, buildMapFiles } from './rmg-build.ts';
import { runFull } from './rmg-run.ts';
import { dataDir, gameDir } from './game-dir.ts';
import type { ChainOptions } from './rmg-chain.ts';

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
  console.log('--seed <n>            the order\'s seed (required)');
  console.log('--template <name>     default S1P2Z2M1');
  console.log(`--size <tiles>        one of ${MAP_SIZES.join(' ')}, default 96`);
  console.log('--underground         two floors');
  console.log('--water <0|1|2>       0 none, 2 island map — what the dialog\'s checkbox orders');
  console.log('--name <text>         the map\'s name, default "RMG <seed>"');
  console.log('--guid <G>            default random, as CoCreateGuid makes one');
  console.log('--out <file.h5m>      default <game>/Maps/<name>.h5m');
  process.exit(0);
}

const dir = dataDir();
if (!existsSync(join(dir, 'RMG'))) {
  console.error(`no RMG data under ${dir} — unpack it with \`npm run unpack-data\` first`);
  process.exit(2);
}
const game = gameDir();

const template = flag('template') ?? 'S1P2Z2M1';
const size = num('size') ?? 96;
if (!MAP_SIZES.includes(size as (typeof MAP_SIZES)[number])) {
  console.error(`--size ${size} is not one of the dialog's sizes: ${MAP_SIZES.join(' ')}`);
  process.exit(2);
}
const underground = args.includes('--underground');
const water = num('water') ?? 0;
const mapName = flag('name') ?? `RMG ${seed}`;

const options: ChainOptions = { seed, template, size, underground, water: water || undefined };
console.log(`generating ${template} ${size}x${size}, seed ${seed}`
  + `${underground ? ', underground' : ''}${water ? `, water ${water}` : ''}`);
const run = runFull(dir, options);
const players = Math.max(...run.c.loaded.zones.map((z) => z.playerNo ?? 0));
console.log(`  ${run.c.rng.draws} draws, ${players} players, ${run.objects.length} objects`);

// CoCreateGuid's shape, which is what the engine stamps into the map and names
// the folder with. Ours is random the same way; nothing reads it back.
const hex = (n: number): string => Array.from({ length: n },
  () => '0123456789ABCDEF'[Math.floor(Math.random() * 16)]).join('');
// `--guid` is for reproducing a particular archive — the engine's own, when
// comparing against a map it wrote.
const guid = flag('guid') ?? `${hex(8)}-${hex(4)}-${hex(4)}-${hex(4)}-${hex(12)}`;

const files = buildMapFiles(dir, join(game, 'bin', 'H5_Game_H5E.exe'), run, {
  seed, template, players, underground, water, guid, mapName,
});

const prefix = `Maps/RMG/${guid}`;
const staging = join('_tmp', 'rmg-pack');
rmSync(staging, { recursive: true, force: true });
const mapDir = join(staging, ...prefix.split('/'));
mkdirSync(mapDir, { recursive: true });
for (const file of files) writeFileSync(join(mapDir, file.name), file.data);
initProject(mapDir);

const out = flag('out') ?? join(game, 'Maps', `${mapName}.h5m`);
mkdirSync(join(out, '..'), { recursive: true });
const packed = packProject(mapDir, out, { prefix });
console.log(`${out} — ${packed.entries} entries, ${packed.bytes} bytes`);
