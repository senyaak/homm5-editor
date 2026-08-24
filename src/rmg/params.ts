// `RMGParameters` — the generator's global knobs, as the generator reads them.
//
// One file holds them: `data-unpacked/RMG/Params/Default.xdb`. Where a template
// says what ONE map wants, this says how EVERY map is built — how far from a
// town each tier of mine may sit, how strong the guard on a passage is, how
// close two treasure blocks may stand, which tile paints the ground nobody
// claimed. Nothing here interprets any of it — that is the phases' job. This
// only turns the file into numbers and hrefs.
//
// The field names are the game's own, spelling included: `MonsterStrenghtNames`
// and `ShipyardGuardsLevelCoef` are what the file says, and renaming them on
// the way in would mean every reader of this port has to translate back before
// they can grep the data. See docs/RMG.md.
//
// An href is kept verbatim, `#xpointer(...)` suffix and all — the phases that
// resolve one should see exactly what the engine saw, not a path this reader
// decided to tidy.

import { readFileSync } from 'node:fs';

import { childText, find, findAll, parse, text } from '../format/xml.ts';
import type { XmlElement } from '../format/xml.ts';

/** An x/y/z triple — a light colour, held in single precision like the engine. */
export interface RmgColor {
  x: number;
  y: number;
  z: number;
}

/** `PointLightParams` — the coloured lights scattered over the underground. */
export interface RmgPointLightParams {
  zoneRadius: number;
  minDist: number;
  zMin: number;
  zMax: number;
  lightRadiusMin: number;
  lightRadiusMax: number;
  colors: RmgColor[];
}

/** `CreatureStackParams` — the size of a guard stack before level scaling. */
export interface RmgCreatureStackParams {
  basicAmount: number;
  minAmount: number;
  maxAmount: number;
}

export interface RmgParams {
  rmgVersion: number;
  /** Tiles from a town: how far out each tier of mine is allowed to be. */
  mine1LevelMinRadius: number;
  mine1LevelMaxRadius: number;
  mine2LevelMinRadius: number;
  mine2LevelMaxRadius: number;
  mine3LevelMinRadius: number;
  mine3LevelMaxRadius: number;
  basicLeverGuardPower: number;
  connectionGuardLevel: number;
  mine1LevelGuardLevel: number;
  mine2LevelGuardLevel: number;
  mineGoldGuardLevel: number;
  junctionMinBorderDistance: number;
  teleportMinBorderDistance: number;
  teleportMaxBorderDistance: number;
  distBetweenLakes: number;
  distBetweenTreasureBlocks: number;
  creatureMinStackAmount: number;
  creatureMaxStackAmount: number;
  minDistanceBetweenBigObjects: number;
  minDistanceBetweenTreasureBlocks: number;
  groundTerrainLight: string;
  undergroundTerrainLight: string;
  pointLightParams: RmgPointLightParams;
  mapName: string;
  mapDescription: string;
  scenarioCaption: string;
  scenarioDescription: string;
  objectiveCaption: string;
  objectiveDescription: string;
  objectiveRMGCaption: string;
  objectiveRMGDescription: string;
  creatureStackParams: RmgCreatureStackParams;
  defaultSurfaceTile: string;
  defaultSubterraTile: string;
  deepWaterTile: string;
  deepWaterBottom: string;
  defaultTransitiveTile: string;
  transitiveTileIntensity: number;
  /** Seven, one per entry of the size table `CreateMap` indexes. */
  mapSizeNames: string[];
  textWith: string;
  textWithout: string;
  defaultRMGObjective: string;
  defaultGrailObjective: string;
  /** Empty in the shipped file; kept so a file that fills it is not misread. */
  templates: string[];
  textWithWater: string;
  textWithoutWater: string;
  monsterStrenghtNames: string[];
  resourceMineColors: RmgColor[];
  /** Empty in the shipped file, like `templates`. */
  monsterLevelCoef: number[];
  shipyardGuardsLevelCoef: number;
  groundTerrainLights: string[];
  obelisk: string;
  grail: string;
  waterTreasures: string[];
}

const int = (el: XmlElement, name: string): number => Number.parseInt(childText(el, name), 10) || 0;

// Single precision on purpose: the engine reads these into floats, and the
// betweenFloat lesson (docs/RMG.md) is that double-precision copies of float
// data are right to seven digits and wrong after.
const float = (el: XmlElement, name: string): number => Math.fround(Number.parseFloat(childText(el, name)) || 0);

const href = (el: XmlElement, name: string): string => find(el, name)?.attrs['href'] ?? '';

/** `<Name><Item href="…"/>…</Name>` — a list of references. */
function hrefItems(el: XmlElement, name: string): string[] {
  const holder = find(el, name);
  return holder ? findAll(holder, 'Item').map((i) => i.attrs['href'] ?? '') : [];
}

/** `<Name><Item><x>…</x><y>…</y><z>…</z></Item>…</Name>` — a list of colours. */
function colorItems(el: XmlElement, name: string): RmgColor[] {
  const holder = find(el, name);
  return holder
    ? findAll(holder, 'Item').map((i) => ({ x: float(i, 'x'), y: float(i, 'y'), z: float(i, 'z') }))
    : [];
}

