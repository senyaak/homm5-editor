// Any map the ENGINE generated, against the same map from the port.
//
//   npm run rmg-diff-map -- --game <dir> "game/Maps/<the run>.h5m"
//   npm run rmg-diff-map -- --game <dir> game/bin/rmg-runs/1
//
// A map carries its own order: `sRMGProps` records the seed, the template,
// the size, the water and the players it was asked for, and the GUID and name
// it was given. So the whole comparison needs nothing typed — order a map in
// the editor, save it, point this at it, and it says which of the seventeen
// entries the port reproduces and which it does not.
//
// EITHER AN ARCHIVE OR A FOLDER, because the two ways of ordering a map end
// differently. Saving from the editor's dialog writes a packed `.h5m`; the
// console command the batch uses leaves the documents loose in
// `data/RMGTemp/CurrentMap`, which `native/rmg/cli.c` copies to
// `bin/rmg-runs/<n>`. They are the same seventeen files either way, so this
// takes whichever it is pointed at and the batch needs no packing step.
//
// This is the oracle every seed but the reference's is missing. Playing a
// generated map says only that it loads; this says whether it is the map the
// engine would have made.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { readEntries } from '../src/format/pak.ts';
import { parseTerrain, passabilityPlane } from '../src/terrain/terrain.ts';
import { MAP_SIZES, buildMapFiles } from './rmg-build.ts';
import { runFull } from './rmg-run.ts';
import { dataDir, gameDir } from './game-dir.ts';

const args = process.argv.slice(2);
// The map is the one bare word that is not some flag's value.
const TAKES_A_VALUE = new Set(['--game', '--data', '--write']);
const archive = args.find((a, i) => !a.startsWith('--') && !TAKES_A_VALUE.has(args[i - 1] ?? ''));
if (!archive || !existsSync(archive)) {
  console.error('point me at a generated map: node tools/rmg-diff-map.ts --game <dir> <map.h5m>');
  process.exit(2);
}
const dir = dataDir();
if (!existsSync(join(dir, 'RMG'))) {
  console.error(`no RMG data under ${dir} — unpack it with \`npm run unpack-data\` first`);
  process.exit(2);
}
const game = gameDir();

const theirs = new Map<string, Buffer>();
if (statSync(archive).isDirectory()) {
  for (const name of readdirSync(archive)) {
    const path = join(archive, name);
    if (statSync(path).isFile()) theirs.set(name, readFileSync(path));
  }
} else {
  const entries = readEntries(readFileSync(archive));
  const holder = entries.find((e) => e.name.endsWith('/map.xdb') || e.name === 'map.xdb');
  if (!holder) {
    console.error(`${archive} holds no map.xdb — is it a map?`);
    process.exit(2);
  }
  const folder = holder.name.slice(0, holder.name.lastIndexOf('/'));
  for (const e of entries) {
    if (folder && !e.name.startsWith(`${folder}/`)) continue;
    theirs.set(e.name.slice(folder ? folder.length + 1 : 0), e.data);
  }
}
const mapEntry = theirs.get('map.xdb');
if (!mapEntry) {
  console.error(`${archive} holds no map.xdb — is it a map?`);
  process.exit(2);
}

const text = mapEntry.toString('utf8');
const one = (re: RegExp, what: string): string => {
  const m = re.exec(text);
  if (!m) {
    console.error(`${archive}: no ${what} — this map was not generated`);
    process.exit(2);
  }
  return m[1]!;
};
const seed = Number(one(/<RMGstartseed>(\d+)</, 'RMGstartseed'));
const guid = one(/<RMGguid>([^<]*)</, 'RMGguid');
const mapName = one(/<MapName>([^<]*)</, 'MapName');
const sizeName = one(/<MapSize>(\w+)</, 'MapSize');
const players = Number(one(/<Players>(\d+)</, 'Players'));
// `[^"]+` and not `[^.]+`: half the stock templates have a dot in the NAME —
// `S0-1P2Z2K3.1T.xdb`, `S3-5P2Z7N2.2.xdb` — and a stricter class stopped at the
// first one, so those maps read as "not generated".
const template = one(/<Template href="\/RMG\/Templates\/([^"]+)\.xdb/, 'Template');
const waterName = one(/<WaterAmount>(\w+)</, 'WaterAmount');
const monster = one(/<MonsterLevel>(\w+)</, 'MonsterLevel');
const underground = /<HasUnderground>true</.test(text);
// The order's Minimap tick, taken from the record like everything else: an
// order made with it off writes no minimap files, and the port must not write
// them either or the comparison reports a difference the order asked for.
const minimap = !/<Minimap>false</.test(text);

