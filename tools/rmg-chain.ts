// The reference chain, once — seed 1785351845 through the nine ported
// phases to the door of MainObjects, plus a per-zone runner for the fill
// steps in the engine's order. Every RMG suite used to carry its own copy
// of this; they now share one, so a new step's test is the step and its
// assertions, nothing else.

import { join } from 'node:path';

import { readArmyTemplates } from '../src/rmg/armies.ts';
import type { GuardTables } from '../src/rmg/armies.ts';
import { calcBorderTiles } from '../src/rmg/border-tiles.ts';
import { zoneConnections } from '../src/rmg/connections.ts';
import type { ConnectionsResult } from '../src/rmg/connections.ts';
import { createMap } from '../src/rmg/create-map.ts';
import { readCreatures } from '../src/rmg/creatures.ts';
import { fillDistToTowns } from '../src/rmg/dist-to-towns.ts';
import { placeZoneDwellings } from '../src/rmg/dwellings.ts';
import type { PlacedDwelling } from '../src/rmg/dwellings.ts';
import { fillZones } from '../src/rmg/fill-zones.ts';
import { loadTemplate } from '../src/rmg/load-template.ts';
import type { LoadedTemplate } from '../src/rmg/load-template.ts';
import { mapSetup } from '../src/rmg/map-setup.ts';
import { MINE_TYPES, placeZoneMines, readMineShared } from '../src/rmg/mines.ts';
import type { MineFootprint, PlacedMine } from '../src/rmg/mines.ts';
import { readParams } from '../src/rmg/params.ts';
import { readFootprint } from '../src/rmg/placement.ts';
import type { Footprint, Tile } from '../src/rmg/placement.ts';
import { readPresets } from '../src/rmg/preset-table.ts';
import type { PricedBuilding, RacePreset } from '../src/rmg/preset-table.ts';
import { placePriceList, scaledBudget } from '../src/rmg/price-lists.ts';
import type { PlacedPriced, PricedItem } from '../src/rmg/price-lists.ts';
import { RmgRandom } from '../src/rmg/random.ts';
import { buildZoneRoad } from '../src/rmg/road.ts';
import { SHRINE_TYPES, placeZoneShrines } from '../src/rmg/shrines.ts';
import type { PlacedShrine } from '../src/rmg/shrines.ts';
import { readTemplate } from '../src/rmg/template.ts';
import {
  DEN_OF_THIEVES_HREF, OBSERVATORY_HREF, TREASURE_TYPES,
  placeObservatories, placeZoneTreasures,
} from '../src/rmg/treasures.ts';
import type { PlacedObject } from '../src/rmg/treasures.ts';
import type { RmgTemplate, RmgZone } from '../src/rmg/template.ts';
import { readTownShared, readTownSpecializations } from '../src/rmg/town-data.ts';
import type { TownShared } from '../src/rmg/town-data.ts';
import { placeTowns } from '../src/rmg/towns.ts';
import type { TownsResult } from '../src/rmg/towns.ts';
import { placeZoneUpgradeBuildings } from '../src/rmg/upgrade-buildings.ts';
import type { PlacedUpgradeBuilding } from '../src/rmg/upgrade-buildings.ts';
import { generateGameZones } from '../src/rmg/zones.ts';

export const SEED = 1785351845;
export const SIZE = 96;

export interface Chain {
  dir: string;
  rng: RmgRandom;
  template: RmgTemplate;
  params: ReturnType<typeof readParams>;
  presets: Map<number, RacePreset>;
  tables: GuardTables;
  setup: ReturnType<typeof mapSetup>;
  loaded: LoadedTemplate;
  townResult: TownsResult;
  conn: ConnectionsResult;
  /** Floor 0's zone grid, border table and occupancy. */
  grid: Int32Array[];
  border: Int32Array[];
  occ: Uint8Array;
  /** The zone's stamped points: the towns' occupancy-4 tiles plus the passages. */
  roomPoints(zoneIndex: number): Tile[];
  zone(zoneIndex: number): RmgZone;
  zoneRace(zoneIndex: number): number;
  footprint(href: string): Footprint;
}