export function parseParams(xml: string): RmgParams {
  const root = parse(xml);
  const p = find(root, 'RMGParameters');
  if (!p) throw new Error('not an RMGParameters');

  const light = find(p, 'PointLightParams');
  const pointLightParams: RmgPointLightParams = light
    ? {
        zoneRadius: int(light, 'ZoneRadius'),
        minDist: int(light, 'MinDist'),
        zMin: int(light, 'zMin'),
        zMax: int(light, 'zMax'),
        lightRadiusMin: int(light, 'LightRadiusMin'),
        lightRadiusMax: int(light, 'LightRadiusMax'),
        colors: colorItems(light, 'Colors'),
      }
    : { zoneRadius: 0, minDist: 0, zMin: 0, zMax: 0, lightRadiusMin: 0, lightRadiusMax: 0, colors: [] };

  const stack = find(p, 'CreatureStackParams');
  const creatureStackParams: RmgCreatureStackParams = stack
    ? { basicAmount: int(stack, 'BasicAmount'), minAmount: int(stack, 'MinAmount'), maxAmount: int(stack, 'MaxAmount') }
    : { basicAmount: 0, minAmount: 0, maxAmount: 0 };

  const monsterLevelCoefEl = find(p, 'MonsterLevelCoef');
  const monsterLevelCoef = monsterLevelCoefEl
    ? findAll(monsterLevelCoefEl, 'Item').map((i) => Math.fround(Number.parseFloat(text(i)) || 0))
    : [];

  return {
    rmgVersion: int(p, 'RMGVersion'),
    mine1LevelMinRadius: int(p, 'Mine1LevelMinRadius'),
    mine1LevelMaxRadius: int(p, 'Mine1LevelMaxRadius'),
    mine2LevelMinRadius: int(p, 'Mine2LevelMinRadius'),
    mine2LevelMaxRadius: int(p, 'Mine2LevelMaxRadius'),
    mine3LevelMinRadius: int(p, 'Mine3LevelMinRadius'),
    mine3LevelMaxRadius: int(p, 'Mine3LevelMaxRadius'),
    basicLeverGuardPower: int(p, 'BasicLeverGuardPower'),
    connectionGuardLevel: int(p, 'ConnectionGuardLevel'),
    mine1LevelGuardLevel: int(p, 'Mine1LevelGuardLevel'),
    mine2LevelGuardLevel: int(p, 'Mine2LevelGuardLevel'),
    mineGoldGuardLevel: int(p, 'MineGoldGuardLevel'),
    junctionMinBorderDistance: int(p, 'JunctionMinBorderDistance'),
    teleportMinBorderDistance: int(p, 'TeleportMinBorderDistance'),
    teleportMaxBorderDistance: int(p, 'TeleportMaxBorderDistance'),
    distBetweenLakes: int(p, 'DistBetweenLakes'),
    distBetweenTreasureBlocks: int(p, 'DistBetweenTreasureBlocks'),
    creatureMinStackAmount: int(p, 'CreatureMinStackAmount'),
    creatureMaxStackAmount: int(p, 'CreatureMaxStackAmount'),
    minDistanceBetweenBigObjects: int(p, 'MinDistanceBetweenBigObjects'),
    minDistanceBetweenTreasureBlocks: int(p, 'MinDistanceBetweenTreasureBlocks'),
    groundTerrainLight: href(p, 'GroundTerrainLight'),
    undergroundTerrainLight: href(p, 'UndergroundTerrainLight'),
    pointLightParams,
    mapName: href(p, 'MapName'),
    mapDescription: href(p, 'MapDescription'),
    scenarioCaption: href(p, 'ScenarioCaption'),
    scenarioDescription: href(p, 'ScenarioDescription'),
    objectiveCaption: href(p, 'ObjectiveCaption'),
    objectiveDescription: href(p, 'ObjectiveDescription'),
    objectiveRMGCaption: href(p, 'ObjectiveRMGCaption'),
    objectiveRMGDescription: href(p, 'ObjectiveRMGDescription'),
    creatureStackParams,
    defaultSurfaceTile: href(p, 'DefaultSurfaceTile'),
    defaultSubterraTile: href(p, 'DefaultSubterraTile'),
    deepWaterTile: href(p, 'DeepWaterTile'),
    deepWaterBottom: href(p, 'DeepWaterBottom'),
    defaultTransitiveTile: href(p, 'DefaultTransitiveTile'),
    transitiveTileIntensity: int(p, 'TransitiveTileIntensity'),
    mapSizeNames: hrefItems(p, 'MapSizeNames'),
    textWith: href(p, 'TextWith'),
    textWithout: href(p, 'TextWithout'),
    defaultRMGObjective: href(p, 'DefaultRMGObjective'),
    defaultGrailObjective: href(p, 'DefaultGrailObjective'),
    templates: hrefItems(p, 'Templates'),
    textWithWater: href(p, 'TextWithWater'),
    textWithoutWater: href(p, 'TextWithoutWater'),
    monsterStrenghtNames: hrefItems(p, 'MonsterStrenghtNames'),
    resourceMineColors: colorItems(p, 'ResourceMineColors'),
    monsterLevelCoef,
    shipyardGuardsLevelCoef: int(p, 'ShipyardGuardsLevelCoef'),
    groundTerrainLights: hrefItems(p, 'GroundTerrainLights'),
    obelisk: href(p, 'Obelisk'),
    grail: href(p, 'Grail'),
    waterTreasures: hrefItems(p, 'WaterTreasures'),
  };
}

export function readParams(path: string): RmgParams {
  return parseParams(readFileSync(path, 'utf8'));
}
