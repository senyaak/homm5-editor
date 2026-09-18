// The building tree of a faction's town — `TownSpec.buildings` applied by
// the town copier to Haven's records and grid:
//
//   a drop leaves the town's list, the grid and the copy itself (the record,
//     its texts and its icon are never copied); dropping a level takes every
//     level above it, dropping the first takes the slot;
//   a building that needed a dropped one is refused unless re-parented;
//   rename, recost, town level, dependencies and grid cell land in the copy
//     and nowhere else;
//   every refusal names what it refuses.
//
//   node tools/test-town-buildings.ts [dataRoot]

// needs: data
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataReader } from '../src/mods/mod-files.ts';
import { buildTown, dropGridCell, moveGridCell, parseBuildingKey } from '../src/mods/town-files.ts';
import type { TownBuild, TownSpec } from '../src/mods/town-files.ts';
import { positionsBox, wideBase } from '../src/scene/geometry.ts';
import { BONE_ON_PLUM } from '../src/mods/faction-icons.ts';
import { SHIPPED_BUTTON_STATES, SPECIAL_BUTTON, SPECIAL_BUTTON_SHARED, TOWN_BUILDINGS, addTownButtons, buildingsFileText, factionScriptFile, factionScriptLoadLine } from '../src/mods/town-button.ts';
import { featureLines } from '../src/mods/town-features.ts';
import { patchCommonScript } from '../src/mods/artifact-scripts.ts';
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
const build = (buildings: TownSpec['buildings']): TownBuild => buildTown({ ...base, buildings }, HEAVEN, read);
const text = (t: TownBuild, path: string): string => {
  const f = t.files.find((x) => x.path === path);
  if (!f) throw new Error(`no ${path} in the copy`);
  return f.data.toString('latin1');
};
const utf16 = (t: TownBuild, path: string): string => {
  const f = t.files.find((x) => x.path === path);
  if (!f) throw new Error(`no ${path} in the copy`);
  return f.data.subarray(2).toString('utf16le');
};
const slots = (grid: string): string[] => [...grid.matchAll(/<BuildingType>(\w+)<\/BuildingType>/g)].map((m) => m[1]!);
const cells = (grid: string, type: string): { level: number; x: number; y: number }[] => {
  const at = grid.indexOf(`<BuildingType>${type}</BuildingType>`);
  if (at < 0) return [];
  const slot = grid.slice(at, grid.indexOf('\n\t\t</Item>', at));
  return [...slot.matchAll(/<Upgrade>BLD_UPG_(\d)<\/Upgrade>\s*<XSlotPos>(\d+)<\/XSlotPos>\s*<YSlotPos>(\d+)<\/YSlotPos>/g)]
    .map((m) => ({ level: Number(m[1]), x: Number(m[2]), y: Number(m[3]) }));
};

console.log('keys');
check('type alone is level 1', parseBuildingKey('TB_SPECIAL_1').level === 1);
check('type/level', parseBuildingKey('TB_TOWN_HALL/4').type === 'TB_TOWN_HALL' && parseBuildingKey('TB_TOWN_HALL/4').level === 4);
throws('a key is TB_TYPE or TB_TYPE/level', () => parseBuildingKey('townhall'), 'townhall');
throws('the first level is the type alone', () => parseBuildingKey('TB_TAVERN/1'), 'TB_TAVERN alone');

console.log('the donor as shipped');
const plain = build(undefined);
const grid0 = text(plain, plain.paths.build);
check('Haven has 36 records', plain.records.size === 36, `${plain.records.size}`);
check('and 19 slots on the grid', slots(grid0).length === 19, `${slots(grid0).length}`);
check('the town hall has four cells', cells(grid0, 'TB_TOWN_HALL').length === 4);
const shipyard = plain.records.get('TB_SHIPYARD')!;
const shipyardName = /<NameFileRef href="\/([^"#]+)/.exec(text(plain, shipyard))![1]!;
check('the shipyard\'s name text is in the copy', plain.files.some((f) => f.path === shipyardName), shipyardName);

