// The minimap's icons — the game's own art, stamped over the terrain.
//
// `0xDD00E0` collects the objects worth an icon into THREE lists and the
// drawer runs one loop per list:
//
//   - the object's `[+0x04]()` component answers `[+0x08]()` — it can be
//     FLAGGED. These are the `Town_%d` / `Mine_%d` / `Object_%d` ones;
//   - else the shared document is a `SAdvMapBuildingShared` whose `Type`
//     (`+0xEC`) is 0x27, `BUILDING_SUBTERRA_GATE` — `UnderworldExitEnter`;
//   - else `Type` 0x63 or 0x64, the two campaign citadels, drawn `Town_1`.
//
// The port has no runtime components, so the first gate is taken from the
// shared document's CLASS, which is what the component is built from: a town,
// a mine, an abandoned mine or a dwelling can be flagged, an ordinary
// building cannot. On the reference run that is exactly the engine's list —
// 2 towns, 18 mines and the 2 dwellings, and none of the 39 buildings.
//
// The NAME is `sprintf`ed and looked up by string in the `SWindowRelated`
// resource `UI/AdventureScreen-FPP-2/MinimapTextures.(WindowRelatedTextures)
// .xdb`: `Town_%d` when the shared answers `[vtbl+0x3C]`, else `Mine_%d` when
// its class id is `AdvMapMineShared` (0x16130CC3) or `AdvMapAbanMineShared`
// (0x16130CC5), else `Object_%d`. `%d` is the owner from `[obj+0xC]`, and an
// owner above 8 skips the object outright — 0 neutral, 1..8 the players.
//
// The ANCHOR is `0xDCFF70`: the object's world point halved and floored — its
// tile — plus the MEAN of the offsets in its two footprint lists. Measured:
// the mean over blocked AND active together lands all 22 of the reference
// run's blits exactly, where blocked alone lands 8 and the two means summed 1.
// That point goes through the converter `0xDCFB00`,
//
//   out.x =       (in.x - border) * 256 / (side - 2 * border)
//   out.y = 256 - (in.y - border) * 256 / (side - 2 * border)
//
// and the blit `0xDCFDE0` puts the icon's top-left at `(trunc(px) - trunc(w/2),
// trunc(py) - trunc(h/2))`, copying every pixel whose OWN alpha is non-zero as
// a whole dword — no blending, no scaling, clipped per pixel.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { decodeDDS } from '../format/dds.ts';
import { childText, find, findAll, parse } from '../format/xml.ts';
import { rotateOffsets } from './heights.ts';
import { MINIMAP_SIDE } from './minimap.ts';
import type { Bitmap } from './resample.ts';
import type { Offset } from './town-data.ts';

/** An object as the icon pass reads it. */
export interface IconObject {
  x: number;
  y: number;
  /** Radians; the footprint lists are turned by it before they are averaged. */
  rot: number;
  /** The shared document's `blockedTiles`, unrotated. */
  blocked: readonly Offset[];
  /** Its `activeTiles`, unrotated — the anchor averages both together. */
  active: readonly Offset[];
  /** The looked-up name, `Town_1` / `Mine_0` / `Object_0` / `UnderworldExitEnter`. */
  name: string;
}

const ICON_LIST = 'UI/AdventureScreen-FPP-2/MinimapTextures.(WindowRelatedTextures).xdb';

/**
 * The name an object's icon is looked up by, or null when it gets none.
 *
 * The engine asks the object whether it can be flagged and then names the
 * icon by the shared document's class; with no runtime objects the port asks
 * the class for both. `owner` is `[obj+0xC]`: 0 for neutral, 1..8 a player,
 * and anything above 8 skips the object.
 */
export function iconNameFor(shared: string, owner: number, buildingType = ''): string | null {
  if (owner < 0 || owner > 8) return null;
  if (shared.includes('AdvMapTownShared')) return `Town_${owner}`;
  if (shared.includes('AdvMapMineShared') || shared.includes('AdvMapAbanMineShared')) return `Mine_${owner}`;
  if (shared.includes('AdvMapDwellingShared')) {
    return UNFLAGGABLE_DWELLINGS.has(buildingType) ? null : `Object_${owner}`;
  }
  return null;
}

