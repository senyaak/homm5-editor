// Map data model — a typed, editable view over a HoMM5 `map.xdb`.
//
// Built on the loss-less XML DOM (src/xml.js): the model navigates and mutates
// that tree in place, so any object we don't touch re-serializes byte-for-byte.
// This is the backbone of the editor — every higher layer (3D scene, property
// panels, validation) reads and edits maps through here.
//
// A map file is `<AdvMapDesc>` with a header (dimensions, floors, terrain file,
// players, goal, script…) and an `<objects>` list of `<Item>` wrappers, each
// holding one `AdvMap<Type>` element (Static, Town, Hero, Monster, Treasure,
// Mine, Artifact, Dwelling, …). See OBJECT_TYPES for the full set.
//
// The model exposes:
//   * header fields (tileX/tileY/floors/terrain/heroMaxLevel/mapScript…),
//   * a normalized object list ({type, id, pos, rot, floor, player, shared, el}),
//   * edits (setPos/setRot/setFloor/remove) that write through the DOM,
//   * save() -> text (byte-identical for untouched content).
//
// Type-specific object properties (town buildings, hero army, monster count…)
// are reached via the object's `el` DOM node and land as typed accessors in the
// Phase 4 "parity" work; Phase 1's job is a faithful, enumerable, editable model.

import { parse, serialize, find, findAll, children, text, childText, setText } from './xml.ts';
import type { XmlElement } from './xml.ts';

/** A map-space object position: tile coordinates plus height. */
export interface MapPos {
  x: number;
  y: number;
  z: number;
}

/** Object-type name -> number of objects of that type (see typeCounts()). */
export type TypeCounts = Record<string, number>;

// Every advanced-map object type seen across the game's maps, by frequency.
export const OBJECT_TYPES: string[] = [
  'AdvMapStatic', 'AdvMapTreasure', 'AdvMapMonster', 'AdvMapBuilding', 'AdvMapMine',
  'AdvMapArtifact', 'AdvMapDwelling', 'AdvMapShrine', 'AdvMapHero', 'AdvMapTown',
  'AdvMapGarrison', 'AdvMapAbanMine', 'AdvMapShipyard', 'AdvMapSign', 'AdvMapTent',
  'AdvMapHillFort', 'AdvMapDwarvenWarren', 'AdvMapSeerHut', 'AdvMapPrison',
  'AdvMapCartographer', 'AdvMapSphinx',
];
const OBJECT_TYPE_SET = new Set<string>(OBJECT_TYPES);

/**
 * Parse map.xdb text (read as latin1 to preserve bytes) into a Map model.
 * Pass the raw string; callers read the file with encoding 'latin1'.
 */
export function loadMap(xmlText: string): HommMap {
  const doc = parse(xmlText);
  const desc = find(doc, 'AdvMapDesc');
  if (!desc) throw new Error('not a map.xdb (no <AdvMapDesc> root)');
  return new HommMap(doc, desc);
}

// A single advanced-map object, wrapping its DOM nodes so edits stay in the tree.
export class MapObject {
  /** <Item href="#n:inline(Type)" id="..."> wrapper. */
  item: XmlElement;
  /** <AdvMapType> body element carrying this object's fields. */
  el: XmlElement;
  /** Body element name, one of OBJECT_TYPES (e.g. 'AdvMapTown'). */
  type: string;
  /** `id` attribute of the <Item> wrapper, when the map assigns one. */
  id: string | null;

  constructor(itemEl: XmlElement, bodyEl: XmlElement) {
    this.item = itemEl;   // <Item href="#n:inline(Type)" id="...">
    this.el = bodyEl;     // <AdvMapType> body
    this.type = bodyEl.name;
    this.id = itemEl.attrs.id || null;
  }

  get pos(): MapPos | null {
    const p = find(this.el, 'Pos');
    if (!p) return null;
    return { x: +childText(p, 'x'), y: +childText(p, 'y'), z: +childText(p, 'z') };
  }
  setPos(x: number, y: number, z?: number): boolean {
    const p = find(this.el, 'Pos'); if (!p) return false;
    // Hoisted so a <Pos> missing its leaf fields is reported instead of throwing
    // (and instead of writing x before failing on y).
    const xEl = find(p, 'x'), yEl = find(p, 'y');
    if (!xEl || !yEl) return false;
    setText(xEl, x); setText(yEl, y);
    if (z !== undefined) { const zEl = find(p, 'z'); if (zEl) setText(zEl, z); }
    return true;
  }

