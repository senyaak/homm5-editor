// A faction in the mod — the model's edits, and the build's faction pass:
//
//   the model: the type is the identifier's, the ordinal is appended, a
//     shipped type and a duplicate are refused, a hero of the type holds the
//     faction in place, the ones after a removal move down;
//   the build: every registry a twelfth type has to be in has ours in it —
//     types.xml's two enums and three table sizes, TownTypesInfo, the
//     generator's table, the music, the picker's two lists and their texts,
//     the random-town group, the hero pool, TownSpecs, UIGameRoot's grid,
//     the global script's doFile — and two factions do not fight over any of
//     them;
//   the install's rows: the picker's order, the buttons, the features;
//   what the engine compiled per race: the alignment, the AI's skill values
//     and the random-dwelling group as rows of the races file, the group
//     document and its RPGRoot entry.
//
//   node tools/test-faction-mod.ts [dataRoot]

// needs: data
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MOD_MANIFEST, dataReader, TYPES, UI_ROOT } from '../src/mods/mod-files.ts';
import { buildCreatureMod } from '../src/mods/creature-mod.ts';
import { addDwelling, addFaction, newCreatureMod, removeFaction, updateFaction } from '../src/mods/mod-model.ts';
import type { CreatureMod } from '../src/mods/mod-model.ts';
import { GRID, SHIPPED_TOWN_TYPES, dwellingsGroupFor, factionProblems, raceFor, townTypeFor } from '../src/mods/factions.ts';
import type { FactionSpec } from '../src/mods/factions.ts';
import { DWELLING_GROUP_DIR, PICKER_DIR, PICKER_TEXTS, PICKER_TEXTURES, RMG_PRESETS, RPG_ROOT, pickerNames } from '../src/mods/faction-files.ts';
import { racesFileText } from '../src/mods/race-order.ts';
import { SHIPPED_TOWN_ORDINALS, TOWN_SPECS, gridSlotText } from '../src/mods/town-files.ts';
import { RACE_MUSIC, TOWN_TYPES_INFO } from '../src/mods/town-type-info.ts';
import { HERO_GROUP, TOWN_GROUP, groupMembers } from '../src/mods/shared-groups.ts';
import { COMMON_SCRIPT } from '../src/mods/artifact-scripts.ts';
import { factionScriptPath } from '../src/mods/town-button.ts';
import { BONE_ON_PLUM } from '../src/mods/faction-icons.ts';
import { readTownTree } from '../src/mods/town-tree.ts';
import { dataDir } from './game-dir.ts';
import { pngDataUri } from '../src/format/png.ts';
import { decodeDDSBuffer } from '../src/format/dds.ts';
import { SHIPPED_SKILLS, SKILL_TABLE } from '../src/mods/hero-skills.ts';
import type { ModHeroSkill } from '../src/mods/hero-skills.ts';
import { readSkillAiRows } from '../src/mods/skill-values.ts';
import { gameText } from '../src/schema/registry.ts';
import { assets } from '../src/game/assets.ts';
import type { BuildReport } from '../src/mods/mod-files.ts';

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
const count = (text: string, re: RegExp): number => (text.match(re) ?? []).length;

const dataRoot = process.argv[2] ?? dataDir();
if (!existsSync(join(dataRoot, 'types.xml'))) {
  console.log(`no unpacked data at ${dataRoot} — nothing to compare against`);
  process.exit(0);
}
const read = dataReader(dataRoot);

const spec = (file: string, extra: Partial<FactionSpec> = {}): FactionSpec => ({
  file, type: townTypeFor(file), donor: 'TOWN_HEAVEN', name: `${file}burg`,
  race: { name: `The ${file}` },
  towns: [{ file: 'First', name: 'First Town', biography: 'The first.', bonus: 'TOWN_NO_BONUS' }],
  ...extra,
});

