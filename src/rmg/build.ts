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

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { readEngineSine, type EngineSine } from '../exe/sine-table.ts';
import { readText } from './data.ts';
import type { DataRoot } from './data.ts';
import { writeDDS } from '../format/texture.ts';
import { heightsToFile, latePass, rotateOffsets } from './heights.ts';
import { buildMinimapXdb, buildRmgMapDesc, buildRmgMapTag } from './emit.ts';
import { buildTerrainFile } from './emit-terrain.ts';
import { buildRmgTexts } from './emit-texts.ts';
import { tr24 } from '../exe/x87.ts';
import { installTables } from './install.ts';
import type { RmgInstall } from './install.ts';
import { enumNames, readEnumValues } from './data.ts';
import { RACE } from './load-template.ts';
import { templateFile } from './template.ts';
import { drawMinimap, drawTerrainLayer, waterTile, type MinimapFloor, type WaterTileInput } from './minimap.ts';
import {
  drawIconLayer, iconList, iconNameFor, loadMinimapIcons, type IconObject,
} from './minimap-icons.ts';
import { buildMinimapMask, vetoesRegistration } from './minimap-mask.ts';
import { readTileInfo } from './preset-table.ts';
import {
  fillTerrain, makeRiverPlane, paintLakes, paintRoads, paintSeaCorners, paintWaterMarks, stampZoneLakeRiver,
  type TerrainLayer,
} from './terrain.ts';
import { floorIterationOrder } from './zones.ts';
import { heightsInput } from './run.ts';
import type { FullRun } from './run.ts';

/** The order a map was generated from, plus the two values nobody generates. */
export interface MapOrder {
  seed: number;
  /**
   * The map was made by the GAME's executable, not the editor's.
   *
   * Two things follow from it and nothing else does: the two coordinate draws
   * go into the two axes the other way round (`swapZoneAxes`), and every
   * decimal is written by a runtime whose x87 rounds toward zero.
   */
  gameBuild?: boolean;
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
  /** OURS: the map's `AvailableHeroes`; see `heroes.ts`. Absent or empty is the engine's. */
  availableHeroes?: readonly string[];
}

/** One entry of the archive, named the way the map folder holds it. */
export interface MapFile {
  name: string;
  data: Buffer;
}

export const TOWN_BY_RACE: Record<number, string> = {
  [RACE.HEAVEN]: 'TOWN_HEAVEN', [RACE.PRESERVE]: 'TOWN_PRESERVE', [RACE.ACADEMY]: 'TOWN_ACADEMY',
  [RACE.DUNGEON]: 'TOWN_DUNGEON', [RACE.NECROMANCY]: 'TOWN_NECROMANCY', [RACE.INFERNO]: 'TOWN_INFERNO',
  [RACE.DWARF]: 'TOWN_FORTRESS', [RACE.STRONGHOLD]: 'TOWN_STRONGHOLD',
};
// The engine's own table, kept where the engine keeps it.
/** The tile counts by size index, out of the install's executable. */
export function mapSizes(install: RmgInstall): readonly number[] {
  return installTables(install).mapSizes;
}
// The names `sRMGProps` spells the order in are the enums' — `MapSize`,
// `WaterAmount`, `MonsterLevel` in the type listing, read through the chain.

/**
 * The run's terrain layers, per floor, with every painter replayed in order.
 *
 * fillTerrain first, then the water carve's marks and sea corners, then the
 * lakes (whose painter runs inside the statics sweep, before the roads), then
 * the roads. The river plane is stamped along the way because the lakes and
 * the sea share it.
 */