console.log('drops');
const dropped = build({ 'TB_SHIPYARD': null, 'TB_TOWN_HALL/4': null, 'TB_SPECIAL_4': null, 'TB_DWELLING_6': { requires: ['TB_FORT/2'] } });
const grid1 = text(dropped, dropped.paths.build);
const town1 = text(dropped, dropped.paths.shared);
check('the shipyard is gone from the records', !dropped.records.has('TB_SHIPYARD'));
check('from the town\'s list', !town1.includes('Shipyard'));
check('from the grid', !slots(grid1).includes('TB_SHIPYARD'));
check('and from the copy, texts included', !dropped.files.some((f) => f.path === shipyard || f.path === shipyardName));
check('the Capitol is gone', !dropped.records.has('TB_TOWN_HALL/4') && dropped.records.has('TB_TOWN_HALL/3'));
check('its cell too, the three below stay', cells(grid1, 'TB_TOWN_HALL').map((c) => c.level).join() === '1,2,3');
check('33 records remain', dropped.records.size === 33, `${dropped.records.size}`);
check('17 slots remain', slots(grid1).length === 17, `${slots(grid1).length}`);
const arena = text(dropped, dropped.records.get('TB_DWELLING_6')!);
const citadel = dropped.records.get('TB_FORT/2')!;
check('the jousting arena needs the citadel now', arena.includes(`<Item href="/${citadel}#xpointer(/TownBuildingSharedStats)"/>`));
check('and only it', (arena.match(/<Item href=/g) ?? []).length === 1);
const kept = new Set(dropped.files.map((f) => f.path));
const removed = plain.files.filter((f) => !kept.has(f.path)).map((f) => f.path);
check('the drop only removes, never adds', dropped.files.every((f) => plain.files.some((g) => g.path === f.path)));
check('and removes the records with what only they reached', removed.length >= 3 * 3, `${removed.length} removed`);
check('nothing in the copy points at a removed file', !dropped.files.some((f) =>
  f.path.endsWith('.xdb') && removed.some((r) => f.data.toString('latin1').includes(`href="/${r}`))));
check('the dwellings are untouched', text(dropped, dropped.records.get('TB_DWELLING_2/2')!) === text(plain, plain.records.get('TB_DWELLING_2/2')!));
throws('dropping what another building needs is refused', () => build({ 'TB_SPECIAL_4': null }), 'TB_DWELLING_6 needs TB_SPECIAL_4');
throws('a building the donor has not', () => build({ 'TB_SPECIAL_3': null }), 'TB_SPECIAL_3');
throws('editing a dropped building', () => build({ 'TB_TOWN_HALL/3': null, 'TB_TOWN_HALL/4': { devLevel: 3 } }), 'TB_TOWN_HALL/4');
throws('requiring a dropped building', () => build({ 'TB_SHIPYARD': null, 'TB_TAVERN': { requires: ['TB_SHIPYARD'] } }), 'TB_SHIPYARD');

console.log('edits');
const edited = build({
  'TB_SPECIAL_1': { name: 'Bone Pit', description: 'Where the dead are sorted.', cost: { Gold: 2000, Sulfur: 0 }, devLevel: 3, slot: { x: 5, y: 6 } },
  'TB_TAVERN': { requires: [] },
});
const special = text(edited, edited.records.get('TB_SPECIAL_1')!);
const nameAt = /<NameFileRef href="\/([^"#]+)/.exec(special)![1]!;
const descAt = /<DescriptionFileRef href="\/([^"#]+)/.exec(special)![1]!;
check('the name is written into the copy\'s text', utf16(edited, nameAt) === 'Bone Pit');
check('the description too', utf16(edited, descAt) === 'Where the dead are sorted.');
check('gold and sulfur changed', special.includes('<Gold>2000</Gold>') && special.includes('<Sulfur>0</Sulfur>'));
check('wood and ore kept', special.includes('<Wood>10</Wood>') && special.includes('<Ore>5</Ore>'));
check('the town level', special.includes('<DevLevelNeeded>3</DevLevelNeeded>'));
check('the grid cell moved', JSON.stringify(cells(text(edited, edited.paths.build), 'TB_SPECIAL_1')) === '[{"level":1,"x":5,"y":6}]');
check('an empty requires is an empty element', text(edited, edited.records.get('TB_TAVERN')!).includes('\t<dependencies/>'));
check('the other records are the donor\'s', text(edited, edited.records.get('TB_FORT')!) === text(plain, plain.records.get('TB_FORT')!));
throws('a resource that is not one', () => build({ 'TB_TAVERN': { cost: { Iron: 1 } as never } }), 'Iron');
throws('a cell for a level the slot has not', () => build({ 'TB_TAVERN': { slot: { x: 1, y: 1 } }, 'TB_TAVERN/2': { slot: { x: 1, y: 1 } } }), 'TB_TAVERN/2');

