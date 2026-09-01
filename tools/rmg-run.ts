// The full reference run, once — the chain, the first MainObjects loop,
// the roads phase, the statics, the additional objects and the treasure
// blocks, for any of the three ordered references. The boundary suites
// keep their own step-by-step replays; this runner exists for the passes
// that need the WHOLE run's output at once — the height plane reads the
// map's object list (every non-static object flattens its footprint),
// and the emitter will read everything.
//
// Objects are collected in the map's slot (creation) order: towns and
// their decorations, the water treasures, the connection guards, the
// teleport halves and shipyards zone by zone, then the first loop's
// placements per zone in step order, the statics, the late treasures and
// the treasure blocks. Each record carries what the height pass needs
// (position, rotation, floor, the shared footprint, the crater/hover
// flags) plus its minted name and kind for the by-name checks and the
// emitter to come.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { readArtifacts, rmgArtifactPool } from '../src/rmg/artifacts.ts';
import type { HeightObject, HeightPlane } from '../src/rmg/heights.ts';
import {
  CRATER_DWELLING_TYPES, SKIP_FLATTEN_DWELLING_TYPES, makeHeightPlane,
} from '../src/rmg/heights.ts';
import { createVertexHeights } from '../src/rmg/massif-carve.ts';
import type { VertexHeights } from '../src/rmg/massif-carve.ts';
import { MINE_TYPES, readMineShared } from '../src/rmg/mines.ts';
import { PRISON_HREF } from '../src/rmg/prisons.ts';
import { recomputeRoom, zoneTiles } from '../src/rmg/placement.ts';
import type { Footprint, Tile } from '../src/rmg/placement.ts';
import { buildZoneRoadsPhase } from '../src/rmg/roads-phase.ts';
import { SHIPYARD_HREF } from '../src/rmg/shipyards.ts';
import { placeZoneBigStatics } from '../src/rmg/statics-big.ts';
import type { PlacedStatic } from '../src/rmg/statics-big.ts';
import {
  placeSubterraOneTileStatics, placeWaterOneTileStatics, placeZoneOneTileStatics,
} from '../src/rmg/statics-one-tile.ts';
import type { LakePaint } from '../src/rmg/terrain.ts';
import { buildTreasureBlocks, fillTreasureBlocks } from '../src/rmg/treasure-blocks.ts';
import type { ArtifactEntry } from '../src/rmg/treasure-blocks.ts';
import { floorIterationOrder } from '../src/rmg/zones.ts';
import type { Chain, ChainOptions } from './rmg-chain.ts';
import { runChain, ZoneFill } from './rmg-chain.ts';

const HALF_PI = Math.PI / 2;

/** One placed object — the height pass's view plus what the emitter writes. */
export interface RunObject extends HeightObject {
  name: string;
  kind: string;
  /** The `Shared` href as the map file records it (with its xpointer). */
  shared?: string;
  /** Monsters: the army behind the object; `Shared` is stacks[0]'s document. */
  army?: { stacks: Array<{ creature: string; amount: number }>; mood: number };
  /** Treasures: a custom Amount, or null for a stock pile. */
  amount?: number | null;
  /** Towns: the fields their body writes beyond the common head. */
  town?: { playerId: number; hasTavern: boolean; specialization?: string };
  /** Underground towns' four lights, and a lit crystal's one. */
  lights?: Array<{ x: number; y: number; z: number; color: readonly [number, number, number]; radius: number }>;
  /** Monoliths: the pair's GroupID. */
  groupId?: number;
  /** Shipyards: the engine-computed ShipTile (derivation unread). */
  shipTile?: readonly [number, number];
  /** Dwellings of tier >= 3: the enabled-creature switch. */
  creaturesEnabled?: number[];
}

