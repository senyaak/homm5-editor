// The map's memory of what is in its boxes — the sidecar, and what it refuses.
//
// Needs no game data: the sidecar is ours end to end, so this suite runs in a
// temp folder and checks the things that would otherwise be found by a box
// opening empty in play — a rename that loses the contents, a deleted
// placement whose trigger is still written, a message pointed at a path the
// game cannot address.
//
//   node tools/test-pandora-store.ts

import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PANDORA_FILE, findPandoraBox, pandoraMessageFile, pandoraMessageRef, prunePandoraBoxes,
  readPandoraBoxes, removePandoraBox, renamePandoraBox, setPandoraBox, writePandoraBoxes,
} from '../src/map/pandora-store.ts';
import { EDITOR_SIDECARS } from '../src/map/project.ts';
import type { PandoraContents } from '../src/mods/pandora-contents.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const dir = mkdtempSync(join(tmpdir(), 'pandora-store-'));

console.log('the sidecar');
check('a map with no sidecar has no boxes', readPandoraBoxes(dir).length === 0);

const boxes: PandoraContents[] = [
  { name: 'PandoraGold', gold: 10000 },
  { name: 'PandoraArmy', creatures: [{ creature: 'CREATURE_ARCHANGEL', count: 10 }] },
];
writePandoraBoxes(dir, boxes);
check('what is written comes back', JSON.stringify(readPandoraBoxes(dir)) === JSON.stringify(boxes));
check('and it lands in the file we say it does', existsSync(join(dir, PANDORA_FILE)));
check('the file says which shape it is',
  (JSON.parse(readFileSync(join(dir, PANDORA_FILE), 'utf8')) as { version: number }).version === 1);

// Bookkeeping must not sink a map: a sidecar someone edited by hand into
// nonsense costs its contents, not the map.
writeFileSync(join(dir, PANDORA_FILE), '{ this is not json');
check('a sidecar that will not parse reads as no boxes', readPandoraBoxes(dir).length === 0);
writePandoraBoxes(dir, boxes);

console.log('editing the list');
const renamed = renamePandoraBox(boxes, 'PandoraGold', 'PandoraRich');
check('a rename carries the contents', findPandoraBox(renamed, 'PandoraRich')?.gold === 10000);
check('and leaves nothing behind under the old name', !findPandoraBox(renamed, 'PandoraGold'));
// Two boxes of one name would make the second unreachable — the trigger looks
// up by name, and the block would write the handle twice.
const collided = renamePandoraBox(
  [...boxes, { name: 'PandoraSpare', gold: 1 }], 'PandoraSpare', 'PandoraGold');
check('renaming onto a name in use replaces it, never doubles it',
  collided.filter((b) => b.name === 'PandoraGold').length === 1
  && findPandoraBox(collided, 'PandoraGold')?.gold === 1,
  collided.map((b) => b.name).join(','));

check('setting a box replaces its entry',
  setPandoraBox(boxes, { name: 'PandoraGold', gold: 25 }).filter((b) => b.name === 'PandoraGold').length === 1);
check('and a new name is added', setPandoraBox(boxes, { name: 'PandoraNew' }).length === boxes.length + 1);
check('removing takes exactly one out', removePandoraBox(boxes, 'PandoraGold').length === boxes.length - 1);

// The one that bites in play: a placement deleted on the map, its contents
// left behind, and the next save writing a trigger for an object that is gone.
const pruned = prunePandoraBoxes(boxes, ['PandoraArmy']);
check('contents of a deleted placement are forgotten',
  pruned.length === 1 && pruned[0]!.name === 'PandoraArmy');
check('and a map with nothing placed keeps nothing', prunePandoraBoxes(boxes, []).length === 0);

console.log('the message text');
check('one file per box', pandoraMessageFile('PandoraGold') === 'pandora-PandoraGold.txt');
check('addressed the way the game addresses files',
  pandoraMessageRef('Maps/SingleMissions/Probe', 'PandoraGold')
  === '/Maps/SingleMissions/Probe/pandora-PandoraGold.txt');
check('a leading or trailing slash in the prefix changes nothing',
  pandoraMessageRef('/Maps/Probe/', 'A') === '/Maps/Probe/pandora-A.txt');
check('a map packed at the root still gets an absolute ref',
  pandoraMessageRef('', 'A') === '/pandora-A.txt');

console.log('what ships');
check('the sidecar is editor bookkeeping, not map content',
  EDITOR_SIDECARS.has(PANDORA_FILE) && EDITOR_SIDECARS.has('localization.json'));

rmSync(dir, { recursive: true, force: true });
console.log(failures ? `\n${failures} FAILED` : '\nall good');
process.exit(failures ? 1 : 0);
