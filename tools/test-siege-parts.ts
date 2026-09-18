// Siege parts of our own — `SiegeMix.walls|towers|gate|moat` as models on
// disk, applied by the town copier:
//
//   the Necropolis graves as a folder of ours stand in for Haven's four walls
//     and its moat: one object of ours per piece, shaped as the donor's (as
//     many upgrades, as many ruin levels), the record pointed at it, the arena
//     listing it where the donor's was;
//   each model is moved to the donor piece's ground centre — four walls, four
//     spots; the donor piece's hull serves;
//   a breached model given lands at ruin level 1, a razed one at 2; the
//     level before serves when one is not given;
//   a wrong count, a missing file, are refused by name.
//
//   node tools/test-siege-parts.ts [dataRoot]

// needs: data
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataReader } from '../src/mods/mod-files.ts';
import { buildTown, townPaths } from '../src/mods/town-files.ts';
import type { TownBuild, TownSpec } from '../src/mods/town-files.ts';
import { positionsBox } from '../src/scene/geometry.ts';
import { dataDir } from './game-dir.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}
function throws(name: string, f: () => unknown, mentions: string): void {
  try { f(); check(name, false, 'did not throw'); } catch (e) {
    const msg = (e as Error).message;
    check(name, msg.includes(mentions), msg);
  }
}

const dataRoot = process.argv[2] ?? dataDir();
if (!existsSync(join(dataRoot, 'types.xml'))) {
  console.log(`no unpacked data at ${dataRoot} — nothing to compare against`);
  process.exit(0);
}
const read = dataReader(dataRoot);
const HEAVEN = 3;
const base: TownSpec = { file: 'Test', type: 'TOWN_TEST', donor: 'TOWN_HEAVEN', name: 'Testburg' };
const build = (siege: TownSpec['siege']): TownBuild => buildTown({ ...base, siege }, HEAVEN, read);
const text = (t: TownBuild, path: string): string => {
  const f = t.files.find((x) => x.path === path);
  if (!f) throw new Error(`no ${path} in the copy`);
  return f.data.toString('latin1');
};
const uidOf = (doc: string): string => /<uid>([0-9A-F-]{36})<\/uid>/i.exec(doc)![1]!.toUpperCase();

// The graves as a folder of ours, and a second folder (the same graves) to
// stand as the breached level — two folders, so the two are told apart.
const root = join(import.meta.dirname, '..', '_tmp', 'siege-parts-test');
rmSync(root, { recursive: true, force: true });
function graves(folder: string): string {
  const dir = join(root, folder);
  mkdirSync(join(dir, 'bin', 'Geometries'), { recursive: true });
  mkdirSync(join(dir, 'bin', 'AIGeometries'), { recursive: true });
  const stem = 'UneartheGrave_u1r0';
  for (const f of [`${stem}.xdb`, `${stem}-geom.xdb`, `${stem}-geom-AI.xdb`, `${stem}-UnearthedGraves_M.(Material).xdb`]) {
    writeFileSync(join(dir, f), read(`Arenas/Town/Necropolis/${f}`)!);
  }
  const geom = uidOf(read(`Arenas/Town/Necropolis/${stem}-geom.xdb`)!.toString('latin1'));
  writeFileSync(join(dir, 'bin', 'Geometries', geom), read(`bin/Geometries/${geom}`)!);
  const ai = uidOf(read(`Arenas/Town/Necropolis/${stem}-geom-AI.xdb`)!.toString('latin1'));
  writeFileSync(join(dir, 'bin', 'AIGeometries', ai), read(`bin/AIGeometries/${ai}`)!);
  return join(dir, `${stem}.xdb`);
}
const whole = graves('whole');
const breached = graves('breached');

