// The `map-tag.xdb` a packed map is listed by (src/map/map-tag.ts).
//
// A map without a tag never appears in the game's menus, and a tag whose
// `<teams>` is wrong lists the map as the wrong game: a four-player map offered
// as one side, or as none at all. Neither is an error anybody sees — the map is
// simply not the map it was.
//
// So the sides are checked against THE GAME'S OWN TAGS, all of them. Every
// shipped map that carries one is a worked example, written by the tool this
// one is meant to replace, and the rule either reproduces them or it is a
// guess. It was a guess: the version this replaced fits 12 of 69.
//
// The shape checks below run anywhere; the survey needs the unpacked data and
// says so when there is none, rather than passing quietly.
//
//   node tools/test-map-tag.ts

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { buildMapTag, teamSizes } from '../src/map/map-tag.ts';
import { loadMap } from '../src/map/map.ts';
import { dataDir } from './game-dir.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

/** A player as the desc tree gives one. */
const p = (active: boolean, team: number, colour = 'PCOLOR_NEUTRAL'): Record<string, string> =>
  ({ ActivePlayer: String(active), Team: String(team), Colour: colour });

// --- the rule, stated ---------------------------------------------------------

console.log('THE SIDES');

check('nobody active is no sides at all', teamSizes([p(false, 0), p(false, 0)], false).length === 0);

check('without custom teams every active player is his own side',
  teamSizes([p(true, 0), p(true, 0), p(true, 0)], false).join(',') === '1,1,1');

check('...and the Team field is ignored while it is off',
  teamSizes([p(true, 3), p(true, 3)], false).join(',') === '1,1');

check('with custom teams the field means it',
  teamSizes([p(true, 0), p(true, 0), p(true, 1), p(true, 1)], true).join(',') === '2,2');

check('and team 0 is a team like any other',
  teamSizes([p(true, 0), p(true, 0), p(true, 0)], true).join(',') === '3');

check('sides come out in team order',
  teamSizes([p(true, 2), p(true, 0), p(true, 0)], true).join(',') === '2,1');

// The half that wrote `<teams/>` for most shipped maps.
check('a neutral colour is still a side',
  teamSizes([p(true, 0, 'PCOLOR_NEUTRAL'), p(true, 0, 'PCOLOR_NEUTRAL')], false).join(',') === '1,1');

check('an inactive player is not, whatever his colour',
  teamSizes([p(true, 0, 'PCOLOR_RED'), p(false, 0, 'PCOLOR_BLUE')], false).join(',') === '1');

// --- against every tag the game ships ------------------------------------------

const DATA = dataDir();
const MAPS = join(DATA, 'Maps');
if (!existsSync(MAPS)) {
  console.log('\nskip — the survey needs the unpacked data; pass --data <dir> or set HOMM5_DATA');
} else {
  console.log('\nAGAINST EVERY SHIPPED TAG');
  const dirs: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(d, e.name));
      else if (e.name === 'map-tag.xdb') dirs.push(d);
    }
  };
  walk(MAPS);

  const itemsOf = (xml: string): number[] => {
    const block = /<teams>([\s\S]*?)<\/teams>/.exec(xml);
    return block ? [...block[1]!.matchAll(/<Item>(-?\d+)<\/Item>/g)].map((m) => +m[1]!) : [];
  };

  let compared = 0; const wrong: string[] = []; const skipped: string[] = [];
  for (const dir of dirs) {
    const at = dir.slice(MAPS.length + 1);
    // The map document beside the tag: the only other .xdb with a <players> list.
    const doc = readdirSync(dir).filter((f) => f.endsWith('.xdb') && f !== 'map-tag.xdb')
      .map((f) => readFileSync(join(dir, f), 'latin1'))
      .find((t) => t.includes('<players>'));
    if (!doc) { skipped.push(`${at}: no document with a <players> list`); continue; }
    let ours: number[];
    // NAMED, not swallowed. A map this cannot read is a map the survey does not
    // cover, and a survey that quietly shrinks reads as "everything agrees".
    try { ours = itemsOf(buildMapTag(loadMap(doc).desc)); } catch (e) {
      skipped.push(`${at}: ${(e as Error).message}`); continue;
    }
    const theirs = itemsOf(readFileSync(join(dir, 'map-tag.xdb'), 'latin1'));
    compared++;
    if (ours.join(',') !== theirs.join(',')) {
      wrong.push(`${at}: theirs [${theirs}] ours [${ours}]`);
    }
  }
  for (const s of skipped) console.log(`        not compared: ${s}`);

  // OUR OWN maps are in this tree too — the e2e writes its work into the data
  // root — and one of them was written by the rule this replaces. The game's
  // are what the rule answers to, so a disagreement with one of ours is
  // reported and not counted against it.
  // AND TWO OF THE GAME'S OWN were written by that same older rule, so no single
  // rule can reproduce all 68. Straker Atk and Straker Def are the ONLY shipped
  // maps where CustomTeams is false and the active players sit on different
  // teams — two players, teams 0 and 1 — and their tags read [1,2], which is the
  // team numbers plus one, not the sizes of two sides. Sizes would be [1,1], and
  // [1,2] would mean three players on a map that has two. Checked across the
  // whole tree: no other map can tell the two readings apart, and 66 of them
  // agree with sizes only. So these two are named, and named exactly — if one of
  // them ever starts matching, the survey has changed under us and should say so.
  const ODD = new Map([
    ['SingleMissions\\Straker Atk', 'theirs [1,2] ours [1,1]'],
    ['SingleMissions\\Straker Def', 'theirs [1,2] ours [1,1]'],
  ]);
  const shipped = wrong.filter((w) => !/test|e2e/i.test(w))
    .filter((w) => ODD.get(w.split(':')[0]!) !== w.split(': ')[1]);
  check(`every shipped tag is reproduced (${compared - wrong.length}/${compared} exactly, `
    + `two by the older rule)`, shipped.length === 0, shipped.slice(0, 5).join(' | '));
  for (const [at, how] of ODD) {
    check(`${at} still disagrees the way it always has`,
      wrong.some((w) => w === `${at}: ${how}`), 'it now matches, or fails differently');
  }
  for (const w of wrong.filter((x) => /test|e2e/i.test(x))) console.log(`        ours, older: ${w}`);
  check('and there were tags to compare against at all', compared > 50, String(compared));
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
