// The objects placed on a map: the catalogue they come from, putting one down,
// moving it, reading and setting its simple fields, taking it away.
//
// Every mutation goes through record(), so it shares undo, dirty and save with
// every other edit.

import { ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { record } from '#electron/edits.ts';
import type { AddObjectPayload, AddObjectResult, IconPayload, IconResult, MoveObjectPayload, MoveObjectResult, ObjectCatalogResult, ObjectEditResult, ObjectPropsResult, RemoveObjectPayload, RotateObjectPayload, SetPropPayload, SpecValuesPayload, SpecValuesResult } from '#electron/ipc.ts';
import { editorRoot, gameData, mountedAssets } from '#electron/paths.ts';
import { orderFor, valuesFor } from '#electron/spec.ts';
import { findObject, need } from '#electron/state.ts';
import type { Session } from '#electron/state.ts';
import { readFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { decodeDDS } from '#src/dds.ts';
import { createField } from '#src/defaults.ts';
import { donorFor } from '#src/donors.ts';
import { MapObject } from '#src/map.ts';
import type { ObjectProp } from '#src/map.ts';
import { iconPathFor, listPlaceable, readIconFile } from '#src/objects.ts';
import { pngDataUri } from '#src/scene.ts';
import { controlOf, deref, objectProps, objectSchema } from '#src/schema.ts';
import type { FieldSchema, RegistryName } from '#src/schema.ts';
import { find } from '#src/xml.ts';

/** The object catalogue, scanned once — 1466 small files is not a per-call cost. */
let catalogCache: ReturnType<typeof listPlaceable> | null = null;

function catalog(): ReturnType<typeof listPlaceable> {
  // Through the mounted chain, so a mod's palette entries are in the catalogue.
  if (!catalogCache) catalogCache = listPlaceable(mountedAssets(gameData()), editorRoot() || '');
  return catalogCache;
}

/**
 * Decode a texture a palette entry names, as a data URI.
 *
 * The href is a `.(Texture).xdb`, which is a description; the pixels are in the
 * `.dds` its `DestName` names, beside it. Anything that does not resolve — the
 * shipped links' authoring `.tga` paths, above all — is simply no icon.
 */
function linkTexture(href: string | undefined): IconResult {
  if (!href || !/\.xdb$/i.test(href)) return null;
  const data = mountedAssets(gameData());
  const rel = href.replace(/\\/g, '/').replace(/^\/+/, '');
  const xml = data.text(rel);
  if (!xml) return null;
  const dest = /<DestName href="([^"]+)"/.exec(xml)?.[1];
  if (!dest) return null;
  const dds = data.path(join(dirname(rel), dest).split(sep).join('/'));
  try {
    const img = decodeDDS(dds);
    return pngDataUri(img.width, img.height, img.rgba);
  } catch { return null; }
}

/**
 * The session's rosters, for the defaults that mean "everything the game has"
 * — a new town's guild-spell filter. Read from the installed data, so a mod's
 * spells are in it and a list frozen into the source would not be.
 */
function rosterFor(s: Session): (name: RegistryName) => string[] {
  return (name) => {
    switch (name) {
      case 'spells': return s.registry.spells().map((e) => e.id);
      case 'artifacts': return s.registry.artifacts().map((e) => e.id);
      case 'creatures': return s.registry.creatures().map((e) => e.id);
      case 'skills': return s.registry.skills().map((e) => e.id);
      case 'races': return s.registry.races().map((e) => e.id);
      default: return [];
    }
  };
}

// --- IPC: an object's simple fields, for the property panel ---
/** The editor kind for a field we are describing from the schema alone. */
function kindOf(f: FieldSchema): ObjectProp['kind'] {
  switch (controlOf(f)) {
    case 'checkbox': return 'bool';
    case 'number': return 'number';
    case 'ref': return 'href';
    case 'enum':
    case 'dropdown': return 'enum';
    default: return 'text';
  }
}

