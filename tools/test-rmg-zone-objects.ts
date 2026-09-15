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

  // THE GUARD MULTIPLIER, and the warning. Jebus's middle guards at 2, its
  // start zones at 0.5; a variant at 1 everywhere is the control — the same
  // seed, the same mines and buildings, the armies' power the only
  // difference. The powers go through the engine's own SetMonster ladder,
  // so what is compared is the ladder's answer weighed the way it weighs
  // it — creatures × each creature's power — and NOT a head count, which
  // is not monotone in the power: a dearer tier comes in fewer heads, and
  // a head count once passed this check by luck and failed it on the
  // next template change.
  console.log('the guard multiplier, and the warning');
  {
    const flat = jebusXml
      .replace('<Name>Jebus Cross</Name>', '<Name>Jebus Flat</Name>')
      .replace(/<GuardMultiplier>[^<]*<\/GuardMultiplier>\n/g, '');
    writeFileSync(join(root, 'RMG', 'Templates', 'Jebus Flat.h5et'), flat);
    const thousand = jebusXml
      .replace('<Name>Jebus Cross</Name>', '<Name>Jebus Thousand</Name>')
      .replace('<Min>1</Min>', '<Min>1000</Min>').replace('<Max>1</Max>', '<Max>1000</Max>');
    writeFileSync(join(root, 'RMG', 'Templates', 'Jebus Thousand.h5et'), thousand);
    const order = { size: 136, players: 4, seed: 202, monsterStrength: 1, water: 0 };
    const strong = runFull(install, { ...order, template: 'Jebus Cross' });
    const flatRun = runFull(install, { ...order, template: 'Jebus Flat' });
    const creatures = (run: FullRun, zone: number): number => {
      const grid = run.c.gridAtFillTerrain[0]!;
      let n = 0;
      for (const o of run.objects) {
        if (!o.army || grid[o.y]![o.x] !== zone) continue;
        for (const st of o.army.stacks) n += st.amount * (run.c.tables.powerByName.get(st.creature) ?? 0);
      }
      return n;
    };
    check('a template of ours reads its multipliers',
      strong.c.template.zones.map((z) => z.guardMultiplier).join(',') === '2,0.5,0.5,0.5,0.5');
    check('one without them reads 1 everywhere', flatRun.c.template.zones.every((z) => z.guardMultiplier === 1));
    check('the middle\'s armies are bigger at 2 than at 1', creatures(strong, 1) > creatures(flatRun, 1),
      `${creatures(strong, 1)} vs ${creatures(flatRun, 1)} of army power`);
    check('a start zone\'s are smaller at 0.5 than at 1', creatures(strong, 2) < creatures(flatRun, 2),
      `${creatures(strong, 2)} vs ${creatures(flatRun, 2)} of army power`);
    check('a clean run warns of nothing', strong.c.warnings.length === 0, strong.c.warnings.join('; '));
    const many = runFull(install, { ...order, template: 'Jebus Thousand' });
    const utopias = countBy(many, UTOPIA).get(1) ?? 0;
    check('a thousand Utopias asked: what fits is placed, the rest is a warning, not a refusal',
      utopias > 1 && utopias < 1000 && many.c.warnings.some((w) => w.includes(`Dragon_Utopia asked 1000, placed ${utopias}`)),
      `${utopias} placed; ${many.c.warnings.join('; ')}`);
  }
}

console.log(failures ? `\n${failures} FAILED` : '\nall good');
process.exit(failures ? 1 : 0);
