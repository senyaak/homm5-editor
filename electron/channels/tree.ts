// The map and its objects as trees, edited by path.
//
// The property panel edits simple fields; a STRUCTURE — a hero's army, a
// capture trigger, a monster's reward — has children and no honest text box.
// Both are reached with the same primitives (src/tree.ts), rooted at the map's
// <AdvMapDesc> or at one object's element.

import { ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { record } from '#electron/edits.ts';
import type { AddItemPayload, MapPropsResult, MapTreeResult, ObjectAddItemPayload, ObjectEditResult, ObjectRemoveItemPayload, ObjectSetPathPayload, ObjectTreePayload, ObjectTreeResult, RemoveItemPayload2, SetListPayload, SetMapPropPayload, SetPathPayload } from '#electron/ipc.ts';
import { readSidecarText } from '#electron/sidecar.ts';
import { findObject, need } from '#electron/state.ts';
import { deref, mapSchema, objectSchema, resolveObjectPath, resolveSchemaAtPath } from '#src/schema/schema.ts';
import { buildItem, isBuildable } from '#src/schema/skeleton.ts';
import { addRefItem, addStringItem, appendItem, indentText, nodeAt, readTree, removeItem, setList, setPath } from '#src/schema/tree.ts';

/** Wire this domain onto ipcMain. Called once, from main. */
export function registerTree(): void {
  // The whole <AdvMapDesc> as a tree, and path-based edits on it.
  // The tree editor reads the map's full shape once, then edits by path. Every
  // edit goes through record({map:true}), so the tree shares undo/dirty/save with
  // every other edit.
  ipcMain.handle('map:tree', async (): Promise<MapTreeResult> => {
    const session = need();
    return { tree: readTree(session.map.desc) };
  });

  ipcMain.handle('map:set-path', async (_e: IpcMainInvokeEvent, p: SetPathPayload): Promise<ObjectEditResult> => {
    const session = need();
    const done = record(session, `set ${p.path.join('.')}`, { map: true }, () => setPath(session.map.desc, p.path, p.value));
    if (!done) throw new Error(`cannot set ${p.path.join('.')}`);
    return { ok: true };
  });

  ipcMain.handle('map:add-item', async (_e: IpcMainInvokeEvent, p: AddItemPayload): Promise<ObjectEditResult> => {
    const session = need();
    const desc = session.map.desc;
    // A list of structures (rumours, players, army stacks) gets a full item built
    // from its schema with default values; a list of plain values gets <Item>v</Item>;
    // a list of references gets the href, which is where a reference lives.
    const arrField = resolveSchemaAtPath(mapSchema, p.path);
    const itemSchema = arrField?.items ? deref(mapSchema, arrField.items) : null;
    const done = record(session, `add ${p.path.join('.')}`, { map: true }, () => {
      if (isBuildable(itemSchema)) {
        const container = nodeAt(desc, p.path);
        if (!container) return false;
        return appendItem(desc, p.path, buildItem(mapSchema, itemSchema!, indentText(container)));
      }
      if (itemSchema?.['x-ref']) return addRefItem(desc, p.path, p.value ?? '');
      return addStringItem(desc, p.path, p.value ?? '');
    });
    if (!done) throw new Error(`cannot add to ${p.path.join('.')}`);
    return { ok: true };
  });

  ipcMain.handle('map:remove-item', async (_e: IpcMainInvokeEvent, p: RemoveItemPayload2): Promise<ObjectEditResult> => {
    const session = need();
    const done = record(session, `remove ${p.path.join('.')}`, { map: true }, () => removeItem(session.map.desc, p.path));
    if (!done) throw new Error(`cannot remove ${p.path.join('.')}`);
    return { ok: true };
  });

  // One object as a tree.
  //
  // The property panel edits an object's simple fields; its STRUCTURES — a hero's
  // army, a capture trigger, a monster's reward resources — have children and no
  // honest text box. They are declared in the object schema's `$defs` and reached
  // with the same tree the map's own settings use: one renderer, one set of edit
  // primitives (src/tree.ts), rooted at the object's element instead of the map's.
  ipcMain.handle('object:tree', async (_e: IpcMainInvokeEvent, p: ObjectTreePayload): Promise<ObjectTreeResult> => {
    const session = need();
    const obj = findObject(session, p.id);
    return { type: obj.type, tree: readTree(obj.el) };
  });

  ipcMain.handle('object:set-path', async (_e: IpcMainInvokeEvent, p: ObjectSetPathPayload): Promise<ObjectEditResult> => {
    const session = need();
    const obj = findObject(session, p.id);
    const done = record(session, `set ${p.path.join('.')}`, { map: true }, () => setPath(obj.el, p.path, p.value));
    if (!done) throw new Error(`cannot set ${p.path.join('.')}`);
    return { ok: true };
  });

  ipcMain.handle('object:add-item', async (_e: IpcMainInvokeEvent, p: ObjectAddItemPayload): Promise<ObjectEditResult> => {
    const session = need();
    const obj = findObject(session, p.id);
    // A list of structures (army stacks) gets an item built from its schema with
    // the declared defaults; a list of plain values gets <Item>v</Item>.
    const arrField = resolveObjectPath(obj.type, p.path);
    const itemSchema = arrField?.items ? deref(objectSchema, arrField.items) : null;
    const done = record(session, `add ${p.path.join('.')}`, { map: true }, () => {
      if (isBuildable(itemSchema)) {
        const container = nodeAt(obj.el, p.path);
        if (!container) return false;
        return appendItem(obj.el, p.path, buildItem(objectSchema, itemSchema!, indentText(container)));
      }
      return addStringItem(obj.el, p.path, p.value ?? '');
    });
    if (!done) throw new Error(`cannot add to ${p.path.join('.')}`);
    return { ok: true };
  });

  ipcMain.handle('object:remove-item', async (_e: IpcMainInvokeEvent, p: ObjectRemoveItemPayload): Promise<ObjectEditResult> => {
    const session = need();
    const obj = findObject(session, p.id);
    const done = record(session, `remove ${p.path.join('.')}`, { map: true }, () => removeItem(obj.el, p.path));
    if (!done) throw new Error(`cannot remove ${p.path.join('.')}`);
    return { ok: true };
  });

  ipcMain.handle('map:set-list', async (_e: IpcMainInvokeEvent, p: SetListPayload): Promise<ObjectEditResult> => {
    const session = need();
    const done = record(session, `set list ${p.path.join('.')}`, { map: true }, () => setList(session.map.desc, p.path, p.values));
    if (!done) throw new Error(`cannot set list ${p.path.join('.')}`);
    return { ok: true };
  });

  // The map's own settings (the original's map-properties tree).
  // Read from map.desc, plus the visible name/description pulled from the sibling
  // text files they reference. Those files are shown read-only for now: they are a
  // separate document from the in-memory map.xdb, so editing them wants the same
  // undo/save plumbing terrain floors have, which is a later step.
  ipcMain.handle('map:props', async (): Promise<MapPropsResult> => {
    const session = need();
    return {
      props: session.map.mapProps(),
      name: readSidecarText(session, session.map.nameFileRef),
      description: readSidecarText(session, session.map.descriptionFileRef),
    };
  });

  // Set one map-root simple field.
  ipcMain.handle('map:set-prop', async (_e: IpcMainInvokeEvent, p: SetMapPropPayload): Promise<ObjectEditResult> => {
    const session = need();
    const done = record(session, `set ${p.name}`, { map: true }, () => session.map.setMapProp(p.name, p.value));
    if (!done) throw new Error(`${p.name} is not an editable map field`);
    return { ok: true };
  });
}
