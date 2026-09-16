// `<UniqueRaces>` — ours, on a template's random zones: no faction twice.
//
//   node tools/test-rmg-unique-races.ts
//
// The engine draws every random zone's race from the same list, so a star
// of five zones repeats a faction more often than not and the middle zone
// is somebody's home ground as often as not — which matters, because a
// hero pays a terrain penalty everywhere but on his own class's ground
// (`docs/RMG.md`, the move cost). With the flag the draw is among the races
// not yet taken: by a zone already made, or by a lobby slot still to be
// seated. Held on LoadTemplate alone, seed by seed, against the flag off.

// needs: game
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { exeTables } from '../src/rmg/exe.ts';
import { loadTemplate, RACE } from '../src/rmg/load-template.ts';
import { RmgRandom } from '../src/rmg/random.ts';
import { parseTemplate } from '../src/rmg/template.ts';
import { gameExeIfAny } from './game-dir.ts';

const exePath = gameExeIfAny();
if (!exePath) {
  console.log('skipping — the generator reads its tables from the executable; say --game <dir> or HOMM5_GAME');
  process.exit(0);
}
const EXE = exeTables(exePath);

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const OWN = join(import.meta.dirname, '..', 'assets', 'rmg', 'RMG', 'Templates');
const jebusXml = readFileSync(join(OWN, 'Jebus Cross.h5et'), 'utf8');
const jebus = parseTemplate(jebusXml);
const plain = parseTemplate(jebusXml.replace('<UniqueRaces>true</UniqueRaces>', ''));
const raceName = (r: number): string => Object.entries(RACE).find(([, v]) => v === r)?.[0] ?? `${r}`;

const load = (t: typeof jebus, seed: number, players?: number[], twoFloors = false) => loadTemplate(t, {
  twoFloors, dwarvenUnderground: false, water: 0, playerCount: 4, mapSize: 136,
  pointLightZoneRadius: 40, races: EXE, players,
}, new RmgRandom(seed));

console.log('reading');
check('Jebus Cross asks for unique races, the same file without the tag does not', jebus.uniqueRaces && !plain.uniqueRaces);

console.log('the draw, 40 seeds, one floor');
{
  let distinct = 0;
  let middleForeign = 0;
  let sameDraws = 0;
  let plainRepeats = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const a = load(jebus, seed);
    const b = load(plain, seed);
    const races = a.zones.map((z) => z.race);
    if (new Set(races).size === races.length) distinct++;
    const middle = a.zones.find((z) => z.index === 1)!.race;
    if (!a.players.includes(middle)) middleForeign++;
    if (new Set(b.zones.map((z) => z.race)).size < b.zones.length) plainRepeats++;
    if (a.warnings.length) check(`seed ${seed}: no warning on a five-zone star`, false, a.warnings.join('; '));
  }
  // Byte identity for the engine's own templates is the other tests' claim;
  // here only that the flag is a filter on the LIST and not on the stream.
  for (let seed = 1; seed <= 40; seed++) {
    const r1 = new RmgRandom(seed); const r2 = new RmgRandom(seed);
    loadTemplate(jebus, { twoFloors: false, dwarvenUnderground: false, water: 0, playerCount: 4, mapSize: 136, pointLightZoneRadius: 40, races: EXE }, r1);
    loadTemplate(plain, { twoFloors: false, dwarvenUnderground: false, water: 0, playerCount: 4, mapSize: 136, pointLightZoneRadius: 40, races: EXE }, r2);
    if (r1.draws === r2.draws) sameDraws++;
  }
  check('every seed: five zones, five factions', distinct === 40, `${distinct}/40`);
  check('every seed: the middle is no player\'s faction', middleForeign === 40, `${middleForeign}/40`);
  check('the flag spends the draws the engine spends', sameDraws === 40, `${sameDraws}/40`);
  check('and without it the engine repeats a faction on most seeds (the metric sees)', plainRepeats > 20, `${plainRepeats}/40`);
}

console.log('the lobby\'s picks count as taken');
{
  // Two players fixed to Haven and Inferno in the lobby: the middle (drawn
  // first, index 1) must avoid both, and the two random starts the rest.
  let ok = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const a = load(jebus, seed, [RACE.HEAVEN, RACE.INFERNO, RACE.RANDOM, RACE.RANDOM]);
    const races = a.zones.map((z) => z.race);
    const middle = a.zones.find((z) => z.index === 1)!.race;
    if (new Set(races).size === 5 && middle !== RACE.HEAVEN && middle !== RACE.INFERNO
      && a.players[0] === RACE.HEAVEN && a.players[1] === RACE.INFERNO) ok++;
  }
  check('with two slots fixed, still five factions and the middle avoids both', ok === 40, `${ok}/40`);
  // Two players on the SAME faction is the lobby's call; the other zones still avoid it.
  const same = load(jebus, 7, [RACE.HEAVEN, RACE.HEAVEN, RACE.RANDOM, RACE.RANDOM]);
  const others = same.zones.filter((z) => z.playerNo !== 1 && z.playerNo !== 2).map((z) => z.race);
  check('two players on one faction: every other zone is something else',
    same.players[0] === RACE.HEAVEN && same.players[1] === RACE.HEAVEN && !others.includes(RACE.HEAVEN)
      && new Set(others).size === others.length, others.map(raceName).join(' '));
}

console.log('a pool run dry');
{
  // Nine random zones on one floor against a list of eight: the ninth draws
  // among all of them and says so.
  const zone = (i: number) => jebusXml.match(/<Item>\s*<Index>2<\/Index>[\s\S]*?<\/Item>/)![0].replace('<Index>2</Index>', `<Index>${i}</Index>`);
  const nine = parseTemplate(jebusXml.replace('</Zones>', [6, 7, 8, 9].map(zone).join('') + '</Zones>'));
  const a = load(nine, 3);
  check('nine zones read', nine.zones.length === 9);
  check('the ninth zone warns and the map is still made',
    a.zones.length === 9 && a.warnings.length === 1 && a.warnings[0]!.includes('UniqueRaces'), a.warnings.join('; '));
  check('the first eight are still eight factions', new Set(a.zones.slice(0, 8).map((z) => z.race)).size === 8);
}

console.log(failures ? `\n${failures} FAILED` : '\nall good');
process.exit(failures ? 1 : 0);
