// The heroes a generated map offers — an order's choice, ours.
//
//   node tools/test-rmg-heroes.ts
//
// The roster comes from the hero documents (every `AdvMapHeroShared` that is
// not a scenario's, by its `TownType`), the choice per player slot is `any`,
// `random` or a named hero, and what the map gets is `AvailableHeroes` — plus,
// for a named hero, the player's race. Held on the roster's shape, on the
// choice's rules and draws, and on a generated map's file.

import { join } from 'node:path';

import { inFront } from '../src/game/assets.ts';
import { chooseHeroes, hireableHeroes } from '../src/rmg/heroes.ts';
import { generateMap } from '../src/rmg/index.ts';
import { dataAssets, gameDirIfAny, gameInstall } from './game-dir.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

console.log('the roster');
const roster = hireableHeroes(dataAssets());
const byTown = new Map<string, number>();
for (const h of roster) byTown.set(h.town, (byTown.get(h.town) ?? 0) + 1);
console.log('  ' + [...byTown].map(([t, n]) => `${t} ${n}`).join(', '));
check('eight races, eight hireable heroes each — the scenario ones left out',
  byTown.size === 8 && [...byTown.values()].every((n) => n === 8), `${roster.length}`);
check('Orrin is Haven and hireable', roster.some((h) => h.href.includes('/Haven/Orrin.') && h.town === 'TOWN_HEAVEN'));
check('an EntryPoint is not a hero', !roster.some((h) => h.href.includes('/Utility/')));
check('Isabell and Glen are scenario heroes and not on offer', !roster.some((h) => h.href.includes('/Haven/Isabell') || h.href.includes('/Haven/Glen.')));
check('the dwarves live under MapObjects/Dwarves', roster.some((h) => h.href.includes('/Dwarves/') && h.town === 'TOWN_FORTRESS'));

console.log('the choice');
{
  const races = ['TOWN_HEAVEN', 'TOWN_INFERNO', 'TOWN_ACADEMY'];
  const orrin = roster.find((h) => h.href.includes('/Haven/Orrin.'))!.href;
  const none = chooseHeroes({ choices: ['any', 'any', 'any'], races, roster, seed: 7 });
  check('all any: nothing listed, nothing chosen', none.available.length === 0 && none.chosen.every((c) => c === null));
  const one = chooseHeroes({ choices: [orrin, 'any', 'any'], races, roster, seed: 7 });
  check('a named hero is listed, and the slots left to the game keep their whole race',
    one.chosen[0] === orrin && one.available.includes(orrin) && one.available.length === 1 + 8 + 8, `${one.available.length}`);
  const drawn = chooseHeroes({ choices: ['random', 'random', 'any'], races, roster, seed: 7 });
  const again = chooseHeroes({ choices: ['random', 'random', 'any'], races, roster, seed: 7 });
  check('random draws one of the race, and the same seed the same one',
    roster.find((h) => h.href === drawn.chosen[0])?.town === 'TOWN_HEAVEN'
      && roster.find((h) => h.href === drawn.chosen[1])?.town === 'TOWN_INFERNO'
      && drawn.chosen.join() === again.chosen.join());
  const other = chooseHeroes({ choices: ['random', 'random', 'any'], races, roster, seed: 8 });
  check('another seed draws otherwise (on one of the two slots at least)', other.chosen.join() !== drawn.chosen.join());
  const shifted = chooseHeroes({ choices: ['any', 'random', 'any'], races, roster, seed: 7 });
  check('one slot\'s choice does not move another\'s draw', shifted.chosen[1] === drawn.chosen[1]);
  const wrong = chooseHeroes({ choices: [orrin], races: ['TOWN_INFERNO'], roster, seed: 1 });
  check('a hero of another race is listed with a warning', wrong.chosen[0] === orrin && wrong.warnings.length === 1, wrong.warnings.join('; '));
  const twice = chooseHeroes({ choices: [orrin, orrin], races: ['TOWN_HEAVEN', 'TOWN_HEAVEN'], roster, seed: 1 });
  check('one hero named twice is listed once and warned about — the lobby seats him once',
    twice.available.length === 1 && twice.warnings.length === 1 && twice.warnings[0]!.includes('already player 1'), twice.warnings.join('; '));
  const missing = chooseHeroes({ choices: ['/MapObjects/Haven/Nobody.(AdvMapHeroShared).xdb'], races: ['TOWN_HEAVEN'], roster, seed: 1 });
  check('a hero not in the data is a warning and the slot is left to the game',
    missing.chosen[0] === null && missing.warnings.length === 1 && missing.available.length === 8);
}

const game = gameDirIfAny();
if (!game) {
  console.log('the map: skipped — say --game <dir> or HOMM5_GAME');
} else {
  console.log('the map');
  const install = gameInstall(inFront(join(import.meta.dirname, '..', 'assets', 'rmg'), dataAssets()));
  const orrin = roster.find((h) => h.href.includes('/Haven/Orrin.'))!.href;
  const base = {
    seed: 202, template: 'S1P2Z2M1', sizeIndex: 1, underground: false, water: 0, players: 2,
    monsterLevel: 1, resourceMultiplier: 1, expMultiplier: 1, grail: false, randomTowns: false,
    minimap: false, mapName: 'Heroes', guid: '00000000-0000-0000-0000-000000000000',
  };
  const plain = generateMap(install, base);
  const named = generateMap(install, { ...base, heroes: [orrin, 'random'] });
  const xdb = (m: typeof plain): string => m.files.find((f) => f.name === 'map.xdb')!.data.toString('latin1');
  check('no heroes asked: the engine\'s empty roster', xdb(plain).includes('<AvailableHeroes/>'));
  const listed = /<AvailableHeroes>([\s\S]*?)<\/AvailableHeroes>/.exec(xdb(named))?.[1] ?? '';
  const hrefs = [...listed.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!);
  check('Orrin and one drawn hero listed, nobody else', hrefs.length === 2 && hrefs.includes(orrin), hrefs.join(' '));
  check('player 1 is Haven, because Orrin is', /<Race>TOWN_HEAVEN<\/Race>/.test(xdb(named).split('<PlayersInfo>')[1] ?? ''));
  check('HeroInTown stays true — the lobby still picks', (xdb(named).match(/<HeroInTown>true<\/HeroInTown>/g) ?? []).length === 2);
  check('no warnings on a clean order', named.warnings.length === 0, named.warnings.join('; '));
}

console.log(failures ? `\n${failures} FAILED` : '\nall good');
process.exit(failures ? 1 : 0);
