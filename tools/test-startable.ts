// The four traps that all speak with one voice — checked against maps.
//
// `ERROR: Start player does not exist on map/…` is what the engine says for
// four different mistakes, and a run is the only way it ever said which. These
// rules are that sentence taken apart (docs/MAP_PROPERTIES.md), and this suite gives
// them maps to be right about: hand-built ones for each trap, and — when the
// game is around — every map in `H5E/`, where a shipped-and-played map that the
// rules called broken would mean the rules are wrong.
//
//   node tools/test-startable.ts [--game <dir>]

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from '../src/format/xml.ts';
import { startableProblems } from '../src/map/startable.ts';
import { readEntries } from '../src/format/pak.ts';
import { gameDirIfAny } from './game-dir.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

/** A map document with the players and objects a case needs, and nothing else. */
function mapWith(opts: {
  players: { active: boolean; colour: string; team: number }[];
  owners?: string[];
  defeatAll?: boolean;
  entryPointFor?: string;
}): ReturnType<typeof parse> {
  const players = opts.players.map((p) => `\t\t<Item>
\t\t\t<ActivePlayer>${p.active}</ActivePlayer>
\t\t\t<Team>${p.team}</Team>
\t\t\t<Colour>${p.colour}</Colour>
\t\t</Item>`).join('\n');
  const heroes = (opts.owners ?? []).map((id) => `\t\t<Item href="#n:inline(AdvMapHero)">
\t\t\t<AdvMapHero>
\t\t\t\t<Shared href="/MapObjects/Haven/Alaric.(AdvMapHeroShared).xdb#xpointer(/AdvMapHeroShared)"/>
\t\t\t\t<PlayerID>${id}</PlayerID>
\t\t\t</AdvMapHero>
\t\t</Item>`).join('\n');
  // An EntryPoint: a hero by shape, and — the trap — by CLASS too. Its xpointer
  // says `AdvMapHeroShared`, exactly like a real hero's; only the DOCUMENT is
  // different. Written here with the game's own href for that reason: the
  // version with an invented class name passed a check the game failed.
  const entry = opts.entryPointFor ? `\t\t<Item href="#n:inline(AdvMapHero)">
\t\t\t<AdvMapHero>
\t\t\t\t<Shared href="/MapObjects/Utility/EntryPoint.xdb#xpointer(/AdvMapHeroShared)"/>
\t\t\t\t<PlayerID>${opts.entryPointFor}</PlayerID>
\t\t\t</AdvMapHero>
\t\t</Item>` : '';
  const objectives = opts.defeatAll ? `\t<Objectives>
\t\t<Primary><Common><Objectives><Item>
\t\t\t<Kind>OBJECTIVE_KIND_DEFEAT_ALL</Kind>
\t\t</Item></Objectives></Common></Primary>
\t</Objectives>` : '\t<Objectives/>';
  return parse(`<?xml version="1.0" encoding="UTF-8"?>
<AdvMapDesc>
\t<objects>
${[heroes, entry].filter(Boolean).join('\n')}
\t</objects>
\t<players>
${players}
\t</players>
${objectives}
</AdvMapDesc>
`);
}

const RED = { active: true, colour: 'PCOLOR_RED', team: 0 };
const BLUE = { active: true, colour: 'PCOLOR_BLUE', team: 1 };
const ALLY = { active: true, colour: 'PCOLOR_BLUE', team: 0 };
const OFF = { active: false, colour: 'PCOLOR_NEUTRAL', team: 0 };

console.log('the four traps');
{
  const nobody = startableProblems(mapWith({ players: [OFF, OFF] }));
  check('a map whose slots are all off is refused', nobody.length === 1
    && /no player slot is active/.test(nobody[0]!), nobody[0]);

  const uncoloured = startableProblems(mapWith({
    players: [{ active: true, colour: 'PCOLOR_NEUTRAL', team: 0 }], owners: ['PLAYER_1'],
  }));
  check('an active but neutral slot is refused', uncoloured.length === 1
    && /PCOLOR_NEUTRAL/.test(uncoloured[0]!), uncoloured[0]);

  const empty = startableProblems(mapWith({ players: [RED, BLUE], owners: ['PLAYER_1'] }));
  check('a live player with nothing on the map is named', empty.length === 1
    && /PLAYER_2 .*owns no hero and no town/.test(empty[0]!), empty[0]);

  const entry = startableProblems(mapWith({
    players: [RED, BLUE], owners: ['PLAYER_1'], entryPointFor: 'PLAYER_2',
  }));
  check('and an EntryPoint does not count as one', entry.length === 1
    && /PLAYER_2/.test(entry[0]!), entry[0]);

  // The one that looks like a working map, and cost this session a run.
  const allies = startableProblems(mapWith({
    players: [RED, ALLY], owners: ['PLAYER_1', 'PLAYER_2'], defeatAll: true,
  }));
  check('two players on one team with "defeat all" are refused', allies.length === 1
    && /all 2 live players are on team 0/.test(allies[0]!), allies[0]);

  const alone = startableProblems(mapWith({
    players: [RED], owners: ['PLAYER_1'], defeatAll: true,
  }));
  check('and so is a lone player with it', alone.length === 1
    && /satisfied at load/.test(alone[0]!), alone[0]);

  check('the same two on their own teams are fine', startableProblems(mapWith({
    players: [RED, BLUE], owners: ['PLAYER_1', 'PLAYER_2'], defeatAll: true,
  })).length === 0);
  check('and allies are fine when the objective is not "defeat all"',
    startableProblems(mapWith({
      players: [RED, ALLY], owners: ['PLAYER_1', 'PLAYER_2'],
    })).length === 0);
}

// ---- against the maps in the install ---------------------------------------
//
// The rules have to be right about maps that PLAY. A map in H5E/ that the game
// has started and these rules call broken is a rule that is wrong, and that is
// worth more than any hand-built case above.

const game = gameDirIfAny();
const modDir = game ? join(game, 'H5E') : '';
if (modDir && existsSync(modDir)) {
  console.log('the maps in the install');
  for (const file of readdirSync(modDir).filter((f) => /\.h5m$/i.test(f)).sort()) {
    let desc;
    try {
      const entry = readEntries(readFileSync(join(modDir, file)))
        .find((e) => /(^|[\\/])map\.xdb$/i.test(e.name));
      if (!entry) continue;
      desc = parse(entry.data.toString('latin1'));
    } catch { continue; }
    const problems = startableProblems(desc);
    // Reported, not failed: a map in that folder may be a work in progress, and
    // this suite is about the RULES. What it must never do is stay silent.
    console.log(`  ${problems.length ? 'x ' : 'ok'}  ${file}${problems.length ? ' — ' + problems.join('; ') : ''}`);
  }
} else {
  console.log('\n  (no game said — the install\'s maps are not checked; pass --game <dir>)');
}

console.log(failures ? `\n${failures} FAILED` : '\nall good');
process.exit(failures ? 1 : 0);