/**
 * Fields the type HAS but this object does not carry.
 *
 * An object is built by cloning a real one, so it has whatever field set that
 * donor's game version had — a seer hut from a campaign map has no CheckDelay.
 * The panel could only ever edit what was in the DOM, so such a field could not
 * be set at all. Offering it needs two independent yeses: the GAME'S spec says
 * the type has it (so we are not inventing a field), and our schema describes
 * it (so we know what shape to write).
 */
function absentProps(obj: MapObject): ObjectProp[] {
  const order = orderFor(obj.type);
  if (!order) return [];
  const declared = objectProps(obj.type);
  const out: ObjectProp[] = [];
  for (const name of order.names) {
    if (find(obj.el, name)) continue;
    const raw = declared[name];
    if (!raw) continue;
    const f = deref(objectSchema, raw);
    // Structures are not editable as a value here, in the DOM or out of it.
    if (f.type === 'object' || f.type === 'array') continue;
    out.push({ name, value: '', kind: kindOf(f), absent: true });
  }
  return out;
}

/** Wire this domain onto ipcMain. Called once, from main. */
export function registerObjects(): void {
  // --- IPC: move an object (x,y tiles); z stays the object's stored value ---
  ipcMain.handle('object:move', async (_e: IpcMainInvokeEvent, { id, x, y }: MoveObjectPayload): Promise<MoveObjectResult> => {
    const session = need();
    const obj = session.map.objects.find((o) => o.id === id);
    if (!obj) throw new Error(`object ${id} not found`);
    record(session, 'move object', { map: true }, () => obj.setPos(x, y));
    return { ok: true };
  });

  // --- IPC: rotate an object ---
  // An absolute angle rather than a delta, for the same reason the height brush
  // sends absolute heights: the renderer already worked out the answer, and
  // recomputing it here would be a second place for it to come out different.
  ipcMain.handle('object:rotate', async (_e: IpcMainInvokeEvent, { id, r }: RotateObjectPayload): Promise<ObjectEditResult> => {
    const session = need();
    const obj = findObject(session, id);
    record(session, 'rotate object', { map: true }, () => obj.setRot(r));
    return { ok: true };
  });

  // --- IPC: the placeable-object catalogue (the original's Objects tab) ---
  //
  // Two different roots, deliberately. The link files are game DATA, so they come
  // from the same unpacked root as every other asset; the filter list and icons
  // are editor CONFIG and live loose beside the game install, outside the paks.
  // A machine with the game installed but no unpacked data has icons and no
  // catalogue, and the other way round — so neither is assumed present.
  ipcMain.handle('objects:list', async (): Promise<ObjectCatalogResult> => {
    // [perf] First call scans the Editor folder from disk; warmed in the
    // background after a map opens, so a slow scan here can steal main-process
    // time from early edits. Timed to catch that.
    const tCat = performance.now();
    const cat = catalog();
    const dt = performance.now() - tCat;
    if (dt > 5) console.log(`[perf] objects:list ${dt | 0}ms · ${cat.objects.length} entries`);
    return {
      objects: cat.objects,
      groups: cat.groups.map((g) => ({ name: g.name, separator: g.separator })),
      hasEditor: !!editorRoot(),
    };
  });

  // --- IPC: one palette icon, decoded on demand ---
  // 1466 icons at 64x64 RGBA would be ~24 MB pushed across the bridge for a panel
  // showing a few dozen at a time, so they are fetched per tile as it scrolls in.
  ipcMain.handle('objects:icon', async (_e: IpcMainInvokeEvent, { path }: IconPayload): Promise<IconResult> => {
    const root = editorRoot();
    const file = root ? iconPathFor(root, path) : null;
    if (file) {
      try {
        const icon = readIconFile(readFileSync(file));
        // A few entries hold an image declared 0x0 — a placeholder with no picture.
        if (icon) return pngDataUri(icon.w, icon.h, icon.rgba);
      } catch { /* fall through to the entry's own texture */ }
    }
    // No cache entry. The cache is keyed by link path and only the game's own
    // installer writes it, so everything a MOD adds lands here — a blank tile
    // among 185 that have pictures. A link may name a texture instead, and a
    // creature's 128px icon is already in the mod beside its model.
    return linkTexture(catalog().objects.find((o) => o.path === path)?.iconFile);
  });

  // --- IPC: place a new object ---
  // The model writes the map side; the mesh is resolved here so the renderer can
  // show it at once. A model the scene has not seen before is sent along with the
  // instance, since the renderer's geometry list is built at load time.
  ipcMain.handle('object:add', async (_e: IpcMainInvokeEvent, p: AddObjectPayload): Promise<AddObjectResult> => {
    const session = need();
    const before = session.resolver.geoms.length;
    const gi = session.resolver.resolve(p.shared);
    if (gi < 0) throw new Error('this object has no model we can decode yet');
    // When this map has no object of the type to copy, borrow one from the
    // game's own maps rather than writing a half-empty skeleton.
    const donor = donorFor(gameData(), p.type);
    // Through record(), like every other edit: placing an object grows the map
    // document, and if that growth is not captured as a step then the next undo
    // finds the document a different size than its patch was taken from and throws
    // "patch does not fit". This was the one mutating handler that skipped it.
    const { object, complete } = record(session, 'add object', { map: true }, () =>
      session.map.addObject({
        type: p.type, shared: p.shared, x: p.x, y: p.y, floor: p.floor, r: p.r ?? 0,
        roster: rosterFor(session),
        order: orderFor(p.type),
        ...(donor ? { donor } : {}),
      }));
    const geomData = session.resolver.geoms[gi];
    return {
      instance: {
        id: object.id, type: object.type, g: gi, shared: p.shared.split('#')[0]!,
        x: p.x, y: p.y, z: 0, r: p.r ?? 0,
      },
      geom: gi >= before && geomData ? { index: gi, data: geomData } : null,
      complete,
    };
  });

  ipcMain.handle('object:props', async (_e: IpcMainInvokeEvent, { id }: RemoveObjectPayload): Promise<ObjectPropsResult> => {
    const session = need();
    const obj = findObject(session, id);
    return { type: obj.type, props: [...obj.props(), ...absentProps(obj)] };
  });

  // --- IPC: the legal values of a type's enum fields, from the game's spec ---
  ipcMain.handle('spec:values', async (_e: IpcMainInvokeEvent, { type }: SpecValuesPayload): Promise<SpecValuesResult> => {
    return { values: valuesFor(type) };
  });

  // --- IPC: set one simple field ---
  ipcMain.handle('object:set-prop', async (_e: IpcMainInvokeEvent, p: SetPropPayload): Promise<ObjectEditResult> => {
    const session = need();
    const obj = findObject(session, p.id);
    // A reference field (`x-ref`) is written as an href, even into a bare element
    // that has no attribute yet — a town's `<Specialization/>` set for the first
    // time. Text there would not resolve in the game.
    const raw = objectProps(obj.type)[p.name];
    const isRef = raw ? deref(objectSchema, raw)['x-ref'] === true : false;
    const done = record(session, `set ${p.name}`, { map: true }, () => {
      // Filling in a field the object never had: create it where the spec puts
      // it, then set it like any other. Recorded inside the same step, so undo
      // takes the field away again rather than leaving an empty one behind.
      if (!find(obj.el, p.name)) {
        const order = orderFor(obj.type);
        if (!order || !raw) return false;
        if (!createField(obj.el, p.name, order.names, isRef)) return false;
      }
      return obj.setProp(p.name, p.value, isRef);
    });
    if (!done) throw new Error(`${p.name} is not a simple field of this object`);
    return { ok: true };
  });

  // --- IPC: delete an object ---
  // `remove` takes out the whole <Item> wrapper and the blank line after it, so
  // the surrounding XML is left exactly as it was — which is also what lets the
  // recorded patch put it back byte for byte on undo.
  ipcMain.handle('object:remove', async (_e: IpcMainInvokeEvent, { id }: RemoveObjectPayload): Promise<ObjectEditResult> => {
    const session = need();
    const obj = findObject(session, id);
    const gone = record(session, 'delete object', { map: true }, () => session.map.remove(obj));
    if (!gone) throw new Error(`could not remove ${id}`);
    return { ok: true };
  });
}
