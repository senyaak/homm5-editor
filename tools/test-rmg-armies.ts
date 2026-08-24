// SetMonster — the guards, replayed from the draws the engine spent on them.
//
//   node tools/test-rmg-armies.ts
//
// The traced run recorded every draw of the connections phase, and the map
// it produced records the guards those draws made. So this suite feeds the
// RECORDED values back in and asks for the RECORDED armies — creature by
// creature, count by count. Nothing here is simulated: the inputs come from
// the log, the expectations from map.xdb.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { readArmyTemplates, setMonster } from '../src/rmg/armies.ts';
import type { DrawSource, GuardTables } from '../src/rmg/armies.ts';
import { readCreatures } from '../src/rmg/creatures.ts';
import { dataDir } from './game-dir.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const dir = dataDir();
if (!existsSync(join(dir, 'RMG'))) {
  console.log('no unpacked RMG data — skipping');
  process.exit(0);
}

const creatures = readCreatures(dir);
const templates = readArmyTemplates(dir);
const tables: GuardTables = {
  templates,
  creatures,
  powerByName: new Map(creatures.map((c) => [c.name, c.power])),
};

console.log('the tables the guard setter reads');
check('180 creatures, in reference-table order', creatures.length === 180, `${creatures.length}`);
check('240 army templates, in file order', templates.length === 240, `${templates.length}`);
check('the skipped ids are the ones with no adventure object',
  creatures[89]!.name === 'CREATURE_BLACK_KNIGHT' && creatures[114]!.name === 'CREATURE_SNOW_APE');

/** A draw source that replays what the oracle recorded. */
function replay(values: Array<{ kind: 'b' | 'f'; value: number }>): DrawSource {
  let at = 0;
  const take = (kind: 'b' | 'f'): number => {
    const next = values[at++];
    if (!next || next.kind !== kind) throw new Error(`replay: expected ${kind} at ${at - 1}`);
    return next.value;
  };
  return { below: () => take('b'), betweenFloat: () => take('f') };
}

/** The log records a float as its bits; turn them back into the number. */
function floatFromBits(bits: number): number {
  const buf = new ArrayBuffer(4);
  new Int32Array(buf)[0] = bits;
  return new Float32Array(buf)[0]!;
}

console.log('\nthe three guards of the reference run');

// Straight out of bin/homm5-editor-rmg.log, counters 18477..18491: each
// guard is a betweenFloat, then its branch's picks, then two name draws.
const guards = [
  {
    label: 'passage 1-2, strength 12',
    power: 1000 * 2 * 12,
    draws: [
      { kind: 'f' as const, value: floatFromBits(1059560179) },
      { kind: 'b' as const, value: 0 },     // desired = 10 + 0
      { kind: 'b' as const, value: 9 },     // the creature
      { kind: 'b' as const, value: 55335 }, // name, high
      { kind: 'b' as const, value: 62089 }, // name, low
    ],
  },
  {
    label: 'passage 3-1, strength 3',
    power: 1000 * 2 * 3,
    draws: [
      { kind: 'f' as const, value: floatFromBits(1049779564) },
      { kind: 'b' as const, value: 10 },    // the template
      { kind: 'b' as const, value: 7792 },
      { kind: 'b' as const, value: 8070 },
    ],
  },
  {
    label: 'passage 2-4, strength 3',
    power: 1000 * 2 * 3,
    draws: [
      { kind: 'f' as const, value: floatFromBits(1035503858) },
      { kind: 'b' as const, value: 14 },
      { kind: 'b' as const, value: 17798 },
      { kind: 'b' as const, value: 64951 },
    ],
  },
];

const produced = guards.map((g) => setMonster(g.power, 1, tables, replay(g.draws)));
for (let i = 0; i < guards.length; i++) {
  const guard = produced[i];
  check(`${guards[i]!.label} produced a guard`, !!guard,
    guard ? `${guard.branch}: ${guard.stacks.map((s) => `${s.amount} ${s.creature}`).join(', ')}` : 'none');
}

console.log('\nagainst the monsters in the reference map.xdb');

const mapFile = join('_tmp', 'gt-b', 'Maps', 'RMG', '906422BB-D3D0-4E69-B49F-F28029C6FCE5', 'map.xdb');
if (!existsSync(mapFile)) {
  console.log(`  no ${mapFile} — extract the reference map to compare; skipping`);
} else {
  const xml = readFileSync(mapFile, 'utf8');
  interface RefMonster { name: string; stacks: Array<{ creature: string; amount: number }> }
  const refs: RefMonster[] = [];
  for (const m of xml.matchAll(/<AdvMapMonster>([^]*?)<\/AdvMapMonster>/g)) {
    const body = m[1]!;
    // The instance name lives on the wrapper, as an attribute:
    //   <Item href="#n:inline(AdvMapMonster)" id="item_-668470647">
    const before = xml.slice(Math.max(0, m.index! - 200), m.index!);
    const name = /id="([^"]+)"\s*>\s*$/.exec(before)?.[1] ?? '';
    // The first stack is named by its AdvMapMonsterShared file; the rest
    // carry their CREATURE_* enum outright.
    const stacks: Array<{ creature: string; amount: number }> = [];
    const lead = /<Shared href="[^"]*\/([A-Za-z_0-9]+)\.\(AdvMapMonsterShared\)/.exec(body)?.[1];
    const leadAmount = Number(/<Amount>(\d+)<\/Amount>/.exec(body)?.[1] ?? 0);
    if (lead) stacks.push({ creature: lead, amount: leadAmount });
    const additional = /<AdditionalStacks>([^]*?)<\/AdditionalStacks>/.exec(body);
    if (additional) {
      for (const s of additional[1]!.matchAll(/<Creature>([^<]*)<\/Creature>[^]*?<Amount>(\d+)<\/Amount>/g)) {
        stacks.push({ creature: s[1]!, amount: Number(s[2]) });
      }
    }
    refs.push({ name, stacks });
  }
  check('the map holds monsters to compare against', refs.length >= 3, `${refs.length} monsters`);

  // The connections phase places its guards first, in the order the draws
  // were spent, so the first three monsters are ours.
  const short = (s: { creature: string; amount: number }): string =>
    `${s.creature.replace('CREATURE_', '').replace(/_/g, '').toLowerCase()}x${s.amount}`;
  for (let i = 0; i < Math.min(3, refs.length, produced.length); i++) {
    const ours = produced[i];
    const ref = refs[i]!;
    if (!ours) { check(`guard ${i + 1} exists`, false); continue; }
    const oursShort = ours.stacks.map(short).join(' ');
    const refShort = ref.stacks.map(short).join(' ');
    check(`guard ${i + 1} is the engine's army, creature for creature`, oursShort === refShort,
      `${oursShort} vs ${refShort}`);
    check(`guard ${i + 1} carries the name the draws minted`, ours.name === ref.name,
      `${ours.name} vs ${ref.name}`);
  }
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
