// A zone's treasure blocks by RANGES — ours, a template's `<TreasureBlocks>`.
//
//   node tools/test-rmg-treasure-ranges.ts
//
// The engine values a zone's blocks by splitting one total over the seats it
// found, far from the town rich; a Heroes III template says `Low / High /
// Density` instead, and so can ours: `Count` blocks worth a draw in
// `[Min, Max]` each, the richest range on the farthest seats. The guard and
// the artifact follow from the value the engine's way, which is what makes
// the range the lever between relics and trinkets — held here on the whole
// generator, off the artifacts' costs on the finished map, and the two
// warnings (seats running out, a range beyond any artifact's window) held on
// variants written for the purpose.

// needs: game
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { inFront } from '../src/game/assets.ts';
import { readArtifacts, rmgArtifactPool } from '../src/rmg/artifacts.ts';
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
  check('the middle zone carries three ranges, relics first as written',
    middle.treasureBlocks.length === 3 && middle.treasureBlocks[0]!.min === 15000
      && middle.treasureBlocks[0]!.max === 28000 && middle.treasureBlocks[0]!.count === 3);
  check('a start zone carries none and keeps its total',
    t.zones.filter((z) => z.index !== 1).every((z) => z.treasureBlocks.length === 0 && z.treasureBlocksTotalValue === 10000));
  const bare = parseTemplate(readFileSync(join(import.meta.dirname, '..', 'data-unpacked', 'RMG', 'Templates', 'S1P2Z2M1.xdb'), 'utf8'));
  check('the game\'s own zones read with none', bare.zones.every((z) => z.treasureBlocks.length === 0));
}

const game = gameDirIfAny();
if (!game) {
  console.log('the generator: skipped — say --game <dir> or HOMM5_GAME');
} else {
  const root = join(tmpdir(), 'homm5-editor', 'treasure-range-templates');
  mkdirSync(join(root, 'RMG', 'Templates'), { recursive: true });
  const install = gameInstall(inFront(root, inFront(OWN, dataAssets())));
  const cost = new Map(rmgArtifactPool(readArtifacts(dataAssets()), false)
    .map((a) => [a.href.replace(/#.*$/, ''), a.cost]));
  /** Every artifact's cost in a zone, dearest first. */
  const costsIn = (run: FullRun, zone: number): number[] => {
    const grid = run.c.gridAtFillTerrain[0]!;
    return run.objects
      .filter((o) => o.kind === 'artifact' && grid[o.y]![o.x] === zone)
      .map((o) => cost.get((o.shared ?? '').replace(/#.*$/, '')) ?? -1)
      .sort((a, b) => b - a);
  };

  console.log('Jebus Cross as shipped: the middle holds the relics');
  for (const seed of [202, 7]) {
    const run = runFull(install, { template: 'Jebus Cross', size: 136, players: 4, seed, monsterStrength: 1, water: 0 });
    const middle = costsIn(run, 1);
    console.log(`  seed ${seed}: middle ${middle.join(' ')}`);
    // 15000..28000 admits costs 11000..28000 (cost/5 + 500 < value < cost*7/5).
    check('three blocks of the relic range, each with an artifact of 11000 or dearer',
      middle.length >= 3 && middle.slice(0, 3).every((c) => c >= 11000));
    // The richest ranges are served first; the cheapest takes the seats that
    // remain, and how many there are is the roads' and the guards' business
    // (a seed with the back ways' guards on the border has one seat fewer).
    // So: the dearer two whole, the cheapest short only with a line saying so.
    check('the two dearer ranges are served whole, the cheapest says so if short',
      middle.length >= 7 && run.c.warnings.every((w) => w.includes('2500..4000')),
      `${middle.length} artifacts; ${run.c.warnings.join('; ') || 'no warnings'}`);
    const starts = [2, 3, 4, 5].flatMap((z) => costsIn(run, z));
    check('a start zone, on its split total, gets no relic', starts.every((c) => c < 11000), starts.join(' '));
  }

  console.log('the two warnings');
  {
    const greedy = jebusXml
      .replace('<Name>Jebus Cross</Name>', '<Name>Jebus Greedy</Name>')
      .replace('<Count>3</Count>', '<Count>100</Count>');
    writeFileSync(join(root, 'RMG', 'Templates', 'Jebus Greedy.h5et'), greedy);
    const run = runFull(install, { template: 'Jebus Greedy', size: 136, players: 4, seed: 202, monsterStrength: 1, water: 0 });
    check('a hundred relic blocks asked: the seats are all relics, the rest a warning',
      run.c.warnings.some((w) => w.includes('15000..28000 asked 100, seats for')), run.c.warnings.join('; '));
    check('and the map is still made, the poorer ranges going without', costsIn(run, 1).every((c) => c >= 11000));

    const rich = jebusXml
      .replace('<Name>Jebus Cross</Name>', '<Name>Jebus Rich</Name>')
      .replace('<Max>28000</Max>', '<Max>50000</Max>');
    writeFileSync(join(root, 'RMG', 'Templates', 'Jebus Rich.h5et'), rich);
    const run2 = runFull(install, { template: 'Jebus Rich', size: 136, players: 4, seed: 202, monsterStrength: 1, water: 0 });
    check('a range beyond every artifact\'s window is said so',
      run2.c.warnings.some((w) => w.includes('admits no artifact')), run2.c.warnings.join('; '));
  }
}

console.log(failures ? `\n${failures} FAILED` : '\nall good');
process.exit(failures ? 1 : 0);
