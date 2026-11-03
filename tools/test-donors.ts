// Templates for new objects, from the game's own maps — `src/map/donors.ts`.
//
//   node tools/test-donors.ts
//
// A made-up data root whose Maps folder holds one map with a sign and no town.
// The listing of the maps is kept between asks and checked by the folders'
// dates (a folder's date moves when an entry in it comes or goes), so what is
// under test is that it notices: a town map added later is found, though "no
// town" was answered first; a map removed takes its listing with it; and the
// walk follows a junction into a folder that lives elsewhere.

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { clearDonorCache, donorFor } from '../src/map/donors.ts';
import { mapTreeUnder } from '../src/map/map-source.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

/** A map document holding one object of `type`. */
const mapWith = (type: string, field: string): string =>
  `<AdvMapDesc><objects><Item href="#n:inline(${type})" id="item_1"><${type}><${field}>1</${field}></${type}></Item></objects></AdvMapDesc>`;

const putMap = (dir: string, text: string): void => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'map.xdb'), text, 'latin1');
};

const tmp = mkdtempSync(join(tmpdir(), 'homm5-donors-'));
try {
  const data = join(tmp, 'data');
  putMap(join(data, 'Maps', 'Single', 'Signs'), mapWith('AdvMapSign', 'Message'));
  clearDonorCache();

  console.log('one map, with a sign');
  check('a sign comes from it, wrapper and all', donorFor(data, 'AdvMapSign')?.startsWith('<Item ') === true
    && donorFor(data, 'AdvMapSign')!.includes('<Message>1</Message>'));
  check('no map has a town', donorFor(data, 'AdvMapTown') === null);

  console.log('\na town map added beside it');
  putMap(join(data, 'Maps', 'Single', 'Towns'), mapWith('AdvMapTown', 'Name'));
  check('the town is found now', donorFor(data, 'AdvMapTown')?.includes('<Name>1</Name>') === true);

  console.log('\nthe sign map removed');
  rmSync(join(data, 'Maps', 'Single', 'Signs'), { recursive: true });
  check('a sign already found is kept: it is text, not a pointer into the map', donorFor(data, 'AdvMapSign') !== null);
  check('and the listing no longer holds the gone map', donorFor(data, 'AdvMapGarrison') === null);

  console.log('\na junction into a folder elsewhere');
  const elsewhere = join(tmp, 'elsewhere');
  putMap(join(elsewhere, 'Linked'), mapWith('AdvMapShrine', 'Spell'));
  symlinkSync(elsewhere, join(data, 'Maps', 'Linked'), 'junction');
  const tree = mapTreeUnder(join(data, 'Maps'));
  check('the walk lists the map behind it', tree.maps.some((m) => m.endsWith(join('Linked', 'Linked', 'map.xdb'))),
    tree.maps.join(' | '));
  check('and its folders are among those it dates', tree.dirs.some((d) => d.endsWith(join('Maps', 'Linked'))));
  check('a shrine is found through it', donorFor(data, 'AdvMapShrine')?.includes('<Spell>1</Spell>') === true);
} finally {
  rmSync(tmp, { recursive: true, force: true });
  clearDonorCache();
}

console.log(failures ? `\n${failures} failure(s)` : '\nall good');
process.exit(failures ? 1 : 0);
