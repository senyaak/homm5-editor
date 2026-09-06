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

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseTerrain, passabilityPlane } from '../src/terrain/terrain.ts';
import { buildMapFiles } from './rmg-build.ts';
import { describeOrder, readOrder } from './rmg-order.ts';
import { runFull } from './rmg-run.ts';
import { dataDir, gameDir } from './game-dir.ts';

const args = process.argv.slice(2);
// The map is the one bare word that is not some flag's value.
const TAKES_A_VALUE = new Set(['--game', '--data', '--write']);
const archive = args.find((a, i) => !a.startsWith('--') && !TAKES_A_VALUE.has(args[i - 1] ?? ''));
if (!archive) {
  console.error('point me at a generated map: node tools/rmg-diff-map.ts --game <dir> <map.h5m>');
  process.exit(2);
}
const dir = dataDir();
if (!existsSync(join(dir, 'RMG'))) {
  console.error(`no RMG data under ${dir} — unpack it with \`npm run unpack-data\` first`);
  process.exit(2);
}
const game = gameDir();

const read = readOrder(archive);
if (typeof read === 'string') { console.error(read); process.exit(2); }
const { order, files: theirs } = read;
const { seed, guid, mapName, template, size, players, water, monster, underground, minimap } = order;

console.log(`${archive}`);
console.log(`  ordered: ${describeOrder(order)}`);
// The monster level the map was ordered with is the level the chain replays.
// It reaches `mapSetup` as a fixed value, so it costs the same discarded draw
// MEDIUM did, and from there it multiplies every guard's power.
const MONSTER_LEVELS = [
  'MONSTER_LEVEL_WEAK', 'MONSTER_LEVEL_MEDIUM', 'MONSTER_LEVEL_STRONG',
  'MONSTER_LEVEL_VERY_STRONG', 'MONSTER_LEVEL_IMPOSSIBLE',
];
const monsterStrength = MONSTER_LEVELS.indexOf(monster);
if (monsterStrength < 0) {
  console.error(`  unknown MonsterLevel ${monster} — it is not one of the five the enum lists`);
  process.exit(2);
}

const run = runFull(dir,
  { seed, template, size, underground, water: water || undefined, monsterStrength });
console.log(`  replayed: ${run.c.rng.draws} draws, ${run.objects.length} objects`);
// WHICH CAPTION NUMBERING TO EXPECT is not the generator's to say: the console
// command numbers the scenario captions from 0, the editor's SAVE from 2 with
// two unreferenced documents below them, and the same map ordered both ways
// differs by exactly those two bytes. So the base is taken from the map under
// test - how many caption documents it carries, less one per player - rather
// than guessed from the path, which would misjudge an unpacked archive.
//
// This does not make the numbering unchecked. The base only says how many
// documents exist; whether `map.xdb` REFERENCES the right ones is still a byte
// comparison, and a map whose refs did not follow its own file set would fail
// it. See `RmgTextsInput.captionBase`.
const captions = [...theirs.keys()].filter((n) => /^caption-text-\d+\.txt$/.test(n)).length;
const captionBase = Math.max(0, captions - players);
if (captionBase) console.log(`  captions: ${captions} documents, so the numbering starts at ${captionBase} (an editor SAVE)`);
const ours = buildMapFiles(dir, join(game, 'bin', 'H5_Game_H5E.exe'), run,
  { seed, template, players, underground, water, guid, mapName, minimap },
  { captionBase });

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