console.log('the model');
{
  check('the type is the identifier\'s', townTypeFor('BoneCourt') === 'TOWN_BONE_COURT' && townTypeFor('Test') === 'TOWN_TEST');
  check('the race is the type\'s, but the dwarves', raceFor('TOWN_TEST') === 'RACE_TEST' && raceFor('TOWN_FORTRESS') === 'RACE_DWARF');
  check('a blank faction names what it lacks', factionProblems({ ...spec('X'), name: '', towns: [] }).length === 2);
  const mod = newCreatureMod();
  const a = addFaction(mod, spec('Alpha'));
  const b = addFaction(mod, spec('Beta'));
  check('ordinals append after the shipped eleven', a.number === SHIPPED_TOWN_TYPES && b.number === SHIPPED_TOWN_TYPES + 1);
  throws('a shipped type is refused', () => addFaction(mod, spec('Heaven'), new Set(['TOWN_HEAVEN'])), 'game\'s own');
  throws('a duplicate is refused', () => addFaction(mod, spec('Alpha')), 'already in the mod');
  throws('a wrong type is refused', () => addFaction(mod, { ...spec('Gamma'), type: 'TOWN_OTHER' }), 'TOWN_GAMMA');
  throws('a rename is refused', () => updateFaction(mod, 'Alpha', spec('Alpha2')), 'renamed');
  const changed = updateFaction(mod, 'Alpha', spec('Alpha', { name: 'Alphaville' }));
  check('an update keeps the ordinal', changed.number === SHIPPED_TOWN_TYPES && mod.factions![0]!.name === 'Alphaville');
  mod.heroes = [{ id: 'H', name: 'H', biography: '', town: 'TOWN_BETA', heroClass: 'HERO_CLASS_KNIGHT' } as never];
  throws('a hero of the type holds it', () => removeFaction(mod, 'Beta'), 'town of H');
  mod.heroes = [];
  removeFaction(mod, 'Alpha');
  check('the ones after a removal move down', mod.factions!.length === 1 && mod.factions![0]!.number === SHIPPED_TOWN_TYPES);
  check('the grid is five by six', GRID.columns === 5 && GRID.rows === 6);
}

console.log('the tree, read for the form');
{
  const haven = readTownTree('TOWN_HEAVEN', read);
  const at = (key: string) => haven.buildings.find((b) => b.key === key);
  check('Haven lists thirty-six records', haven.buildings.length === 36, String(haven.buildings.length));
  check("the hall's levels have cells of their own down the column", at('TB_TOWN_HALL')?.cell?.x === 1 && at('TB_TOWN_HALL/2')?.cell?.y === 2 && at('TB_TOWN_HALL/4')?.cell?.y === 6);
  check("a dwelling's upgrade stacks on its cell", JSON.stringify(at('TB_DWELLING_1')?.cell) === JSON.stringify(at('TB_DWELLING_1/2')?.cell));
  check('a level needs the one below it', at('TB_TOWN_HALL/3')?.requires.join() === 'TB_TOWN_HALL/2');
  check('a dependency is named by key', at('TB_DWELLING_5')?.requires.join() === 'TB_MAGIC_GUILD');
  check("the record's words, cost and level are read", !!at('TB_DWELLING_3')?.name && at('TB_DWELLING_3')?.cost.Gold === 1500 && at('TB_DWELLING_3')?.devLevel === 3);
  check('a dwelling names its creature', at('TB_DWELLING_1')?.creature === 'CREATURE_PEASANT');
  const necro = readTownTree('TOWN_NECROMANCY', read);
  check('a dependency on a record the town never lists is left out', necro.buildings.every((b) => b.requires.every((r) => necro.buildings.some((x) => x.key === r))));
  throws('a town that is not shipped is refused', () => readTownTree('TOWN_TEST', read), 'not a shipped town');
}