/** Run the nine ported phases; the rng stands at 18491 when this returns. */
export function runChain(dir: string): Chain {
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

  const rng = new RmgRandom(SEED);
  const made = createMap(template, { players: 2, size: 8 }, rng);
  const setup = mapSetup(params, { monsterStrength: 1, water: false }, rng);
  const loaded = loadTemplate(template, {
    twoFloors: made.twoFloors, dwarvenUnderground: setup.dwarvenUnderground, water: setup.water,
    playerCount: made.players, mapSize: SIZE, pointLightZoneRadius: params.pointLightParams.zoneRadius,
  }, rng);
  const placed = generateGameZones(SIZE, SIZE,
    loaded.zones.map((z) => ({ index: z.index, size: z.size, floor: z.floor })), made.twoFloors, rng);
  const filled = fillZones(SIZE, SIZE, placed.zones, made.twoFloors, rng);
  const distances = calcBorderTiles(SIZE, SIZE, filled.floors);
  const townResult = placeTowns({
    size: SIZE, template, zones: loaded.zones, floors: filled.floors, distances,
    radii: new Map(placed.zones.map((z) => [z.index, z.r])),
    presets, towns, specializations: readTownSpecializations(dir),
  }, rng);
  fillDistToTowns(SIZE, filled.floors, loaded.zones, townResult.centres);
  const conn = zoneConnections({
    size: SIZE, template, zones: loaded.zones, floors: filled.floors, distances,
    guardPowerUnit: params.basicLeverGuardPower * params.connectionGuardLevel,
    monsterStrength: setup.monsterStrength, tables,
  }, rng);

  const grid = filled.floors[0]!;
  const border = distances[0]!;
  const occ = townResult.occupancy[0]!;
  const footprints = new Map<string, Footprint>();

  return {
    dir, rng, template, params, presets, tables, setup, loaded, townResult, conn,
    grid, border, occ,
    roomPoints(zoneIndex: number): Tile[] {
      // The engine's PUSH order — the town's stamp, then the passages. The
      // room computations are order-blind, but the road step chains these
      // points in order, so the order is part of the fact.
      const points: Tile[] = [...(townResult.stamped.get(zoneIndex) ?? [])];
      for (const [a, b] of conn.passages.get(zoneIndex) ?? []) points.push([b, a]);
      return points;
    },
    zone(zoneIndex: number): RmgZone {
      return template.zones.find((z) => z.index === zoneIndex)!;
    },
    zoneRace(zoneIndex: number): number {
      return loaded.zones.find((z) => z.index === zoneIndex)!.race;
    },
    footprint(href: string): Footprint {
      let foot = footprints.get(href);
      if (!foot) {
        foot = readFootprint(dir, href);
        footprints.set(href, foot);
      }
      return foot;
    },
  };
}

/**
 * One zone's MainObjects steps, in the engine's order. Construction spends
 * NO draws; the phase's one prologue draw is the caller's (`chain.rng.next()`
 * before the first zone). Call the steps in order — each mutates the shared
 * occupancy and this zone's points the way the engine does.
 */
export class ZoneFill {
  readonly points: Tile[];
  private readonly c: Chain;
  private readonly zoneIndex: number;
  private readonly zone: RmgZone;
  private readonly preset: RacePreset;

  constructor(c: Chain, zoneIndex: number) {
    this.c = c;
    this.zoneIndex = zoneIndex;
    this.points = c.roomPoints(zoneIndex);
    this.zone = c.zone(zoneIndex);
    this.preset = c.presets.get(c.zoneRace(zoneIndex))!;
  }

  private priced(list: PricedBuilding[]): PricedItem[] {
    return list.map((p) => ({ type: p.href, value: p.value, foot: this.c.footprint(p.href) }));
  }

  mines(): PlacedMine[] {
    const { c } = this;
    const centre = c.townResult.centres.get(this.zoneIndex);
    const feet = new Map<string, MineFootprint>(MINE_TYPES.map((t) => [t.mine, readMineShared(c.dir, t.mine)]));
    return placeZoneMines({
      size: SIZE, grid: c.grid, border: c.border, occupancy: c.occ, points: this.points,
      zoneIndex: this.zoneIndex,
      town: this.zone.town && centre ? { x: centre.b, y: centre.a } : null,
      counts: this.zone.mines,
      radii: {
        nearMin: c.params.mine1LevelMinRadius, nearMax: c.params.mine1LevelMaxRadius,
        farMin: c.params.mine2LevelMinRadius, farMax: c.params.mine2LevelMaxRadius,
      },
      guardPower: {
        basic: c.params.basicLeverGuardPower,
        mine1: c.params.mine1LevelGuardLevel, mine2: c.params.mine2LevelGuardLevel,
        gold: c.params.mineGoldGuardLevel,
      },
      monsterStrength: c.setup.monsterStrength,
      tables: c.tables,
      footprints: feet,
    }, c.rng);
  }

  dwellings(): PlacedDwelling[] {
    const { c } = this;
    return placeZoneDwellings({
      size: SIZE, grid: c.grid, border: c.border, occupancy: c.occ, points: this.points,
      zoneIndex: this.zoneIndex, counts: this.zone.dwellings,
      descriptors: this.preset.dwellings.map((href) => c.footprint(href)),
    }, c.rng);
  }

