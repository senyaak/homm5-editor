// The heroes a generated map offers — an order's choice, ours.
//
//   node tools/test-rmg-heroes.ts
//
// The roster comes from the hero documents (every `AdvMapHeroShared` that is
// not a scenario's, by its `TownType`, with the name the game shows), an
// order names a race a player and either a white list of heroes or "every
// hero of the players' races", and what the map gets is `AvailableHeroes` and
// the players' races. Held on the roster's shape, on the offer's rules, and
// on a generated map's file.

// needs: game
import { join } from 'node:path';

import { inFront } from '../src/game/assets.ts';
import { availableHeroes, hireableHeroes } from '../src/rmg/heroes.ts';
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
check('the names are the game\'s, not the files\' — no orc is Hero1',
  !roster.some((h) => /^Hero\d$/.test(h.name)) && roster.every((h) => h.name.length > 0),
  roster.filter((h) => h.town === 'TOWN_STRONGHOLD').map((h) => h.name).join(', '));

console.log('the offer');
{
  const races = ['TOWN_HEAVEN', 'TOWN_INFERNO', 'TOWN_ACADEMY'];
  const orrin = roster.find((h) => h.href.includes('/Haven/Orrin.'))!.href;
  const none = availableHeroes({ races, roster });
  check('nothing asked: nothing listed', none.available.length === 0 && none.warnings.length === 0);
  const ofRaces = availableHeroes({ ofRaces: races, races, roster });
  check('of the races: every hero of the three, nobody else',
    ofRaces.available.length === 24 && ofRaces.available.every((href) => races.includes(roster.find((h) => h.href === href)!.town)), `${ofRaces.available.length}`);
  const one = availableHeroes({ listed: [orrin], races, roster });
  check('a white list of one is listed as is, no warning', one.available.length === 1 && one.available[0] === orrin && one.warnings.length === 0);
  const bare = availableHeroes({ listed: [orrin.replace(/#.*$/, '')], races, roster });
  check('an href without its pointer names the same hero, listed with the pointer', bare.available[0] === orrin);
  const wrong = availableHeroes({ listed: [orrin], races: ['TOWN_INFERNO'], roster });
  check('a hero of a race no player has is listed with a warning', wrong.available.length === 1 && wrong.warnings.length === 1, wrong.warnings.join('; '));
  const twice = availableHeroes({ listed: [orrin, orrin], races, roster });
  check('one hero listed twice is listed once', twice.available.length === 1 && twice.warnings.length === 0);
  const missing = availableHeroes({ listed: ['/MapObjects/Haven/Nobody.(AdvMapHeroShared).xdb', orrin], races, roster });
  check('a hero not in the data is a warning and left out', missing.available.length === 1 && missing.warnings.length === 1, missing.warnings.join('; '));
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
  const named = generateMap(install, { ...base, races: ['TOWN_HEAVEN', 'random'], heroes: [orrin] });
  const xdb = (m: typeof plain): string => m.files.find((f) => f.name === 'map.xdb')!.data.toString('latin1');
  check('no heroes asked: the engine\'s empty roster', xdb(plain).includes('<AvailableHeroes/>') && plain.heroes.length === 0);
  const hrefsOf = (m: typeof plain): string[] => [...(/<AvailableHeroes>([\s\S]*?)<\/AvailableHeroes>/.exec(xdb(m))?.[1] ?? '').matchAll(/href="([^"]+)"/g)].map((x) => x[1]!);
  check('the white list is the map\'s list — Orrin, nobody else', hrefsOf(named).join() === orrin && named.heroes.join() === orrin, hrefsOf(named).join(' '));
  check('player 1 is Haven, because the order says so', /<Race>TOWN_HEAVEN<\/Race>/.test(xdb(named).split('<PlayersInfo>')[1] ?? '') && named.playerRaces[0] === 'TOWN_HEAVEN');
  check('player 2 came out as a race of the map, and the run says which', /^TOWN_[A-Z]+$/.test(named.playerRaces[1] ?? ''), named.playerRaces.join(', '));
  check('HeroInTown stays true — the lobby still picks', (xdb(named).match(/<HeroInTown>true<\/HeroInTown>/g) ?? []).length === 2);
  check('no warnings on a clean order', named.warnings.length === 0, named.warnings.join('; '));
  const ofRaces = generateMap(install, { ...base, races: ['TOWN_HEAVEN', 'TOWN_INFERNO'], heroesOfRaces: true, heroes: [orrin] });
  check('of the races: sixteen heroes of the two, the white list not read', hrefsOf(ofRaces).length === 16
    && hrefsOf(ofRaces).every((href) => ['TOWN_HEAVEN', 'TOWN_INFERNO'].includes(roster.find((h) => h.href === href)!.town)), `${hrefsOf(ofRaces).length}`);
  let refused = '';
  try { generateMap(install, { ...base, races: ['TOWN_MARS'] }); } catch (e) { refused = e instanceof Error ? e.message : String(e); }
  check('a race that is not one is refused', refused.includes('TOWN_MARS'), refused);
}

console.log(failures ? `\n${failures} FAILED` : '\nall good');
process.exit(failures ? 1 : 0);
