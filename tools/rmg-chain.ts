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
import { MINE_TYPES, placeZoneAbandonedMines, placeZoneMines, readMineShared } from '../src/rmg/mines.ts';
import type { MineFootprint, PlacedMine } from '../src/rmg/mines.ts';
import { readParams } from '../src/rmg/params.ts';
import { ensureRoom, filterByRoom, readFootprint } from '../src/rmg/placement.ts';
import { PRISON_HREF, placeZonePrisons } from '../src/rmg/prisons.ts';
import type { PlacedPrison } from '../src/rmg/prisons.ts';
import type { Footprint, Tile } from '../src/rmg/placement.ts';
import { readPresets } from '../src/rmg/preset-table.ts';
import type { PricedBuilding, RacePreset } from '../src/rmg/preset-table.ts';
import { placePriceList, scaledBudget } from '../src/rmg/price-lists.ts';
import type { PlacedPriced, PricedItem } from '../src/rmg/price-lists.ts';
import { RmgRandom } from '../src/rmg/random.ts';
import { buildZoneRoad } from '../src/rmg/road.ts';
import { SHRINE_TYPES, placeZoneShrines } from '../src/rmg/shrines.ts';
import type { PlacedShrine } from '../src/rmg/shrines.ts';
import { placeZoneTeleports } from '../src/rmg/teleports.ts';
import type { PlacedTeleport } from '../src/rmg/teleports.ts';
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
import { floorIterationOrder, generateGameZones } from '../src/rmg/zones.ts';

export const SEED = 1785351845;
export const SIZE = 96;

/** The knobs the ordered reference runs differ by. */
export interface ChainOptions {
  /** Template file name without the extension; the surface run's default. */
  template?: string;
  /** Map side in tiles — 96 for the surface run, 72 for the underground one. */
  size?: number;
  underground?: boolean;
  /** WaterAmount (0/1/2); the water reference supplies 2 — see map-setup.ts. */
  water?: number;
}

export interface Chain {
  dir: string;
  rng: RmgRandom;
  size: number;
  template: RmgTemplate;
  params: ReturnType<typeof readParams>;
  presets: Map<number, RacePreset>;
  tables: GuardTables;
  setup: ReturnType<typeof mapSetup>;
  loaded: LoadedTemplate;
  townResult: TownsResult;
  conn: ConnectionsResult;
  /** The teleport pass's objects, per zone — empty on the surface run. */
  teleports: Map<number, PlacedTeleport[]>;
  /** Per floor: the zone grid, border table, occupancy and room grid. */
  floors: Array<{ grid: Int32Array[]; border: Int32Array[]; occ: Uint8Array; room: Int32Array[] }>;
  /** Floor 0's zone grid, border table and occupancy. */
  grid: Int32Array[];
  border: Int32Array[];
  occ: Uint8Array;
  /**
   * Floor 0's PERSISTENT room grid (`level+0xF4`): every step recomputes
   * its own zone's tiles in place and the rest keep their stale values —
   * which the statics fit reads across zone borders, so the staleness is
   * part of the model.
   */
  room: Int32Array[];
  /** The zone's `+0x68` points: town stamp, passages, teleport stamps. */
  roomPoints(zoneIndex: number): Tile[];
  /** The teleports' active tiles — the `zone+0xC0` entries they pushed. */
  teleportActives(zoneIndex: number): Tile[];
  /** The teleports' guard seats — part of the treasure blocks' repel list. */
  teleportGuardSeats(zoneIndex: number): Tile[];
  /** The zone's `+0x5C` stamped-blocked ledger — the lakes' 0x3E extra bit. */
  blockedList(zoneIndex: number): Tile[];
  zone(zoneIndex: number): RmgZone;
  zoneRace(zoneIndex: number): number;
  footprint(href: string): Footprint;
}

/**
 * Run the nine ported phases; the rng stands at 18491 when this returns —
 * or at 4475 for the underground run's options.
 */
