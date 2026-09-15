// A zone's named objects — ours, a template's `<Objects>` (`.h5et`).
//
//   node tools/test-rmg-zone-objects.ts
//
// The game's zone says how many mines and dwellings by tier and how many
// points to spend by category; which building a budget buys is the draw's.
// `<Objects>` names one: a floor placed before the budgets, a ceiling the
// budgets honour, a guard if asked. Held here on Jebus Cross (its middle
// carries a guarded Dragon Utopia, one and one only) and on a variant of it
// written for the purpose — a treasury the middle may not have at all, a
// shop every start zone must have twice — with the whole generator run and
// the objects counted zone by zone off the finished map.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { inFront } from '../src/game/assets.ts';
import { runFull } from '../src/rmg/run.ts';
import type { FullRun } from '../src/rmg/run.ts';
import { parseTemplate } from '../src/rmg/template.ts';
import { dataAssets, gameDirIfAny, gameInstall } from './game-dir.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const OWN = join(import.meta.dirname, '..', 'assets', 'rmg');
const jebusXml = readFileSync(join(OWN, 'RMG', 'Templates', 'Jebus Cross.h5et'), 'utf8');

console.log('reading');
{
  const t = parseTemplate(jebusXml);
  const middle = t.zones.find((z) => z.index === 1)!;
  check('the middle zone names a Dragon Utopia, 1..1, guarded at 30',
    middle.objects.length === 1 && middle.objects[0]!.href.includes('Dragon_Utopia')
      && middle.objects[0]!.min === 1 && middle.objects[0]!.max === 1 && middle.objects[0]!.guardStrenght === 30);
  check('a zone without the list has none', t.zones.every((z) => z.index === 1 || z.objects.length === 0));
  const bare = parseTemplate(jebusXml.replace(/<Objects>[\s\S]*?<\/Objects>/, ''));
  check('the game\'s own zone reads with an empty list', bare.zones.every((z) => z.objects.length === 0));
  const noMax = parseTemplate(jebusXml.replace('<Max>1</Max>', ''));
  check('no <Max> means no ceiling', noMax.zones[0]!.objects[0]!.max === Number.POSITIVE_INFINITY);
}

const game = gameDirIfAny();
if (!game) {
  console.log('the generator: skipped — say --game <dir> or HOMM5_GAME');
} else {
  // A root of our own with the variant beside the shipped Jebus, so the
  // shipped file stays what the dialog lists.
  const root = join(tmpdir(), 'homm5-editor', 'zone-objects-templates');
  mkdirSync(join(root, 'RMG', 'Templates'), { recursive: true });
  const UTOPIA = '/MapObjects/Dragon_Utopia.(AdvMapBuildingShared).xdb';
  const CRYPT = '/MapObjects/Crypt.(AdvMapBuildingShared).xdb';
  const TRADING = '/MapObjects/Trading_Post.(AdvMapBuildingShared).xdb';
  const startObjects = `<Objects><Item><Href>${TRADING}</Href><Min>2</Min><Max>2</Max></Item></Objects>`;
  const variant = jebusXml
    .replace('<Name>Jebus Cross</Name>', '<Name>Jebus Objects</Name>')
    // The middle: the Utopia as shipped, plus no Crypt at all.
    .replace('</Objects>', `<Item><Href>${CRYPT}</Href><Max>0</Max></Item></Objects>`)
    // Every start zone: two trading posts, and not a third.
    .replace(/<BuffPoints>0<\/BuffPoints>\n\t\t<\/Item>/g, (m, offset: number, whole: string) =>
      // The middle zone's block already has its own list; the rest get theirs.
      whole.lastIndexOf('<Objects>', offset) > whole.lastIndexOf('<Index>', offset)
        ? m
        : `<BuffPoints>0</BuffPoints>\n\t\t\t${startObjects}\n\t\t</Item>`);
  writeFileSync(join(root, 'RMG', 'Templates', 'Jebus Objects.h5et'), variant);
  const install = gameInstall(inFront(root, inFront(OWN, dataAssets())));

  const countBy = (run: FullRun, href: string): Map<number, number> => {
    const grid = run.c.gridAtFillTerrain[0]!;
    const out = new Map<number, number>();
    for (const o of run.objects) {
      if (!o.shared || !o.shared.startsWith(href)) continue;
      const zone = grid[o.y]![o.x]!;
      out.set(zone, (out.get(zone) ?? 0) + 1);
    }
    return out;
  };
  const guardsNear = (run: FullRun, o: { x: number; y: number }): number =>
    run.objects.filter((g) => g.army && Math.abs(g.x - o.x) <= 3 && Math.abs(g.y - o.y) <= 3).length;

  console.log('Jebus Cross as shipped: the middle\'s Utopia');
  {
    const run = runFull(install, { template: 'Jebus Cross', size: 136, players: 4, seed: 202, monsterStrength: 1, water: 0 });
    const utopias = countBy(run, UTOPIA);
    check('one Dragon Utopia in the middle zone and nowhere else',
      utopias.get(1) === 1 && [...utopias.keys()].every((z) => z === 1), JSON.stringify([...utopias]));
    const it = run.objects.find((o) => o.shared?.startsWith(UTOPIA))!;
    check('and a guard beside it', guardsNear(run, it) >= 1);
  }

  console.log('Jebus Objects: ceilings and floors');
  for (const seed of [7, 4242]) {
    const run = runFull(install, { template: 'Jebus Objects', size: 136, players: 4, seed, monsterStrength: 1, water: 0 });
    const crypts = countBy(run, CRYPT);
    const posts = countBy(run, TRADING);
    console.log(`  seed ${seed}: crypts ${JSON.stringify([...crypts])}, trading posts ${JSON.stringify([...posts])}`);
    check('no Crypt in the middle', !crypts.has(1));
    check('exactly two trading posts in every start zone',
      [2, 3, 4, 5].every((z) => posts.get(z) === 2));
  }

  // THE CEILING, CHECKED BY SABOTAGE: "no Crypt in the middle" proves
  // nothing on a seed whose budget never bought one. So find a seed where
  // the shipped Jebus DOES put a Crypt in the middle, and hold the variant
  // — the same seed, the same everything, the ceiling added — to none.
  console.log('the ceiling bites where the budget would have bought');
  {
    let seed = 0;
    for (let s = 100; s < 140 && !seed; s++) {
      const run = runFull(install, { template: 'Jebus Cross', size: 136, players: 4, seed: s, monsterStrength: 1, water: 0 });
      if (countBy(run, CRYPT).has(1)) seed = s;
    }
    check('a seed whose middle buys a Crypt exists among forty', seed > 0, `${seed}`);
    if (seed) {
      const capped = runFull(install, { template: 'Jebus Objects', size: 136, players: 4, seed, monsterStrength: 1, water: 0 });
      check(`seed ${seed} under the ceiling buys none there`, !countBy(capped, CRYPT).has(1),
        JSON.stringify([...countBy(capped, CRYPT)]));
    }
  }
}

console.log(failures ? `\n${failures} FAILED` : '\nall good');
process.exit(failures ? 1 : 0);
