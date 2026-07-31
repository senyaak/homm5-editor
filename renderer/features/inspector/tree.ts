// (header pending)

//
// The whole <AdvMapDesc> as an expandable, schema-typed tree — the raw, complete
// counterpart to the curated dialog. It walks the schema (src/schema.ts) and the
// map's data (map:tree) together: a field's control comes from its schema, its
// value from the data. Where the schema stops (deep stubs, mod additions) it
// recurses on the data itself, so nothing in the file is hidden.

import { $ } from '#core/dom.ts';
import { api } from '#core/ipc.ts';
import { roster } from '#core/rosters.ts';
import { nameRefInput, selectFrom } from '#features/inspector/controls.ts';
import { entityRefControl } from '#features/inspector/refs.ts';
import { fileRefControl, scriptRefControl, specRefControl } from '#features/text-editor/document.ts';
import { classOf, controlOf, deref, mapSchema, objectProps, objectSchema } from '#src/schema/schema.ts';
import type { FieldSchema, HasDefs } from '#src/schema/schema.ts';
import type { TreeData } from '#src/schema/tree.ts';
import { markDirty } from '#core/dirty.ts';
import type { Path as TreePath } from '#src/schema/tree.ts';
/**
 * What the tree is currently editing.
 *
 * The panel started as the map's own settings and is now pointed at objects too:
 * a hero's army, a capture trigger, a monster's reward resources are structures
 * with children, and a flat property list has no honest control for them. Rather
 * than a second editor — or a hand-written panel per type, which is what the
 * schema exists to avoid — the same renderer takes a different root: which
 * fields to start from, which `$defs` a `$ref` resolves against, and where an
 * edit is written.
 */
interface TreeTarget {
  /** Shown in the panel's title bar. */
  label: string;
  /** Schema root a `$ref` resolves against. */
  root: HasDefs;
  /** The top-level fields to render. */
  fields: () => Record<string, FieldSchema>;
  read: () => Promise<TreeData>;
  set: (path: TreePath, value: string) => Promise<unknown>;
  add: (path: TreePath, value?: string) => Promise<unknown>;
  remove: (path: TreePath) => Promise<unknown>;
  /** Replace a value list wholesale — how a one-of-many list is written. */
  setList?: (path: TreePath, values: string[]) => Promise<unknown>;
}

export const MAP_TREE: TreeTarget = {
  label: 'Map tree',
  root: mapSchema,
  fields: () => mapSchema.properties,
  read: async () => (await api.mapTree()).tree as TreeData,
  set: (path, value) => api.setMapPath({ path, value }),
  add: (path, value) => api.addMapItem(value === undefined ? { path } : { path, value }),
  remove: (path) => api.removeMapItem({ path }),
  setList: (path, values) => api.setMapList({ path, values }),
};

/** The tree rooted at one object — same renderer, same edit primitives. */
export function objectTree(id: string, type: string): TreeTarget {
  return {
    label: `${type} · ${id.replace('item_', '').slice(0, 8)}`,
    root: objectSchema,
    fields: () => objectProps(type),
    read: async () => (await api.objectTree({ id })).tree as TreeData,
    set: (path, value) => api.setObjectPath({ id, path, value }),
    add: (path, value) => api.addObjectItem(value === undefined ? { id, path } : { id, path, value }),
    remove: (path) => api.removeObjectItem({ id, path }),
  };
}

export let treeTarget: TreeTarget = MAP_TREE;

export const mapTreeOpen = (): boolean => $('maptree').style.display !== 'none';
let mtShowAdvanced = false;

/** Whether the tree shows the fields the schema marks advanced. */
export const advancedShown = (): boolean => mtShowAdvanced;
export const showAdvanced = (on: boolean): void => { mtShowAdvanced = on; };
/** Expanded group paths, so a rebuild (after add/remove) keeps them open. */
export const mtOpen = new Set<string>();
// The separator is escaped rather than typed: a literal NUL in the source
// makes git treat this whole file as binary, so no diff of it is ever shown.
export const pathKey = (path: TreePath): string => path.join('\u0000');

export function openMapTree(target: TreeTarget = MAP_TREE): void {
  // Switching what the tree shows starts it collapsed: an expansion remembered
  // from the map's players means nothing inside a monster.
  if (target !== treeTarget) mtOpen.clear();
  treeTarget = target;
  $('maptree').style.display = 'flex';
  $('maptreebtn').classList.toggle('on', target === MAP_TREE);
  void refreshMapTree();
}
export function closeMapTree(): void { collapseTree(); $('maptree').style.display = 'none'; $('maptreebtn').classList.remove('on'); }

