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
import { buildMinimapMask } from '../src/rmg/minimap-mask.ts';
import { drawIconLayer, iconNameFor, loadMinimapIcons, type IconObject } from '../src/rmg/minimap-icons.ts';
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