/**
 * The three dwellings that cannot be flagged — READ, not fitted.
 *
 * The collector's gate is two virtual calls. `[obj+0x04]` is
 * `GetFlagged()` (`0xAD0230`, `lea eax,[ecx-44h]` — the flagged subobject at
 * `+0xC8`, null for monsters, treasures, statics and heroes), and then
 * `[+0x18]` is `GetDwelling()`: a TOWN's and a MINE's return null
 * (`0xAC0309` / `0xD2A40C`, both `jmp 0x4797F0`, `xor eax,eax`) and a null
 * ACCEPTS outright, which is why they always carry an icon. Only a dwelling
 * reaches the predicate, `0xD0F960`, and its whole body is a dynamic_cast to
 * `SAdvMapDwellingShared` followed by three subtractions on the `Type` at
 * `+0xEC`:
 *
 *     sub eax,54h  je false     ; BUILDING_FIRE_LAKE
 *     sub eax,0Ah  je false     ; BUILDING_REFUGEE_CAMP
 *     sub eax,1    je false     ; BUILDING_ELEMENTAL_CONFLUX
 *     mov al,1
 *
 * So it is a literal set in the executable, not a table and not a field — the
 * predicate re-reads the shared document every call and keeps nothing. The
 * same three appear again in `CAdvMapDwelling`'s constructor (`0xD0F1D5`).
 * They are the three neutral "buy creatures here" dwellings, which is what
 * the game does with them.
 */
const UNFLAGGABLE_DWELLINGS: ReadonlySet<string> = new Set([
  'BUILDING_FIRE_LAKE', 'BUILDING_REFUGEE_CAMP', 'BUILDING_ELEMENTAL_CONFLUX',
]);

/** Every minimap icon by the name the drawer asks for, as BGRA bitmaps. */
export function loadMinimapIcons(dataRoot: string): Map<string, Bitmap> {
  const root = parse(readFileSync(join(dataRoot, ICON_LIST), 'utf8'));
  const list = find(root, 'WindowRelatedTextures');
  const textures = list ? find(list, 'textures') : null;
  const out = new Map<string, Bitmap>();
  if (!textures) return out;
  for (const item of findAll(textures, 'Item')) {
    const name = childText(item, 'TextureName');
    const href = find(item, 'Texture')?.attrs['href'];
    if (!name || !href) continue;
    const docPath = href.split('#')[0]!.replace(/^\/+/, '');
    const doc = parse(readFileSync(join(dataRoot, docPath), 'utf8'));
    const dest = find(doc, 'Texture');
    const file = dest ? find(dest, 'DestName')?.attrs['href'] : undefined;
    if (!file) continue;
    const dir = docPath.slice(0, docPath.lastIndexOf('/') + 1);
    const image = decodeDDS(join(dataRoot, dir + file));
    // The port keeps the engine's byte order, which is what the .dds stores.
    const data = new Uint8Array(image.rgba.length);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = image.rgba[i + 2]!;
      data[i + 1] = image.rgba[i + 1]!;
      data[i + 2] = image.rgba[i]!;
      data[i + 3] = image.rgba[i + 3]!;
    }
    out.set(name, { width: image.width, height: image.height, data });
  }
  return out;
}

/** `0xDCFF70` then `0xDCFB00` — where an object's icon is centred, in pixels. */
export function iconAnchor(obj: IconObject, side: number, border: number): readonly [number, number] {
  const offs = rotateOffsets([...obj.blocked, ...obj.active], obj.rot);
  let sx = 0, sy = 0;
  for (const [dx, dy] of offs) {
    sx += dx;
    sy += dy;
  }
  const n = offs.length || 1;
  const ax = Math.trunc(obj.x) + sx / n;
  const ay = Math.trunc(obj.y) + sy / n;
  const span = side - 2 * border;
  return [(ax - border) * MINIMAP_SIDE / span, MINIMAP_SIDE - (ay - border) * MINIMAP_SIDE / span];
}

/** The 256x256 icon layer: zero everywhere the icons do not reach. */
export function drawIconLayer(
  objects: readonly IconObject[], icons: ReadonlyMap<string, Bitmap>, side: number, border: number,
): Bitmap {
  const data = new Uint8Array(MINIMAP_SIDE * MINIMAP_SIDE * 4);
  for (const obj of objects) {
    const icon = icons.get(obj.name);
    if (!icon) continue;
    const [px, py] = iconAnchor(obj, side, border);
    const left = Math.trunc(px) - Math.trunc(icon.width / 2);
    const top = Math.trunc(py) - Math.trunc(icon.height / 2);
    for (let y = 0; y < icon.height; y++) {
      const ty = top + y;
      if (ty < 0 || ty >= MINIMAP_SIDE) continue;
      for (let x = 0; x < icon.width; x++) {
        const tx = left + x;
        if (tx < 0 || tx >= MINIMAP_SIDE) continue;
        const from = (y * icon.width + x) * 4;
        if (icon.data[from + 3] === 0) continue;
        const to = (ty * MINIMAP_SIDE + tx) * 4;
        data[to] = icon.data[from]!;
        data[to + 1] = icon.data[from + 1]!;
        data[to + 2] = icon.data[from + 2]!;
        data[to + 3] = icon.data[from + 3]!;
      }
    }
  }
  return { width: MINIMAP_SIDE, height: MINIMAP_SIDE, data };
}