console.log('the build, one faction');
let one: BuildReport;
{
  const mod: CreatureMod = newCreatureMod();
  addFaction(mod, spec('Test', {
    icons: BONE_ON_PLUM,
    magic: 'none',
    race: { name: 'Bone Court', siloIncome: { Gem: 1 }, music: 'TOWN_NECROMANCY' },
    buildings: {
      'TB_SHIPYARD': null,
      'TB_SPECIAL_1': { name: 'Bone Pit', cost: { Gold: 2000 }, devLevel: 3, slot: { x: 5, y: 5 }, button: { lua: 'BonePit' } },
      'TB_DWELLING_5': { requires: ['TB_FORT/2'] },
    },
    script: 'function BonePit(town) end;',
    towns: [
      { file: 'Ossuary', name: 'Ossuary', biography: 'Bones.', bonus: 'TOWN_NO_BONUS' },
      { file: 'Charnel', name: 'Charnel', biography: 'More bones.', bonus: 'TOWN_NO_BONUS' },
    ],
  }));
  one = buildCreatureMod(mod, read);
  const text = (path: string): string => {
    const f = one.files.find((x) => x.path === path);
    if (!f) throw new Error(`no ${path} in the build`);
    return f.data.toString('latin1');
  };
  const has = (path: string): boolean => one.files.some((x) => x.path === path);
  const types = text(TYPES);
  check('types.xml: the type in both shapes', types.includes('<Item>TOWN_TEST</Item>') && /<Name>TOWN_TEST<\/Name>\s*<Value>11<\/Value>/.test(types));
  check('types.xml: the race in both shapes', types.includes('<Item>RACE_TEST</Item>') && /<Name>RACE_TEST<\/Name>\s*<Value>11<\/Value>/.test(types));
  check('types.xml: __RACE_COUNT is 12', /<Name>__RACE_COUNT<\/Name>\s*<Value>12<\/Value>/.test(types));
  const size = (table: string): string | undefined => new RegExp(`<TypeName>${table}</TypeName>[\\s\\S]*?<Data>(\\d+)</Data>`).exec(types)?.[1];
  check('types.xml: the town table holds 12', size('Table_TownTypeInfo_TownType') === '12', size('Table_TownTypeInfo_TownType'));
  check('types.xml: the RMG table holds 13', size('Table_RMGPreset_Race') === '13', size('Table_RMGPreset_Race'));
  check('types.xml: the town specs hold 257', size('Table_TownSpecRef_TownSpec') === '257', size('Table_TownSpecRef_TownSpec'));
  check('types.xml: the named towns', types.includes('<Item>TOWNSPEC_TEST_RANDOM_OSSUARY</Item>') && /<Name>TOWNSPEC_TEST_RANDOM_CHARNEL<\/Name>\s*<Value>256<\/Value>/.test(types));
  check('TownTypesInfo: twelve records, ours last', count(text(TOWN_TYPES_INFO), /<ID>/g) === 12 && text(TOWN_TYPES_INFO).includes('<ID>TOWN_TEST</ID>'));
  check('RMGPresetTable: thirteen rows, ours before the count', count(text(RMG_PRESETS), /<ID>/g) === 13 && text(RMG_PRESETS).indexOf('<ID>RACE_TEST</ID>') < text(RMG_PRESETS).indexOf('<ID>__RACE_COUNT</ID>'));
  check('music: a row for the type', text(RACE_MUSIC).includes('<race>TOWN_TEST</race>'));
  const names = pickerNames({ file: 'Test' });
  check('the picker: a tile and two texts', text(PICKER_TEXTURES).includes(`<TextureName>${names.texture}</TextureName>`)
    && text(PICKER_TEXTS).includes(`<TextName>${names.tooltip}</TextName>`) && has(`${PICKER_DIR}/${names.texture}.txt`));
  check('the random-town group seats the town', groupMembers(text(TOWN_GROUP)).some((m) => m.includes('/Factions/Test/Test.(AdvMapTownShared).xdb')));
  check('TownSpecs: two named towns', count(text(TOWN_SPECS), /<ID>TOWNSPEC_TEST_RANDOM_/g) === 2);
  check('UIGameRoot: town_buildings_8', text(UI_ROOT).includes('<ID>town_buildings_8</ID>'));
  check('the script is loaded on every map', has(factionScriptPath('Test')) && text(COMMON_SCRIPT).includes(`doFile("/${factionScriptPath('Test')}");`));
  check("the script names the type the way the game's Lua numbers towns (type - 3)", text(factionScriptPath('Test')).includes('\nTOWN_TEST = 8;\n'));
  check('the town files are the faction\'s', has('Factions/Test/Test.(AdvMapTownShared).xdb') && has('Factions/Test/race.txt'));
  check('the rows: the picker, nine wide, ours last', one.factions?.picker.length === 9 && one.factions.picker[8]!.name === 'TOWN_TEST' && one.factions.picker[8]!.town === 11);
  check('the rows: the button', one.factions?.buttons.length === 1 && one.factions.buttons[0]!.lua === 'BonePit' && one.factions.buttons[0]!.town === 11);
  check('the manifest carries the faction', text(MOD_MANIFEST).includes('"factions"'));
}

