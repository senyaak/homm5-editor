// An RMG template, as the generator reads it.
//
// A template is the whole design of a map minus the dice: how many zones, which
// of them hold a town, how densely each is stocked, and which are joined to
// which. `data-unpacked/RMG/Templates/*.xdb` holds 22 of them, plain XML, and
// nothing here interprets any of it — that is the phases' job. This only turns
// the file into numbers.
//
// The field names are the game's own, spelling included: `TownGuardStrenght`
// and `LuckMoralBuildingsDensity` are what the files say, and renaming them on
// the way in would mean every reader of this port has to translate back before
// they can grep the data. See docs/RMG.md.

import { readFileSync } from 'node:fs';

import { childText, find, findAll, parse, text } from '../format/xml.ts';
import type { XmlElement } from '../format/xml.ts';

/** Seven, one per creature tier — the shape of `Mines` and `Dwellings`. */
export const TIERS = 7;

export interface RmgZone {
  index: number;
  /** `RACE_RANDOM_TYPE`, or a specific town — the zone's flavour. */
  setting: string;
  canBeWater: boolean;
  /** Relative, not tiles: zones divide the map in proportion to these. */
  size: number;
  canBePlayerStart: boolean;
  town: boolean;
  townGuardStrenght: number;
  /** Per tier: how many mines of that resource the zone wants. */
  mines: number[];
  abandonedMines: number;
  /** Per tier: dwellings of that tier. */
  dwellings: number[];
  upgBuildingsDensity: number;
  treasureDensity: number;
  treasureChestDensity: number;
  prisons: number;
  landCartographer: number;
  shopPoints: number;
  shrinePoints: number;
  luckMoralBuildingsDensity: number;
  resourceBuildingsDensity: number;
  treasureBuildingPoints: number;
  treasureBlocksTotalValue: number;
  denOfThieves: number;
  redwoodObservatoryDensity: number;
  buffPoints: number;
}

export interface RmgConnection {
  sourceZoneIndex: number;
  destZoneIndex: number;
  twoWay: boolean;
  /** How strong the army sitting on the passage is. */
  guardStrenght: number;
  guarded: boolean;
  wide: boolean;
}

export interface RmgTemplate {
  name: string;
  zones: RmgZone[];
  connections: RmgConnection[];
  graalOnMap: boolean;
  /** The four `CreateMap` reads to decide players and size. */
  minPlayers: number;
  maxPlayers: number;
  minMapSize: number;
  maxMapSize: number;
  underground: boolean;
  testTemplate: boolean;
}

const int = (el: XmlElement, name: string): number => Number.parseInt(childText(el, name), 10) || 0;
const bool = (el: XmlElement, name: string): boolean => childText(el, name) === 'true';

/** `<Mines><Item>1</Item>…</Mines>` — a fixed-length list of counts. */
function items(el: XmlElement, name: string, length = TIERS): number[] {
  const holder = find(el, name);
  const out = holder ? findAll(holder, 'Item').map((i) => Number.parseInt(text(i), 10) || 0) : [];
  // Padded rather than trusted: a short list would otherwise read as undefined
  // at a tier the phases index blindly.
  while (out.length < length) out.push(0);
  return out;
}

export function parseTemplate(xml: string): RmgTemplate {
  const root = parse(xml);
  const t = find(root, 'RMGTemplate');
  if (!t) throw new Error('not an RMGTemplate');

  const zonesEl = find(t, 'Zones');
  const zones = (zonesEl ? findAll(zonesEl, 'Item') : [])
    // Only direct children are zones; `Mines`/`Dwellings` have Items too.
    .filter((z) => find(z, 'Index') !== null)
    .map((z): RmgZone => ({
      index: int(z, 'Index'),
      setting: childText(z, 'Setting'),
      canBeWater: bool(z, 'CanBeWater'),
      size: int(z, 'Size'),
      canBePlayerStart: bool(z, 'CanBePlayerStart'),
      town: bool(z, 'Town'),
      townGuardStrenght: int(z, 'TownGuardStrenght'),
      mines: items(z, 'Mines'),
      abandonedMines: int(z, 'AbandonedMines'),
      dwellings: items(z, 'Dwellings'),
      upgBuildingsDensity: int(z, 'UpgBuildingsDensity'),
      treasureDensity: int(z, 'TreasureDensity'),
      treasureChestDensity: int(z, 'TreasureChestDensity'),
      prisons: int(z, 'Prisons'),
      landCartographer: int(z, 'LandCartographer'),
      shopPoints: int(z, 'ShopPoints'),
      shrinePoints: int(z, 'ShrinePoints'),
      luckMoralBuildingsDensity: int(z, 'LuckMoralBuildingsDensity'),
      resourceBuildingsDensity: int(z, 'ResourceBuildingsDensity'),
      treasureBuildingPoints: int(z, 'TreasureBuildingPoints'),
      treasureBlocksTotalValue: int(z, 'TreasureBlocksTotalValue'),
      denOfThieves: int(z, 'DenOfThieves'),
      redwoodObservatoryDensity: int(z, 'RedwoodObservatoryDensity'),
      buffPoints: int(z, 'BuffPoints'),
    }));

  const connectionsEl = find(t, 'Connections');
  const connections = (connectionsEl ? findAll(connectionsEl, 'Item') : []).map((c): RmgConnection => ({
    sourceZoneIndex: int(c, 'SourceZoneIndex'),
    destZoneIndex: int(c, 'DestZoneIndex'),
    twoWay: bool(c, 'TwoWay'),
    guardStrenght: int(c, 'GuardStrenght'),
    guarded: bool(c, 'Guarded'),
    wide: bool(c, 'Wide'),
  }));

  return {
    name: childText(t, 'Name'),
    zones,
    connections,
    graalOnMap: bool(t, 'GraalOnMap'),
    minPlayers: int(t, 'MinPlayers'),
    maxPlayers: int(t, 'MaxPlayers'),
    minMapSize: int(t, 'MinMapSize'),
    maxMapSize: int(t, 'MaxMapSize'),
    underground: bool(t, 'Underground'),
    testTemplate: bool(t, 'TestTemplate'),
  };
}

export function readTemplate(path: string): RmgTemplate {
  return parseTemplate(readFileSync(path, 'utf8'));
}
