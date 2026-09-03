// Everything a generated map is, as files — the one place the port assembles
// a run into the entries a `.h5m` holds.
//
// The generator's phases each have their own module and their own suite; what
// was missing was the step after: `map.xdb`, `GroundTerrain.bin`, the texts,
// the map tag and the minimaps are built by five different emitters that
// nobody was calling together. Three suites had grown their own copy of the
// replay — fill the terrain, paint the water, the lakes and the roads, run the
// height late pass — which is three chances to drift. This is that replay,
// once, and the file list it produces.
//
// Inputs that are NOT the generator's come in through `MapOrder`: the GUID
// (`CoCreateGuid` at run time), the map's name (typed into the dialog) and
// the settings the dialog was set to. docs/RMG.md names them.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { readEngineSine, type EngineSine } from '../src/exe/sine-table.ts';
import { writeDDS } from '../src/format/texture.ts';
import { heightsToFile, latePass } from '../src/rmg/heights.ts';
import { buildMinimapXdb, buildRmgMapDesc, buildRmgMapTag } from '../src/rmg/emit.ts';
import { buildTerrainFile } from '../src/rmg/emit-terrain.ts';
import { buildRmgTexts } from '../src/rmg/emit-texts.ts';
import { RACE } from '../src/rmg/load-template.ts';
import { drawMinimap } from '../src/rmg/minimap.ts';
import { drawIconLayer, iconNameFor, loadMinimapIcons, type IconObject } from '../src/rmg/minimap-icons.ts';
import { buildMinimapMask } from '../src/rmg/minimap-mask.ts';
import { readTileInfo } from '../src/rmg/preset-table.ts';
import {
  fillTerrain, makeRiverPlane, paintLakes, paintRoads, paintSeaCorners, paintWaterMarks, stampZoneLakeRiver,
  type TerrainLayer,
} from '../src/rmg/terrain.ts';
import { floorIterationOrder } from '../src/rmg/zones.ts';
import type { FullRun } from './rmg-run.ts';

/** The order a map was generated from, plus the two values nobody generates. */
export interface MapOrder {
  seed: number;
  /** The template's name without its path, e.g. `S1P2Z2M1`. */
  template: string;
  players: number;
  underground: boolean;
  /** WaterAmount as the dialog offers it: 0 none, 1 present, 2 island map. */
  water: number;
  /** `CoCreateGuid`'s, uppercase with dashes. */
  guid: string;
  mapName: string;
  /**
   * The dialog's Minimap tick, default on.
   *
   * Off is worth having because it costs the generator NOTHING — the same
   * order with it off spends the same 92438 draws and writes the same terrain
   * — while taking the port's one remaining difference off the table: with no
   * minimap asked for the engine writes neither `minimap_floor_0N.dds` nor its
   * `.xdb`, and the map points its thumbnail at a stock texture instead. A
   * sweep ordered that way shows only real differences. It HIDES the ten-byte
   * minimap debt rather than paying it, which is the whole of what it does.
   */
  minimap?: boolean;
}

/** One entry of the archive, named the way the map folder holds it. */
export interface MapFile {
  name: string;
  data: Buffer;
}

const TOWN_BY_RACE: Record<number, string> = {
  [RACE.HEAVEN]: 'TOWN_HEAVEN', [RACE.PRESERVE]: 'TOWN_PRESERVE', [RACE.ACADEMY]: 'TOWN_ACADEMY',
  [RACE.DUNGEON]: 'TOWN_DUNGEON', [RACE.NECROMANCY]: 'TOWN_NECROMANCY', [RACE.INFERNO]: 'TOWN_INFERNO',
  [RACE.DWARF]: 'TOWN_FORTRESS', [RACE.STRONGHOLD]: 'TOWN_STRONGHOLD',
};
/** The tile counts the dialog's sizes mean, in the enum's own order. */
export const MAP_SIZES = [72, 96, 136, 176, 216, 256, 320] as const;
const MAP_SIZE_NAMES = [
  'MAP_SIZE_TINY', 'MAP_SIZE_SMALL', 'MAP_SIZE_MEDIUM', 'MAP_SIZE_LARGE',
  'MAP_SIZE_EXTRALARGE', 'MAP_SIZE_HUGE', 'MAP_SIZE_IMPOSSIBLE',
] as const;
const WATER_NAMES = ['WATER_NONE', 'WATER_PRESENT', 'WATER_ISLAND_MAP'] as const;
const MONSTER_NAMES = [
  'MONSTER_LEVEL_WEAK', 'MONSTER_LEVEL_MEDIUM', 'MONSTER_LEVEL_STRONG',
  'MONSTER_LEVEL_VERY_STRONG', 'MONSTER_LEVEL_IMPOSSIBLE',
] as const;

