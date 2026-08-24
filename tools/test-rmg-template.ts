// The template reader, and the first ported phase.
//
//   node tools/test-rmg-template.ts
//
// Runs against the game's real templates — all 22 of them — because a reader
// tested on a fixture only proves it can read the fixture. Skips itself when
// there is no unpacked data, the way the rest of the suite does.

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { createMap } from '../src/rmg/create-map.ts';
import { RmgRandom } from '../src/rmg/random.ts';
import { readTemplate, TIERS } from '../src/rmg/template.ts';
import { dataDir } from './game-dir.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const dir = join(dataDir(), 'RMG', 'Templates');
if (!existsSync(dir)) {
  console.log('no unpacked RMG templates — run `npm run unpack-data`; skipping');
  process.exit(0);
}

console.log('templates');

const files = readdirSync(dir).filter((f) => f.endsWith('.xdb'));
check('the shipped templates are all there', files.length === 22, `${files.length}`);

let zones = 0;
let connections = 0;
for (const file of files) {
  const t = readTemplate(join(dir, file));
  zones += t.zones.length;
  connections += t.connections.length;
  if (!t.zones.length) check(`${file} has zones`, false);
  // Every connection must name zones that exist, or a phase walking them
  // dereferences nothing. This is the check that would catch a parser reading
  // the Items of `Mines` as zones — which an earlier draft of it did.
  const known = new Set(t.zones.map((z) => z.index));
  for (const c of t.connections) {
    if (!known.has(c.sourceZoneIndex) || !known.has(c.destZoneIndex)) {
      check(`${file}: connection ${c.sourceZoneIndex}→${c.destZoneIndex} names a real zone`, false);
    }
  }
  for (const z of t.zones) {
    if (z.mines.length !== TIERS || z.dwellings.length !== TIERS) {
      check(`${file}: zone ${z.index} has ${TIERS} tiers of mines and dwellings`, false,
        `${z.mines.length}/${z.dwellings.length}`);
    }
  }
  if (t.minPlayers > t.maxPlayers || t.minMapSize > t.maxMapSize) {
    check(`${file}: its ranges are the right way round`, false);
  }
}
check('every connection names a zone that exists', failures === 0, `${connections} connections, ${zones} zones`);

// The one the reference runs used, read field by field — the numbers are from
// the file, so this is the reader being held to the data rather than to itself.
const s1 = readTemplate(join(dir, 'S1P2Z2M1.xdb'));
check('S1P2Z2M1 has four zones', s1.zones.length === 4, `${s1.zones.length}`);
check('two of them hold a town', s1.zones.filter((z) => z.town).length === 2);
check('and three connections join them', s1.connections.length === 3);
check('it is a two-player template', s1.minPlayers === 2 && s1.maxPlayers === 2);
check('sized 5..14', s1.minMapSize === 5 && s1.maxMapSize === 14);
check('zone 1 wants six kinds of mine', s1.zones[0]!.mines.filter((m) => m > 0).length === 6,
  s1.zones[0]!.mines.join(','));
check('and its treasure block budget is 10000', s1.zones[0]!.treasureBlocksTotalValue === 10000);
check('the guarded passage between the towns is the strong one',
  Math.max(...s1.connections.map((c) => c.guardStrenght)) === 12);

check('shipyard defaults to true where no template writes it', s1.zones.every((z) => z.shipyard));

console.log('\nCreateMap');

// Both reference runs supplied players and size, so both must spend three
// draws and hand those values straight back.
const supplied = new RmgRandom(1785351845);
const made = createMap(s1, { players: 2, size: 8 }, supplied);
check('it spends exactly three draws', supplied.draws === 3, `${supplied.draws}`);
check('and returns what it was given, one floor', made.players === 2 && made.size === 8 && !made.twoFloors,
  JSON.stringify(made));

// Unsupplied, it draws inside the template's own range — and spends the same
// three, which is the whole point of the phase.
const drawn = new RmgRandom(1785351845);
const rolled = createMap(s1, {}, drawn);
check('unsupplied, it still spends three', drawn.draws === 3, `${drawn.draws}`);
check('players land inside 2..2', rolled.players === 2);
check('size lands inside 5..14', rolled.size >= 5 && rolled.size <= 14, `${rolled.size}`);

// The clamp, as the engine wrote it, lands on the PLAYERS — and too many
// does NOT become the maximum.
const clamped = createMap(s1, { players: 99, size: 8 }, new RmgRandom(1));
check('a player count above the maximum falls back to the MINIMUM',
  clamped.players === s1.minPlayers, `${clamped.players}`);
const few = createMap(s1, { players: 1, size: 8 }, new RmgRandom(1));
check('and so does one below it', few.players === s1.minPlayers, `${few.players}`);

// The underground coin REPLACES the first discarded draw — three either way.
const coin = new RmgRandom(7);
createMap(s1, { players: 2, size: 8, randomUnderground: true }, coin);
check('a random underground still costs three draws', coin.draws === 3, `${coin.draws}`);

// Two floors halve a DRAWN size before it becomes an index.
const halved = createMap(s1, { players: 2, underground: true }, new RmgRandom(1));
check('a drawn size halves when two floors share the map',
  halved.twoFloors && halved.size >= 2 && halved.size <= 7, `${halved.size}`);

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