console.log('walls and a moat of ours');
{
  const t = build({ arena: 'TOWN_HEAVEN', walls: { models: [whole, whole, whole, whole], damaged: [breached, undefined, undefined, undefined] }, moat: { models: [whole] } });
  const shared = text(t, townPaths(base).shared);
  const records = [...shared.matchAll(/<ArenaBuilding ObjectRecordID="\d+">[\s\S]*?<\/ArenaBuilding>/g)].map((m) => m[0]);
  const walls = records.filter((r) => r.includes('<Type>WALL</Type>'));
  check('four wall records point at objects of ours', walls.length === 4 && walls.every((r, i) => r.includes(`<Object href="/Factions/Test/siege/walls_${i + 1}/Test_walls_${i + 1}.(ArenaModObject).xdb#xpointer(/ArenaModObject)"/>`)));
  check('the moat too', records.some((r) => r.includes('<Type>MOAT</Type>') && r.includes('/Factions/Test/siege/moat_1/Test_moat_1.(ArenaModObject).xdb')));
  check('the towers and the gate stay the arena\'s', records.some((r) => r.includes('<Type>GATE</Type>') && r.includes('/Factions/Test/town/Arenas/CombatArena/NewGrassarena_siege/s_gate.(ArenaModObject).xdb')));

  const object = text(t, 'Factions/Test/siege/walls_1/Test_walls_1.(ArenaModObject).xdb');
  const ruins = [...object.matchAll(/<ruins>([\s\S]*?)<\/ruins>/g)].map((m) => (m[1]!.match(/<Model(?:\s[^>]*)?\/>/g) ?? []).length);
  check('the object is shaped as the donor\'s: an unbuilt upgrade, then one with three ruin levels', ruins.join(',') === '1,3', ruins.join(','));
  const models = [...object.matchAll(/<Model href="\/([^"#]+)/g)].map((m) => m[1]!);
  check('whole, breached, razed: ours, the breached folder\'s, the breached again', models.length === 3
    && models[0]!.startsWith('Factions/Test/siege/walls_1/r0/own/whole/') && models[1]!.startsWith('Factions/Test/siege/walls_1/r1/own/breached/') && models[2] === models[1], models.join(' '));
  const wall2 = text(t, 'Factions/Test/siege/walls_2/Test_walls_2.(ArenaModObject).xdb');
  const wall2Models = [...wall2.matchAll(/<Model href="\/([^"#]+)/g)].map((m) => m[1]!);
  check('a piece given only the whole model uses it at every level', wall2Models.length === 3 && wall2Models.every((m) => m === wall2Models[0]));

  // Where they stand: each at its own wall's spot.
  const spot = (modelPath: string): { x: number; y: number } => {
    const model = text(t, modelPath);
    const geomPath = modelPath.replace(/[^/]+$/, '') + /<Geometry href="([^"#]+)/.exec(model)![1]!;
    const bin = t.files.find((f) => f.path === `bin/Geometries/${uidOf(text(t, geomPath))}`)!.data;
    const box = positionsBox(bin)!;
    return { x: box.cx, y: box.cy };
  };
  const ours = [1, 2, 3, 4].map((i) => spot(`Factions/Test/siege/walls_${i}/r0/own/whole/UneartheGrave_u1r0.xdb`));
  const theirs = [1, 2, 3, 4].map((i) => spot(`Factions/Test/town/Arenas/CombatArena/NewGrassarena_siege/wall_${i}_u1r0.xdb`));
  check('each stands where its wall stood', ours.every((o, i) => Math.abs(o.x - theirs[i]!.x) < 0.01 && Math.abs(o.y - theirs[i]!.y) < 0.01),
    ours.map((o, i) => `${o.x.toFixed(1)},${o.y.toFixed(1)} vs ${theirs[i]!.x.toFixed(1)},${theirs[i]!.y.toFixed(1)}`).join(' | '));
  check('four spots, not one', new Set(ours.map((o) => `${o.x.toFixed(0)},${o.y.toFixed(0)}`)).size === 4);
  const geom1 = text(t, 'Factions/Test/siege/walls_1/r0/own/whole/UneartheGrave_u1r0-geom.xdb');
  check("the donor wall's hull serves", geom1.includes('<AIGeometry href="/Factions/Test/town/Arenas/CombatArena/NewGrassarena_siege/wall_1_u1r0-geom-AI.xdb#xpointer(/AIGeometry)"/>'));
  check("the folder's own hull is not copied", !t.files.some((f) => f.path.includes('siege/walls_1/') && f.path.includes('geom-AI')));

  // The arena lists ours where it listed the donor's.
  const arenaHref = /<ArenaDesc href="\/([^"#]+)/.exec(shared)![1]!;
  const arena = text(t, arenaHref);
  check('the arena lists the objects of ours', arena.includes('<Item href="/Factions/Test/siege/walls_1/Test_walls_1.(ArenaModObject).xdb#xpointer(/ArenaModObject)"/>') && !arena.includes('s_wall_1.(ArenaModObject).xdb'));
  check('and still the gate', arena.includes('s_gate.(ArenaModObject).xdb'));
}

console.log('with another town\'s arena');
{
  const t = build({ arena: 'TOWN_INFERNO', gate: { models: [whole] } });
  const shared = text(t, townPaths(base).shared);
  check("Inferno's field, a gate of ours on it", shared.includes('/Factions/Test/siege/gate_1/Test_gate_1.(ArenaModObject).xdb') && shared.includes('Arenas/CombatArena/') && !shared.includes('NewGrassarena_siege/s_gate'));
  const object = text(t, 'Factions/Test/siege/gate_1/Test_gate_1.(ArenaModObject).xdb');
  check('the gate of ours has no animation', !object.includes('<AnimSet href') && (object.match(/<Model href/g) ?? []).length === 3);
}

console.log('refusals');
throws('a wall count that is not four', () => build({ arena: 'TOWN_HEAVEN', walls: { models: [whole, whole] } }), '4 piece(s), 2 model(s)');
throws('a file that is not there', () => build({ arena: 'TOWN_HEAVEN', moat: { models: [join(root, 'nothing.xdb')] } }), 'no such file');

rmSync(root, { recursive: true, force: true });
if (failures) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nall good');