/**
 * The run's terrain layers, per floor, with every painter replayed in order.
 *
 * fillTerrain first, then the water carve's marks and sea corners, then the
 * lakes (whose painter runs inside the statics sweep, before the roads), then
 * the roads. The river plane is stamped along the way because the lakes and
 * the sea share it.
 */
export function replayTerrain(dataRoot: string, run: FullRun): {
  layers: TerrainLayer[][];
  river: { w: number; data: Uint8Array };
} {
  const c = run.c;
  const transitive = c.params.defaultTransitiveTile ? readTileInfo(dataRoot, c.params.defaultTransitiveTile) : null;
  const layers = c.water
    ? [fillTerrain(c.size, c.size, c.loaded.zones, [c.water.gridBeforeCarve], c.presets, transitive)[0]!]
    : fillTerrain(c.size, c.size, c.loaded.zones, c.floors.map((f) => f.grid), c.presets, transitive);
  if (c.water) {
    const deepWaterBottom = c.params.deepWaterBottom ? readTileInfo(dataRoot, c.params.deepWaterBottom) : null;
    const deepWaterTile = c.params.deepWaterTile ? readTileInfo(dataRoot, c.params.deepWaterTile) : null;
    for (const [zi, zoneMarks] of c.water.marks) {
      const lz = c.loaded.zones.find((z) => z.index === zi)!;
      paintWaterMarks(layers[0]!, zoneMarks, c.presets.get(lz.terrainRace)?.waterCoastTile ?? null,
        deepWaterBottom, c.size);
      paintSeaCorners(layers[0]!, c.water.sea.get(zi)!, deepWaterTile, c.size);
    }
  }
  const river = c.water?.river ?? makeRiverPlane(c.size);
  for (const lake of run.lakes) {
    paintLakes(layers[0]!, lake, c.size);
    stampZoneLakeRiver(river, lake);
  }
  for (let f = 0; f < c.floors.length; f++) {
    paintRoads(layers[f]!, c.size, c.floors[f]!.grid, c.floors[f]!.occ,
      floorIterationOrder(c.loaded.zones.filter((z) => z.floor === f)).map((z) => {
        const preset = c.presets.get(c.loaded.zones.find((lz) => lz.index === z.index)!.terrainRace);
        return {
          zoneIndex: z.index,
          roadTile: preset?.roadTile ?? null,
          secondaryRoadTile: preset?.secondaryRoadTile ?? null,
        };
      }));
  }
  return { layers, river };
}

/** One floor's minimap, both files. */
function minimapFiles(
  dataRoot: string, run: FullRun, floor: number, layers: readonly TerrainLayer[],
  river: { w: number; data: Uint8Array }, sine: EngineSine, icons: ReturnType<typeof loadMinimapIcons>,
): MapFile[] {
  const c = run.c;
  const side = c.size, border = 1, dim = c.size + 1;
  const mask = buildMinimapMask({
    side, plane: run.passability[floor]!, dim,
    objects: run.objects.filter((o) => o.floor === floor).map((o) => ({
      x: o.x, y: o.y, rot: o.rot, floor: o.floor,
      blocked: o.blocked.length || !o.shared ? o.blocked : c.footprint(o.shared).blocked,
    })),
  });
  const iconObjects: IconObject[] = [];
  for (const o of run.objects) {
    if (o.floor !== floor || !o.shared) continue;
    const docPath = o.shared.split('#')[0]!.replace(/^\//, '');
    const docType = /<Type>(\w+)<\/Type>/.exec(readFileSync(join(dataRoot, docPath), 'utf8'))?.[1] ?? '';
    const name = iconNameFor(o.shared, o.town?.playerId ?? 0, docType);
    if (!name) continue;
    const foot = c.footprint(o.shared);
    iconObjects.push({ x: o.x, y: o.y, rot: o.rot, blocked: foot.blocked, active: foot.active, name });
  }
  // `0x9EC3C0`, the shipyard's water test — a water tile is never darkened.
  const water = (tx: number, ty: number): boolean => {
    const cx = tx < 0 ? 0 : tx > side - 1 ? side - 1 : tx;
    const cy = ty < 0 ? 0 : ty > side - 1 ? side - 1 : ty;
    return river.data[(2 * cy + 1) * river.w + (2 * cx + 1)]! > 0x8c;
  };
  const image = drawMinimap(
    { side, border, layers, dim, masked: (tx, ty) => mask[ty * side + tx] === 1, water },
    drawIconLayer(iconObjects, icons, side, border), sine);
  // The port keeps the engine's byte order; writeDDS takes RGBA and stores BGRA.
  const rgba = new Uint8Array(image.data.length);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = image.data[i + 2]!;
    rgba[i + 1] = image.data[i + 1]!;
    rgba[i + 2] = image.data[i]!;
    rgba[i + 3] = image.data[i + 3]!;
  }
  const stem = `minimap_floor_0${floor + 1}`;
  return [
    { name: `${stem}.dds`, data: writeDDS({ width: image.width, height: image.height, rgba }, true) },
    { name: `${stem}.xdb`, data: Buffer.from(buildMinimapXdb(floor), 'utf8') },
  ];
}