// The tree docks left at 360px — fine for a monster, tight for a town's dozens
// of fields. "Expand" moves the WHOLE #maptree element into a roomy modal
// <dialog> and back again, so the same nodes (and every test selector) are
// reused untouched; only their box changes. Tests never expand, so #maptree
// stays docked for them.
export let mtExpanded = false;
export const mtDialog = (): HTMLDialogElement => $('mt-dialog') as HTMLDialogElement;
export function expandTree(): void {
  if (mtExpanded) return;
  mtDialog().appendChild($('maptree'));
  mtExpanded = true;
  $('mt-expand').textContent = '⤡';
  $('mt-expand').title = 'dock to the side';
  if (!mtDialog().open) mtDialog().showModal();
}
export function collapseTree(): void {
  if (!mtExpanded) return;
  document.body.appendChild($('maptree'));
  mtExpanded = false;
  $('mt-expand').textContent = '⤢';
  $('mt-expand').title = 'expand to a window';
  if (mtDialog().open) mtDialog().close();
}

export async function refreshMapTree(): Promise<void> {
  const body = $('maptree-body');
  $('mt-title').textContent = treeTarget.label;
  let data: TreeData;
  try { data = await treeTarget.read(); }
  catch (e) { body.textContent = 'could not read tree: ' + (e instanceof Error ? e.message : String(e)); return; }
  body.innerHTML = '';
  for (const [name, raw] of Object.entries(treeTarget.fields())) {
    const field = deref(treeTarget.root, raw);
    if (field['x-advanced'] && !mtShowAdvanced) continue;
    body.appendChild(treeNode(name, field, dataAt(data, name), [name]));
  }
}

/** A child of tree data by key/index, or undefined for a leaf. */
export function dataAt(data: TreeData | undefined, key: string | number): TreeData | undefined {
  if (data && typeof data === 'object') return (data as Record<string | number, TreeData>)[key];
  return undefined;
}

/** A minimal schema inferred from a data value, for fields the schema omits. */
export function inferField(v: TreeData | undefined): FieldSchema {
  if (Array.isArray(v)) return { type: 'array' };
  if (v && typeof v === 'object') return { type: 'object' };
  if (v === 'true' || v === 'false') return { type: 'boolean' };
  if (typeof v === 'string' && v !== '' && /^-?\d+(\.\d+)?$/.test(v)) return { type: 'number' };
  return { type: 'string' };
}

/** One node: a leaf row, or an expandable group (object or list). */
function treeNode(name: string, field: FieldSchema, data: TreeData | undefined, path: TreePath): HTMLElement {
  // A checklist ARRAY is a real list here — items with remove, an add row with
  // the roster dropdown (fillArray) — because the tree is where a hero's
  // artifacts or perks get edited. Only the single-choice array stays a
  // one-control leaf: x-widget "dropdown" on an array (the ambient-light
  // preset) means "a list in the file, one choice in the editor".
  const c = controlOf(field);
  if (field.type === 'array' && c === 'checklist') return groupNode(name, field, data, path);
  return c === 'group' ? groupNode(name, field, data, path) : leafRow(name, field, data, path);
}

/** A labelled leaf row whose control is set by the field's schema. */
export function leafRow(name: string, field: FieldSchema, data: TreeData | undefined, path: TreePath): HTMLElement {
  const row = document.createElement('div');
  row.className = 'mt-row';
  // The row's own path, on the element. The label shows the schema's title and
  // its tooltip carries the description, so neither says where the value lives —
  // and "where" is what automation, and anyone reading the DOM, needs.
  row.dataset.path = JSON.stringify(path);
  const label = document.createElement('label');
  label.textContent = field.title || name;
  label.title = field.description ? `${name} — ${field.description}` : name;
  label.dataset.field = name;
  row.appendChild(label);
  // A list rendered as ONE control — the map's ambient light is a list in the
  // file and a single choice in the editor — shows its first entry and is
  // written as a whole list, since a list node has no text to set.
  const isList = field.type === 'array';
  const value = typeof data === 'string' ? data
    : (isList && Array.isArray(data) && typeof data[0] === 'string' ? data[0] : '');
  row.appendChild(leafControl(field, value, (v) => {
    void (isList ? treeSetList(path, v ? [v] : []) : treeSet(path, v));
  }));
  return row;
}