  upgradeBuildings(): PlacedUpgradeBuilding[] {
    const { c } = this;
    return placeZoneUpgradeBuildings({
      size: SIZE, grid: c.grid, border: c.border, occupancy: c.occ, points: this.points,
      zoneIndex: this.zoneIndex, density: this.zone.upgBuildingsDensity, multIndex: 1,
      list: this.priced(this.preset.newUpgradeBuildings)
        .map((p, i) => ({ href: p.type, value: p.value, foot: p.foot,
          guardStrenght: this.preset.newUpgradeBuildings[i]!.guardStrenght })),
      basicLeverGuardPower: c.params.basicLeverGuardPower,
      monsterStrength: c.setup.monsterStrength, tables: c.tables,
    }, c.rng);
  }

  shrines(): PlacedShrine[] {
    const { c } = this;
    return placeZoneShrines({
      size: SIZE, grid: c.grid, border: c.border, occupancy: c.occ, points: this.points,
      zoneIndex: this.zoneIndex, shrinePoints: this.zone.shrinePoints,
      footprints: SHRINE_TYPES.map((s) => c.footprint(`/MapObjects/${s.name}.(AdvMapShrineShared).xdb`)),
    }, c.rng);
  }

  private priceListStep(budget: number, list: PricedBuilding[]): PlacedPriced[] {
    const { c } = this;
    return placePriceList({
      size: SIZE, grid: c.grid, border: c.border, occupancy: c.occ, points: this.points,
      zoneIndex: this.zoneIndex, budget, list: this.priced(list),
    }, c.rng);
  }

  private zoneTileCount(): number {
    let n = 0;
    for (let x = 0; x < SIZE; x++) {
      for (let y = 0; y < SIZE; y++) if (this.c.grid[y]![x] === this.zoneIndex) n++;
    }
    return n;
  }

  resourceBuildings(): PlacedPriced[] {
    return this.priceListStep(
      scaledBudget(this.zoneTileCount(), this.zone.resourceBuildingsDensity),
      this.preset.newResourceGivers);
  }

  treasuryBuildings(): PlacedPriced[] {
    return this.priceListStep(this.zone.treasureBuildingPoints, this.preset.newTreasuryBuildings);
  }

  luckMorale(): PlacedPriced[] {
    return this.priceListStep(
      scaledBudget(this.zoneTileCount(), this.zone.luckMoralBuildingsDensity, 40),
      this.preset.newLuckMoraleBuildings);
  }

  shops(): PlacedPriced[] {
    return this.priceListStep(this.zone.shopPoints, this.preset.newShopBuildings);
  }

  /** `0xEBF930` — observatories plus the townless zones' Den of Thieves roll. */
  observatories(): PlacedObject[] {
    const { c } = this;
    return placeObservatories({
      size: SIZE, grid: c.grid, border: c.border, occupancy: c.occ, points: this.points,
      zoneIndex: this.zoneIndex,
      observatory: c.footprint(OBSERVATORY_HREF),
      denOfThieves: c.footprint(DEN_OF_THIEVES_HREF),
      playerNo: c.loaded.zones.find((z) => z.index === this.zoneIndex)!.playerNo,
    }, c.rng);
  }

  private treasureStep(kind: 'treasures' | 'chests'): PlacedObject[] {
    const { c } = this;
    // The dispatcher 0xEA57B0 sits behind the surface gate — an underground
    // zone gets its treasures in the additional-objects phase instead.
    if (c.loaded.zones.find((z) => z.index === this.zoneIndex)!.floor !== 0) return [];
    return placeZoneTreasures({
      size: SIZE, grid: c.grid, border: c.border, occupancy: c.occ, points: this.points,
      zoneIndex: this.zoneIndex,
      density: kind === 'treasures' ? this.zone.treasureDensity : this.zone.treasureChestDensity,
      multIndex: 1, kind,
      footprints: TREASURE_TYPES.map((t) => c.footprint(`/MapObjects/${t}.(AdvMapTreasureShared).xdb`)),
    }, c.rng);
  }

  treasures(): PlacedObject[] {
    return this.treasureStep('treasures');
  }

  chests(): PlacedObject[] {
    return this.treasureStep('chests');
  }

  /** `0xEC05B0` — the zone road, kind 0x20; one below(2) per walked tile. */
  road(): Tile[] {
    const { c } = this;
    return buildZoneRoad({
      size: SIZE, grid: c.grid, border: c.border, occupancy: c.occ,
      zoneIndex: this.zoneIndex, points: this.points, kindBit: 0x20,
    }, c.rng);
  }
}