export function replayTerrain(dataRoot: DataRoot, run: FullRun): {
  layers: TerrainLayer[][];
  river: { w: number; data: Uint8Array };
} {
  const c = run.c;
  const transitive = c.params.defaultTransitiveTile ? readTileInfo(dataRoot, c.params.defaultTransitiveTile) : null;
  // ALWAYS the FillTerrain-time grid, water or not: the later one has the
  // dist-to-towns pass's -2 over a zone's unreachable tiles, and a vertex whose
  // zone does not resolve is skipped rather than painted.
  // EVERY FLOOR, water or not. The water branch used to keep floor 0 alone,
  // which was invisible while every water map in the corpus was one-floored and
  // threw the moment one had an underground: `paintRoads` asks for `layers[f]`.
  // The two expressions are the same thing on a single-floor map, so this takes
  // nothing away from what was green.
  const layers = fillTerrain(c.size, c.size, c.loaded.zones, c.gridAtFillTerrain, c.presets, transitive);
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

/**
 * Where the WORLD object stands: the record's tile, or a random town's real
 * stand-in a document-shift away — the shift turned by the object's own
 * rotation the way every footprint offset is.
 */
function worldTile(o: FullRun['objects'][number]): { x: number; y: number } {
  if (!o.world || (!o.world.dx && !o.world.dy)) return { x: o.x, y: o.y };
  const [[dx, dy]] = rotateOffsets([[o.world.dx, o.world.dy]], o.rot) as Array<readonly [number, number]>;
  return { x: o.x + dx, y: o.y + dy };
}

/** One floor's minimap, both files. */
function minimapFiles(
  dataRoot: DataRoot, run: FullRun, floor: number, layers: readonly TerrainLayer[],
  river: { w: number; data: Uint8Array }, sine: EngineSine, icons: ReturnType<typeof loadMinimapIcons>,
  gameBuild = false,
): MapFile[] {
  const c = run.c;
  // The dwelling types the minimap never flags: numbers in the executable, names in the type listing.
  const typeNames = readEnumValues(dataRoot, 'BuildingType');
  const unflaggable = new Set(c.exe.unflaggableDwellingTypes.map((v) => typeNames.get(v) ?? `#${v}`));
  const side = c.size, border = 1, dim = c.size + 1;
  // The ground flags: the constructor's uniform 16 on the surface, the massif
  // carve's byte grid below. The pass leaves a tile over 0x15 black, and the
  // mask's corner arm reads the same plane.
  const flags = floor === 0
    ? new Uint8Array(dim * dim).fill(16)
    : run.vertexHeights[floor]!.bytes;
  const mask = buildMinimapMask({
    side, plane: run.passability[floor]!, dim, layers, flags, border,
    underground: floor > 0, river: floor > 0 ? undefined : river,
    objects: run.objects.filter((o) => o.floor === floor && !o.alias).map((o) => ({
      // The WORLD object where it is not the record's — a random town's real
      // stand-in, a tile off and with its own lists. See `RunObject.world`.
      ...worldTile(o),
      rot: o.rot, floor: o.floor,
      blocked: o.world ? c.footprint(o.world.shared).blocked
        : o.blocked.length || !o.shared ? o.blocked : c.footprint(o.shared).blocked,
      // The active list too: it is the other half of the per-tile descriptor,
      // and a tile it claims is one the blocked lists cannot darken.
      active: o.world ? c.footprint(o.world.shared).active : o.shared ? c.footprint(o.shared).active : [],
      // The passable list is the tile pass's own arm, not a registration.
      passable: o.world ? c.footprint(o.world.shared).passable : o.shared ? c.footprint(o.shared).passable : [],
      // And whether the veto takes this class at all, in which case neither
      // list is registered — `vetoesRegistration` names the read ones.
      vetoed: vetoesRegistration(o.shared),
    })),
  });
  const iconObjects: IconObject[] = [];
  for (const o of run.objects) {
    if (o.floor !== floor || !o.shared || o.alias) continue;
    const docPath = o.shared.split('#')[0]!.replace(/^\//, '');
    const docText = readText(dataRoot, docPath);
    const docType = /<Type>(\w+)<\/Type>/.exec(docText)?.[1] ?? '';
    const name = iconNameFor(o.shared, o.town?.playerId ?? 0, docType, unflaggable);
    if (!name) continue;
    const foot = c.footprint(o.world?.shared ?? o.shared);
    // The hole tiles too — the anchor's mean runs over them (`IconObject.holes`).
    const holes = [...(/<holeTiles>([\s\S]*?)<\/holeTiles>/.exec(docText)?.[1] ?? '')
      .matchAll(/<x>(-?\d+)<\/x>\s*<y>(-?\d+)<\/y>/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
    iconObjects.push({ ...worldTile(o), rot: o.rot, blocked: foot.blocked, active: foot.active, holes, name });
  }
  // The drawer drains its three lists one after another, so the gates go over
  // the flaggable ones wherever they share a pixel. `sort` is stable, which
  // keeps each list in the world order the run holds.
  iconObjects.sort((a, b) => iconList(a.name) - iconList(b.name));
  // A masked tile the halving spares is one `0x9EC3C0` calls water — `waterTile`
  // in `minimap.ts`, read whole — over the FLOOR'S OWN planes.
  //
  // THE RIVER PLANE IS THE SURFACE'S. The generator stamps one, from floor 0's
  // lakes and its sea, and an underground floor has none — its terrain carries
  // its own, empty. Handing the surface's plane to the floor below spares
  // thirteen cave tiles that happen to sit under the surface lake, which is
  // what it did until a two-level map was diffed.
  const wet: WaterTileInput = { side, layers, flags, river: floor > 0 ? undefined : river };
  const spared = (tx: number, ty: number): boolean => waterTile(wet, tx, ty);
  const floorInput: MinimapFloor = {
    side, border, layers, dim, masked: (tx, ty) => mask[ty * side + tx] === 1, spared, flags,
    gameParse: gameBuild,
  };
  const iconLayer = drawIconLayer(iconObjects, icons, side, border);
  // THE TWO LAYERS BEFORE THE RESAMPLE, when somebody asks for them. A pixel
  // of the finished picture is six by six source pixels through the filter, so
  // a difference of one byte out there is only ever blamed from in here —
  // `RMG_MINIMAP_LAYERS=<dir>` writes `terrain-<floor>.bin` and
  // `icons-<floor>.bin`, each a raw BGRA field of its own side.
  const dumpTo = process.env.RMG_MINIMAP_LAYERS;
  if (dumpTo) {
    const terrainLayer = drawTerrainLayer(floorInput);
    mkdirSync(dumpTo, { recursive: true });
    writeFileSync(join(dumpTo, `terrain-${floor}.bin`), terrainLayer.data);
    writeFileSync(join(dumpTo, `icons-${floor}.bin`), iconLayer.data);
    console.log(`  minimap layers written to ${dumpTo}: terrain ${terrainLayer.width}, icons ${iconLayer.width}`);
  }
  const image = drawMinimap(floorInput, iconLayer, sine);
  // The port keeps the engine's byte order; writeDDS takes RGBA and stores BGRA.
  const rgba = new Uint8Array(image.data.length);
  // THE GAME'S EXTRA STAGE. Every channel of a minimap the game wrote is the
  // port's value put through a float32 normalise-and-back under chop —
  // `trunc(tr24(v / 255) * 255)`, which fixes 0 and 255 and drops everything
  // between by one. The four drawing functions the port reproduces hold no
  // `1/255` in either build (read instruction by instruction: the resample's
  // codegen differences move no byte); the round trip sits past them, where
  // the game's writer hands the image to its texture layer and the editor's
  // does not. Fitted to the bytes, not read. With the game's own parse of the
  // tile colours on top (`MinimapFloor.gameParse`) a large map's two floors
  // come to 65,532 and 65,535 of 65,536 pixels.
  const roundTrip = (v: number): number => Math.trunc(tr24(v / 255) * 255);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = image.data[i + 2]!;
    rgba[i + 1] = image.data[i + 1]!;
    rgba[i + 2] = image.data[i]!;
    rgba[i + 3] = image.data[i + 3]!;
    if (gameBuild) for (let k = 0; k < 4; k++) rgba[i + k] = roundTrip(rgba[i + k]!);
  }
  const stem = `minimap_floor_0${floor + 1}`;
  return [
    { name: `${stem}.dds`, data: writeDDS({ width: image.width, height: image.height, rgba }, true) },
    { name: `${stem}.xdb`, data: Buffer.from(buildMinimapXdb(floor), 'utf8') },
  ];
}

/** Every file the archive holds, in no particular order — packing sorts them. */
export function buildMapFiles(
  install: RmgInstall, run: FullRun, order: MapOrder,
  // The caption numbering belongs to the SAVE PATH, not to the generator: 0 is
  // what the console command writes, 2 what the editor's dialog does. See
  // `RmgTextsInput.captionBase`.
  opts: { captionBase?: number } = {},
): MapFile[] {
  const c = run.c;
  const twoLevel = c.floors.length > 1;
  const { layers, river } = replayTerrain(install.data, run);
  latePass(run.heightPlane, heightsInput(run), undefined, run.c.arith);

  const sizeIndex = c.exe.mapSizes.indexOf(c.size);
  const races = Array.from({ length: order.players }, (_, i) =>
    TOWN_BY_RACE[c.loaded.zones.find((z) => z.playerNo === i + 1)!.race]!);
  const files: MapFile[] = [
    {
      name: 'map.xdb',
      data: Buffer.from(buildRmgMapDesc({
        tiles: c.size,
        truncateFloats: order.gameBuild ?? false,
        // The birds are the map-setup step's own draw (`setup.birds`), the document the executable names.
        birds: c.setup.birds ? c.exe.birds : undefined,
        twoLevel,
        grail: c.grail,
        randomTowns: c.randomTowns,
        resourceMultiplier: c.multipliers.resource,
        expMultiplier: c.multipliers.exp,
        objects: run.objects,
        groundAmbientLight: c.params.groundTerrainLights[c.setup.ambientLightIndex]!,
        players: order.players,
        sRMG: {
          version: 34,
          seed: order.seed,
          guid: order.guid,
          mapSize: enumNames(install.data, 'MapSize')[sizeIndex]!,
          // The file as it resolved — `.h5et` for one of ours, which is then
          // what a replay of this map's order reads back.
          template: `/${templateFile(install.data, order.template)}#xpointer(/RMGTemplate)`,
          waterAmount: enumNames(install.data, 'WaterAmount')[order.water]!,
          monsterLevel: enumNames(install.data, 'MonsterLevel')[c.setup.monsterStrength]!,
          hasUnderground: twoLevel,
          races,
          mapName: order.mapName,
        },
        minimap: order.minimap !== false,
        availableHeroes: order.availableHeroes,
        captionBase: opts.captionBase,
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
  files.push(...buildRmgTexts(install.data, {
    mapName: order.mapName,
    grail: c.grail,
    gamePlaceholder: order.gameBuild,
    template: order.template,
    sizeIndex,
    underground: order.underground,
    water: Boolean(c.water),
    monsterStrength: c.setup.monsterStrength,
    players: order.players,
    seed: order.seed,
    captionBase: opts.captionBase,
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
        // The pre-step ran on the SECOND floor, so its grid is this file's.
        ...(c.coarse === null ? {} : { coarse: c.coarse }),
      }),
    });
  }

  if (order.minimap !== false) {
    const sine = readEngineSine(install.exe);
    const icons = loadMinimapIcons(install.data, c.exe.minimapIcons);
    for (let f = 0; f < c.floors.length; f++) {
      files.push(...minimapFiles(install.data, run, f, layers[f]!, river, sine, icons, order.gameBuild ?? false));
    }
  }
  return files;
}