/** Every file the archive holds, in no particular order — packing sorts them. */
export function buildMapFiles(
  dataRoot: string, exePath: string, run: FullRun, order: MapOrder,
): MapFile[] {
  const c = run.c;
  const twoLevel = c.floors.length > 1;
  const { layers, river } = replayTerrain(dataRoot, run);
  latePass(run.heightPlane, {
    size: c.size, occupancy: c.occ, border: c.border, grid: c.grid,
    raceOf: (zi) => c.loaded.zones.find((z) => z.index === zi)?.race,
    objects: run.objects,
  });

  const sizeIndex = MAP_SIZES.indexOf(c.size as (typeof MAP_SIZES)[number]);
  const races = Array.from({ length: order.players }, (_, i) =>
    TOWN_BY_RACE[c.loaded.zones.find((z) => z.playerNo === i + 1)!.race]!);
  const files: MapFile[] = [
    {
      name: 'map.xdb',
      data: Buffer.from(buildRmgMapDesc({
        tiles: c.size,
        twoLevel,
        objects: run.objects,
        groundAmbientLight: c.params.groundTerrainLights[c.setup.ambientLightIndex]!,
        players: order.players,
        sRMG: {
          version: 34,
          seed: order.seed,
          guid: order.guid,
          mapSize: MAP_SIZE_NAMES[sizeIndex]!,
          template: `/RMG/Templates/${order.template}.xdb#xpointer(/RMGTemplate)`,
          waterAmount: WATER_NAMES[order.water]!,
          monsterLevel: MONSTER_NAMES[c.setup.monsterStrength]!,
          hasUnderground: twoLevel,
          races,
          mapName: order.mapName,
        },
        minimap: order.minimap !== false,
      }), 'utf8'),
    },
    {
      name: 'map-tag.xdb',
      data: Buffer.from(buildRmgMapTag({
        tiles: c.size, twoLevel, players: order.players, minimap: order.minimap !== false,
      }), 'utf8'),
    },
    // Empty, and the engine writes it — a marker rather than a document.
    { name: '1.test', data: Buffer.alloc(0) },
  ];
  files.push(...buildRmgTexts(dataRoot, {
    mapName: order.mapName,
    template: order.template,
    sizeIndex,
    underground: order.underground,
    water: Boolean(c.water),
    monsterStrength: c.setup.monsterStrength,
    players: order.players,
    seed: order.seed,
  }));

  const withXpointer = (l: TerrainLayer): { path: string; mask: Uint8Array } => ({
    path: l.path.includes('#xpointer') ? l.path : `${l.path}#xpointer(/AdvMapTile)`,
    mask: l.mask,
  });
  const vertices = (c.size + 1) * (c.size + 1);
  files.push({
    name: 'GroundTerrain.bin',
    data: buildTerrainFile({
      tiles: c.size,
      layers: layers[0]!.map(withXpointer),
      heights: heightsToFile(run.heightPlane),
      flags: new Uint8Array(vertices).fill(16),
      water: river.data,
      passability: run.passability[0],
    }),
  });
  if (twoLevel) {
    files.push({
      name: 'UndergroundTerrain.bin',
      data: buildTerrainFile({
        tiles: c.size,
        layers: layers[1]!.map(withXpointer),
        heights: run.vertexHeights[1]!.floats,
        flags: run.vertexHeights[1]!.bytes,
        passability: run.passability[1],
      }),
    });
  }

  if (order.minimap !== false) {
    const sine = readEngineSine(exePath);
    const icons = loadMinimapIcons(dataRoot);
    for (let f = 0; f < c.floors.length; f++) {
      files.push(...minimapFiles(dataRoot, run, f, layers[f]!, river, sine, icons));
    }
  }
  return files;
}