export interface FullRun {
  c: Chain;
  /** Every placed object in the map's slot order. */
  objects: RunObject[];
  /** Floor 0's height plane, carrying the constructor fill and the cones. */
  heightPlane: HeightPlane;
  /** Per floor, the massif vertex grids (meaningful on two-floor runs). */
  vertexHeights: VertexHeights[];
  roads: Map<number, Tile[]>;
  mineActives: Map<number, Tile[]>;
  guardSeats: Map<number, Tile[]>;
  fills: Map<number, ZoneFill>;
  statics: PlacedStatic[];
  /**
   * Per zone that grew lakes, in statics order: what the lake terrain
   * painter (`0xECE680`) was handed at the moment it ran. The paints and
   * the river stamp replay later, once fillTerrain has built the layers.
   */
  lakes: LakePaint[];
}

/**
 * Run the whole reference generation. `onStep(label, draws)` fires after
 * every step whose boundary a suite may want to hold.
 */
export function runFull(
  dir: string,
  options: ChainOptions = {},
  onStep?: (label: string, draws: number) => void,
): FullRun {
  const c = runChain(dir, options);
  const step = (label: string): void => onStep?.(label, c.rng.draws);
  step('chain');

  const objects: RunObject[] = [];
  /**
   * `Shared` hrefs are written with their xpointer; when the source lacks
   * one, the tag comes from the path's own `.(Tag).xdb` (the abandoned
   * mine is an AdvMapAbanMineShared, whatever list it came from), with
   * the caller's tag as the fallback.
   */
  const pointered = (href: string, tag: string): string => {
    if (href.includes('#xpointer')) return href;
    const own = /\.\((\w+)\)\.xdb$/.exec(href)?.[1];
    return `${href}#xpointer(/${own ?? tag})`;
  };
  const treasureShared = (name: string): string =>
    `/MapObjects/${name}.(AdvMapTreasureShared).xdb#xpointer(/AdvMapTreasureShared)`;
  const sharedByCreature = new Map(c.tables.creatures.map((cr) => [cr.name, cr.monsterShared]));

  const point = (
    kind: string, name: string, x: number, y: number, floor = 0, rot = 0,
    extra: Partial<RunObject> = {},
  ): void => {
    objects.push({
      kind, name, x, y, z: 0, rot, floor, isStatic: false, blocked: [], firstActive: [0, 0],
      ...extra,
    });
  };
  const object = (
    kind: string, name: string, x: number, y: number, rot: number, foot: Footprint,
    floor = 0, extra: Partial<RunObject> = {},
  ): void => {
    objects.push({
      kind, name, x, y, z: 0, rot, floor, isStatic: false,
      blocked: foot.blocked, firstActive: foot.active[0],
      ...extra,
    });
  };
  const guardPoint = (
    g: { name: string; stacks: Array<{ creature: string; amount: number }>; mood: number },
    x: number, y: number, floor = 0, rot = 0,
  ): void => {
    point('guard', g.name, x, y, floor, rot, {
      shared: sharedByCreature.get(g.stacks[0]!.creature),
      army: { stacks: g.stacks, mood: g.mood },
    });
  };

  // Towns and their decorations, in placement order.
  for (const t of c.townResult.objects) {
    const floor = t.floor;
    if (t.kind === 'town') {
      const docType = /<Type>(\w+)<\/Type>/.exec(
        readFileSync(join(dir, t.shared.replace(/#xpointer.*$/, '').replace(/^\//, '')), 'utf8'))?.[1] ?? '';
      // An underground town wears four faction-coloured point lights; the
      // colour table grows one entry per faction a reference has shown.
      const TOWN_LIGHT_COLORS: Record<string, readonly [number, number, number]> = {
        TOWN_FORTRESS: [1, 0.392157, 0.101961],
      };
      let lights: RunObject['lights'];
      if (t.pointLights) {
        const color = TOWN_LIGHT_COLORS[docType];
        if (!color) throw new Error(`no light colour known for ${docType} — read it off this reference`);
        lights = ([[0, -5], [0, 5], [-5, 0], [5, 0]] as const).map(([lx, ly]) => ({
          x: lx, y: ly, z: t.pointLights!.z, color, radius: t.pointLights!.radius,
        }));
      }
      object('town', t.name, t.pos.x, t.pos.y, t.rot, c.footprint(t.shared), floor, {
        craterTown: docType === 'TOWN_INFERNO' || t.shared.includes('Inferno'),
        skipFlattenTown: docType === 'TOWN_ACADEMY' || t.shared.includes('Academy'),
        shared: pointered(t.shared, 'AdvMapTownShared'),
        town: { playerId: t.playerId ?? 0, hasTavern: t.hasTavern ?? false, specialization: t.specialization },
        lights,
      });
    } else {
      // Decorations are AdvMapStatic instances — the flatten skips them.
      objects.push({
        kind: 'decoration', name: t.name, x: t.pos.x, y: t.pos.y, z: 0, rot: t.rot,
        floor, isStatic: true, blocked: [],
        shared: pointered(t.shared, 'AdvMapStaticShared'),
      });
    }
  }

  // The water treasures — placed inside the water border pass, per zone in
  // carve (hash) order, before the connections.
  if (c.water) {
    for (const [zi, list] of c.water.treasures) {
      void zi;
      for (const t of list) {
        object('water-treasure', t.name, t.x, t.y, t.q * HALF_PI,
          c.footprint(c.params.waterTreasures[t.typeIndex]!), 0,
          { shared: c.params.waterTreasures[t.typeIndex]!, amount: null });
      }
    }
  }

  // The connection guards.
  for (const g of c.conn.guards) guardPoint(g, g.x, g.y);

  // The second sweep's objects — teleport halves (each with its guard) and
  // the shipyards, zone by zone in the sweep's own order.
  for (let f = 0; f < c.floors.length; f++) {
    for (const z of floorIterationOrder(c.loaded.zones.filter((zz) => zz.floor === f))) {
      for (const t of c.teleports.get(z.index) ?? []) {
        object('teleport', t.name, t.x, t.y, t.q * HALF_PI, c.footprint(t.href), f,
          { shared: pointered(t.href, 'AdvMapBuildingShared'), groupId: t.groupId });
        // A teleport's guard records the teleport's own rotation (8/8 fit).
        if (t.guard) guardPoint(t.guard, t.guard.x, t.guard.y, f, t.q * HALF_PI);
      }
      const ship = c.water?.shipyards.get(z.index);
      if (ship) {
        // The facing quarter 0 is the engine's full 2*pi in the file.
        object('shipyard', ship.name, ship.x, ship.y,
          ship.q === 0 ? 2 * Math.PI : ship.q * HALF_PI, c.footprint(SHIPYARD_HREF), f,
          { shared: pointered(SHIPYARD_HREF, 'AdvMapShipyardShared') });
        // The shipyard's guard records one quarter BEHIND the facing (4/4 fit).
        if (ship.guard?.guard) {
          guardPoint(ship.guard.guard, ship.guard.x, ship.guard.y, f, ((ship.q + 3) & 3) * HALF_PI);
        }
      }
    }
  }

  // --- The first loop of MainObjects, template order, the engine's steps.
  c.rng.next(); // the phase's prologue draw
  const fills = new Map<number, ZoneFill>();
  const mineActives = new Map<number, Tile[]>();
  const roads = new Map<number, Tile[]>();
  const guardSeats = new Map<number, Tile[]>();

  for (const tz of c.template.zones) {
    const zone = tz.index;
    const fill = new ZoneFill(c, zone);
    fills.set(zone, fill);
    const lz = c.loaded.zones.find((z) => z.index === zone)!;
    const floor = lz.floor;
    const pricePreset = c.presets.get(lz.terrainRace)!;
    const seats: Tile[] = [
      ...(c.conn.passages.get(zone) ?? []).map(([a, b]) => [b, a] as Tile),
      ...c.teleportGuardSeats(zone),
    ];
    guardSeats.set(zone, seats);

    const mines = fill.mines();
    mineActives.set(zone, [
      ...mines.flatMap((m) => m.actives),
      ...fill.abandoned.flatMap((m) => m.actives),
    ]);
    for (const m of mines) {
      object('mine', m.name, m.x, m.y, m.q * HALF_PI, readMineShared(dir, m.type), floor,
        { shared: `/MapObjects/${m.type}.(AdvMapMineShared).xdb#xpointer(/AdvMapMineShared)` });
      // The guard and the piles record the seat walk's facing (mines.ts).
      if (m.guard) {
        guardPoint(m.guard, m.guard.x, m.guard.y, floor, m.facing);
        seats.push([m.guard.x, m.guard.y]);
      }
      const pile = MINE_TYPES.find((t) => t.mine === m.type)!.pile;
      for (const p of m.piles) {
        point('pile', p.name, p.x, p.y, floor, m.facing, { shared: treasureShared(pile), amount: null });
      }
    }
    for (const a of fill.abandoned) {
      object('abandoned-mine', a.name, a.x, a.y, a.q * HALF_PI,
        c.footprint(pricePreset.abandonedMine!), floor,
        { shared: pointered(pricePreset.abandonedMine!, 'AdvMapMineShared') });
    }
    step(`zone ${zone} mines`);

    for (const d of fill.dwellings()) {
      const href = pricePreset.dwellings.concat(c.presets.get(lz.race)!.dwellings)
        .find((h) => c.footprint(h).path === d.type)!;
      const docType = /<Type>(\w+)<\/Type>/.exec(readFileSync(join(dir, d.type.replace(/^\//, '')), 'utf8'))?.[1] ?? '';
      object('dwelling', d.name, d.x, d.y, d.q * HALF_PI, c.footprint(href), floor, {
        craterDwelling: CRATER_DWELLING_TYPES.has(docType),
        skipFlattenDwelling: SKIP_FLATTEN_DWELLING_TYPES.has(docType),
        shared: pointered(href, 'AdvMapDwellingShared'),
        // Tier >= 3 reuses descriptor 3 and switches its creature on.
        creaturesEnabled: d.tier >= 3
          ? Array.from({ length: 4 }, (_, k) => (k === d.tier - 3 ? 1 : 0))
          : undefined,
      });
    }
    step(`zone ${zone} dwellings`);

    const priced = (p: { name: string; x: number; y: number; q: number; type: string }): void => {
      object('building', p.name, p.x, p.y, p.q * HALF_PI, c.footprint(p.type), floor,
        { shared: pointered(p.type, 'AdvMapBuildingShared') });
    };
    for (const u of fill.upgradeBuildings()) {
      priced(u);
      // The 0xED3200 door's guard records the BUILDING's own rotation.
      if (u.guard?.guard) guardPoint(u.guard.guard, u.guard.x, u.guard.y, floor, u.q * HALF_PI);
      if (u.guard) seats.push([u.guard.x, u.guard.y]);
    }
    step(`zone ${zone} upgradeBuildings`);

    for (const p of fill.prisons()) {
      object('prison', p.name, p.x, p.y, p.q * HALF_PI, c.footprint(PRISON_HREF), floor,
        { shared: pointered(PRISON_HREF, 'AdvMapPrisonShared') });
    }
    step(`zone ${zone} prisons`);

    for (const s of fill.shrines()) {
      const href = `/MapObjects/${s.type}.(AdvMapShrineShared).xdb`;
      object('shrine', s.name, s.x, s.y, s.q * HALF_PI, c.footprint(href), floor,
        { shared: pointered(href, 'AdvMapShrineShared') });
    }
    step(`zone ${zone} shrines`);

    for (const p of fill.resourceBuildings()) priced(p);
    step(`zone ${zone} resourceBuildings`);
    for (const p of fill.treasuryBuildings()) priced(p);
    step(`zone ${zone} treasuryBuildings`);
    for (const p of fill.luckMorale()) priced(p);
    step(`zone ${zone} luckMorale`);
    for (const p of fill.shops()) priced(p);
    step(`zone ${zone} shops`);

    for (const o of fill.observatories()) priced(o);
    for (const t of fill.treasures()) {
      point('treasure', t.name, t.x, t.y, floor, t.q * HALF_PI,
        { shared: treasureShared(t.type), amount: null });
    }
    for (const t of fill.chests()) {
      point('treasure', t.name, t.x, t.y, floor, t.q * HALF_PI,
        { shared: treasureShared(t.type), amount: null });
    }
    step(`zone ${zone} tail`);

    roads.set(zone, fill.road());
    step(`zone ${zone} road`);
  }
  step('first loop');

  // --- The roads phase, floors then zones in hash order.
  for (let f = 0; f < c.floors.length; f++) {
    for (const z of floorIterationOrder(c.loaded.zones.filter((zz) => zz.floor === f))) {
      const zone = c.zone(z.index);
      const centre = c.townResult.centres.get(z.index);
      const phase = buildZoneRoadsPhase({
        size: c.size, grid: c.floors[f]!.grid, border: c.floors[f]!.border,
        occupancy: c.floors[f]!.occ, zoneIndex: z.index,
        townEntry: zone.town && centre ? [centre.b, centre.a] : null,
        connectionPoints: [
          ...(c.conn.passages.get(z.index) ?? []).map(([a, b]) => [b, a] as Tile),
          ...c.teleportActives(z.index),
        ],
        mineActives: mineActives.get(z.index) ?? [],
      }, c.rng);
      roads.set(z.index, [...roads.get(z.index)!, ...phase.road08, ...phase.road10]);
    }
  }
  step('roads phase');

  // --- The statics, template order, big then one-tile per zone; the
  // relief cones write floor 0's height plane as they land.
  const heightPlane = makeHeightPlane(c.size, 6.0);
  const vertexHeights = c.floors.map((_, f) => createVertexHeights(c.size, f));
  const statics: PlacedStatic[] = [];
  const lakes: LakePaint[] = [];

  for (const tz of c.template.zones) {
    const lz = c.loaded.zones.find((z) => z.index === tz.index)!;
    const f = lz.floor;
    const floor = c.floors[f]!;
    const preset = c.presets.get(lz.terrainRace)!;
    const fill = fills.get(tz.index)!;
    const zoneRoads = roads.get(tz.index)!;
    const subterranean = lz.kind !== 'zone' && lz.kind !== 'waterBordered';
    const water = Boolean(c.water) && f === 0;

    const big = placeZoneBigStatics({
      size: c.size, grid: floor.grid, border: floor.border, occupancy: floor.occ, room: floor.room,
      points: fill.points, zoneIndex: tz.index, floor: f,
      settingRace: lz.race,
      roads: zoneRoads, bigPositions: [], blockedList: fill.blocked,
      bigStatics: preset.bigStatics.map((h) => c.footprint(h)),
      mountains: preset.mountains.map((h) => c.footprint(h)),
      overLakeCenterObjects: preset.overLakeCenterObjects.map((h) => c.footprint(h)),
      overLakeOneTileRandomObjects: preset.overLakeOneTileRandomObjects.map((h) => h ? c.footprint(h) : null),
      mapAngle: c.setup.angle,
      heightPlane: f === 0 ? heightPlane : undefined,
      subterranean, vertexHeights: vertexHeights[f]!,
      water: water || undefined, tiles: c.water?.kept.get(tz.index),
    }, c.rng);
    // A lit crystal's colour is the params' Colors[zoneIndex % count].
    const zoneColor = c.params.pointLightParams.colors.length
      ? c.params.pointLightParams.colors[tz.index % c.params.pointLightParams.colors.length]!
      : { x: 1, y: 1, z: 1 };
    const staticRecord = (s: PlacedStatic): RunObject => ({
      kind: 'static', name: s.name, x: s.x, y: s.y, z: 0, rot: s.angle,
      floor: f, isStatic: true, blocked: [],
      shared: pointered(s.type, 'AdvMapStaticShared'),
      lights: s.light
        ? [{ x: 0, y: 0, z: s.light.z, color: [zoneColor.x, zoneColor.y, zoneColor.z], radius: s.light.radius }]
        : undefined,
    });
    if (big.lakeTiles.length) {
      lakes.push({
        tiles: big.lakeTiles, room: big.lakeRoom, border: big.lakeBorder,
        // The painter looks the zone up by its own id (`zone+0xEC`) and
        // reads the preset off `zone+0x20` — the terrain-race entry, the
        // same one FillTerrain paints the zone's ground from.
        waterTile: preset.waterTile, waterBottomTile: preset.waterBottomTile,
        settingRace: lz.race,
      });
    }
    statics.push(...big.placed);
    for (const s of big.placed) objects.push(staticRecord(s));
    step(`zone ${tz.index} big statics`);

    const oneInput = {
      size: c.size, grid: floor.grid, border: floor.border, occupancy: floor.occ, room: floor.room,
      points: fill.points, zoneIndex: tz.index, roads: zoneRoads,
      smallBlockers: preset.oneTileSmallBlockers.map((h) => c.footprint(h)),
      smallNonblockers: preset.oneTileSmallNonblockers.map((h) => c.footprint(h)),
      bigObjects: preset.oneTileBigObjects.map((h) => c.footprint(h)),
      mapAngle: c.setup.angle,
    };
    const one = subterranean
      ? placeSubterraOneTileStatics({
          ...oneInput, vertexHeights: vertexHeights[f]!,
          pointLight: c.params.pointLightParams,
        }, c.rng)
      : water
        ? placeWaterOneTileStatics({ ...oneInput, tiles: c.water!.kept.get(tz.index)! }, c.rng)
        : placeZoneOneTileStatics(oneInput, c.rng);
    statics.push(...one);
    for (const s of one) objects.push(staticRecord(s));
    step(`zone ${tz.index} one-tile statics`);
  }
  step('statics');

  // --- Additional objects: the underground zones' late treasures.
  for (const tz of c.template.zones) {
    const lz = c.loaded.zones.find((z) => z.index === tz.index)!;
    if (lz.floor === 0) continue;
    const fill = fills.get(tz.index)!;
    for (const t of fill.lateTreasures()) {
      point('treasure', t.name, t.x, t.y, lz.floor, t.q * HALF_PI,
        { shared: treasureShared(t.type), amount: null });
    }
    step(`zone ${tz.index} late treasures`);
    for (const t of fill.lateChests()) {
      point('treasure', t.name, t.x, t.y, lz.floor, t.q * HALF_PI,
        { shared: treasureShared(t.type), amount: null });
    }
    step(`zone ${tz.index} late chests`);
  }

  // --- The treasure blocks, template order, each zone on its own floor.
  const artifacts: ArtifactEntry[] = rmgArtifactPool(readArtifacts(dir), Boolean(c.water))
    .map((a) => ({ id: a.id, cost: a.cost, href: a.href }));
  for (const tz of c.template.zones) {
    const lz = c.loaded.zones.find((z) => z.index === tz.index)!;
    const fl = c.floors[lz.floor]!;
    const centre = c.townResult.centres.get(tz.index);
    const hasTown = Boolean(tz.town && centre);
    recomputeRoom(fl.room, c.size, fl.grid, tz.index, roads.get(tz.index)!, c.water?.kept.get(tz.index));
    const blocks = buildTreasureBlocks({
      size: c.size, occupancy: fl.occ, room: fl.room,
      tiles: c.water?.kept.get(tz.index) ?? zoneTiles(c.size, fl.grid, tz.index),
      town: hasTown ? [centre!.b, centre!.a] : [0, 0], hasTown,
      repel: guardSeats.get(tz.index)!,
      totalValue: tz.treasureBlocksTotalValue,
      distBetween: c.params.distBetweenTreasureBlocks,
    }, c.rng);
    step(`zone ${tz.index} blocks grown`);
    const result = fillTreasureBlocks({
      size: c.size, occupancy: fl.occ, blocks, artifacts,
      monsterStrength: c.setup.monsterStrength, tables: c.tables,
    }, c.rng);
    for (const b of result) {
      if (b.guard) guardPoint(b.guard, b.guardAt[0], b.guardAt[1], lz.floor, b.guardRotation);
      for (const item of b.items) {
        point(item.kind === 'artifact' ? 'artifact' : 'treasure', item.name, item.x, item.y,
          lz.floor, item.rotation, {
            shared: pointered(item.href,
              item.kind === 'artifact' ? 'AdvMapArtifactShared' : 'AdvMapTreasureShared'),
            amount: item.kind === 'artifact' ? null : item.amount,
          });
      }
    }
    step(`zone ${tz.index} blocks filled`);
  }
  step('run');

  return { c, objects, heightPlane, vertexHeights, roads, mineActives, guardSeats, fills, statics, lakes };
}