  get rot(): number { const r = find(this.el, 'Rot'); return r ? +text(r) : 0; }
  setRot(v: number): boolean { const r = find(this.el, 'Rot'); if (r) setText(r, v); return !!r; }

  get floor(): number { return +childText(this.el, 'Floor') || 0; }
  setFloor(v: number): boolean { const f = find(this.el, 'Floor'); if (f) setText(f, v); return !!f; }

  // Owning player, where the object has one (towns, heroes, mines…).
  get player(): string | null { return childText(this.el, 'PlayerID') || null; }

  // Shared-definition href (points at the (AdvMap*Shared).xdb that carries the
  // model/footprint/behaviour). Present on most placeable objects.
  get shared(): string | null {
    const s = find(this.el, 'Shared');
    return s ? (s.attrs.href || null) : null;
  }
}

export class HommMap {
  /** Parse root ('#document'), kept so save() re-emits the whole file. */
  doc: XmlElement;
  /** <AdvMapDesc> root element holding header fields and <objects>. */
  desc: XmlElement;
  /** <objects> list element, absent on (malformed) maps without one. */
  objectsEl: XmlElement | null;
  /** Lazily built object list; invalidated on structural edits. */
  private _objects: MapObject[] | null;

  constructor(doc: XmlElement, desc: XmlElement) {
    this.doc = doc;
    this.desc = desc;
    this.objectsEl = find(desc, 'objects');
    this._objects = null;
  }

  // --- header ---
  get tileX(): number { return +childText(this.desc, 'TileX'); }
  get tileY(): number { return +childText(this.desc, 'TileY'); }
  get version(): number { return +childText(this.desc, 'Version'); }
  get hasUnderground(): boolean { return childText(this.desc, 'HasUnderground') === 'true'; }
  get hasSurface(): boolean { return childText(this.desc, 'HasSurface') === 'true'; }
  get heroMaxLevel(): number { return +childText(this.desc, 'HeroMaxLevel') || 0; }
  get terrainFile(): string | null {
    const el = find(this.desc, 'GroundTerrainFileName');
    // Terrain filename is stored as a <FileName href="..."> or plain text ref.
    return el ? (find(el, 'FileName')?.attrs.href || text(el)) : null;
  }
  // Lua map script binding (Phase 5 builds on this).
  get mapScript(): string | null {
    const el = find(this.desc, 'MapScript');
    return el ? (find(el, 'FileName')?.attrs.href || text(el) || null) : null;
  }

  // --- objects ---
  get objects(): MapObject[] {
    if (this._objects) return this._objects;
    const list: MapObject[] = [];
    if (this.objectsEl) {
      for (const item of children(this.objectsEl)) {
        if (item.name !== 'Item') continue;
        // The body is the first child element that is a known AdvMap* type.
        const body = children(item).find((c) => OBJECT_TYPE_SET.has(c.name)) || children(item)[0];
        if (body) list.push(new MapObject(item, body));
      }
    }
    this._objects = list;
    return list;
  }

  objectsOfType(type: string): MapObject[] { return this.objects.filter((o) => o.type === type); }

  // Count objects by type — a quick map summary.
  typeCounts(): TypeCounts {
    const c: TypeCounts = {};
    for (const o of this.objects) c[o.type] = (c[o.type] || 0) + 1;
    return c;
  }

  // Remove an object (its whole <Item> wrapper) from the tree.
  remove(obj: MapObject): boolean {
    const objectsEl = this.objectsEl;
    if (!objectsEl) return false;
    const arr = objectsEl.children;
    const idx = arr.indexOf(obj.item);
    if (idx === -1) return false;
    // Also drop the trailing whitespace text node that followed the item, so
    // indentation stays clean (the preceding text node keeps the newline).
    const next = arr[idx + 1];
    if (next && next.type === 'text' && /^\s*$/.test(next.text)) arr.splice(idx, 2);
    else arr.splice(idx, 1);
    this._objects = null;
    return true;
  }

  // --- serialize ---
  save(): string { return serialize(this.doc); }
}
