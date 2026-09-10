// The minimap against the engine's own, byte for byte.
//
//   node tools/test-rmg-minimap.ts
//
// The reference is the `.h5m`'s `minimap_floor_01.dds`, laid out beside
// map.xdb by `npm run rmg-reference`. Everything the picture is made of is
// checked on the way: the terrain layer tile by tile, the darkening mask tile
// by tile, the icon names and where each one lands.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { readEngineSine } from '../src/exe/sine-table.ts';
import { writeDDS } from '../src/format/texture.ts';
import { drawMinimap, drawTerrainLayer } from '../src/rmg/minimap.ts';
import { buildMinimapMask, vetoesRegistration } from '../src/rmg/minimap-mask.ts';
import { drawIconLayer, iconNameFor, loadMinimapIcons, type IconObject } from '../src/rmg/minimap-icons.ts';
import { iconAnchor } from '../src/rmg/minimap-icons.ts';
import { readTileInfo } from '../src/rmg/preset-table.ts';
import {
  fillTerrain, makeRiverPlane, paintLakes, paintRoads, stampZoneLakeRiver,
} from '../src/rmg/terrain.ts';
import { floorIterationOrder } from '../src/rmg/zones.ts';
import { runFull } from './rmg-run.ts';
import { dataDir, gameDirIfAny } from './game-dir.ts';
import { REFERENCE_DIR, REFERENCE_MISSING, hasReference, referenceMinimap } from './rmg-reference.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

// ------------------------------------ one descriptor a tile, not a union
// The object arm of the darkening mask is a per-tile descriptor the engine
// overwrites (`0xA4FF00`), so a tile one object blocks and another calls
// active ends up ACTIVE and is never darkened. Held here without any game
// data: two one-tile objects standing on the same tile.
{
  const side = 8;
  const plane = new Uint8Array((side + 1) * (side + 1)).fill(1);
  const at = (x: number, y: number): number => y * side + x;
  const blocker = { x: 4, y: 4, rot: 0, floor: 0, blocked: [[0, 0]] as const, active: [] };
  // Two claimants with the SAME shape — no blocked list, one active tile, the
  // blocker's — and opposite answers, because the veto goes by class. A shrine
  // keeps its tile bright; a pile or a guard never claimed it. That is the
  // measurement of ten contested tiles, and the reading it replaced was "an
  // object with no blocked list claims nothing", which got the shrines wrong.
  const claimer = { x: 4, y: 3, rot: 0, floor: 0, blocked: [] as const, active: [[0, 1]] as const };
  const vetoed = { ...claimer, vetoed: true };
  const alone = buildMinimapMask({ side, plane, dim: side + 1, objects: [blocker] });
  check('a blocked tile is darkened', alone[at(4, 4)] === 1, `${alone[at(4, 4)]}`);
  const shared = buildMinimapMask({ side, plane, dim: side + 1, objects: [blocker, claimer] });
  check("another object's active tile takes it back", shared[at(4, 4)] === 0, `${shared[at(4, 4)]}`);
  const reversed = buildMinimapMask({ side, plane, dim: side + 1, objects: [claimer, blocker] });
  check('and the order the two stand in does not decide it', reversed[at(4, 4)] === 0,
    `${reversed[at(4, 4)]}`);
  const pile = buildMinimapMask({ side, plane, dim: side + 1, objects: [blocker, vetoed] });
  check('but a class the veto takes never claimed it', pile[at(4, 4)] === 1, `${pile[at(4, 4)]}`);
  // And the veto takes BOTH lists, not just the active one: an object it
  // answers for does not darken with its blocked list either.
  const vetoedBlocker = { x: 4, y: 4, rot: 0, floor: 0, blocked: [[0, 0]] as const, active: [], vetoed: true };
  const none = buildMinimapMask({ side, plane, dim: side + 1, objects: [vetoedBlocker] });
  check('and its blocked list darkens nothing', none[at(4, 4)] === 0, `${none[at(4, 4)]}`);
  // The classes themselves, off the shared document's own xpointer.
  const cls = (name: string): boolean => vetoesRegistration(`/MapObjects/X.xdb#xpointer(/${name})`);
  check('the treasure and the monster are the measured two',
    cls('AdvMapTreasureShared') && cls('AdvMapMonsterShared'));
  check('the shrine and the building are not',
    !cls('AdvMapShrineShared') && !cls('AdvMapBuildingShared'));
}

