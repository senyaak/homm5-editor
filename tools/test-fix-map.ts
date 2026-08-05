// The Rules Test map's spec, checked against the game's own files.
//
// The map itself is built by `e2e/fix-001-rules-map`, which needs an install, a
// build and several minutes. Everything that can be wrong with the SPEC —
// a perk the hero will not be granted, a creature the table does not have, a
// shared path that places nothing, a fix with no hero to watch it, two things
// on one tile, a battle too short for its own log — costs a second to ask here,
// and every one of those failures is otherwise SILENT.
//
// So this runs in `npm test`, without Electron and without an install. It needs
// the unpacked game data and skips itself, loudly, when there is none.
//
//   node tools/test-fix-map.ts [--data <dir>]

import { dataDir } from './game-dir.ts';
import { dataIsThere, mapComplaints } from '../e2e/map-checks.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const DATA = dataDir();

console.log('\nthe Rules Test map spec');
if (!dataIsThere(DATA)) {
  console.log(`  skipped — no unpacked game data at ${DATA}`);
} else {
  const complaints = mapComplaints(DATA);
  for (const said of complaints) check(said, false);
  check('every kit is one the game will actually grant, and the map is well formed',
    complaints.length === 0, complaints.length ? `${complaints.length} complaints above` : '');
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
