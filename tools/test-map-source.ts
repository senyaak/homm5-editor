// Where the picker's maps come from.
//
// Two claims, and both are about what is NOT listed: the unpacked data root is
// not a source of maps at all any more, and the game's own archives are read
// without being touched. Everything here is fake archives in a temp folder, so
// it runs in milliseconds; the real install is read at the end, read-only.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { extractMapFolder, gameArchives, listOurMaps, listStockMaps } from '../src/map/map-source.ts';
import { ensureModDir, modFile } from '../src/game/mod-paths.ts';
import { writeArchive } from '../src/format/pak.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

/** An archive holding one map at its in-game path, as ours are packed. */
const oneMap = (prefix: string): Buffer => writeArchive([
  { name: `${prefix}/map.xdb`, data: Buffer.from('<AdvMapDesc/>') },
  { name: `${prefix}/GroundTerrain.bin`, data: Buffer.from([1, 2, 3]) },
  { name: `${prefix}/name.txt`, data: Buffer.from('a map') },
]);

const dir = mkdtempSync(join(tmpdir(), 'mapsource-'));
try {
  // --- ours ---------------------------------------------------------------
  ensureModDir(dir);
  writeFileSync(modFile(dir, 'map', 'My Map'), oneMap('Maps/SingleMissions/My Map'));
  writeFileSync(modFile(dir, 'map', 'Together'), oneMap('Maps/Multiplayer/Together'));
  // Not maps: our creature mod, and a campaign.
  writeFileSync(modFile(dir, 'mod', 'homm5-editor'), oneMap('Units/Whatever'));
  writeFileSync(modFile(dir, 'campaign', 'A Campaign'), oneMap('UserCampaigns/A Campaign'));

  const ours = listOurMaps(dir);
  check('our maps are the packed maps in our folder',
    ours.map((m) => m.rel).join() === 'My Map.h5m,Together.h5m', ours.map((m) => m.rel).join());
  check('...named without the extension', ours[0]?.name === 'My Map');
  // A campaign mission names the map by its path in the game's file system, so
  // the archive's own folder has to come back with it.
  check('...and carrying the folder they sit at inside',
    ours.map((m) => m.inner).join() === 'Maps/SingleMissions/My Map,Maps/Multiplayer/Together');
  check('nothing else in the folder is offered as a map',
    !ours.some((m) => /h5u|h5c/.test(m.rel)), 'not the mod, not the campaign');

  // --- the game's own -----------------------------------------------------
  const data = join(dir, 'data');
  mkdirSync(data, { recursive: true });
  writeFileSync(join(data, 'data.pak'), writeArchive([
    { name: 'Maps/SingleMissions/A2S1/map.xdb', data: Buffer.from('<AdvMapDesc/>') },
    { name: 'Maps/SingleMissions/A2S1/GroundTerrain.bin', data: Buffer.from([9]) },
    { name: 'Maps/Scenario/A2C1M1/map.xdb', data: Buffer.from('<AdvMapDesc/>') },
    // Arenas and duel presets are not maps to edit, and the rest of the pak is
    // the data itself.
    { name: 'Maps/CombatArenas/Snow_01/map.xdb', data: Buffer.from('<AdvMapDesc/>') },
    { name: 'MapObjects/Whatever.xdb', data: Buffer.from('<x/>') },
  ], { mtime: new Date(2006, 0, 1) }));
  // The addon ships a patched copy of a map the base game already has, stamped
  // later — which is exactly how the game knows to prefer it.
  writeFileSync(join(data, 'a2p1-data.pak'), writeArchive([
    { name: 'Maps\\SingleMissions\\A2S1\\map.xdb', data: Buffer.from('<AdvMapDesc patched="yes"/>') },
    { name: 'Maps\\Multiplayer\\A2M3\\map.xdb', data: Buffer.from('<AdvMapDesc/>') },
  ], { mtime: new Date(2010, 0, 1) }));

  const stock = listStockMaps(dir);
  check('the game\'s maps are read out of its own archives',
    stock.map((m) => m.rel).join() === 'Multiplayer/A2M3,Scenario/A2C1M1,SingleMissions/A2S1',
    stock.map((m) => m.rel).join());
  check('...marked as the game\'s', stock.every((m) => m.stock === true));
  check('...arenas are not offered as maps to edit', !stock.some((m) => /CombatArenas/.test(m.rel)));
  check('...and a map two archives carry is one entry',
    stock.filter((m) => m.rel === 'SingleMissions/A2S1').length === 1);

  // --- taking one out ------------------------------------------------------
  //
  // A shipped map is spread across the archives — the base one holds the map,
  // the addon patches a file of it, the texts are somewhere else again — and
  // the game reads the NEWEST copy of each. So does this.
  writeFileSync(join(data, 'texts.pak'), writeArchive([
    { name: 'Maps/SingleMissions/A2S1/name.txt', data: Buffer.from('the name') },
  ]));
  const work = join(dir, 'work');
  const files = extractMapFolder(gameArchives(dir), 'Maps/SingleMissions/A2S1', work);
  check('a map comes out of every archive holding a piece of it, and nothing else comes with it',
    files === 3 && !existsSync(join(work, 'MapObjects')), `${files} files`);
  check('...and where two archives have the same file, the newer one lands',
    readFileSync(join(work, 'Maps', 'SingleMissions', 'A2S1', 'map.xdb'), 'utf8') === '<AdvMapDesc patched="yes"/>');
  check('...at the path the game addresses it by',
    existsSync(join(work, 'Maps', 'SingleMissions', 'A2S1', 'map.xdb')));
  check('...and the archives are left as they were',
    readdirSync(data).length === 3 && listStockMaps(dir).length === 3);

  let said = '';
  try { extractMapFolder(gameArchives(dir), 'Maps/SingleMissions/Nothing', work); }
  catch (e) { said = e instanceof Error ? e.message : String(e); }
  check('asking for a map that is not in there says so', said.includes('hold nothing under'), said);

  // --- nothing to read -----------------------------------------------------
  check('an install we do not have lists nothing, rather than throwing',
    listOurMaps(join(dir, 'nope')).length === 0 && listStockMaps(join(dir, 'nope')).length === 0);
  check('and neither does no install at all',
    listOurMaps(null).length === 0 && listStockMaps(null).length === 0);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// --- the real install, read only ------------------------------------------------

const gameRoot = process.env.HOMM5_GAME ?? resolve(import.meta.dirname, '..', '..');
if (existsSync(join(gameRoot, 'data'))) {
  const started = performance.now();
  const stock = listStockMaps(gameRoot);
  const ms = (performance.now() - started) | 0;
  check(`${gameRoot} offers its shipped maps`, stock.length > 20, `${stock.length} maps in ${ms}ms`);
  // The 1.4 GB archive is read for its list of names and nothing else; if that
  // ever turned into reading the file, this is where it would show.
  check('...and reading them is quick enough for a first screen', ms < 3000, `${ms}ms`);
  check('...each one knowing which archive and folder it is in',
    stock.every((m) => m.path.endsWith('.pak') && m.inner?.startsWith('Maps/')));
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
