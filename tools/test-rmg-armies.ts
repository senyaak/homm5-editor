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
import { hasReference, REFERENCE_MAP, REFERENCE_MISSING } from './rmg-reference.ts';

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

/** The creature an `AdvMapMonsterShared` file stands for, asked of the file. */
function creatureOf(href: string): string {
  const path = join(dir, href.replace(/^\//, ''));
  if (!existsSync(path)) return href.split('/').pop() ?? href;
  return /<Creature>([^<]*)<\/Creature>/.exec(readFileSync(path, 'utf8'))?.[1] ?? href;
}

console.log('\nagainst the monsters in the reference map.xdb');

if (!hasReference()) {
  console.log(`  ${REFERENCE_MISSING}`);
} else {
  const xml = readFileSync(REFERENCE_MAP, 'utf8');
  interface RefMonster { name: string; stacks: Array<{ creature: string; amount: number }> }
  const refs: RefMonster[] = [];
  for (const m of xml.matchAll(/<AdvMapMonster>([^]*?)<\/AdvMapMonster>/g)) {
    const body = m[1]!;
    // The instance name lives on the wrapper, as an attribute:
    //   <Item href="#n:inline(AdvMapMonster)" id="item_-668470647">
    const before = xml.slice(Math.max(0, m.index! - 200), m.index!);
    const name = /id="([^"]+)"\s*>\s*$/.exec(before)?.[1] ?? '';
    // The first stack is named by its AdvMapMonsterShared FILE; the rest carry
    // their CREATURE_* enum outright. Those two do not always spell the same
    // creature the same way — the file is `Centaur_Marauder` where the enum is
    // `CREATURE_CENTAUR_MARADEUR`, and `Blood_Witch_upg2` where the enum is
    // `CREATURE_BLOOD_WITCH_2` — so the file is opened and asked, rather than
    // its name being compared to one.
    const stacks: Array<{ creature: string; amount: number }> = [];
    const leadFile = /<Shared href="([^"#]*)/.exec(body)?.[1];
    const leadAmount = Number(/<Amount>(\d+)<\/Amount>/.exec(body)?.[1] ?? 0);
    if (leadFile) stacks.push({ creature: creatureOf(leadFile), amount: leadAmount });
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

  // -------------------------------------------------------------------------
  // The eighteen guards of the mines step
  //
  // Same function, eighteen more times, and they are here for two reasons.
  //
  // They widen the check: three guards took two of the branches between them,
  // and these take both again and again — five of them are single stacks,
  // which is the branch the three barely touched. That is how the strength
  // scaling turned out to truncate where the product lands rather than at the
  // nearest float (see setMonster): seventeen of these hold either way, and
  // the Familiar guard is the one whose division comes out exact, so it is the
  // only place in the run where the difference is visible at all.
  //
  // And they are what PROVES the guard power. The step reads three parameter
  // fields by offset — `+0x60`, `+0x68`/`+0x6C`/`+0x70` — and which name sits
  // at which offset was a reading of the structure's layout, not of the
  // parser. If that reading were wrong, these armies would not come out.
  // BasicLeverGuardPower is 1000, Mine1LevelGuardLevel 2, Mine2LevelGuardLevel
  // 9, MineGoldGuardLevel 18, all from Params/Default.xdb.
  const MINE_GUARD_LEVEL: Record<string, number> = {
    Sawmill: 2, Ore_Pit: 2,
    Alchemist_Lab: 9, Crystal_Cavern: 9, Sulfur_Dune: 9, Gem_Pond: 9,
    Gold_Mine: 18,
  };
  const BASIC_LEVER_GUARD_POWER = 1000;

  // Straight out of bin/homm5-editor-rmg.log, the mines steps of all four
  // zones: the roll's bits, then the branch's picks, then the two name draws.
  const mineGuards: Array<[string, ...number[]]> = [
    ['Sawmill', 1033305466, 0, 1214, 3701],
    ['Ore_Pit', 1048522466, 2, 53815, 26644],
    ['Alchemist_Lab', 1057697529, 29, 62076, 42191],
    ['Crystal_Cavern', 1031125036, 41, 57315, 61189],
    ['Sulfur_Dune', 1057310366, 52, 51269, 27123],
    ['Gem_Pond', 1058019624, 53, 55248, 28042],
    ['Sawmill', 1046338872, 4, 5077, 59515],
    ['Ore_Pit', 1063026921, 11, 14, 44225, 19477],
    ['Alchemist_Lab', 1039906647, 42, 44550, 39699],
    ['Crystal_Cavern', 1052536744, 38, 22918, 19961],
    ['Sulfur_Dune', 1062411387, 26, 15, 15825, 34810],
    ['Gem_Pond', 1035736761, 58, 48892, 1775],
    ['Sawmill', 1042696958, 3, 48348, 9754],
    ['Ore_Pit', 1037622470, 0, 34598, 65491],
    ['Gold_Mine', 1055079263, 2, 18922, 12828],
    ['Sawmill', 1058098985, 1, 39141, 64800],
    ['Ore_Pit', 1064321293, 15, 1, 51720, 47695],
    ['Gold_Mine', 1064024738, 19, 25, 64760, 5330],
  ];

  console.log('\nthe eighteen guards of the mines step');
  const byName = new Map(refs.map((r) => [r.name, r]));
  let matched = 0;
  for (const [mine, bits, ...picks] of mineGuards) {
    const draws = [
      { kind: 'f' as const, value: floatFromBits(bits!) },
      ...picks.map((v) => ({ kind: 'b' as const, value: v })),
    ];
    const power = BASIC_LEVER_GUARD_POWER * MINE_GUARD_LEVEL[mine]!;
    const ours = setMonster(power, 1, tables, replay(draws));
    // Which monster on the map this is comes from the name the draws minted,
    // not from any position — the guard names itself.
    const ref = ours && byName.get(ours.name);
    const oursShort = ours ? ours.stacks.map(short).join(' ') : 'none';
    const refShort = ref ? ref.stacks.map(short).join(' ') : 'no monster of that name';
    if (oursShort === refShort) matched++;
    else check(`${mine} at power ${power}`, false, `${oursShort} vs ${refShort}`);
  }
  check('every mine guard is the engine\'s own, creature for creature',
    matched === mineGuards.length, `${matched} of ${mineGuards.length}`);
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
