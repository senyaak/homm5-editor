// ZoneConnections — the passages, held to the guards the engine placed.
//
//   node tools/test-rmg-connections.ts
//
// This is the phase where everything before it is on trial at once: the
// candidate tiles come from the zone grid FillZones drew, filtered by rules
// of this phase's own, and the draws that pick among them only land on the
// engine's tiles if every earlier phase left the stream where the engine
// left it. Sixteen draws, three guards, three positions, three armies — all
// read out of the reference map.xdb.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { readArmyTemplates } from '../src/rmg/armies.ts';
import type { GuardTables } from '../src/rmg/armies.ts';
import { calcBorderTiles } from '../src/rmg/border-tiles.ts';
import { zoneConnections } from '../src/rmg/connections.ts';
import { createMap } from '../src/rmg/create-map.ts';
import { readCreatures } from '../src/rmg/creatures.ts';
import { fillDistToTowns } from '../src/rmg/dist-to-towns.ts';
import { fillZones } from '../src/rmg/fill-zones.ts';
import { loadTemplate } from '../src/rmg/load-template.ts';
import { mapSetup } from '../src/rmg/map-setup.ts';
import { readParams } from '../src/rmg/params.ts';
import { readPresets } from '../src/rmg/preset-table.ts';
import { RmgRandom } from '../src/rmg/random.ts';
import { readTemplate } from '../src/rmg/template.ts';
import { readTownShared, readTownSpecializations } from '../src/rmg/town-data.ts';
import type { TownShared } from '../src/rmg/town-data.ts';
import { placeTowns } from '../src/rmg/towns.ts';
import { generateGameZones } from '../src/rmg/zones.ts';
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

const template = readTemplate(join(dir, 'RMG', 'Templates', 'S1P2Z2M1.xdb'));
const params = readParams(join(dir, 'RMG', 'Params', 'Default.xdb'));
const presets = readPresets(dir);
const towns = new Map<string, TownShared>();
for (const preset of presets.values()) {
  if (preset.townProto) {
    const shared = readTownShared(dir, preset.townProto);
    towns.set(shared.path, shared);
  }
}
const creatures = readCreatures(dir);
const tables: GuardTables = {
  templates: readArmyTemplates(dir),
  creatures,
  powerByName: new Map(creatures.map((c) => [c.name, c.power])),
};

const rng = new RmgRandom(1785351845);
const made = createMap(template, { players: 2, size: 8 }, rng);
const setup = mapSetup(params, { monsterStrength: 1, water: false }, rng);
const loaded = loadTemplate(template, {
  twoFloors: made.twoFloors, dwarvenUnderground: setup.dwarvenUnderground, water: setup.water,
  playerCount: made.players, mapSize: 96, pointLightZoneRadius: params.pointLightParams.zoneRadius,
}, rng);
const placed = generateGameZones(96, 96,
  loaded.zones.map((z) => ({ index: z.index, size: z.size, floor: z.floor })), made.twoFloors, rng);
const filled = fillZones(96, 96, placed.zones, made.twoFloors, rng);
const distances = calcBorderTiles(96, 96, filled.floors);
const townResult = placeTowns({
  size: 96, template, zones: loaded.zones, floors: filled.floors, distances,
  radii: new Map(placed.zones.map((z) => [z.index, z.r])),
  presets, towns, specializations: readTownSpecializations(dir),
}, rng);
fillDistToTowns(96, filled.floors, loaded.zones, townResult.centres);

console.log('ZoneConnections');

const before = rng.draws;
const result = zoneConnections({
  size: 96,
  template,
  zones: loaded.zones,
  floors: filled.floors,
  distances,
  guardPowerUnit: params.basicLeverGuardPower * params.connectionGuardLevel,
  monsterStrength: setup.monsterStrength,
  tables,
}, rng);

// The traced run: FillDistToTownsTable ends at 18475, the phase after
// ZoneConnections begins at 18491.
check('it spends the engine\'s 16 draws', rng.draws - before === 16, `${rng.draws - before}`);
check('the counter lands on 18491, where the trace has it', rng.draws === 18491, `${rng.draws}`);
check('all three connections were dug on land', result.unconnected.length === 0,
  result.unconnected.map((c) => `${c.sourceZoneIndex}-${c.destZoneIndex}`).join(' '));
check('three guards placed', result.guards.length === 3,
  result.guards.map((g) => `${g.between[0]}-${g.between[1]}`).join(' '));

console.log('\nagainst the reference map.xdb');

if (!hasReference()) {
  console.log(`  ${REFERENCE_MISSING}`);
} else {
  const xml = readFileSync(REFERENCE_MAP, 'utf8');
  interface RefMonster { name: string; x: number; y: number; mood: string; stacks: string }
  const refs: RefMonster[] = [];
  for (const m of xml.matchAll(/<AdvMapMonster>([^]*?)<\/AdvMapMonster>/g)) {
    const body = m[1]!;
    const before2 = xml.slice(Math.max(0, m.index! - 200), m.index!);
    const pos = /<Pos>\s*<x>([\d.-]+)<\/x>\s*<y>([\d.-]+)<\/y>/.exec(body);
    const stacks: string[] = [];
    const lead = /<Shared href="[^"]*\/([A-Za-z_0-9]+)\.\(AdvMapMonsterShared\)/.exec(body)?.[1];
    if (lead) stacks.push(`${lead.replace(/_/g, '').toLowerCase()}x${/<Amount>(\d+)<\/Amount>/.exec(body)?.[1]}`);
    const additional = /<AdditionalStacks>([^]*?)<\/AdditionalStacks>/.exec(body);
    if (additional) {
      for (const s of additional[1]!.matchAll(/<Creature>([^<]*)<\/Creature>[^]*?<Amount>(\d+)<\/Amount>/g)) {
        stacks.push(`${s[1]!.replace('CREATURE_', '').replace(/_/g, '').toLowerCase()}x${s[2]}`);
      }
    }
    refs.push({
      name: /id="([^"]+)"\s*>\s*$/.exec(before2)?.[1] ?? '',
      x: Number(pos?.[1]),
      y: Number(pos?.[2]),
      mood: /<Mood>MONSTER_MOOD_([A-Z]+)<\/Mood>/.exec(body)?.[1] ?? '',
      stacks: stacks.join(' '),
    });
  }

  const MOOD = { 2: 'HOSTILE', 3: 'WILD' } as const;
  for (let i = 0; i < Math.min(result.guards.length, refs.length); i++) {
    const our = result.guards[i]!;
    const ref = refs[i]!;
    const ourStacks = our.stacks
      .map((s) => `${s.creature.replace('CREATURE_', '').replace(/_/g, '').toLowerCase()}x${s.amount}`).join(' ');
    check(`guard ${i + 1} (${our.between[0]}-${our.between[1]}) stands on the engine's tile`,
      our.x === ref.x && our.y === ref.y, `ours ${our.x},${our.y} vs engine ${ref.x},${ref.y}`);
    check(`guard ${i + 1} is the engine's army`, ourStacks === ref.stacks, `${ourStacks} vs ${ref.stacks}`);
    check(`guard ${i + 1} carries the engine's name`, our.name === ref.name, `${our.name} vs ${ref.name}`);
    check(`guard ${i + 1} has the engine's mood`,
      MOOD[our.mood as 2 | 3] === ref.mood, `${MOOD[our.mood as 2 | 3]} vs ${ref.mood}`);
  }
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