export function runChain(dir: string, options: ChainOptions = {}): Chain {
  const size = options.size ?? SIZE;
  const template = readTemplate(join(dir, 'RMG', 'Templates', `${options.template ?? 'S1P2Z2M1'}.xdb`));
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
  const made = createMap(template, { players: 2, size: 8, underground: options.underground }, rng);
  const setup = mapSetup(params, { monsterStrength: 1, water: options.water ?? 0 }, rng);
  const loaded = loadTemplate(template, {
    twoFloors: made.twoFloors, dwarvenUnderground: setup.dwarvenUnderground, water: setup.water,
    playerCount: made.players, mapSize: size, pointLightZoneRadius: params.pointLightParams.zoneRadius,
  }, rng);
  const placed = generateGameZones(size, size,
    loaded.zones.map((z) => ({ index: z.index, size: z.size, floor: z.floor })), made.twoFloors, rng);
  const filled = fillZones(size, size, placed.zones, made.twoFloors, rng);
  const distances = calcBorderTiles(size, size, filled.floors);
  const townResult = placeTowns({
    size, template, zones: loaded.zones, floors: filled.floors, distances,
    radii: new Map(placed.zones.map((z) => [z.index, z.r])),
    presets, towns, specializations: readTownSpecializations(dir),
  }, rng);
  fillDistToTowns(size, filled.floors, loaded.zones, townResult.centres);
  const conn = zoneConnections({
    size, template, zones: loaded.zones, floors: filled.floors, distances,
    guardPowerUnit: params.basicLeverGuardPower * params.connectionGuardLevel,
    monsterStrength: setup.monsterStrength, tables,
  }, rng);

  const floors = filled.floors.map((grid, f) => ({
    grid, border: distances[f]!, occ: townResult.occupancy[f]!,
    room: Array.from({ length: size }, () => new Int32Array(size)),
  }));

  // The phase's second sweep — the teleports. A no-op when the land digger
  // served every connection, so the surface run costs nothing here. The
  // stamps' room points and actives are kept per zone: `roomPoints` serves
  // the former to every later recompute, the roads phase reads the latter.
  const footprints = new Map<string, Footprint>();
  const chainFootprint = (href: string): Footprint => {
    let foot = footprints.get(href);
    if (!foot) {
      foot = readFootprint(dir, href);
      footprints.set(href, foot);
    }
    return foot;
  };
  const teleports = new Map<number, PlacedTeleport[]>();
  const teleportRoomPoints = new Map<number, Tile[]>();
  const teleportActives = new Map<number, Tile[]>();
  const teleportGuardSeats = new Map<number, Tile[]>();
  const unconnectedSet = new Set(conn.unconnected);
  const blockedLists = new Map<number, Tile[]>();
  const blockedList = (zoneIndex: number): Tile[] => {
    let l = blockedLists.get(zoneIndex);
    if (!l) {
      l = [...(townResult.stampedBlocked.get(zoneIndex) ?? [])];
      blockedLists.set(zoneIndex, l);
    }
    return l;
  };
  const basePoints = (zoneIndex: number): Tile[] => {
    const points: Tile[] = [...(townResult.stamped.get(zoneIndex) ?? [])];
    for (const [a, b] of conn.passages.get(zoneIndex) ?? []) points.push([b, a]);
    return points;
  };
  if (unconnectedSet.size) {
    for (let f = 0; f < floors.length; f++) {
      for (const z of floorIterationOrder(loaded.zones.filter((zz) => zz.floor === f))) {
        const centre = townResult.centres.get(z.index)!;
        const points = basePoints(z.index);
        const grew: Tile[] = [];
        const actives: Tile[] = [];
        const seats: Tile[] = [];
        const placedTeleports = placeZoneTeleports({
          size, zoneIndex: z.index, floor: f,
          grid: floors[f]!.grid, border: floors[f]!.border, occupancy: floors[f]!.occ,
          points: grew, blocked: blockedList(z.index), connectionPoints: actives, guardSeats: seats,
          connections: template.connections, unconnected: unconnectedSet,
          centre: { x: centre.b, y: centre.a },
          floorOf: (zi) => loaded.zones.find((zz) => zz.index === zi)!.floor,
          footprint: chainFootprint,
          guardPowerUnit: params.basicLeverGuardPower * params.connectionGuardLevel,
          monsterStrength: setup.monsterStrength, tables,
          roomKept: (ring) => {
            const room = ensureRoom(floors[f]!.room, size, floors[f]!.grid, z.index, [...points, ...grew]);
            return filterByRoom(ring, room, floors[f]!.grid, floors[f]!.border, floors[f]!.occ,
              size, z.index, 3).kept;
          },
        }, rng);
        if (placedTeleports.length) teleports.set(z.index, placedTeleports);
        if (grew.length) teleportRoomPoints.set(z.index, grew);
        if (actives.length) teleportActives.set(z.index, actives);
        if (seats.length) teleportGuardSeats.set(z.index, seats);
      }
    }
  }
  const grid = floors[0]!.grid;
  const border = floors[0]!.border;
  const occ = floors[0]!.occ;
  const room = floors[0]!.room;

  return {
    dir, rng, size, template, params, presets, tables, setup, loaded, townResult, conn,
    teleports, floors, grid, border, occ, room,
    roomPoints(zoneIndex: number): Tile[] {
      // The engine's PUSH order — the town's stamp, the passages, then the
      // teleports' stamps. The room computations are order-blind, but the
      // road step chains these points in order, so the order is part of
      // the fact.
      return [...basePoints(zoneIndex), ...(teleportRoomPoints.get(zoneIndex) ?? [])];
    },
    teleportActives(zoneIndex: number): Tile[] {
      return teleportActives.get(zoneIndex) ?? [];
    },
    teleportGuardSeats(zoneIndex: number): Tile[] {
      return teleportGuardSeats.get(zoneIndex) ?? [];
    },
    blockedList,
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
  readonly floor: number;
  /** The abandoned mines the last mines() call placed — actives included. */
  abandoned: import('../src/rmg/mines.ts').PlacedAbandonedMine[] = [];
  private readonly c: Chain;
  private readonly zoneIndex: number;
  private readonly zone: RmgZone;
  /** The town race's preset — what the dwellings step indexes. */
  private readonly preset: RacePreset;
  /**
   * The TERRAIN race's preset — what `[zone+0x20]` points at, and what
   * every price-list step buys from. On the surface the two races agree;
   * an underground zone's dwarven town buys from the Dungeon lists, which
   * the underground run's treasury boundary is what proved.
   */
  private readonly pricePreset: RacePreset;
  /** The zone's `+0x5C` stamped-blocked ledger, shared with the chain. */
  readonly blocked: Tile[];
  /** The zone's own floor's grids — what every step reads and dents. */
  private readonly f: Chain['floors'][number];

  constructor(c: Chain, zoneIndex: number) {
    this.c = c;
    this.zoneIndex = zoneIndex;
    this.points = c.roomPoints(zoneIndex);
    this.blocked = c.blockedList(zoneIndex);
    this.zone = c.zone(zoneIndex);
    const loaded = c.loaded.zones.find((z) => z.index === zoneIndex)!;
    this.preset = c.presets.get(loaded.race)!;
    this.pricePreset = c.presets.get(loaded.terrainRace)!;
    this.floor = loaded.floor;
    this.f = c.floors[this.floor] ?? c.floors[0]!;
  }

  private priced(list: PricedBuilding[]): PricedItem[] {
    return list.map((p) => ({ type: p.href, value: p.value, foot: this.c.footprint(p.href) }));
  }

  mines(): PlacedMine[] {
    const { c } = this;
    const centre = c.townResult.centres.get(this.zoneIndex);
    const feet = new Map<string, MineFootprint>(MINE_TYPES.map((t) => [t.mine, readMineShared(c.dir, t.mine)]));
    const mines = placeZoneMines({
      size: c.size, grid: this.f.grid, border: this.f.border, occupancy: this.f.occ, room: this.f.room,
      points: this.points, blocked: this.blocked, zoneIndex: this.zoneIndex, floor: this.floor,
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
    // 0xEBD700 — the abandoned mines run right after, in the same step.
    this.abandoned = this.pricePreset.abandonedMine
      ? placeZoneAbandonedMines({
          size: c.size, grid: this.f.grid, border: this.f.border, occupancy: this.f.occ,
          room: this.f.room, points: this.points, blocked: this.blocked, zoneIndex: this.zoneIndex, floor: this.floor,
          count: this.zone.abandonedMines,
          town: this.zone.town && centre ? { x: centre.b, y: centre.a } : null,
          ringMin: c.params.mine3LevelMinRadius, ringMax: c.params.mine3LevelMaxRadius,
          foot: c.footprint(this.pricePreset.abandonedMine),
        }, c.rng)
      : [];
    return mines;
  }

  dwellings(): PlacedDwelling[] {
    const { c } = this;
    return placeZoneDwellings({
      size: c.size, grid: this.f.grid, border: this.f.border, occupancy: this.f.occ, room: this.f.room,
      points: this.points, blocked: this.blocked, zoneIndex: this.zoneIndex, floor: this.floor, counts: this.zone.dwellings,
      descriptors: this.preset.dwellings.map((href) => c.footprint(href)),
    }, c.rng);
  }

  upgradeBuildings(): PlacedUpgradeBuilding[] {
    const { c } = this;
    return placeZoneUpgradeBuildings({
      size: c.size, grid: this.f.grid, border: this.f.border, occupancy: this.f.occ, room: this.f.room,
      points: this.points, blocked: this.blocked, zoneIndex: this.zoneIndex, floor: this.floor, density: this.zone.upgBuildingsDensity, multIndex: 1,
      list: this.priced(this.pricePreset.newUpgradeBuildings)
        .map((p, i) => ({ href: p.type, value: p.value, foot: p.foot,
          guardStrenght: this.pricePreset.newUpgradeBuildings[i]!.guardStrenght })),
      basicLeverGuardPower: c.params.basicLeverGuardPower,
      monsterStrength: c.setup.monsterStrength, tables: c.tables,
    }, c.rng);
  }

  /** `0xEBD1C0` — the template's Prisons count, no guard, skip on failure. */
  prisons(): PlacedPrison[] {
    const { c } = this;
    return placeZonePrisons({
      size: c.size, grid: this.f.grid, border: this.f.border, occupancy: this.f.occ, room: this.f.room,
      points: this.points, blocked: this.blocked, zoneIndex: this.zoneIndex, floor: this.floor,
      count: this.zone.prisons, foot: c.footprint(PRISON_HREF),
    }, c.rng);
  }

  shrines(): PlacedShrine[] {
    const { c } = this;
    return placeZoneShrines({
      size: c.size, grid: this.f.grid, border: this.f.border, occupancy: this.f.occ, room: this.f.room,
      points: this.points, blocked: this.blocked, zoneIndex: this.zoneIndex, floor: this.floor, shrinePoints: this.zone.shrinePoints,
      footprints: SHRINE_TYPES.map((s) => c.footprint(`/MapObjects/${s.name}.(AdvMapShrineShared).xdb`)),
    }, c.rng);
  }

  private priceListStep(budget: number, list: PricedBuilding[]): PlacedPriced[] {
    const { c } = this;
    return placePriceList({
      size: c.size, grid: this.f.grid, border: this.f.border, occupancy: this.f.occ, room: this.f.room,
      points: this.points, blocked: this.blocked, zoneIndex: this.zoneIndex, floor: this.floor, budget, list: this.priced(list),
    }, c.rng);
  }

  private zoneTileCount(): number {
    let n = 0;
    for (let x = 0; x < this.c.size; x++) {
      for (let y = 0; y < this.c.size; y++) if (this.f.grid[y]![x] === this.zoneIndex) n++;
    }
    return n;
  }

  resourceBuildings(): PlacedPriced[] {
    return this.priceListStep(
      scaledBudget(this.zoneTileCount(), this.zone.resourceBuildingsDensity),
      this.pricePreset.newResourceGivers);
  }

  treasuryBuildings(): PlacedPriced[] {
    return this.priceListStep(this.zone.treasureBuildingPoints, this.pricePreset.newTreasuryBuildings);
  }

  luckMorale(): PlacedPriced[] {
    return this.priceListStep(
      scaledBudget(this.zoneTileCount(), this.zone.luckMoralBuildingsDensity, 40),
      this.pricePreset.newLuckMoraleBuildings);
  }

  shops(): PlacedPriced[] {
    return this.priceListStep(this.zone.shopPoints, this.pricePreset.newShopBuildings);
  }

  /** `0xEBF930` — observatories plus the townless zones' Den of Thieves roll. */
  observatories(): PlacedObject[] {
    const { c } = this;
    return placeObservatories({
      size: c.size, grid: this.f.grid, border: this.f.border, occupancy: this.f.occ, room: this.f.room,
      points: this.points, blocked: this.blocked, zoneIndex: this.zoneIndex, floor: this.floor,
      observatory: c.footprint(OBSERVATORY_HREF),
      denOfThieves: c.footprint(DEN_OF_THIEVES_HREF),
      playerNo: c.loaded.zones.find((z) => z.index === this.zoneIndex)!.playerNo,
    }, c.rng);
  }

  private treasureStep(kind: 'treasures' | 'chests', late = false): PlacedObject[] {
    const { c } = this;
    // The dispatcher 0xEA57B0 sits behind the surface gate — an underground
    // zone gets its treasures in the additional-objects phase instead,
    // through the same dispatcher with the gate's sense reversed.
    if (!late && c.loaded.zones.find((z) => z.index === this.zoneIndex)!.floor !== 0) return [];
    return placeZoneTreasures({
      size: c.size, grid: this.f.grid, border: this.f.border, occupancy: this.f.occ, room: this.f.room,
      // NO `blocked` — the treasures' 2s stay out of the `+0x5C` ledger
      // (measured on the underground zone-2 mountains: with them in, the
      // port's candidate list loses tiles the engine keeps).
      points: this.points, zoneIndex: this.zoneIndex, floor: this.floor,
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

  /** The additional-objects phase — the underground zones' late treasures. */
  lateTreasures(): PlacedObject[] {
    return this.treasureStep('treasures', true);
  }

  lateChests(): PlacedObject[] {
    return this.treasureStep('chests', true);
  }

  /** `0xEC05B0` — the zone road, kind 0x20; one below(2) per walked tile. */
  road(): Tile[] {
    const { c } = this;
    return buildZoneRoad({
      size: c.size, grid: this.f.grid, border: this.f.border, occupancy: this.f.occ,
      zoneIndex: this.zoneIndex, points: this.points, kindBit: 0x20,
    }, c.rng);
  }
}
