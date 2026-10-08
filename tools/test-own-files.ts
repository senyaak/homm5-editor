// A file of the author's own is copied into the mod first, and the copy is
// all the build ever reads (src/mods/own-files.ts, intakeOwnFiles).
//
// The failure this guards against was quiet and late: the manifest kept the
// path the author picked, every rebuild read it from there, and a folder
// moved a week later made the next install of ANYTHING fail on a model nobody
// remembered picking. So the checks are about the originals being gone:
// taken in once, deleted, and the next intake still finds everything, reads
// nothing outside the store, and copies nothing again.
//
//   node tools/test-own-files.ts

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { intakeOwnFiles } from '../src/mods/own-files.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const UID = 'AAAAAAAA-1111-2222-3333-444444444444';
const root = mkdtempSync(join(tmpdir(), 'own-files-'));
try {
  // The author's: a model folder (its document, the geometry beside it, the
  // binary under bin/ by uid — and a file the model does not reach), a
  // picture, and a hero's file.
  const graves = join(root, 'authored', 'graves');
  mkdirSync(join(graves, 'bin', 'Geometries'), { recursive: true });
  writeFileSync(join(graves, 'Graves.xdb'), '<?xml version="1.0" encoding="UTF-8"?>\r\n<Model>\r\n\t<Geometry href="Graves-geom.xdb#xpointer(/Geometry)"/>\r\n</Model>');
  writeFileSync(join(graves, 'Graves-geom.xdb'), `<?xml version="1.0" encoding="UTF-8"?>\r\n<Geometry>\r\n\t<uid>${UID}</uid>\r\n</Geometry>`);
  writeFileSync(join(graves, 'bin', 'Geometries', UID), 'geometry bytes');
  writeFileSync(join(graves, 'notes.txt'), 'nothing the model names');
  const picture = join(root, 'authored', 'tower.png');
  writeFileSync(picture, 'png bytes');
  const heroFile = join(root, 'authored', 'face.dds');
  writeFileSync(heroFile, 'dds bytes');

  const store = join(root, 'game', 'H5E', 'sources');
  const manifest = {
    factions: [{
      file: 'Bone',
      buildings: { TB_SPECIAL_1: { model: { source: join(graves, 'Graves.xdb'), at: { x: 1, y: 2, z: 3 } } } },
      pictures: { tower: picture },
      script: 'function BonePit() end',
    }],
    heroes: [{ id: 'Lord', ownFiles: { '/Heroes/Lord/face.dds': heroFile } }],
    creatures: [{ id: 'CREATURE_X', visualSource: 'GameMechanics/CreatureVisual/Creatures/Elf.xdb' }],
  };

  console.log('taken in');
  const first = intakeOwnFiles(manifest, store);
  const f = manifest.factions[0]!;
  const model = f.buildings.TB_SPECIAL_1.model.source;
  check('three files of the author\'s were taken in', first.copied.size === 3, `${first.copied.size}`);
  check('the manifest names the copies, inside the store',
    [model, f.pictures.tower, manifest.heroes[0]!.ownFiles['/Heroes/Lord/face.dds']]
      .every((p) => !relative(store, p).startsWith('..')));
  check('a model keeps its folder\'s name — the mod\'s own/<folder>/ paths do not move',
    /[\\/]graves[\\/]Graves\.xdb$/.test(model), model);
  const home = join(model, '..');
  check('what the model reaches came with it: the geometry and its binary',
    existsSync(join(home, 'Graves-geom.xdb')) && readFileSync(join(home, 'bin', 'Geometries', UID), 'utf8') === 'geometry bytes');
  check('what it does not reach stayed behind', !existsSync(join(home, 'notes.txt')));
  check('data paths and texts are left alone',
    manifest.creatures[0]!.visualSource === 'GameMechanics/CreatureVisual/Creatures/Elf.xdb' && f.script === 'function BonePit() end');
  check('the other fields of the model stand', f.buildings.TB_SPECIAL_1.model.at.z === 3);

  console.log('the originals gone');
  rmSync(join(root, 'authored'), { recursive: true, force: true });
  const again = intakeOwnFiles(manifest, store);
  check('nothing is copied again — the manifest already names the copies', again.copied.size === 0);
  check('and nothing it names is thrown away', again.pruned.length === 0 && existsSync(model) && existsSync(f.pictures.tower));

  console.log('picked again, and dropped');
  mkdirSync(join(root, 'authored'), { recursive: true });
  writeFileSync(picture, 'png bytes, repainted');
  f.pictures.tower = picture;
  const repicked = intakeOwnFiles(manifest, store);
  check('the same original picked again is taken in afresh', repicked.copied.size === 1
    && readFileSync(f.pictures.tower, 'utf8') === 'png bytes, repainted');
  const heroCopy = manifest.heroes[0]!.ownFiles['/Heroes/Lord/face.dds'];
  manifest.heroes = [];
  const dropped = intakeOwnFiles(manifest, store);
  check('a copy nothing names any more leaves the store', dropped.pruned.length === 1 && !existsSync(heroCopy));
  check('and the rest stays', existsSync(model) && existsSync(f.pictures.tower));
  const missing = join(root, 'never', 'there.png');
  f.pictures.tower = missing;
  intakeOwnFiles(manifest, store);
  check('a path that names nothing is left for the build to refuse', f.pictures.tower === missing);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} failure(s)` : '\nall good');
process.exit(failures ? 1 : 0);
