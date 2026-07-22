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

import { parse, serialize, find, findAll, children, text, childText, setText, setAttr } from './xml.ts';
import type { XmlElement, XmlNode } from './xml.ts';
import { applyDefaults } from './defaults.ts';
import type { DefaultsOptions } from './defaults.ts';

/** A map-space object position: tile coordinates plus height. */
export interface MapPos {
  x: number;
  y: number;
  z: number;
}

/** Object-type name -> number of objects of that type (see typeCounts()). */
export type TypeCounts = Record<string, number>;

// Every advanced-map object type, by frequency across the game's maps.
// AdvMapStand is the tail: one object (Tieru's Hut) in two ToE campaign maps,
// which is why it went unnoticed until the catalogue offered it. Confirmed
// against the game's own type spec — see src/typespec.ts.
export const OBJECT_TYPES: string[] = [
  'AdvMapStatic', 'AdvMapTreasure', 'AdvMapMonster', 'AdvMapBuilding', 'AdvMapMine',
  'AdvMapArtifact', 'AdvMapDwelling', 'AdvMapShrine', 'AdvMapHero', 'AdvMapTown',
  'AdvMapGarrison', 'AdvMapAbanMine', 'AdvMapShipyard', 'AdvMapSign', 'AdvMapTent',
  'AdvMapHillFort', 'AdvMapDwarvenWarren', 'AdvMapSeerHut', 'AdvMapPrison',
  'AdvMapCartographer', 'AdvMapSphinx', 'AdvMapStand',
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
  /** The map this belongs to, for questions only the whole file can answer. */
  private owner: HommMap | null;

  constructor(itemEl: XmlElement, bodyEl: XmlElement, owner: HommMap | null = null) {
    this.item = itemEl;   // <Item href="#n:inline(Type)" id="...">
    this.el = bodyEl;     // <AdvMapType> body
    this.type = bodyEl.name;
    this.id = itemEl.attrs.id || null;
    this.owner = owner;
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

  /** The script handle Lua and other fields address this object by. Empty on
   *  the objects the original editor placed; never empty on ours — see
   *  HommMap.nextName(). */
  get name(): string { return childText(this.el, 'Name'); }

  // Owning player, where the object has one (towns, heroes, mines…).
  get player(): string | null { return childText(this.el, 'PlayerID') || null; }

  // Shared-definition href (points at the (AdvMap*Shared).xdb that carries the
  // model/footprint/behaviour). Present on most placeable objects.
  get shared(): string | null {
    const s = find(this.el, 'Shared');
    return s ? (s.attrs.href || null) : null;
  }

  /**
   * The object's simple fields, as a flat editable list.
   *
   * Read from the DOM rather than from a per-type schema. There are 22 object
   * types with wildly different fields, and a hand-written table for each would
   * be 22 chances to miss one and to drift from the game's own data — while the
   * file already says what an object has. Anything a text box can honestly edit
   * is included; nested structures (a town's buildings, a hero's army, trigger
   * blocks) have children and are left to the typed editors of Phase 4.
   *
   * `Pos`, `Rot` and `Floor` are excluded: they have their own controls, and
   * two ways to set the same value is one way to make them disagree.
   */
  props(): ObjectProp[] {
    // One rule, shared with the map root — see simpleFields(). An empty
    // structure (`<pointLights/>`, `<armySlots/>`) looks exactly like an empty
    // string, so a field is a value only if it is never a container anywhere in
    // this map; measured across the shipped maps, no name is ever both, and the
    // tempting shortcut of judging by capitalisation is not decidable (8 of 19
    // containers start lowercase, and `spellID` is a value).
    const containers = this.owner?.containerFields();
    return simpleFields(this.el, (n) => !!containers?.has(n), { skip: POS_FIELDS });
  }

  /** Set one simple field by element name. False when it is not a simple field. */
  setProp(name: string, value: string): boolean {
    if (POS_FIELDS.has(name)) return false;
    if (this.owner?.containerFields().has(name)) return false;
    const el = find(this.el, name);
    if (!el || children(el).length || el.attrs.href !== undefined) return false;
    setText(el, value);
    return true;
  }
}

/** What addObject needs to place something. */
export interface NewObject {
  /** Element name, e.g. 'AdvMapStatic'. */
  type: string;
  /** Shared-definition href, straight from the palette entry. */
  shared: string;
  x: number;
  y: number;
  z?: number;
  r?: number;
  floor?: number;
  /** Script handle. Generated (`MONSTER_001`) when absent, and auto-suffixed
   *  when the one asked for is already in use — never left empty. */
  name?: string;
  /**
   * An `<Item>` of the same type, as text, to use when this map has no object
   * of that type to copy. See src/donors.ts — the shipped maps supply these.
   */
  donor?: string;
  /**
   * The full roster behind an x-registry name, for the one default that is
   * "everything the installation has" (a town's guild spells). See
   * src/defaults.ts; omitted, that field keeps whatever the donor had.
   */
  roster?: DefaultsOptions['roster'];
}

/**
 * `wanted`, or the first `wanted_2`, `wanted_3`… that nobody holds.
 *
 * Suffixing rather than refusing: the caller asked for a name, and the useful
 * answer to "that one is taken" is a name it can have, not an error in the
 * middle of placing an object.
 */
function uniqueName(wanted: string, taken: Set<string>): string {
  if (!taken.has(wanted)) return wanted;
  let n = 2;
  while (taken.has(`${wanted}_${n}`)) n++;
  return `${wanted}_${n}`;
}

/** The whitespace on the line an element sits on, read from its parent. */
function indentBefore(parent: XmlElement, el: XmlElement): string | null {
  const i = parent.children.indexOf(el);
  const prev = i > 0 ? parent.children[i - 1] : null;
  return prev && prev.type === 'text' && /^\s*$/.test(prev.text) ? prev.text : null;
}

/** Deep copy of an element, so a clone shares no nodes with its donor. */
function cloneElement(el: XmlElement): XmlElement {
  return {
    ...el,
    attrs: { ...el.attrs },
    children: el.children.map((c) => (c.type === 'element' ? cloneElement(c) : { ...c })),
    // The copy is new, so nothing about it can be "unchanged since parsing".
    _dirtyAttrs: true,
  } as XmlElement;
}

/**
 * A GUID in the shape the maps use: `item_` plus an upper-case hyphenated UUID.
 *
 * Version-4 random, matching what the original editor writes. It has to be
 * unique rather than merely new-looking: the id is the handle the renderer and
 * every edit path uses to find an object again.
 */
function uuid(): string {
  const b = new Uint8Array(16);
  for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0').toUpperCase()).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
/**
 * Parse a donor `<Item>` taken from another map into a fresh element tree.
 *
 * Returns null rather than throwing on anything unexpected: a donor is a
 * convenience, and failing to read one should fall back to the skeleton, not
 * refuse the placement.
 */
function parseDonor(xml: string, type: string): XmlElement | null {
  try {
    const item = find(parse(xml), 'Item');
    if (!item) return null;
    // It has to actually contain the type asked for; a mismatched donor would
    // write a monster where a building was wanted.
    return children(item).some((c) => c.name === type) ? item : null;
  } catch { return null; }
}

/**
 * The bare `<Item><AdvMapX>…</AdvMapX></Item>` every object type shares.
 *
 * Used only when the map has no object of this type to copy, which is the
 * uncommon case. Deliberately minimal rather than guessed-at: writing fields we
 * have not verified would be inventing data, whereas leaving them out is a
 * visible gap. Type-specific defaults are Phase 4.
 */
function skeletonItem(type: string): XmlElement {
  const el = (name: string, kids: XmlNode[] = [], attrs: Record<string, string> = {}): XmlElement =>
    ({ type: 'element', name, attrs, children: kids, _dirtyAttrs: true } as XmlElement);
  const nl = (indent: number): XmlNode => ({ type: 'text', text: '\n' + '\t'.repeat(indent) } as XmlNode);
  const leaf = (name: string, value = '', indent = 4): XmlNode[] => [
    nl(indent),
    value
      ? el(name, [{ type: 'text', text: value } as XmlNode])
      : ({ ...el(name), selfClose: true } as XmlElement),
  ];
  const num = (name: string, v: number): XmlNode[] => leaf(name, String(v), 5);

  const pos = el('Pos', [...num('x', 0), ...num('y', 0), ...num('z', 0), nl(4)]);
  const body = el(type, [
    nl(4), pos,
    ...leaf('Rot', '0'),
    ...leaf('Floor', '0'),
    ...leaf('Name'),
    nl(4), { ...el('Shared', [], { href: '' }), selfClose: true } as XmlElement,
    nl(3),
  ]);
  return el('Item', [nl(3), body, nl(2)], { href: `#n:inline(${type})`, id: '' });
}

/** Fields with dedicated controls, kept out of the generic property list. */
const POS_FIELDS = new Set(['Pos', 'Rot', 'Floor']);

/**
 * Field names that hold a structure, measured across all 109 shipped maps.
 *
 * Per-map detection alone is not enough: a field that happens to be empty in
 * every object of the open map looks like a string there, and `<LinkToTown/>`
 * or `<BannedRaces/>` would be offered as a text box. This is the union of what
 * was ever seen carrying children anywhere, so it covers those too.
 *
 * Measured, not guessed, and the measurement was worth making: across those
 * maps NO name is ever both a container and a value, so the two sources cannot
 * contradict each other. The failure mode is also the safe one — a name listed
 * here in error only withholds an editor, it never writes a bad value.
 */
const KNOWN_CONTAINERS = new Set([
  'AdditionalStacks', 'AvailableResources', 'BannedRaces', 'CaptureTrigger',
  'CreaturesUpgradesFilter', 'Editable', 'GarrisonHero', 'HeroDeployTrigger',
  'LinkToTown', 'LossTrigger', 'Pos', 'PrisonedHero', 'Quest', 'Resources',
  'ShipTile', 'Textures', 'armySlots', 'artifactIDs', 'buildings',
  'creaturesEnabled', 'isUntransferable', 'pointLights', 'relationsOverrides',
  'showCameras', 'spellIDs',
]);

/**
 * Direct children of `<AdvMapDesc>` that hold a structure or list, even when
 * empty. Measured across the shipped SingleMission/Multiplayer maps: the ones
 * that ever carried element children, plus the always-empty lists whose tree
 * icon says "list" (`disabledArtifactSets`, `RacesRandomGroups`,
 * `AdditionallyRollableHeroes`). Withholding an editor is the safe error — a
 * text box for `<players/>` would turn a list into a string.
 */
const MAP_ROOT_CONTAINERS = new Set([
  'AvailableHeroes', 'GroundAmbientLights', 'ImportantArtifacts', 'MapRumours',
  'MoonCalendarModifications', 'NewDayTrigger', 'Objectives', 'Resources',
  'ScenarioInformation', 'UndergroundAmbientLights', 'WarFogEnterTrigger',
  'artifactIDs', 'dialogs', 'isUntransferable', 'moons', 'objects', 'players',
  'regions', 'sRMGProps', 'spellIDs', 'thumbnailImages', 'tiles',
  'disabledArtifactSets', 'RacesRandomGroups', 'AdditionallyRollableHeroes',
]);

/**
 * Map-root fields shown but never edited here: the dimensions and format
 * version. Changing TileX/TileY without resizing the terrain grid corrupts the
 * map, and Version is the file format's, not the author's — both are read-only.
 */
const MAP_READONLY_FIELDS = new Set(['Version', 'TileX', 'TileY']);

/** What kind of editor a field's current value suggests. */
export type PropKind = 'bool' | 'number' | 'enum' | 'text' | 'href';

/** One simple field of an object, as shown in the property panel. */
export interface ObjectProp {
  name: string;
  value: string;
  kind: PropKind;
  /**
   * Shown but not editable. `href` refs are always read-only (typing a path by
   * hand is not an honest editor). The map root also marks its dimensions and
   * empty asset/enum placeholders read-only — see HommMap.mapProps().
   */
  readonly?: boolean;
}

/**
 * Guess an editor from the value.
 *
 * The format carries no types, so this reads them off the data: `true`/`false`
 * are booleans, bare numbers are numbers, and SHOUTING_SNAKE_CASE is one of the
 * game's enums (`MONSTER_MOOD_AGGRESSIVE`, `ATTACK_ANY`). An enum is offered as
 * text, since the legal set lives in the game's own data rather than here — a
 * dropdown with a guessed list would be worse than an honest text box.
 */
function kindOf(v: string): PropKind {
  if (v === 'true' || v === 'false') return 'bool';
  if (v !== '' && /^-?\d+(\.\d+)?$/.test(v)) return 'number';
  if (/^[A-Z][A-Z0-9_]{2,}$/.test(v)) return 'enum';
  return 'text';
}

/**
 * The simple (editable-value) fields of an element, by one rule used everywhere:
 * a direct child that is neither a populated structure, a known-but-empty
 * container, nor an asset reference is a value; everything else is shown or
 * skipped. Shared by an object's panel and the map root's, so both read fields
 * from the file rather than from a per-type table.
 *
 * @param isContainer  names that hold a structure even when they are empty (an
 *   empty `<players/>` looks exactly like an empty string otherwise).
 * @param skip         names with their own dedicated controls (an object's Pos).
 * @param readonly     extra "show, don't edit" rule on top of href — the map
 *   root uses it for dimensions and empty ref/enum placeholders.
 */
function simpleFields(
  el: XmlElement,
  isContainer: (name: string) => boolean,
  opts: { skip?: Set<string>; readonly?: (name: string, value: string) => boolean } = {},
): ObjectProp[] {
  const out: ObjectProp[] = [];
  for (const c of children(el)) {
    if (opts.skip?.has(c.name)) continue;
    if (children(c).length) continue;
    if (isContainer(c.name)) continue;
    if (c.attrs.href !== undefined) {
      out.push({ name: c.name, value: c.attrs.href, kind: 'href', readonly: true });
      continue;
    }
    const v = text(c);
    out.push({ name: c.name, value: v, kind: kindOf(v), readonly: opts.readonly?.(c.name, v) || false });
  }
  return out;
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
  /** Cached container-field names; see containerFields(). */
  private _containers: Set<string> | null = null;

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
    // The ref is an href on the element itself (`<GroundTerrainFileName href=…/>`),
    // with a nested `<FileName href>` or plain text as older/alternate forms.
    return el ? (el.attrs.href || find(el, 'FileName')?.attrs.href || text(el)) : null;
  }
  // Lua map script binding (Phase 5 builds on this).
  get mapScript(): string | null {
    const el = find(this.desc, 'MapScript');
    return el ? (el.attrs.href || find(el, 'FileName')?.attrs.href || text(el) || null) : null;
  }
  // The visible name and description live in sibling text files the map points
  // at, not in the XML. Return the href so the caller can resolve and read them.
  get nameFileRef(): string { return find(this.desc, 'NameFileRef')?.attrs.href || ''; }
  get descriptionFileRef(): string { return find(this.desc, 'DescriptionFileRef')?.attrs.href || ''; }

  // --- map-root properties (the original's map settings tree) ---
  /**
   * The map's own simple fields — the direct leaves of `<AdvMapDesc>`, by the
   * same rule as an object's ([[simpleFields]]). Its containers (players,
   * Resources, Objectives…) are withheld by MAP_ROOT_CONTAINERS; dimensions and
   * empty asset/enum placeholders come back read-only, since a free-text box
   * would let one write a bad reference where the original offers a picker.
   */
  mapProps(): ObjectProp[] {
    return simpleFields(this.desc, (n) => MAP_ROOT_CONTAINERS.has(n), {
      readonly: (name, v) => MAP_READONLY_FIELDS.has(name) || v === '',
    });
  }

  /** Set one map-root simple field. False when it is not an editable value. */
  setMapProp(name: string, value: string): boolean {
    if (MAP_READONLY_FIELDS.has(name) || MAP_ROOT_CONTAINERS.has(name)) return false;
    const el = find(this.desc, name);
    if (!el || children(el).length || el.attrs.href !== undefined) return false;
    setText(el, value);
    return true;
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
        if (body) list.push(new MapObject(item, body, this));
      }
    }
    this._objects = list;
    return list;
  }

  objectsOfType(type: string): MapObject[] { return this.objects.filter((o) => o.type === type); }

  /** Every script handle in use on the map, so a new one can avoid them. */
  namesInUse(): Set<string> {
    const out = new Set<string>();
    for (const o of this.objects) { const n = o.name; if (n) out.add(n); }
    return out;
  }

  /**
   * A free script handle for a new object of `type`: `MONSTER_001`, `SEER_HUT_002`.
   *
   * The original editor leaves a new object's `<Name>` empty, and we
   * deliberately do not. The handle is how Lua and half the map's own fields
   * (a quest target, a town's LinkToTown, SetObjectOwner) address the object;
   * an empty one cannot be referenced at all and a duplicate silently makes two
   * objects answer to one reference — the failure lands in the script, far from
   * the placement that caused it. See docs/NAMES_AND_SCRIPTING.md.
   *
   * Numbering continues from the highest suffix IN USE, which means a handle
   * freed by a deletion is handed out again. The map is the only state there
   * is — a high-water mark would have to be stored somewhere the original
   * editor would not preserve — so this is a limit, not a design: a script that
   * still names the deleted `MONSTER_002` will address the next one placed.
   * Catching that is the script lint's job (Phase 5), where both directions of
   * the question live: names used but not defined, and names silently reused.
   */
  nextName(type: string, taken: Set<string> = this.namesInUse()): string {
    // AdvMapSeerHut -> SEER_HUT: the type without the prefix, in the same
    // upper-snake shape as the game's own identifiers.
    const prefix = type.replace(/^AdvMap/, '').replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
    let max = 0;
    const re = new RegExp(`^${prefix}_(\\d+)$`);
    for (const n of taken) { const m = re.exec(n); if (m) max = Math.max(max, +m[1]!); }
    let n = max + 1;
    // A hand-typed name can collide with the pattern without matching it above
    // (different padding, say), so the result is still checked.
    while (taken.has(`${prefix}_${String(n).padStart(3, '0')}`)) n++;
    return `${prefix}_${String(n).padStart(3, '0')}`;
  }

  /**
   * Field names that hold a structure rather than a value, learned from this map.
   *
   * An empty `<pointLights/>` is indistinguishable from an empty string when you
   * look at one object, so the answer comes from every object at once: if the
   * name ever carries element children here, it is a container everywhere.
   * Across 40 shipped maps no field name is ever both, so this does not have to
   * pick a winner.
   *
   * Cached, and invalidated with the object list, since it is a fact about the
   * current tree.
   */
  containerFields(): Set<string> {
    if (this._containers) return this._containers;
    // Seeded with what the shipped maps taught us, then widened by this map —
    // so a mod's own structure field is caught even though it is in no list.
    const s = new Set<string>(KNOWN_CONTAINERS);
    for (const o of this.objects) {
      for (const c of children(o.el)) if (children(c).length) s.add(c.name);
    }
    this._containers = s;
    return s;
  }

  // Count objects by type — a quick map summary.
  typeCounts(): TypeCounts {
    const c: TypeCounts = {};
    for (const o of this.objects) c[o.type] = (c[o.type] || 0) + 1;
    return c;
  }

  /**
   * Place a new object on the map.
   *
   * The body is a CLONE of an existing object of the same type whenever the map
   * has one, with only position, rotation, name and shared reference replaced.
   * That is not laziness: an object's field set differs per type and per game
   * version, a mod can add fields of its own, and the surest description of
   * what a valid AdvMapMonster looks like in THIS map is an AdvMapMonster
   * already in it. Cloning also inherits the file's own indentation.
   *
   * The clone is then put into the state the ORIGINAL editor writes a new
   * object in — a donor is an object somebody designed, so cloning it and
   * stopping there would hand on their monster count and their town's
   * buildings. The values come from the schema, measured off a map the original
   * saved (src/defaults.ts, docs/OBJECT_DEFAULTS.md).
   *
   * With no donor, a minimal skeleton is written instead — the fields every
   * object type shares. That is enough for the editor to carry it and for it to
   * round-trip, but it is NOT a complete object: the type-specific fields are
   * missing, so there is nothing for the defaults to be written into either.
   * `complete` says which of the two you got.
   */
  addObject(spec: NewObject): { object: MapObject; complete: boolean } {
    const objectsEl = this.objectsEl;
    if (!objectsEl) throw new Error('this map has no <objects> list');
    // This map first: an object already here is the surest example of what a
    // valid one looks like in THIS map's version. Then a donor from the game's
    // own maps. The skeleton is the last resort and is knowingly incomplete.
    const local = this.objects.find((o) => o.type === spec.type);
    const external = !local && spec.donor ? parseDonor(spec.donor, spec.type) : null;
    const item = local ? cloneElement(local.item) : external ?? skeletonItem(spec.type);
    const complete = !!(local || external);
    const body = children(item).find((c) => c.name === spec.type);
    if (!body) throw new Error(`could not build a ${spec.type} body`);

    // The donor gave the field SET; the schema gives the values. Without this a
    // new town would arrive with the donor designer's 21 buildings and a new
    // monster with their stack of 4 — see src/defaults.ts.
    applyDefaults(body, spec.type, { roster: spec.roster });

    // A fresh identity: reusing the donor's id would give two objects the same
    // handle, and the renderer keys its meshes by it.
    setAttr(item, 'id', `item_${uuid()}`);
    const shared = find(body, 'Shared');
    if (shared) setAttr(shared, 'href', spec.shared);
    const obj = new MapObject(item, body, this);
    obj.setPos(spec.x, spec.y, spec.z ?? 0);
    obj.setRot(spec.r ?? 0);
    obj.setFloor(spec.floor ?? 0);
    // A handle of its own. The donor's would otherwise be copied over, and two
    // objects answering to one name is worse than none doing so — but so is the
    // empty name the original leaves behind, which no script can address. A
    // caller-supplied name is honoured, and only auto-suffixed if it is taken.
    const name = find(body, 'Name');
    if (name) {
      const taken = this.namesInUse();
      setText(name, spec.name ? uniqueName(spec.name, taken) : this.nextName(spec.type, taken));
    }

    // Indent like the item before it, so the file keeps its shape.
    const arr = objectsEl.children;
    if (!arr.length) {
      // The first object on a map that has none: `<objects/>` has to become a
      // pair of tags, and there is no sibling to copy the indentation from, so
      // it is taken from the line `<objects>` itself sits on.
      const close = indentBefore(this.desc, objectsEl) ?? '\n\t';
      objectsEl.selfClose = false;
      arr.push({ type: 'text', text: close + '\t' }, item, { type: 'text', text: close });
    } else {
      const last = arr[arr.length - 1];
      if (last && last.type === 'text') arr.splice(arr.length - 1, 0, item, { type: 'text', text: last.text });
      else arr.push(item);
    }
    this._objects = null;
    this._containers = null;
    return { object: obj, complete };
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
    this._containers = null;
    return true;
  }

  // --- serialize ---
  save(): string { return serialize(this.doc); }
}
