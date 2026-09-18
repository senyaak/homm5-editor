// The files every faction in the mod contributes, and the game's own that it
// edits — the build's faction pass.
//
// A faction touches more of the game's files than anything else in the mod,
// because the engine indexes by town type in a dozen places and each one is
// a registry a twelfth type has to be written into (docs/FACTION_PLAN.md,
// "The registries a faction touches"):
//
//   by ordinal     types.xml (ETownType, ERace, __RACE_COUNT, three table
//                  sizes), TownTypesInfo, RMGPresetTable, UIGameRoot's
//                  town_buildings_N, the executable's ceilings (faction-limit.ts)
//   by name        the picker's textures and texts, the initiative bar's tower
//                  portraits, TableRaceMusic, the extension's races file
//   by membership  Towns/any, Heroes/Any, TownSpecs, PlayerColourSchemes,
//                  the town screen's centre button
//
// Every one of these is a shipped file with ONE more record appended, and the
// appending is what this module orders: the per-faction copy (town-files.ts
// and its neighbours) is called for each, the shared tables are threaded
// through every faction in turn, and the three files the mod already edits
// for other reasons — types.xml, UIGameRoot, advmap-common.lua — are handed
// back as patch functions for creature-mod.ts to apply to its own copy, so no
// archive ever carries two of them.
//
// All of it is the probe's work (_tmp/town12-probe.ts, launches 1–39) made
// the mod's: what the probe wrote for one faction by hand, this writes for
// every faction from the manifest.

import { SHIPPED_TOWN_ORDINALS, SHIPPED_TOWN_SPECS, TOWN_SPECS, ATB_TOWER_ICONS, buildNamedTowns, buildTown, patchTownSpecTable, patchTownSpecTypes, patchTowerIcons } from './town-files.ts';
import type { TownBuild } from './town-files.ts';
import { RACE_MUSIC, TOWN_TYPES_INFO, musicFiles, patchRaceMusic, patchTownTypesInfo, raceFiles, soundFiles } from './town-type-info.ts';
import type { LooseFile } from './town-type-info.ts';
import { PLAYER_COLOUR_SCHEMES, patchColourSchemes } from './capture-marker.ts';
import { HERO_GROUP, TOWN_GROUP, addGroupMember } from './shared-groups.ts';
import { SHIPPED_PICKER_ORDER } from './race-order.ts';
import type { PickerRace } from './race-order.ts';
import { SPECIAL_BUTTON, SPECIAL_BUTTON_SHARED, addTownButtons, factionScriptFile, factionScriptPath } from './town-button.ts';
import type { TownButton, TownButtonRow } from './town-button.ts';
import { featureLines } from './town-features.ts';
import { heroHref, heroPaths } from './heroes.ts';
import type { HeroSpec } from './heroes.ts';
import { UI_ROOT, mustRead, utf16 } from './mod-files.ts';
import type { DataReader, ModFile } from './mod-files.ts';
import { EOL, insertAfterLine, insertBeforeLine, once, retune } from './xml-edit.ts';
import { LAST_SHIPPED_RACE, LAST_SHIPPED_TOWN_TYPE, SHIPPED_RMG_PRESETS, SHIPPED_TOWN_TYPES, raceFor } from './factions.ts';
import type { ModFaction } from './factions.ts';

/** The race picker's item folder: its two lists and its texts. */
export const PICKER_DIR = 'UI/MPWait/PlayersList/Item';
export const PICKER_TEXTURES = `${PICKER_DIR}/Races.(WindowRelatedTextures).xdb`;
export const PICKER_TEXTS = `${PICKER_DIR}/Races.(WindowRelatedTexts).xdb`;
/** The generator's table: a row per race, cloned from the donor's. */
export const RMG_PRESETS = 'GameMechanics/RefTables/RMGPresetTable.xdb';
/** The picker's fallback tile, for a faction that drew no icons. */
const HAVEN_TILE = 'Textures/Interface/MPWait/PlayersList/Item/Races/Haven.(Texture).xdb';

/** The rows the extension's files are written from — the install's side (mod-archive.ts). */
export interface FactionRows {
  /** The picker's order: the shipped eight, then ours. */
  picker: PickerRace[];
  /** The centre buttons, one per faction that has one. */
  buttons: TownButtonRow[];
  /** What the buildings DO — `feature <town> <bldg> <lvl> <id>` lines. */
  features: string[];
  /** Tracks of ours, copied loose under the game (`Music/H5E/<faction>/`), and the folders that may hold any. */
  loose: LooseFile[];
  musicDirs: string[];
}