/** The control element for a leaf value (no label). */
export function leafControl(field: FieldSchema, value: string, commit: (v: string) => void): HTMLElement {
  if (field['x-nameRef']) return nameRefInput(field['x-nameRef'], value, commit);
  // A script reference (MapScript): the wrapper's xpointer, with New/Edit that
  // create the .lua+.xdb pair and open the code — not an href typed by hand.
  if (field['x-widget'] === 'script') return scriptRefControl(value, commit);
  // A town specialization: a named bonus, pick-or-create map-local.
  if (field['x-widget'] === 'specialization') return specRefControl(value, commit);
  // A text-file reference: show the path, and an Edit button that opens the
  // referenced file in the text editor (the original's "Edit" on such a row).
  if (field['x-file']) return fileRefControl(value, field.title || '', commit);
  // A reference to a whole object (a single AdvMapBirds/Wind/AmbientLight…):
  // show the ref, and offer the type-constrained picker + New. Arrays of refs
  // stay checklists (handled by fillArray), so only single refs come here.
  if (field.type !== 'array') {
    const cls = classOf(field);
    if (cls) return entityRefControl(cls, value, commit);
  }
  const c = controlOf(field);
  if (c === 'readonly') {
    const s = document.createElement('span'); s.className = 'ro';
    s.textContent = value || 'null'; s.title = value; return s;
  }
  if (c === 'dropdown' && field['x-registry']) return regSelect(field['x-registry'], value, commit);
  if (c === 'enum' && field.enum) return selectFrom(value, field.enum.map((v) => ({ value: v, label: v })), commit);
  if (c === 'number') {
    const i = document.createElement('input'); i.type = 'number'; i.value = value;
    if (field.minimum !== undefined) i.min = String(field.minimum);
    if (field.maximum !== undefined) i.max = String(field.maximum);
    i.addEventListener('change', () => commit(i.value)); return i;
  }
  if (c === 'checkbox') {
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = value === 'true';
    cb.addEventListener('change', () => commit(String(cb.checked))); return cb;
  }
  // ref / textfile / script / text — editable raw in the tree.
  const inp = document.createElement('input'); inp.type = 'text'; inp.value = value;
  inp.addEventListener('change', () => commit(inp.value)); return inp;
}

/** A <select> filled from a registry roster once it loads; shows value meanwhile. */
function regSelect(reg: string, value: string, commit: (v: string) => void): HTMLSelectElement {
  const sel = selectFrom(value, value ? [] : [{ value: '', label: '—' }], commit);
  sel.disabled = true;
  void roster(reg).then((entries) => {
    const cur = sel.value;
    sel.innerHTML = '';
    const opts = entries.map((e) => ({ value: e.id, label: e.name || e.id }));
    if (!opts.some((o) => o.value === cur)) opts.unshift({ value: cur, label: cur || '—' });
    for (const o of opts) {
      const el = document.createElement('option');
      el.value = o.value; el.textContent = o.label;
      if (o.value === cur) el.selected = true;
      sel.appendChild(el);
    }
    sel.disabled = false;
  });
  return sel;
}

/** An expandable group — an object's fields or a list's items, filled on expand.
 *  `onRemove`, when given, adds a delete affordance (a struct item in a list). */
function groupNode(name: string, field: FieldSchema, data: TreeData | undefined, path: TreePath, onRemove?: () => void): HTMLElement {
  const grp = document.createElement('div');
  grp.className = 'mt-grp';
  const head = document.createElement('div');
  head.className = 'mt-ghead';
  const tw = document.createElement('span'); tw.className = 'tw'; tw.textContent = '▸';
  const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = field.title || name;
  const co = document.createElement('span'); co.className = 'co';
  const isArray = field.type === 'array';
  const count = isArray && Array.isArray(data) ? data.length : 0;
  if (isArray) co.textContent = ` (${count})`;
  head.append(tw, nm, co);
  if (onRemove) {
    const x = document.createElement('button'); x.className = 'mt-x'; x.textContent = '✕'; x.title = 'remove';
    x.style.marginLeft = 'auto';
    x.addEventListener('click', (e) => { e.stopPropagation(); onRemove(); });
    head.appendChild(x);
  }
  const kids = document.createElement('div');
  kids.className = 'mt-kids collapsed';
  let filled = false;
  const k = pathKey(path);
  const setOpen = (open: boolean): void => {
    kids.classList.toggle('collapsed', !open);
    tw.textContent = open ? '▾' : '▸';
    if (open) { mtOpen.add(k); if (!filled) { filled = true; (isArray ? fillArray : fillObject)(kids, field, data, path); } }
    else mtOpen.delete(k);
  };
  head.addEventListener('click', () => setOpen(kids.classList.contains('collapsed')));
  // Restore expansion across a rebuild: refreshMapTree recreates every node, so
  // without this an add/remove (which reloads the tree) would collapse the group
  // the edit happened in. Groups re-open recursively as their parents fill.
  if (mtOpen.has(k)) setOpen(true);
  // JSON rather than the internal key: that one joins on NUL, which a CSS
  // attribute selector cannot carry (the parser turns it into U+FFFD).
  grp.dataset.path = JSON.stringify(path);
  grp.append(head, kids);
  return grp;
}

