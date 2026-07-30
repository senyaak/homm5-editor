// Documents a map REFERENCES rather than contains — a light, a wind, a texture,
// a town specialization.
//
// The shipped library is read-only; a map-local twin beside map.xdb is what the
// editor makes when one has to change. The pickers offer both, the map's own
// first, because a mission's splash picture lives in its folder and the registry
// only scans the data root.

import { dialog, ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import type { EntityCopyPayload, EntityCopyResult, EntityReadPayload, EntityReadResult, EntitySetPathPayload, NamesPayload, NamesResult, NewEntityPayload, NewEntityResult, ObjectEditResult, OfClassPayload, PickTextResult, RosterPayload, RosterResult, SuggestNamePayload, SuggestNameResult } from '#electron/ipc.ts';
import { need, state } from '#electron/state.ts';
import type { Session } from '#electron/state.ts';
import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { RosterEntry } from '#src/registry.ts';
import { deref, schemaForClass } from '#src/schema.ts';
import { buildEntity } from '#src/skeleton.ts';
import { children, find, parse, serialize, text } from '#src/xml.ts';
import { readTree, setPath } from '#src/tree.ts';
import type { XmlElement, XmlNode } from '#src/xml.ts';

/**
 * Entities that live BESIDE the map, listed first.
 *
 * A mission carries its own: C1M1's splash picture is `PWL.(Texture).xdb` in the
 * map folder, referenced relatively, and the same goes for a script wrapper or a
 * light made for one map. The registry scans the data root, so without this the
 * picker offered every texture the game ships and not the one the map is about
 * to point at — and "New" wrote a document that could then only be referenced
 * by hand.
 */
function mapLocalEntities(s: Session, className: string): RosterEntry[] {
  const out: RosterEntry[] = [];
  let files: string[];
  try { files = readdirSync(s.mapDir); } catch { return out; }
  for (const f of files.sort()) {
    if (!f.toLowerCase().endsWith('.xdb')) continue;
    let head: string;
    try { head = readFileSync(join(s.mapDir, f), 'latin1').slice(0, 400); } catch { continue; }
    // The root element IS the class, which is also what the xpointer names.
    if (!new RegExp(`<${className}[\s>]`).test(head)) continue;
    out.push({
      id: `${f}#xpointer(/${className})`,
      name: f.replace(/\.xdb$/i, ''),
      group: 'This map',
    });
  }
  return out;
}

/**
 * Resolve a referenced entity's href to a file, and say whether it can be
 * edited. A library ref is absolute (`/MapObjects/…`, `/Lights/…`) and resolves
 * under the asset root — shipped data, read-only. A map-local ref is a bare
 * basename beside map.xdb — the map's own document, editable.
 */
function resolveEntityFile(s: Session, href: string): { file: string; editable: boolean } | null {
  const noPtr = href.split('#')[0];
  if (!noPtr) return null;
  // Through the chain, so a definition that lives in a mounted mod opens too —
  // read-only either way, since it is not the map's own document.
  if (noPtr.startsWith('/')) return { file: s.assets.path(noPtr.slice(1)), editable: false };
  return { file: join(s.mapDir, basename(noPtr)), editable: true };
}

/** Wire this domain onto ipcMain. Called once, from main. */
export function registerEntities(): void {
  // Names defined in this map, for x-nameRef autocomplete.
  // A field can reference another entity by the name it was given (an objective's
  // Name, an object's Name). These are the names on offer, gathered from the map
  // itself so the hints are always current.
  ipcMain.handle('map:names', async (_e: IpcMainInvokeEvent, { kind }: NamesPayload): Promise<NamesResult> => {
    const session = need();
    const seen = new Set<string>();
    if (kind === 'object') {
      for (const o of session.map.objects) { const n = text(find(o.el, 'Name')); if (n) seen.add(n); }
    } else if (kind === 'region') {
      // A region's name is what a script addresses it by, and the only place it
      // is written; the objective walk below would not find it.
      const regions = find(session.map.desc, 'regions');
      for (const item of regions ? children(regions) : []) {
        const n = text(find(item, 'Name'));
        if (n) seen.add(n);
      }
    } else {
      // Objective names: the <Name> a list <Item> carries directly, under the two
      // objective containers. Target.Name and the like sit deeper, so are skipped.
      const collect = (el: XmlElement): void => {
        for (const c of children(el)) {
          if (c.name === 'Item') { const n = text(find(c, 'Name')); if (n) seen.add(n); }
          collect(c);
        }
      };
      for (const c of ['ScenarioInformation', 'Objectives']) { const el = find(session.map.desc, c); if (el) collect(el); }
    }
    return { names: [...seen].sort() };
  });

  // A game-data roster for the typed-editing pickers.
  // Discovered from the data tree (see src/registry.ts) and cached per session, so
  // the first request for a roster scans and the rest are instant.
  ipcMain.handle('registry:roster', async (_e: IpcMainInvokeEvent, { name }: RosterPayload): Promise<RosterResult> => {
    const session = need();
    const r = session.registry;
    const roster =
      name === 'spells' ? r.spells() :
      name === 'artifacts' ? r.artifacts() :
      name === 'creatures' ? r.creatures() :
      name === 'skills' ? r.skills() :
      name === 'heroes' ? r.heroes() :
      name === 'ambientLights' ? r.ambientLights() :
      name === 'races' ? r.races() :
      name === 'birds' ? r.birds() :
      name === 'winds' ? r.winds() :
      name === 'weathers' ? r.weathers() :
      null;
    if (!roster) throw new Error(`unknown roster "${name}"`);
    return { entries: roster };
  });

  // Every object of an engine class — the type-constrained browse picker. Same
  // discovery as the class-based rosters, but for any class the schema names
  // (an object's ${type}Shared, or a header ref's entity class).
  ipcMain.handle('objects:of-class', async (_e: IpcMainInvokeEvent, { className }: OfClassPayload): Promise<RosterResult> => {
    const session = need();
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(className)) throw new Error(`bad class "${className}"`);
    return { entries: [...mapLocalEntities(session, className), ...session.registry.objectsOfClass(className)] };
  });

  // Create a new referenced object beside the map (the original's "Create New
  // <Class> Object"). The body is built from the class's schema $def with default
  // values; it is written UTF-8 as `Name.(Class).xdb` in the map folder, and the
  // href the ref should store is returned. Only classes the schema can build a
  // template for are supported — others are picked, not authored here.
  ipcMain.handle('map:new-entity', async (_e: IpcMainInvokeEvent, { className, name }: NewEntityPayload): Promise<NewEntityResult> => {
    const session = need();
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(className)) throw new Error(`bad class "${className}"`);
    const clean = name.trim().replace(/[\\/:*?"<>|]/g, '_');
    if (!clean) throw new Error('name is empty');
    const sc = schemaForClass(className);
    const body = sc ? buildEntity(sc.root, className, deref(sc.root, sc.field), '\n') : null;
    if (!body) throw new Error(`no template for <${className}> — pick an existing one instead`);
    // The new document's script handle: its <Name> (objects) or <InternalName>
    // (library entities) = the given name, never left empty (scripts address
    // objects by this handle — see docs/NAMES_AND_SCRIPTING.md).
    const handle = find(body, 'Name') || find(body, 'InternalName');
    if (handle) { handle.selfClose = false; handle.children = [{ type: 'text', text: clean } as XmlNode]; }
    const file = join(session.mapDir, `${clean}.(${className}).xdb`);
    if (existsSync(file)) throw new Error(`${basename(file)} already exists`);
    writeFileSync(file, `<?xml version="1.0" encoding="UTF-8"?>\n${serialize(body)}\n`, 'utf8');
    session.watch.resync();
    return { href: `${clean}.(${className}).xdb#xpointer(/${className})` };
  });

  // Suggest a free `Class_00N` handle for a new object of a class — the next
  // number not already taken by a `*.(Class).xdb` in the map folder, so New starts
  // with a non-empty, non-duplicate name (see docs/NAMES_AND_SCRIPTING.md).
  ipcMain.handle('map:suggest-name', async (_e: IpcMainInvokeEvent, { className }: SuggestNamePayload): Promise<SuggestNameResult> => {
    const session = need();
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(className)) throw new Error(`bad class "${className}"`);
    const suffix = `.(${className}).xdb`;
    const taken = new Set<string>();
    try { for (const f of readdirSync(session.mapDir)) if (f.endsWith(suffix)) taken.add(f.slice(0, -suffix.length)); } catch { /* no dir yet */ }
    let n = 1;
    let name = `${className}_${String(n).padStart(3, '0')}`;
    while (taken.has(name)) { n++; name = `${className}_${String(n).padStart(3, '0')}`; }
    return { name };
  });

  // Read/edit a referenced entity document (Birds/Wind/AmbientLight…).
  // The original's "Edit" on a structured ref opens the referenced object's own
  // typed fields. These back that: read the document as a tree (like the map
  // tree), and — for a map-local document — set one field and write it back. The
  // shipped library is read-only; to change one you save a copy in the map folder.
  ipcMain.handle('entity:read', async (_e: IpcMainInvokeEvent, { href }: EntityReadPayload): Promise<EntityReadResult> => {
    const session = need();
    const r = resolveEntityFile(session, href);
    if (!r || !existsSync(r.file)) throw new Error(`entity not found: ${href}`);
    const root = children(parse(readFileSync(r.file, 'utf8')))[0];
    if (!root) throw new Error(`empty entity document: ${href}`);
    return { className: root.name, editable: r.editable, tree: readTree(root) };
  });

  ipcMain.handle('entity:set-path', async (_e: IpcMainInvokeEvent, p: EntitySetPathPayload): Promise<ObjectEditResult> => {
    const session = need();
    const r = resolveEntityFile(session, p.href);
    if (!r) throw new Error(`bad entity href: ${p.href}`);
    if (!r.editable) throw new Error('this entity is from the shipped library — save a copy in the map to edit it');
    if (!existsSync(r.file)) throw new Error(`entity not found: ${p.href}`);
    const doc = parse(readFileSync(r.file, 'utf8'));
    const root = children(doc)[0];
    if (!root || !setPath(root, p.path, p.value)) throw new Error(`cannot set ${p.path.join('.')}`);
    writeFileSync(r.file, serialize(doc), 'utf8');
    session.watch.resync();
    return { ok: true };
  });

  // Pick an existing text file for a text ref (the "…" on a txt row).
  // A native OS open-dialog, starting in the map folder. A file chosen from
  // elsewhere is copied in beside map.xdb, since a text ref stores a basename.
  ipcMain.handle('map:pick-text', async (): Promise<PickTextResult> => {
    const session = need();
    const opts = {
      title: 'Select text file',
      defaultPath: session.mapDir,
      properties: ['openFile' as const],
      filters: [{ name: 'Text', extensions: ['txt'] }, { name: 'All files', extensions: ['*'] }],
    };
    const w = state.win;
    const r = await (w ? dialog.showOpenDialog(w, opts) : dialog.showOpenDialog(opts));
    const src = r.canceled ? undefined : r.filePaths[0];
    if (!src) return { href: '' };
    const dest = join(session.mapDir, basename(src));
    if (src !== dest) { copyFileSync(src, dest); session.watch.resync(); }
    return { href: basename(src) };
  });

  // Copy a shipped-library entity into the map so it can be edited.
  // The library is read-only; this makes an editable map-local twin and hands
  // back the href the ref should now point at (keeping the original xpointer).
  ipcMain.handle('entity:copy-to-map', async (_e: IpcMainInvokeEvent, { href }: EntityCopyPayload): Promise<EntityCopyResult> => {
    const session = need();
    const r = resolveEntityFile(session, href);
    if (!r || !existsSync(r.file)) throw new Error(`entity not found: ${href}`);
    if (r.editable) return { href }; // already map-local
    const base = basename(r.file);
    const dest = join(session.mapDir, base);
    if (existsSync(dest)) throw new Error(`${base} already exists in the map folder`);
    copyFileSync(r.file, dest);
    session.watch.resync();
    const ptr = href.includes('#') ? href.slice(href.indexOf('#')) : '';
    return { href: base + ptr };
  });
}