/** What the faction pass produced. */
export interface FactionBuild {
  /** Every file: the towns, the races, the named towns, the shared tables with ours in them. */
  files: ModFile[];
  /** `types.xml` with ours in it — applied to the mod's one copy. */
  patchTypes: (types: string) => string;
  /** `UIGameRoot` with a build grid per faction — the same. */
  patchUiRoot: (root: string) => string;
  /** The faction scripts' paths, for the global script's `doFile` lines. */
  scripts: string[];
  rows: FactionRows;
  /** What the town copies left in the game's data, and what they could not find. */
  stopped: string[];
  missing: string[];
}

/** The picker's item names for a faction: the tile and the arrow's tooltip. */
export function pickerNames(f: Pick<ModFaction, 'file'>): { texture: string; tooltip: string } {
  const stem = f.file.toLowerCase();
  return { texture: `race_${stem}`, tooltip: `race_tooltip_${stem}` };
}

/**
 * Build every faction: its own files, and the shared tables threaded through
 * all of them. `heroes` is the mod's, for the random-hero pool — a hero of
 * the type, not a scenario one, is seated in `Heroes/Any`.
 */
export function buildFactions(
  factions: readonly ModFaction[], heroes: readonly HeroSpec[],
  /** The mod's creatures' Character and Shot, by id — what a `shooter` resolves to. */
  shooters: ReadonlyMap<string, { character: string; shot: string }>,
  read: DataReader,
): FactionBuild {
  const files: ModFile[] = [];
  const stopped: string[] = [];
  const missing: string[] = [];
  const builds: { f: ModFaction; town: TownBuild }[] = [];

  // The shared tables, each read once and appended to per faction.
  let townTypes = mustRead(read, TOWN_TYPES_INFO);
  let rmg = mustRead(read, RMG_PRESETS);
  let music = mustRead(read, RACE_MUSIC);
  let pickerTextures = mustRead(read, PICKER_TEXTURES);
  let pickerTexts = mustRead(read, PICKER_TEXTS);
  let towerIcons = mustRead(read, ATB_TOWER_ICONS);
  let schemes = mustRead(read, PLAYER_COLOUR_SCHEMES);
  let townGroup = mustRead(read, TOWN_GROUP);
  let heroGroup = mustRead(read, HERO_GROUP);
  let townSpecs = mustRead(read, TOWN_SPECS);
  const buttons: TownButton[] = [];
  const features: string[] = [];
  const loose: LooseFile[] = [];
  const musicDirs: string[] = [];
  const picker: PickerRace[] = SHIPPED_PICKER_ORDER.map((name) => ({ name, town: shippedOrdinal(name) }));

  for (const given of factions) {
    const donorOrdinal = SHIPPED_TOWN_ORDINALS[given.donor];
    if (!donorOrdinal) throw new Error(`${given.file}: ${given.donor} is not a shipped town`);
    let f = given;
    if (given.shooter && !given.siegeShooter) {
      const shooter = shooters.get(given.shooter);
      if (!shooter) throw new Error(`${given.file}: the towers' shooter ${given.shooter} is not a creature of the mod`);
      f = { ...given, siegeShooter: shooter };
    }
    const town = buildTown(f, donorOrdinal, read);
    files.push(...town.files);
    stopped.push(...town.stopped);
    missing.push(...town.missing);
    builds.push({ f, town });

    // The race as such: its name, its overview icons, its record, its music.
    if (!f.race) throw new Error(`${f.file}: a faction names its race`);
    const race = raceFiles(f, f.race, f.icons, f.pictures?.kingdom);
    files.push(...race.files);
    townTypes = patchTownTypesInfo(townTypes, f, town, race);
    music = patchRaceMusic(music, f);
    {
      const m = musicFiles(f, f.race.tracks);
      files.push(...m.files);
      loose.push(...m.loose);
      musicDirs.push(`Music/H5E/${f.file}`);
      files.push(...soundFiles(f, f.race.sounds).files);
    }
    rmg = cloneRecord(rmg, raceFor(f.donor), raceFor(f.type), '__RACE_COUNT');

    // The picker: a tile and a tooltip under names the extension's races file
    // repeats, so the compiled name→icon map learns them after the constructor.
    const names = pickerNames(f);
    pickerTextures = insertBeforeLine(pickerTextures, once(pickerTextures, '</textures>', 'picker textures list'), [
      '<Item>', `\t<TextureName>${names.texture}</TextureName>`,
      `\t<Texture href="/${town.raceIcon ?? HAVEN_TILE}#xpointer(/Texture)"/>`, '</Item>',
    ]);
    pickerTexts = insertBeforeLine(pickerTexts, once(pickerTexts, '</texts>', 'picker texts list'), [
      '<Item>', `\t<TextName>${names.texture}</TextName>`, `\t<text href="${names.texture}.txt"/>`, '</Item>',
      '<Item>', `\t<TextName>${names.tooltip}</TextName>`, `\t<text href="${names.tooltip}.txt"/>`, '</Item>',
    ]);
    files.push({ path: `${PICKER_DIR}/${names.texture}.txt`, data: utf16(f.race.name) });
    files.push({ path: `${PICKER_DIR}/${names.tooltip}.txt`, data: utf16(f.race.tooltip ?? f.race.name) });
    picker.push({ name: f.type, town: f.number, texture: names.texture, tooltip: names.tooltip });

    if (town.towerIcon) towerIcons = patchTowerIcons(towerIcons, f.type, town.towerIcon);
    if (town.captureMarker) schemes = patchColourSchemes(schemes, f, town.captureMarker);

    // Membership: the town in the random-town group, its heroes in the pool.
    townGroup = addGroupMember(townGroup, `/${town.paths.shared}#xpointer(/AdvMapTownShared)`, 'random towns group');
    for (const h of heroes) {
      if (h.town !== f.type || h.scenarioHero) continue;
      heroGroup = addGroupMember(heroGroup, heroHref(heroPaths(h)), 'heroes any group');
    }

    // The named towns, and their rows in the table.
    files.push(...buildNamedTowns(f, f.towns));
    townSpecs = patchTownSpecTable(townSpecs, f, f.towns);

    // The centre button and the faction's Lua.
    if (town.button) buttons.push({ ...town.button, town: f.number });
    features.push(...featureLines(f.number, town.features));
    files.push(factionScriptFile(f.file, f.script ?? ''));
  }

  files.push(
    { path: TOWN_TYPES_INFO, data: latin1(townTypes) },
    { path: RMG_PRESETS, data: latin1(rmg) },
    { path: RACE_MUSIC, data: latin1(music) },
    { path: PICKER_TEXTURES, data: latin1(pickerTextures) },
    { path: PICKER_TEXTS, data: latin1(pickerTexts) },
    { path: ATB_TOWER_ICONS, data: latin1(towerIcons) },
    { path: PLAYER_COLOUR_SCHEMES, data: latin1(schemes) },
    { path: TOWN_GROUP, data: latin1(townGroup) },
    { path: HERO_GROUP, data: latin1(heroGroup) },
    { path: TOWN_SPECS, data: latin1(townSpecs) },
  );
  let rows: TownButtonRow[] = [];
  if (buttons.length) {
    const b = addTownButtons(mustRead(read, SPECIAL_BUTTON), mustRead(read, SPECIAL_BUTTON_SHARED), buttons);
    files.push({ path: SPECIAL_BUTTON, data: latin1(b.button) }, { path: SPECIAL_BUTTON_SHARED, data: latin1(b.shared) }, ...b.files);
    rows = b.rows;
  }

  return {
    files,
    patchTypes: (types) => patchFactionTypes(types, factions),
    patchUiRoot: (root) => {
      let out = root;
      for (const { f, town } of builds) out = addBuildGrid(out, f.number, town.paths.build);
      return out;
    },
    scripts: factions.map((f) => factionScriptPath(f.file)),
    rows: { picker, buttons: rows, features, loose, musicDirs },
    stopped,
    missing,
  };
}