/** Fill an object group with its child fields (schema first, then any extra data keys). */
function fillObject(kids: HTMLElement, field: FieldSchema, data: TreeData | undefined, path: TreePath): void {
  const props = field.properties ?? {};
  const dataKeys = data && typeof data === 'object' && !Array.isArray(data) ? Object.keys(data) : [];
  const seen = new Set<string>();
  for (const k of [...Object.keys(props), ...dataKeys]) {
    if (seen.has(k)) continue; seen.add(k);
    const cf = props[k] ? deref(treeTarget.root, props[k]) : inferField(dataAt(data, k));
    if (cf['x-advanced'] && !mtShowAdvanced) continue;
    kids.appendChild(treeNode(k, cf, dataAt(data, k), [...path, k]));
  }
}

/** Fill a list group: struct items recurse; value items get remove + an add row. */
function fillArray(kids: HTMLElement, field: FieldSchema, data: TreeData | undefined, path: TreePath): void {
  const items = Array.isArray(data) ? data : [];
  const itemField = field.items ? deref(treeTarget.root, field.items) : inferField(items[0]);
  const isStruct = itemField.type === 'object' || !!itemField.properties;
  if (isStruct) {
    // Struct items: each expandable, removable down to minItems; add builds a
    // default item from the schema (main side), allowed up to maxItems.
    const canRemove = items.length > (field.minItems ?? 0);
    items.forEach((it, i) => kids.appendChild(groupNode(`[${i}]`, itemField, it, [...path, i],
      canRemove ? () => void mutateList(() => treeTarget.remove([...path, i])) : undefined)));
    if (field.maxItems === undefined || items.length < field.maxItems) {
      const add = document.createElement('div'); add.className = 'mt-add';
      const btn = document.createElement('button'); btn.textContent = `＋ add ${itemField.title || 'item'}`;
      btn.addEventListener('click', () => void mutateList(() => treeTarget.add(path)));
      add.appendChild(btn); kids.appendChild(add);
    }
    return;
  }
  // A list of plain values: each removable, plus an add row.
  const reg = field['x-registry'] || itemField['x-registry'];
  items.forEach((it, i) => {
    const row = document.createElement('div'); row.className = 'mt-item';
    const iv = document.createElement('span'); iv.className = 'iv'; iv.textContent = String(it); iv.title = String(it);
    const x = document.createElement('button'); x.className = 'mt-x'; x.textContent = '✕'; x.title = 'remove';
    x.addEventListener('click', () => { void mutateList(() => treeTarget.remove([...path, i])); });
    row.append(iv, x); kids.appendChild(row);
  });
  const add = document.createElement('div'); add.className = 'mt-add';
  const input = reg ? regSelect(reg, '', () => {}) : Object.assign(document.createElement('input'), { type: 'text' });
  add.appendChild(input);
  const btn = document.createElement('button'); btn.textContent = '＋ add';
  btn.addEventListener('click', () => {
    const v = (input as HTMLInputElement | HTMLSelectElement).value;
    if (v) void mutateList(() => treeTarget.add(path, v));
  });
  add.appendChild(btn); kids.appendChild(add);
}

/** Run a structural list edit, then reflect dirty and rebuild the tree. */
async function mutateList(op: () => Promise<unknown>): Promise<void> {
  try { await op(); markDirty(true); await refreshMapTree(); }
  catch (e) { $('hud').textContent = 'tree edit failed: ' + (e instanceof Error ? e.message : String(e)); }
}

/** Replace a value list — what a single-choice list row commits through. */
async function treeSetList(path: TreePath, values: string[]): Promise<void> {
  if (!treeTarget.setList) { $('hud').textContent = `${path.join('.')} is not a list this view can write`; return; }
  try { await treeTarget.setList(path, values); markDirty(true); $('hud').textContent = `${path.join('.')} = ${values.join(', ') || '(empty)'}`; }
  catch (e) { $('hud').textContent = `could not set ${path.join('.')}: ` + (e instanceof Error ? e.message : String(e)); }
}

/** The same, for whatever the tree is currently editing. */
async function treeSet(path: TreePath, value: string): Promise<void> {
  try { await treeTarget.set(path, value); markDirty(true); $('hud').textContent = `${path.join('.')} = ${value || '(empty)'}`; }
  catch (e) { $('hud').textContent = `could not set ${path.join('.')}: ` + (e instanceof Error ? e.message : String(e)); }
}

/** Write one leaf by path, then reflect dirty (the input already shows the value). */
export async function setMapPath(path: TreePath, value: string): Promise<void> {
  try { await api.setMapPath({ path, value }); markDirty(true); $('hud').textContent = `${path.join('.')} = ${value || '(empty)'}`; }
  catch (e) { $('hud').textContent = `could not set ${path.join('.')}: ` + (e instanceof Error ? e.message : String(e)); }
}