// ------------------------------ the icon anchor chops, and a pixel hangs on it
// The mean is `sum * (1.0f / n)` on a unit at single precision and ROUND
// TOWARD ZERO, so `3 * (1/6)` is an ulp UNDER a half where doubles make it
// exactly a half. Held without game data on the case that showed it: the
// Fairie Tree of a medium map, five blocked tiles and one active at 3pi/2,
// standing on tile 101 of a 136-wide map, where `(101.5 - 1) * 256 / 134` is
// exactly 192.0 and the last bit decides which pixel the blit truncates to.
// `native/rmg/minimap-probe.c` read the game's own answer for it: 101.499.
{
  const tree = {
    x: 101, y: 101, rot: 3 * (Math.PI / 2), name: 'Object_0',
    blocked: [[-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] as ReadonlyArray<readonly [number, number]>,
    active: [[0, 0]] as ReadonlyArray<readonly [number, number]>,
  };
  const [px, py] = iconAnchor(tree, 136, 1);
  check('the anchor lands UNDER the pixel boundary, not on it', px < 192 && px > 191.9999, `${px}`);
  check('so the icon is blitted a pixel left', Math.trunc(px) - 3 === 188, `${Math.trunc(px) - 3}`);
  // The other axis of the same object is nowhere near a boundary, which is why
  // only one of the two moved: the top is 61 either way.
  check('and its top is where it already was', Math.trunc(py) - 3 === 61, `${Math.trunc(py) - 3}`);
  // THE CONTROL, and it lands on the same 101.5: a count that is a power of
  // two divides exactly in either arithmetic, so this one is 192.0 on the nose
  // where the six above is an ulp under. Which makes the two checks about the
  // chop rather than about the footprint or the converter.
  const quarter = {
    ...tree,
    blocked: [[1, 1], [1, 0], [0, 1]] as ReadonlyArray<readonly [number, number]>,
  };
  const [qx] = iconAnchor(quarter, 136, 1);
  check('a power-of-two count still lands ON it', qx === 192, `${qx}`);
}

const dir = dataDir();
if (!existsSync(join(dir, 'RMG'))) {
  console.log('no unpacked RMG data — skipping');
  process.exit(0);
}
const game = gameDirIfAny();
if (!game) {
  console.log('nobody said where the game is (HOMM5_GAME or --game) — the minimap needs its sine table; skipping');
  process.exit(0);
}

const r = runFull(dir, {});
const c = r.c;
const side = c.size, border = 1, dim = c.size + 1;

// The layers, replayed the way test-rmg-emit does — fill, lakes, roads.
const transitive = c.params.defaultTransitiveTile ? readTileInfo(dir, c.params.defaultTransitiveTile) : null;
const floors = fillTerrain(c.size, c.size, c.loaded.zones, c.floors.map((f) => f.grid), c.presets, transitive);
const river = makeRiverPlane(c.size);
for (const lake of r.lakes) {
  paintLakes(floors[0]!, lake, c.size);
  stampZoneLakeRiver(river, lake);
}
for (let f = 0; f < c.floors.length; f++) {
  paintRoads(floors[f]!, c.size, c.floors[f]!.grid, c.floors[f]!.occ,
    floorIterationOrder(c.loaded.zones.filter((z) => z.floor === f)).map((z) => {
      const preset = c.presets.get(c.loaded.zones.find((lz) => lz.index === z.index)!.terrainRace);
      return {
        zoneIndex: z.index,
        roadTile: preset?.roadTile ?? null,
        secondaryRoadTile: preset?.secondaryRoadTile ?? null,
      };
    }));
}

// The mask: the passability plane's zeros plus every object's blocked
// footprint, the statics' read off their shared documents.
const mask = buildMinimapMask({
  side, plane: r.passability[0]!, dim, layers: floors[0]!,
  objects: r.objects.filter((o) => o.floor === 0).map((o) => ({
    x: o.x, y: o.y, rot: o.rot, floor: o.floor,
    blocked: o.blocked.length || !o.shared ? o.blocked : c.footprint(o.shared).blocked,
    // The same two fields `rmg-build` passes, or this suite would be checking
    // a mask nothing else builds: the active list and the veto's answer.
    active: o.shared ? c.footprint(o.shared).active : [],
    vetoed: vetoesRegistration(o.shared),
  })),
});
// WHAT THIS SUITE CANNOT SEE, said out loud so the green is not read as more
// than it is. The mask's third arm is big water over the tile, and this
// template paints no water layer at all — so the arm is inert here and a
// suite that only runs the reference would stay green with it deleted. It is
// checked by `rmg-diff-map` against an engine-generated map that HAS one:
// `RMG/Templates/S0-1P2Z2K3.1T.xdb -seed 1785351845 -size 1 -resource 1
// -exp 1 -water 2` for a sea, and `S1P2Z3K5.1` on the same seed for a lava
// lake, which is `TT_BIG_WATER` with a lava texture over it.
check('this template exercises no water arm, so the suite is blind to it — see the note above',
  floors[0]!.every((l) => l.type !== 'TT_BIG_WATER'));

const iconObjects: IconObject[] = [];
for (const o of r.objects) {
  if (o.floor !== 0 || !o.shared) continue;
  const docPath = o.shared.split('#')[0]!.replace(/^\//, '');
  const docType = /<Type>(\w+)<\/Type>/.exec(readFileSync(join(dir, docPath), 'utf8'))?.[1] ?? '';
  const name = iconNameFor(o.shared, o.town?.playerId ?? 0, docType);
  if (!name) continue;
  const foot = c.footprint(o.shared);
  iconObjects.push({ x: o.x, y: o.y, rot: o.rot, blocked: foot.blocked, active: foot.active, name });
}
check('the icon list is the engine\'s 22 — two towns, eighteen mines, two flaggable dwellings',
  iconObjects.length === 22, `${iconObjects.length}`);

const floor = { side, border, layers: floors[0]!, dim, masked: (tx: number, ty: number) => mask[ty * side + tx] === 1 };
const icons = loadMinimapIcons(dir);
const image = drawMinimap(floor, drawIconLayer(iconObjects, icons, side, border),
  readEngineSine(join(game, 'bin', 'H5_Game_H5E.exe')));

// The port keeps the engine's byte order; writeDDS takes RGBA and stores BGRA.
const rgba = new Uint8Array(image.data.length);
for (let i = 0; i < rgba.length; i += 4) {
  rgba[i] = image.data[i + 2]!;
  rgba[i + 1] = image.data[i + 1]!;
  rgba[i + 2] = image.data[i]!;
  rgba[i + 3] = image.data[i + 3]!;
}
const ours = writeDDS({ width: image.width, height: image.height, rgba }, true);

const refFile = referenceMinimap(REFERENCE_DIR, 0);
if (!hasReference() || !existsSync(refFile)) {
  console.log(`  ${REFERENCE_MISSING}`);
  console.log(`  (the terrain layer is ${drawTerrainLayer(floor).width}^2 and was built; nothing to compare it to)`);
  process.exit(failures ? 1 : 0);
}

const ref = readFileSync(refFile);
check('the file is the same size', ours.length === ref.length, `${ours.length} against ${ref.length}`);

let header = 0;
for (let i = 0; i < 128; i++) if (ours[i] !== ref[i]) header++;
check('the DDS header is byte-identical', header === 0, `${header} bytes differ`);

const off: Array<{ x: number; y: number; ch: string; ours: number; ref: number }> = [];
for (let i = 128; i < Math.min(ours.length, ref.length); i++) {
  if (ours[i] === ref[i]) continue;
  const p = (i - 128) >> 2;
  off.push({ x: p % 256, y: (p / 256) | 0, ch: 'bgra'[(i - 128) & 3]!, ours: ours[i]!, ref: ref[i]! });
}
// THE WHOLE PICTURE, and no allowance. Ten channel bytes used to be exempt
// here — three resampled channels that sat within 4e-5 of a rounding boundary
// and came out the wrong side of it — and the cause was not the filter, the
// sine or the summation, all of which had been checked. It was the FPU: the
// editor runs at `0x0C7F`, precision SINGLE and rounding TOWARD ZERO, so its
// every multiply and add lands on a float and always the float nearer zero.
// `src/exe/x87.ts` does that arithmetic and the ten went with it.
check('every channel byte is the engine\'s', off.length === 0, `${off.length} differ`);
if (off.length) {
  console.log(`        ${off.map((d) => `(${d.x},${d.y})${d.ch} ${d.ours}/${d.ref}`).join('  ')}`);
}

process.exit(failures ? 1 : 0);