console.log('a model of our own, on disk');
{
  // The graves again, but as a folder of ours: the three documents beside
  // each other and the geometry's binary under bin/Geometries — the layout a
  // model of ours is authored in — and the copier reading it as it reads the
  // data. What lands under the faction is the same set of files, under the
  // mounted folder's name, with fresh uids of its own.
  const dir = join(import.meta.dirname, '..', '_tmp', 'own-model-test', 'graves');
  rmSync(join(dir, '..'), { recursive: true, force: true });
  mkdirSync(join(dir, 'bin', 'Geometries'), { recursive: true });
  const stem = 'UneartheGrave_u1r0';
  mkdirSync(join(dir, 'bin', 'AIGeometries'), { recursive: true });
  for (const f of [`${stem}.xdb`, `${stem}-geom.xdb`, `${stem}-geom-AI.xdb`, `${stem}-UnearthedGraves_M.(Material).xdb`]) {
    writeFileSync(join(dir, f), read(`Arenas/Town/Necropolis/${f}`)!);
  }
  const uid = /<uid>([0-9A-F-]{36})<\/uid>/i.exec(read(`Arenas/Town/Necropolis/${stem}-geom.xdb`)!.toString('latin1'))![1]!.toUpperCase();
  writeFileSync(join(dir, 'bin', 'Geometries', uid), read(`bin/Geometries/${uid}`)!);
  const aiUid = /<uid>([0-9A-F-]{36})<\/uid>/i.exec(read(`Arenas/Town/Necropolis/${stem}-geom-AI.xdb`)!.toString('latin1'))![1]!.toUpperCase();
  writeFileSync(join(dir, 'bin', 'AIGeometries', aiUid), read(`bin/AIGeometries/${aiUid}`)!);
  const own = join(dir, `${stem}.xdb`);
  const t = build({ 'TB_SHIPYARD': null, 'TB_SPECIAL_1': { model: { source: own, place: 'TB_SHIPYARD' } } });
  const interior = /<Interior href="\/([^"#]+)/.exec(text(t, t.paths.shared))![1]!;
  const sceneDir = interior.slice(0, interior.lastIndexOf('/'));
  const object = text(t, `${sceneDir}/Test_special_1.(ArenaModObject).xdb`);
  const modelPath = /<Model href="\/([^"#]+)/.exec(object)![1]!;
  check('the model is copied under the faction, under the mounted folder', modelPath === `Factions/Test/buildings/Test_special_1/own/graves/${stem}.xdb`, modelPath);
  const geomDoc = text(t, modelPath.replace(/[^/]+$/, '') + /<Geometry href="([^"#]+)/.exec(text(t, modelPath))![1]!);
  const ours = /<uid>([0-9A-F-]{36})<\/uid>/i.exec(geomDoc)![1]!.toUpperCase();
  check('the geometry has a uid of its own', ours !== uid);
  // The binary is the folder's, moved to its spot — so the same size, not the same bytes.
  check('and its binary came from the folder', t.files.some((f) => f.path === `bin/Geometries/${ours}` && f.data.length === read(`bin/Geometries/${uid}`)!.length));
  check('the material and its texture are reached', t.files.some((f) => f.path.endsWith(`own/graves/${stem}-UnearthedGraves_M.(Material).xdb`)) && t.files.some((f) => /UnerarthedGraves\.tga\.xdb$/.test(f.path)));
  check("the shipyard's pick hull serves, as for a model from the data", geomDoc.includes('<AIGeometry href="/Factions/Test/town/Arenas/Town/NewHaven/Shipyard_u1r0-geom-AI.xdb#xpointer(/AIGeometry)"/>'));
  throws('a file that is not there', () => build({ 'TB_SPECIAL_1': { model: { source: join(dir, 'nothing.xdb'), at: { x: 0, y: 0, z: 0 } } } }), 'no such file');
  rmSync(join(dir, '..'), { recursive: true, force: true });
}

console.log('a model of ours in the screen');
{
  const GRAVES = 'Arenas/Town/Necropolis/UneartheGrave_u1r0.xdb';
  const t = build({ 'TB_SHIPYARD': null, 'TB_SPECIAL_1': { model: { source: GRAVES, place: 'TB_SHIPYARD' } } });
  const record = text(t, t.records.get('TB_SPECIAL_1')!);
  check('the record names the object of ours', record.includes('<ModObjectName>Test_special_1</ModObjectName>'));
  const interior = /<Interior href="\/([^"#]+)/.exec(text(t, t.paths.shared))![1]!;
  const scene = text(t, interior);
  const sceneDir = interior.slice(0, interior.lastIndexOf('/'));
  check('the screen lists the object', scene.includes('<Item href="Test_special_1.(ArenaModObject).xdb#xpointer(/ArenaModObject)"/>'));
  check('and its camera', scene.includes('<Item href="Test_special_1_cam.(Camera).xdb#xpointer(/Camera)"/>'));
  const object = text(t, `${sceneDir}/Test_special_1.(ArenaModObject).xdb`);
  check('the object is level 0 empty and one built level', (object.match(/<Model\/>/g) ?? []).length === 1 && (object.match(/<Model href=/g) ?? []).length === 1);
  const modelPath = /<Model href="\/([^"#]+)/.exec(object)![1]!;
  check('the model is copied under the faction', modelPath.startsWith('Factions/Test/buildings/Test_special_1/'), modelPath);
  const geomDoc = text(t, modelPath.replace(/[^/]+$/, '') + /<Geometry href="([^"#]+)/.exec(text(t, modelPath))![1]!);
  const uid = /<uid>([0-9A-F-]{36})<\/uid>/i.exec(geomDoc)![1]!;
  // What is measured is the part ABOVE the ground (the widest level): a town
  // model keeps a hidden pedestal below, and that is not what stands anywhere.
  const above = (bin: Buffer) => positionsBox(bin, wideBase(bin) ?? -Infinity)!;
  const placedBin = t.files.find((f) => f.path === `bin/Geometries/${uid.toUpperCase()}`)!.data;
  const placed = above(placedBin);
  const shipyardBin = t.files.find((f) => f.path.endsWith('/Shipyard_u1r0-geom.xdb'))!;
  const shipyardUid = /<uid>([0-9A-F-]{36})<\/uid>/i.exec(shipyardBin.data.toString('latin1'))![1]!;
  const shipyard = positionsBox(t.files.find((f) => f.path === `bin/Geometries/${shipyardUid.toUpperCase()}`)!.data)!;
  check('the model stands where the shipyard stood', Math.abs(placed.cx - shipyard.cx) < 0.01 && Math.abs(placed.cy - shipyard.cy) < 0.01, `${placed.cx.toFixed(1)},${placed.cy.toFixed(1)} vs ${shipyard.cx.toFixed(1)},${shipyard.cy.toFixed(1)}`);
  const source = above(read(`bin/Geometries/${/<uid>([0-9A-F-]{36})<\/uid>/i.exec(read('Arenas/Town/Necropolis/UneartheGrave_u1r0-geom.xdb')!.toString('latin1'))![1]!.toUpperCase()}`)!);
  check('at its own size', Math.abs(placed.sx - source.sx) < 0.01 && Math.abs(placed.sy - source.sy) < 0.01);
  check('and not where it came from (the graves stood at y 295, z 61 in their own scene)', Math.abs(source.cy - placed.cy) > 1 && Math.abs(source.cz - placed.cz) > 1);
  check('the geometry document carries the whole box', geomDoc.includes(`<x>${positionsBox(placedBin)!.cx.toFixed(4)}</x>`));
  check("the shipyard's pick hull serves", geomDoc.includes('<AIGeometry href="/Factions/Test/town/Arenas/Town/NewHaven/Shipyard_u1r0-geom-AI.xdb#xpointer(/AIGeometry)"/>'));
  check("the source's own hull is not copied", !t.files.some((f) => f.path.includes('UneartheGrave_u1r0-geom-AI')));
  const camera = text(t, `${sceneDir}/Test_special_1_cam.(Camera).xdb`);
  const theirs = text(t, `${sceneDir}/Shipyard3_cam.(Camera).xdb`);
  check("the camera is the shipyard's, renamed", camera.includes('<Name>Test_special_1_cam</Name>') && /<Pos>[\s\S]*?<\/Pos>/.exec(camera)![0] === /<Pos>[\s\S]*?<\/Pos>/.exec(theirs)![0]);

  const u = build({ 'TB_SPECIAL_1': { model: { source: GRAVES, at: { x: 250, y: 340, z: 10 }, across: 20 } } });
  const uScene = text(u, interior);
  const uObject = text(u, `${sceneDir}/Test_special_1.(ArenaModObject).xdb`);
  const uModel = /<Model href="\/([^"#]+)/.exec(uObject)![1]!;
  const uGeom = text(u, uModel.replace(/[^/]+$/, '') + /<Geometry href="([^"#]+)/.exec(text(u, uModel))![1]!);
  const uBox = above(u.files.find((f) => f.path === `bin/Geometries/${/<uid>([0-9A-F-]{36})<\/uid>/i.exec(uGeom)![1]!.toUpperCase()}`)!.data);
  check('a spot given outright is where it stands', Math.abs(uBox.cx - 250) < 0.01 && Math.abs(uBox.cy - 340) < 0.01, `${uBox.cx.toFixed(1)},${uBox.cy.toFixed(1)}`);
  check('twenty across', Math.abs(Math.max(uBox.sx, uBox.sy) - 20) < 0.05, `${Math.max(uBox.sx, uBox.sy).toFixed(2)}`);
  check("its ground at the spot's z", Math.abs(uBox.cz - uBox.sz / 2 - 10) < 0.05, `${(uBox.cz - uBox.sz / 2).toFixed(2)}`);
  check('no hull', uGeom.includes('<AIGeometry/>'));
  const uCamera = text(u, `${sceneDir}/Test_special_1_cam.(Camera).xdb`);
  const tg = text(u, `${sceneDir}/TrainingGround_cam.(Camera).xdb`);
  check("the camera is the training grounds', moved", uCamera.includes('<Name>Test_special_1_cam</Name>') && /<Pos>[\s\S]*?<\/Pos>/.exec(uCamera)![0] !== /<Pos>[\s\S]*?<\/Pos>/.exec(tg)![0]);
  check('the screen lists it once', (uScene.match(/Test_special_1\.\(ArenaModObject\)/g) ?? []).length === 1);
  throws('a place the donor has not', () => build({ 'TB_SPECIAL_1': { model: { source: GRAVES, place: 'TB_SPECIAL_9' } } }), 'TB_SPECIAL_9');
  throws('a model without a place or a spot', () => build({ 'TB_SPECIAL_1': { model: { source: GRAVES } } }), 'place or a spot');
  throws('a source that is not there', () => build({ 'TB_SPECIAL_1': { model: { source: 'Arenas/Town/Nowhere/Nothing.xdb', place: 'TB_SHIPYARD' } } }), 'Nothing.xdb');
}

console.log('the centre button');
{
  const enumAt = read('types.xml')!.toString('latin1');
  const listed = [...enumAt.slice(enumAt.indexOf('<Name>TB_TOWN_HALL</Name>')).matchAll(/<Name>(TB_[A-Z_0-9]+)<\/Name>\s*<Value>(\d+)<\/Value>/g)]
    .slice(0, TOWN_BUILDINGS.length).map((m) => [m[1]!, Number(m[2])] as const);
  check('ETownBuilding is the list the DLL is told', listed.every(([name, value]) => TOWN_BUILDINGS[value] === name) && listed.length === TOWN_BUILDINGS.length);
  throws('a button needs the theme', () => build({ 'TB_SPECIAL_1': { button: { lua: 'BonePit' } } }), 'icon theme');
  const t2 = buildTown({ ...base, icons: BONE_ON_PLUM, buildings: { 'TB_SPECIAL_1': { button: { lua: 'BonePit' } } } }, HEAVEN, read);
  check("the build hands over the building, the function and three skins", t2.button?.building === 'TB_SPECIAL_1' && t2.button.lua === 'BonePit' && t2.button.skins.normal.width === 82 && t2.button.skins.pushed.height === 82 && t2.button.skins.disabled.width === 82);
  throws('two buttons', () => buildTown({ ...base, icons: BONE_ON_PLUM, buildings: { 'TB_SPECIAL_1': { button: { lua: 'A' } }, 'TB_SPECIAL_2': { button: { lua: 'B' } } } }, HEAVEN, read), 'dial has one');
  const button = read(SPECIAL_BUTTON)!.toString('latin1'), shared = read(SPECIAL_BUTTON_SHARED)!.toString('latin1');
  const out = addTownButtons(button, shared, [{ ...t2.button!, town: 11 }]);
  check('a ninth button state', out.button.split('<MessageOnEnterState/>').length - 1 === SHIPPED_BUTTON_STATES + 1);
  check('whose click is ours', out.button.includes('Own.(UISDirectRunReaction).xdb#xpointer(/UISDirectRunReaction)') && out.button.split('Special.(UISDirectRunReaction)').length === button.split('Special.(UISDirectRunReaction)').length);
  check('a ninth visual state', (out.shared.match(/<DefaultSubState>/g) ?? []).length === SHIPPED_BUTTON_STATES + 1);
  check('drawn in our three skins', ['normal', 'pushed', 'disabled'].every((s) => out.shared.includes(`/Factions/Test/icons/special_${s}.(BackgroundSimpleTexture).xdb#xpointer(/BackgroundSimpleTexture)`)));
  check('the shipped eight untouched', out.shared.startsWith(shared.slice(0, shared.lastIndexOf('</Item>'))) && out.button.startsWith(button.slice(0, button.lastIndexOf('</Item>'))));
  check('the message and reaction files, the six picture files', out.files.filter((f) => f.path.startsWith('UI/TownScreen/Own.')).length === 2 && out.files.filter((f) => f.path.endsWith('.dds')).length === 3 && out.files.filter((f) => f.path.includes('(BackgroundSimpleTexture)')).length === 3);
  check('the message is enter_own', out.files.find((f) => f.path.endsWith('Own.(ARSendGameMessage).xdb'))!.data.toString('latin1').includes('<EventName>enter_own</EventName>'));
  check('the row: type, TB_SPECIAL_1 = 17, the appended state, the function', buildingsFileText(out.rows).trim().endsWith('button 11 17 8 BonePit'));
  throws('a function name that is not one', () => addTownButtons(button, shared, [{ ...t2.button!, town: 11, lua: 'Bone Pit' }]), 'Lua function name');
  throws('a document already extended', () => addTownButtons(out.button, shared, []), 'not the shipped');
  // The faction's Lua is the mod's, on every map — not a map's own script.
  const script = factionScriptFile('Test', ['function BonePit(town)', '  H5ELog(1);', 'end;'].join('\n'));
  const lua = script.data.toString('latin1');
  check("the faction's script is a file of the mod's", script.path === 'scripts/homm5-editor/faction-Test.lua');
  check("it introduces the map first, then the author's Lua",lua.indexOf('H5ETownButtons();') < lua.indexOf('function BonePit(town)'));
  const common = patchCommonScript(read('scripts/advmap-common.lua')!.toString('latin1'), [], [script.path]);
  check('and the global script loads it', common.includes(factionScriptLoadLine('Test')) && factionScriptLoadLine('Test') === 'doFile("/scripts/homm5-editor/faction-Test.lua");');
}

console.log('a building from another town');
{
  // Stronghold's hall in Haven's tree: three records, their texts, their slot
  // — which is the guild's cell in Haven, so the guild goes.
  throws('two buildings on one cell are refused', () => build({ 'TB_SPECIAL_1': { from: 'TOWN_STRONGHOLD' } }), 'share grid cell 4,2');
  const noGuild = { 'TB_MAGIC_GUILD': null, 'TB_DWELLING_5': { requires: ['TB_FORT'] } } as const;
  const hall = build({ ...noGuild, 'TB_SPECIAL_1': { from: 'TOWN_STRONGHOLD' } });
  const grid = text(hall, hall.paths.build);
  const town = text(hall, hall.paths.shared);
  check('three levels of TB_SPECIAL_1 now', ['TB_SPECIAL_1', 'TB_SPECIAL_1/2', 'TB_SPECIAL_1/3'].every((k) => hall.records.has(k)));
  check("they are Stronghold's records, copied under the faction", hall.records.get('TB_SPECIAL_1')!.startsWith('Factions/Test/') && hall.records.get('TB_SPECIAL_1')!.includes('Stronghold/Special_1/HallOfTrial'));
  check("Haven's training grounds record is gone, its texts with it", !hall.files.some((f) => f.path.includes('Special_1/Training_Grounds') || f.path.includes('Training_Grounds_Name')));
  check('the Monument needs the hall now, not the grounds', text(hall, hall.records.get('TB_SPECIAL_2')!).includes(`/${hall.records.get('TB_SPECIAL_1')}#xpointer`));
  check("the town lists the hall where the grounds were", town.indexOf('HallOfTrial') > town.indexOf('Dwelling_7') && town.indexOf('HallOfTrial') < town.indexOf('Special_2'));
  check("the second level still needs the first, by its own relative href", text(hall, hall.records.get('TB_SPECIAL_1/2')!).includes('href="HallOfTrial.xdb#xpointer(/TownBuildingSharedStats)"'));
  check("the slot is Stronghold's: three cells at 4,2", cells(grid, 'TB_SPECIAL_1').map((c) => `${c.level}:${c.x},${c.y}`).join(' ') === '1:4,2 2:4,2 3:4,2');
  check("the hall's texts are in the copy", hall.files.some((f) => f.path.includes('Hall_of_Trial_1_Name')));
  const renamed = build({ ...noGuild, 'TB_SPECIAL_1': { from: 'TOWN_STRONGHOLD', name: 'Костяной зал' } });
  check('and an edit lands on the record taken', utf16(renamed, /<NameFileRef href="\/([^"#]+)/.exec(text(renamed, renamed.records.get('TB_SPECIAL_1')!))![1]!) === 'Костяной зал');
  throws('a level cannot come from elsewhere on its own', () => build({ ...noGuild, 'TB_SPECIAL_1/2': { from: 'TOWN_STRONGHOLD' } }), 'whole building');
  throws('a town with no such building', () => build({ 'TB_SPECIAL_7': { from: 'TOWN_STRONGHOLD' } }), 'no TB_SPECIAL_7 to take');
  throws('a town that is not shipped', () => build({ 'TB_SPECIAL_1': { from: 'TOWN_TEST' } }), 'no shipped town');
  check('the guild slot taken from Stronghold is empty, and the cells are gone', cells(text(build({ 'TB_MAGIC_GUILD': { from: 'TOWN_STRONGHOLD' } }), hall.paths.build), 'TB_MAGIC_GUILD').length === 0);
}

console.log('a town without magic');
{
  // The Monastery needs the guild, which such a town never builds.
  throws('what needed the guild has to be re-parented', () => buildTown({ ...base, magic: 'none' }, HEAVEN, read), 'TB_DWELLING_5 needs TB_MAGIC_GUILD');
  throws('the guild has no name to give', () => buildTown({ ...base, magic: 'none', buildings: { 'TB_MAGIC_GUILD/2': { name: 'x' } } }, HEAVEN, read), 'never shows its guild');
  throws('the guild stays, as stubs', () => buildTown({ ...base, magic: 'none', buildings: { 'TB_MAGIC_GUILD': null } }, HEAVEN, read), 'do not drop');
  throws('no schools without a guild', () => buildTown({ ...base, magic: 'none', magicSchools: ['MAGIC_SCHOOL_DARK', 'MAGIC_SCHOOL_LIGHT'], buildings: { 'TB_DWELLING_5': { requires: ['TB_FORT'] } } }, HEAVEN, read), 'no guild to teach');
  const silent = buildTown({ ...base, magic: 'none', icons: BONE_ON_PLUM, buildings: { 'TB_DWELLING_5': { requires: ['TB_FORT'] } } }, HEAVEN, read);
  const grid = text(silent, silent.paths.build);
  check('36 records still: five stubs for the guild', silent.records.size === 36, `${silent.records.size}`);
  const stub = text(silent, silent.records.get('TB_MAGIC_GUILD/3')!);
  check("the guild's records are Stronghold's stubs", stub.includes('<UIObjectName/>') && stub.includes('<Icon/>') && stub.includes('<DevLevelNeeded>0</DevLevelNeeded>'));
  check('a stub keeps no icon even with a theme', !stub.includes('/Factions/Test/icons/'));
  check('the guild slot has no cells', cells(grid, 'TB_MAGIC_GUILD').length === 0 && slots(grid).includes('TB_MAGIC_GUILD'));
  check('the Monastery needs the fort now', text(silent, silent.records.get('TB_DWELLING_5')!).includes(`/${silent.records.get('TB_FORT')}#xpointer`));
  check('the schools stay as the donor wrote them', text(silent, silent.paths.shared).includes('<MagicSchool_0>'));
  check('and the town grants nothing it did not before', silent.features.length === 0);
  check('rows of the buildings file', featureLines(11, [{ building: 17, minLevel: 1, feature: 0x27 }]).join('|') === 'feature 11 17 1 39');
  check('the file carries them after the buttons', buildingsFileText([], ['feature 11 17 1 39']).trim().endsWith('feature 11 17 1 39'));
  throws('a row that is not one', () => buildingsFileText([], ['feature x']), 'not a feature row');
}

console.log('what a building does');
{
  const noGuild = { 'TB_MAGIC_GUILD': null, 'TB_DWELLING_5': { requires: ['TB_FORT'] } } as const;
  const taken = build({ ...noGuild, 'TB_SPECIAL_1': { from: 'TOWN_STRONGHOLD' } });
  check("a building taken keeps its effect: Stronghold's SPECIAL_1 is the three tiers", taken.features.map((f) => f.feature).join() === '39,40,41');
  check('under our slot', taken.features.every((f) => f.building === 17));
  const silent = build({ ...noGuild, 'TB_SPECIAL_1': { from: 'TOWN_STRONGHOLD', grants: null } });
  check('unless told to do nothing', silent.features.length === 0);
  const library = build({ 'TB_SPECIAL_2': { grants: { like: 'TOWN_ACADEMY', building: 'TB_SPECIAL_1' } } });
  check("a building of the donor's granting another town's effect: the Library's, on our SPECIAL_2", JSON.stringify(library.features) === JSON.stringify([{ building: 18, minLevel: 1, feature: 0x15 }]));
  check('the donor as shipped grants nothing of its own - the engine has its rows', plain.features.length === 0);
  throws("an effect is the whole building's", () => build({ 'TB_TOWN_HALL/2': { grants: { like: 'TOWN_HEAVEN' } } }), 'whole building');
  throws('a building with no effect has none to grant', () => build({ 'TB_TAVERN': { grants: { like: 'TOWN_HEAVEN' } } }), 'no effect to grant');
  throws('a town that is not shipped', () => build({ 'TB_SPECIAL_1': { grants: { like: 'TOWN_TEST' } } }), 'not a shipped town');
}

console.log('the grid alone');
check('dropping the last cell drops the slot', !dropGridCell(grid0, 'TB_TAVERN', 1).includes('TB_TAVERN'));
check('dropping one of four keeps three', cells(dropGridCell(grid0, 'TB_TOWN_HALL', 2), 'TB_TOWN_HALL').length === 3);
check('a slot the grid has not is left alone', dropGridCell(grid0, 'TB_SPECIAL_3', 1) === grid0);
check('moving changes one cell', cells(moveGridCell(grid0, 'TB_FORT', 2, { x: 9, y: 9 }), 'TB_FORT').map((c) => `${c.x},${c.y}`).join(' ') === '2,3 9,9 2,5');
throws('moving in a slot the grid has not', () => moveGridCell(grid0, 'TB_SPECIAL_3', 1, { x: 1, y: 1 }), 'TB_SPECIAL_3');

console.log(failures ? `\n${failures} failure(s)` : '\nall ok');
process.exit(failures ? 1 : 0);