console.log('a building taken from another town keeps all its levels, on one cell');
{
  // LAUNCH 44: the camp is Stronghold's three-level Hall of Trial, moved to a
  // cell of ours. `slot` moved level one and left two and three at
  // Stronghold's coordinates — on top of Haven's magic guild — so the build
  // refused, the probe lost those cells, and the camp could be built and
  // never upgraded.
  const mod: CreatureMod = newCreatureMod();
  addFaction(mod, spec('Levels', {
    buildings: {
      'TB_SHIPYARD': null,
      'TB_SPECIAL_1': { from: 'TOWN_STRONGHOLD', grants: null, slot: { x: 5, y: 5 } },
      'TB_SPECIAL_1/2': { cost: { Gold: 4000 } },
      'TB_SPECIAL_1/3': { cost: { Gold: 8000 } },
    },
  }));
  const built = buildCreatureMod(mod, read);
  const def = built.files.find((f) => /Levels\.\(TownBuildDefinition\)/.test(f.path));
  const slot = def ? gridSlotText(def.data.toString('latin1'), 'TB_SPECIAL_1') ?? '' : '';
  const cells = [...slot.matchAll(/<Upgrade>BLD_UPG_(\d)<\/Upgrade>\s*<XSlotPos>(\d+)<\/XSlotPos>\s*<YSlotPos>(\d+)<\/YSlotPos>/g)]
    .map((m) => `${m[1]}:${m[2]},${m[3]}`);
  check('every level has a cell, and they are all the one we asked for', cells.join(' ') === '1:5,5 2:5,5 3:5,5', cells.join(' '));
  const levels = built.files.filter((f) => /TownBuildingSharedStats.*Special_1/.test(f.path)).length;
  check('and its three records came with it', levels === 3, String(levels));
}
console.log('pictures of our own for the icons');
{
  // A 16×16 magenta PNG for every slot: read, grown, fitted — and the DDS
  // the game reads carries that colour where the theme would have drawn.
  const dir = join(import.meta.dirname, '..', '_tmp', 'own-icons-test');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const rgba = new Uint8Array(16 * 16 * 4);
  for (let i = 0; i < 16 * 16; i++) { rgba[i * 4] = 255; rgba[i * 4 + 2] = 255; rgba[i * 4 + 3] = 255; }
  const png = Buffer.from(pngDataUri(16, 16, rgba).split(',')[1]!, 'base64');
  const pic = (name: string): string => { const f = join(dir, `${name}.png`); writeFileSync(f, png); return f; };
  const mod: CreatureMod = newCreatureMod();
  addFaction(mod, spec('Pix', {
    pictures: {
      buildings: { 'TB_TAVERN': pic('tavern'), 'TB_DWELLING_1/2': pic('d1u') },
      town: pic('town'), race: pic('race'), tower: pic('tower'),
      kingdom: [pic('k1'), pic('k2'), pic('k3'), pic('k4')],
      button: { normal: pic('bn'), pushed: pic('bp'), disabled: pic('bd') },
      capture: { sign: pic('sign'), flag: pic('flag'), byColour: { '03Orange': { flag: pic('orange') } } },
    },
    buildings: { 'TB_SPECIAL_1': { button: { lua: 'Pit' } } },
  }));
  const r = buildCreatureMod(mod, read);
  const file = (path: string) => r.files.find((f) => f.path === path);
  const magenta = (path: string): boolean => {
    const f = file(path);
    if (!f) return false;
    // The centre pixel: a picture smaller than the icon is grown by whole
    // pixels and centred, so the corners are the transparent border.
    const img = decodeDDSBuffer(f.data);
    const at = ((img.height >> 1) * img.width + (img.width >> 1)) * 4;
    return img.rgba[at] === 255 && img.rgba[at + 1] === 0 && img.rgba[at + 2] === 255;
  };
  check('the tavern icon is the picture, at 128', magenta('Factions/Pix/icons/tavern_1.dds') && decodeDDSBuffer(file('Factions/Pix/icons/tavern_1.dds')!.data).width === 128);
  check('an upgrade level by its key', magenta('Factions/Pix/icons/dwelling_1_2.dds'));
  check("a building not given keeps the donor's icon", !file('Factions/Pix/icons/blacksmith_1.dds'));
  check('the town icon at 55, the fortified one kept', magenta('Factions/Pix/icons/town.dds') && decodeDDSBuffer(file('Factions/Pix/icons/town.dds')!.data).width === 55 && !file('Factions/Pix/icons/town_fort.dds'));
  check('the race tile and the tower', magenta('Factions/Pix/icons/race.dds') && magenta('Factions/Pix/icons/tower.dds'));
  check('the four kingdom icons', [1, 2, 3, 4].every((l) => magenta(`Factions/Pix/icons/kingdom_${l}.dds`)));
  check("the button's three skins", r.factions?.buttons.length === 1 && r.files.some((f) => /Factions\/Pix\/icons\/.*special.*\.dds$/i.test(f.path)));
  check('the capture marker from pictures, no theme: eight colours, the sign and the flag ours', magenta('Factions/Pix/capture/01Brown/Sign.(Texture).dds') && magenta('Factions/Pix/capture/08Violet/Flag.(Texture).dds') && magenta('Factions/Pix/capture/03Orange/Flag.(Texture).dds') && r.files.filter((f) => /\/capture\/\d\d\w+\/Marker\.\(Effect\)\.xdb$/.test(f.path)).length === 8);
  throws('a sign without a flag and no theme', () => buildCreatureMod((() => { const m = newCreatureMod(); addFaction(m, spec('HalfMark', { pictures: { capture: { sign: pic('s2') } } })); return m; })(), read), 'both a sign and a flag');
  throws('a button with neither pictures nor a theme', () => buildCreatureMod((() => { const m = newCreatureMod(); addFaction(m, spec('NoSkin', { buildings: { 'TB_SPECIAL_1': { button: { lua: 'X' } } } })); return m; })(), read), 'three skins');
  rmSync(dir, { recursive: true, force: true });
}