const latin1 = (s: string): Buffer => Buffer.from(s, 'latin1');

/** A shipped type's ordinal: `TOWN_HEAVEN` is 3. */
function shippedOrdinal(name: string): number {
  const n = SHIPPED_TOWN_ORDINALS[name];
  if (!n) throw new Error(`${name} is not a shipped town`);
  return n;
}

/**
 * `types.xml` with every faction in it: `ETownType` and `ERace` (a typedef of
 * it, value for value) in both shapes, `__RACE_COUNT` moved past ours, the
 * three table sizes — town types, generator presets, town specializations —
 * retuned to hold what the mod ships.
 */
export function patchFactionTypes(types: string, factions: readonly ModFaction[]): string {
  if (!factions.length) return types;
  let t = types;
  for (const f of factions) {
    if (t.includes(`<Item>${f.type}</Item>`)) throw new Error(`types.xml already declares ${f.type}`);
  }
  const count = SHIPPED_TOWN_TYPES + factions.length;
  // The lists, ours after the last shipped in the mod's order.
  t = insertAfterLine(t, once(t, `<Item>${LAST_SHIPPED_TOWN_TYPE}</Item>`, 'types.xml town enum'), factions.map((f) => `<Item>${f.type}</Item>`));
  const townMap = once(t, `<Name>${LAST_SHIPPED_TOWN_TYPE}</Name>`, 'types.xml town name→number map');
  t = insertAfterLine(t, t.indexOf('</Item>', townMap), factions.flatMap((f) => [
    '<Item>', `\t<Name>${f.type}</Name>`, `\t<Value>${f.number}</Value>`, '</Item>',
  ]));
  const townTable = once(t, '<TypeName>Table_TownTypeInfo_TownType</TypeName>', 'types.xml town table');
  t = retune(t, townTable, 'Data', SHIPPED_TOWN_TYPES, count, 'types.xml town ref_table_num_objs');
  t = retune(t, townTable, 'MinElements', SHIPPED_TOWN_TYPES, count, 'types.xml town MinElements');
  t = retune(t, townTable, 'MaxElements', SHIPPED_TOWN_TYPES, count, 'types.xml town MaxElements');

  t = insertAfterLine(t, once(t, `<Item>${LAST_SHIPPED_RACE}</Item>`, 'types.xml race enum'), factions.map((f) => `<Item>${raceFor(f.type)}</Item>`));
  const raceMap = once(t, `<Name>${LAST_SHIPPED_RACE}</Name>`, 'types.xml race name→number map');
  t = insertAfterLine(t, t.indexOf('</Item>', raceMap), factions.flatMap((f) => [
    '<Item>', `\t<Name>${raceFor(f.type)}</Name>`, `\t<Value>${f.number}</Value>`, '</Item>',
  ]));
  t = retune(t, once(t, '<Name>__RACE_COUNT</Name>', 'types.xml __RACE_COUNT'), 'Value', SHIPPED_TOWN_TYPES, count, 'types.xml __RACE_COUNT value');

  const rmgTable = once(t, '<TypeName>Table_RMGPreset_Race</TypeName>', 'types.xml RMG table');
  const presets = SHIPPED_RMG_PRESETS + factions.length;
  t = retune(t, rmgTable, 'Data', SHIPPED_RMG_PRESETS, presets, 'types.xml RMG ref_table_num_objs');
  t = retune(t, rmgTable, 'MinElements', SHIPPED_RMG_PRESETS, presets, 'types.xml RMG MinElements');
  t = retune(t, rmgTable, 'MaxElements', SHIPPED_RMG_PRESETS, presets, 'types.xml RMG MaxElements');

  // The named towns, each faction's after the last's.
  let first = SHIPPED_TOWN_SPECS;
  for (const f of factions) {
    t = patchTownSpecTypes(t, f, f.towns, first);
    first += f.towns.length;
  }
  return t;
}