const SIZE_NAMES = [
  'MAP_SIZE_TINY', 'MAP_SIZE_SMALL', 'MAP_SIZE_MEDIUM', 'MAP_SIZE_LARGE',
  'MAP_SIZE_EXTRALARGE', 'MAP_SIZE_HUGE', 'MAP_SIZE_IMPOSSIBLE',
];
const sizeIndex = SIZE_NAMES.indexOf(sizeName);
const size = MAP_SIZES[sizeIndex];
const water = ['WATER_NONE', 'WATER_PRESENT', 'WATER_ISLAND_MAP'].indexOf(waterName);
if (size === undefined || water < 0) {
  console.error(`${archive}: ${sizeName} / ${waterName} is not an order this port can replay`);
  process.exit(2);
}
console.log(`${archive}`);
console.log(`  ordered: ${template} ${sizeName.replace('MAP_SIZE_', '').toLowerCase()} ${size}x${size},`
  + ` ${players} players, seed ${seed}, ${waterName}, ${monster}${underground ? ', underground' : ''}`
  + `${minimap ? '' : ', no minimap'}`);
// The chain always orders MEDIUM: mapSetup takes a fixed monsterStrength of 1.
// Saying so beats a silent mismatch buried in an object's army.
if (monster !== 'MONSTER_LEVEL_MEDIUM') {
  console.log(`  NOTE: the port only orders MONSTER_LEVEL_MEDIUM — this map's ${monster} is not replayed`);
}

const run = runFull(dir, { seed, template, size, underground, water: water || undefined });
console.log(`  replayed: ${run.c.rng.draws} draws, ${run.objects.length} objects`);
const ours = buildMapFiles(dir, join(game, 'bin', 'H5_Game_H5E.exe'), run,
  { seed, template, players, underground, water, guid, mapName, minimap });

const ourNames = new Set(ours.map((f) => f.name));
const missing = [...theirs.keys()].filter((n) => !ourNames.has(n));
const extra = ours.map((f) => f.name).filter((n) => !theirs.has(n));
if (missing.length || extra.length) {
  console.log(`  entries: ${ours.length} ours against ${theirs.size} theirs`
    + `${missing.length ? `, we do not write [${missing.join(' ')}]` : ''}`
    + `${extra.length ? `, they do not hold [${extra.join(' ')}]` : ''}`);
} else {
  console.log(`  entries: the same ${ours.length}`);
}

// `--write <dir>` puts OUR side on disk. A count of differing bytes says a
// file is wrong; the plane-by-plane readers (`tools/diff-terrain.ts`) say what
// is wrong about it, and they need two files to read.
const writeTo = (() => {
  const i = args.indexOf('--write');
  return i >= 0 ? args[i + 1] : undefined;
})();
if (writeTo) {
  mkdirSync(writeTo, { recursive: true });
  for (const file of ours) writeFileSync(join(writeTo, file.name), file.data);
  console.log(`  ours written to ${writeTo}`);
}

let same = 0;
for (const file of ours.sort((a, b) => a.name.localeCompare(b.name))) {
  const want = theirs.get(file.name);
  if (!want) continue;
  if (file.data.equals(want)) { same++; continue; }
  // The 0x0e record's payload in a terrain file is uninitialised and flips
  // between two identical runs — the determinism check caught it.
  const exempt = file.name.endsWith('Terrain.bin')
    ? (passabilityPlane(parseTerrain(want))?.dataOff ?? 23) - 23 : -1;
  let differing = 0, firstAt = -1;
  for (let i = 0; i < Math.max(file.data.length, want.length); i++) {
    if (i === exempt) continue;
    if (file.data[i] !== want[i]) { differing++; if (firstAt < 0) firstAt = i; }
  }
  if (!differing) { same++; continue; }
  console.log(`  ${file.name.padEnd(24)} ${differing} bytes differ, first at ${firstAt}`
    + ` (ours ${file.data.length}b, theirs ${want.length}b)`);
}
console.log(`  ${same} of ${theirs.size} entries byte-identical`);