console.log('tracks of our own');
{
  const dir = join(import.meta.dirname, '..', '_tmp', 'own-tracks-test');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const ogg = (name: string): string => { const f = join(dir, `${name}.ogg`); writeFileSync(f, 'OggS'); return f; };
  const mod: CreatureMod = newCreatureMod();
  addFaction(mod, spec('Tune', { race: { name: 'Tune', music: 'TOWN_NECROMANCY', tracks: { town: ogg('town'), win: ogg('win'), combat: [ogg('b1'), ogg('b2'), ogg('b3')] } } }));
  const r = buildCreatureMod(mod, read);
  const text = (path: string): string => r.files.find((f) => f.path === path)!.data.toString('latin1');
  const music = text(RACE_MUSIC);
  const rowAt = music.indexOf('<race>TOWN_TUNE</race>');
  const row = music.slice(rowAt, music.indexOf('</Item>', music.indexOf('</musicInfo>', rowAt)));
  check('the town and win slots point at documents of ours', row.includes('<TownMusic href="/Factions/Tune/music/town.(Music).xdb#xpointer(/Music)"/>') && row.includes('<WinCombatMusic href="/Factions/Tune/music/win.(Music).xdb#xpointer(/Music)"/>'));
  check("the tavern slot stays the set's (Necropolis's)", /<TavernMusic href="Tavern-Themes\/Necro/.test(row) || /<TavernMusic href="[^"]*Necr/i.test(row), /<TavernMusic href="([^"]*)"/.exec(row)?.[1]);
  check('three battle themes of ours', (row.match(/\/Factions\/Tune\/music\/combat_\d\.\(Music\)\.xdb/g) ?? []).length === 3 && !row.includes('Battle-Themes/'));
  const doc = text('Factions/Tune/music/town.(Music).xdb');
  check('the document names the loose file the way the shipped ones do', doc.includes('<FileName>..' + ['', 'Music', 'H5E', 'Tune', 'town.ogg'].join(String.fromCharCode(92)) + '</FileName>') && doc.includes('<FadeIn>2000</FadeIn>'));
  check('the install copies five files under Music/H5E/Tune', r.factions?.loose.length === 5 && r.factions.loose.every((l) => l.path.startsWith('Music/H5E/Tune/')) && r.factions.musicDirs.join() === 'Music/H5E/Tune');
  // Sounds: a WAV of ours for the guild's click and an ambient loop.
  const wav = join(dir, 'click.wav'); writeFileSync(wav, 'RIFF....WAVEfmt ');
  const m2: CreatureMod = newCreatureMod();
  addFaction(m2, spec('Snd', { race: { name: 'Snd', sounds: { guild: wav, ambient: ogg('amb') } } }));
  const r2 = buildCreatureMod(m2, read);
  const music2 = r2.files.find((f) => f.path === RACE_MUSIC)!.data.toString('latin1');
  const row2 = music2.slice(music2.indexOf('<race>TOWN_SND</race>'));
  check('the guild click and the ambient set are ours in the row', row2.includes('<MagicGuildSound href="/Factions/Snd/sounds/guild.(Sound).xdb#xpointer(/Sound)"/>') && row2.includes('<TownAmbientSoundSet href="/Factions/Snd/sounds/ambient.(AmbientSoundSet).xdb#xpointer(/AmbientSoundSet)"/>'));
  const sndDoc = r2.files.find((f) => f.path === 'Factions/Snd/sounds/guild.(Sound).xdb')!.data.toString('latin1');
  const sndUid = /<uid>([0-9A-F-]{36})<\/uid>/i.exec(sndDoc)![1]!;
  check('the sound document keys a binary of ours holding the file as it is', r2.files.some((f) => f.path === `bin/Sounds/${sndUid}` && f.data.toString('latin1') === 'RIFF....WAVEfmt ') && sndDoc.includes('<Loop>false</Loop>'));
  const ambDoc = r2.files.find((f) => f.path === 'Factions/Snd/sounds/ambient.(Sound).xdb')!.data.toString('latin1');
  check('the ambient loop loops, and its set names it', ambDoc.includes('<Loop>true</Loop>') && r2.files.find((f) => f.path === 'Factions/Snd/sounds/ambient.(AmbientSoundSet).xdb')!.data.toString('latin1').includes('<Loop href="/Factions/Snd/sounds/ambient.(Sound).xdb#xpointer(/Sound)"/>'));
  check("the hall's click stays the set's", /<TownHallSound href="\/Sounds\//.test(row2));
  throws('a sound that is neither wav nor ogg', () => { const m = newCreatureMod(); addFaction(m, spec('Mp3s', { race: { name: 'x', sounds: { hall: join(dir, 'x.mp3') } } })); buildCreatureMod(m, read); }, 'not a .wav or an .ogg');
  throws('a track that is not an ogg', () => { const m = newCreatureMod(); addFaction(m, spec('Mp3', { race: { name: 'x', tracks: { town: join(dir, 'x.mp3') } } })); buildCreatureMod(m, read); }, 'not an .ogg');
  rmSync(dir, { recursive: true, force: true });
}

console.log('the build, two factions');
{
  const mod: CreatureMod = newCreatureMod();
  addFaction(mod, spec('One'));
  addFaction(mod, spec('Two', { donor: 'TOWN_NECROMANCY', towns: [
    { file: 'A', name: 'A', biography: 'a', bonus: 'TOWN_NO_BONUS' },
    { file: 'B', name: 'B', biography: 'b', bonus: 'TOWN_NO_BONUS' },
  ] }));
  const two = buildCreatureMod(mod, read);
  const text = (path: string): string => {
    const f = two.files.find((x) => x.path === path);
    if (!f) throw new Error(`no ${path} in the build`);
    return f.data.toString('latin1');
  };
  const types = text(TYPES);
  const size = (table: string): string | undefined => new RegExp(`<TypeName>${table}</TypeName>[\\s\\S]*?<Data>(\\d+)</Data>`).exec(types)?.[1];
  check('types.xml: 13 towns, 14 presets, 258 specs', size('Table_TownTypeInfo_TownType') === '13' && size('Table_RMGPreset_Race') === '14' && size('Table_TownSpecRef_TownSpec') === '258',
    `${size('Table_TownTypeInfo_TownType')} ${size('Table_RMGPreset_Race')} ${size('Table_TownSpecRef_TownSpec')}`);
  check('types.xml: the second\'s named towns number after the first\'s', /<Name>TOWNSPEC_TWO_RANDOM_B<\/Name>\s*<Value>257<\/Value>/.test(types));
  check('ONE types.xml, ONE UIGameRoot', two.files.filter((f) => f.path === TYPES).length === 1 && two.files.filter((f) => f.path === UI_ROOT).length === 1);
  check('UIGameRoot: both grids', text(UI_ROOT).includes('<ID>town_buildings_8</ID>') && text(UI_ROOT).includes('<ID>town_buildings_9</ID>'));
  check('TownTypesInfo: thirteen', count(text(TOWN_TYPES_INFO), /<ID>/g) === 13);
  check('the group seats both', groupMembers(text(TOWN_GROUP)).filter((m) => m.includes('/Factions/')).length === 2);
  check('the picker is ten wide', two.factions?.picker.length === 10);
  check('the second town is Necropolis\'s copy', two.files.some((f) => f.path.startsWith('Factions/Two/town/') && /Necro/i.test(f.path)));
  check('the hero pool is the shipped one without heroes of ours', groupMembers(text(HERO_GROUP)).length === groupMembers(read(HERO_GROUP)!.toString('latin1')).length);
}

console.log('what the engine compiled per race — the rows and the group');
{
  const mod: CreatureMod = newCreatureMod();
  addDwelling(mod, {
    file: 'BoneGlade', creatures: ['CREATURE_UNICORN'], guards: ['CREATURE_UNICORN'],
    model: '/_(Model)/Buildings/MisticalGarden.(Model).xdb', icon: '/UI/TownHall/preserve/128/d6.xdb',
    type: 'BUILDING_PRESERVE_MILITARY_POST', name: '/Text/Game/TownBuildings/Preserve/Dwelling_5/Name.txt',
    description: '/Text/Game/TownBuildings/Preserve/Dwelling_5/Description.txt', firstVisit: 'x',
  });
  addFaction(mod, spec('Traits', {
    alignment: 'evil', mapDwellings: ['BoneGlade'],
    ai: { skillsLike: 'TOWN_NECROMANCY', skillValues: { 5: { commander: 3000, collectorSupplier: 100, freelancer: 1000 } } },
  }));
  addFaction(mod, spec('Plain'));
  const built = buildCreatureMod(mod, read);
  const text = (path: string): string => {
    const f = built.files.find((x) => x.path === path);
    if (!f) throw new Error(`no ${path} in the build`);
    return f.data.toString('latin1');
  };
  const traits = built.factions!.picker.find((r) => r.name === 'TOWN_TRAITS')!.traits!;
  check('the picker row carries the traits', traits.alignment === 'evil' && traits.dwellings === 'DWELLINGS_TRAITS' && traits.aiSkillsLike === 7 && traits.skillValues?.[5]?.commander === 3000);
  check('a faction that says nothing carries none', built.factions!.picker.find((r) => r.name === 'TOWN_PLAIN')!.traits === undefined);
  const file = racesFileText(built.factions!.picker);
  check('the races file: the trait lines', file.includes('\ntrait 11 alignment evil\n') && file.includes('\ntrait 11 dwellings DWELLINGS_TRAITS\n') && file.includes('\ntrait 11 ai-skills-like 7\n'));
  check('the races file: the skill value line', file.includes('\nskillvalue 11 5 3000 100 1000\n'));
  check('the races file: nothing for the plain one, nothing for the shipped', !/\n(trait|skillvalue) (?!11 )/.test(file));
  const group = text(`${DWELLING_GROUP_DIR}/Traits.xdb`);
  check("the group lists the mod's dwelling", groupMembers(group).join() === '/Dwellings/BoneGlade/BoneGlade.(AdvMapDwellingShared).xdb#xpointer(/AdvMapDwellingShared)');
  const root = text(RPG_ROOT);
  check('RPGRoot registers it under the id, once, beside the shipped eight', count(root, /<ID>DWELLINGS_TRAITS<\/ID>/g) === 1 && count(root, /<ID>DWELLINGS_/g) === 9 && root.includes(`<Group href="/${DWELLING_GROUP_DIR}/Traits.xdb#xpointer(/AdvMapSharedGroup)"/>`));
  check('RPGRoot registers nothing for the plain one', !root.includes('DWELLINGS_PLAIN'));
  check('the group id is the type\'s', dwellingsGroupFor('TOWN_BONE_COURT') === 'DWELLINGS_BONE_COURT');
  throws('a map dwelling the mod lacks is refused', () => { const m = newCreatureMod(); addFaction(m, spec('Lost', { mapDwellings: ['Nowhere'] })); buildCreatureMod(m, read); }, 'not a dwelling of the mod');
  check('the checks: a skill by name, a race that is not shipped', factionProblems({ ...spec('X'), ai: { skillsLike: 'TOWN_X', skillValues: { ['HERO_SKILL_LOGISTICS' as unknown as number]: { commander: 1, collectorSupplier: 1, freelancer: 1 } } } }).length === 2);
}

console.log("the AI's skill table — what the window's rows are read from");
{
  const table = read(SKILL_TABLE)!.toString('utf8');
  const textOf = (href: string): string => gameText(assets([dataRoot]), href);
  const ours: ModHeroSkill = { id: 'HERO_SKILL_BONE_LORE', kind: 'racial', heroClass: 'HERO_CLASS_BONE_LORD', name: 'Bone lore', description: '', aiRace: 'Necropolis', number: SHIPPED_SKILLS };
  const rows = readSkillAiRows(table, textOf, [ours]);
  check('every shipped skill but NONE, then ours', rows.length === SHIPPED_SKILLS && rows[0]!.id === 'HERO_SKILL_LOGISTICS' && rows.at(-1)!.id === ours.id);
  // The ordinal is the enum value: types.xml's map says what it is.
  const types = read(TYPES)!.toString('utf8');
  const at = types.indexOf('<TypeName>SkillID</TypeName>');
  const map = types.slice(at, types.indexOf('</Entries>', at));
  const ordinalOf = (id: string): number => Number(new RegExp(`<Name>${id}</Name>\\s*<Value>(\\d+)</Value>`).exec(map)?.[1] ?? -1);
  check('the ordinal is the enum value', rows.every((r) => r.id === ours.id ? r.ordinal === SHIPPED_SKILLS : r.ordinal === ordinalOf(r.id)));
  const archery = rows.find((r) => r.id === 'HERO_SKILL_ARCHERY')!;
  check('a perk is marked and named', archery.perk && archery.name === 'Стрельба');
  check("a race's three, as the record holds them", archery.values.TOWN_PRESERVE!.commander === 4000 && archery.values.TOWN_PRESERVE!.collectorSupplier === 1000 && archery.values.TOWN_DUNGEON!.freelancer === 100);
  check('a skill is not a perk, and every row is named', !rows.find((r) => r.id === 'HERO_SKILL_LOGISTICS')!.perk && rows.every((r) => r.name));
  check("ours: its aiRace's numbers and nobody else's", rows.at(-1)!.values.TOWN_NECROMANCY!.commander === 1000 && rows.at(-1)!.values.TOWN_HEAVEN!.commander === 0 && !rows.at(-1)!.perk);
  check("the eight columns are the shipped towns, in the ordinals' order",Object.keys(archery.values).join() === Object.keys(SHIPPED_TOWN_ORDINALS).join());
}

if (failures) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nall good');