/**
 * `UIGameRoot` with the faction's build grid: `town_buildings_<ordinal-3>`,
 * which is how the town screen asks for a type's grid.
 */
export function addBuildGrid(root: string, ordinal: number, build: string): string {
  const id = `town_buildings_${ordinal - 3}`;
  if (root.includes(`<ID>${id}</ID>`)) throw new Error(`${UI_ROOT} already has ${id}`);
  return insertBeforeLine(root, once(root, '</townBuildDefinitions>', 'town build definitions'), [
    '<Item>', `\t<ID>${id}</ID>`,
    `\t<TownDefinition href="/${build}#xpointer(/TownBuildDefinition)"/>`, '</Item>',
  ]);
}

/**
 * A ref table's `<Item>` around `<ID>id</ID>`, found by depth: a record nests
 * its own `<Item>` lists (a race record closes fifty-two), so the end is
 * the matching close, not the next `</Item>`. Self-closed items open nothing.
 */
function itemBlockAround(text: string, id: string): { start: number; end: number } {
  const idAt = once(text, `<ID>${id}</ID>`, 'record id');
  const start = text.lastIndexOf('<Item>', idAt);
  if (start < 0) throw new Error(`${id}: no enclosing <Item>`);
  const tag = /<Item(?:\s[^>]*)?>|<\/Item>/g;
  tag.lastIndex = start;
  let depth = 0;
  for (let m = tag.exec(text); m; m = tag.exec(text)) {
    if (m[0] === '</Item>') {
      if (--depth === 0) return { start, end: m.index + m[0].length };
    } else if (!m[0].endsWith('/>')) depth++;
  }
  throw new Error(`${id}: unbalanced <Item>`);
}

/** The table with `donorId`'s record cloned under `cloneId`, inserted before `beforeId`'s. */
export function cloneRecord(doc: string, donorId: string, cloneId: string, beforeId: string): string {
  if (doc.includes(`<ID>${cloneId}</ID>`)) throw new Error(`the table already has ${cloneId}`);
  const donor = itemBlockAround(doc, donorId);
  const clone = doc.slice(donor.start, donor.end).replace(`<ID>${donorId}</ID>`, `<ID>${cloneId}</ID>`);
  const anchor = itemBlockAround(doc, beforeId).start;
  const lineStart = doc.lastIndexOf('\n', anchor) + 1;
  const indent = /^[\t ]*/.exec(doc.slice(lineStart, anchor + 1))![0];
  return `${doc.slice(0, lineStart)}${indent}${clone}${EOL}${doc.slice(lineStart)}`;
}
