// (header pending)

//
// A reference to a whole object (an AdvMapBirds flock, an AmbientLight, an
// object's Shared identity) shows only the reference inline, with buttons:
//   …    a type-constrained picker — the compatible class only, like the
//        original's "Objects: <Class>" explorer;
//   New  create a fresh object of that class beside the map (when the schema
//        can build a template for it).
// Both go through a native <dialog>; the entity's own field-form ("Edit") is a
// later pass, so structured refs stay pick-or-create for now.

import { $, $input } from '#core/dom.ts';
import { api } from '#core/ipc.ts';
import { canCreateClass, forgetClass, objectsOfClass } from '#core/rosters.ts';
import { state } from '#core/state.ts';
import { closeMapProps, mapDialog, mapPropsOpen, openMapProps } from '#features/inspector/map-props.ts';
import { closeMapTree, collapseTree, dataAt, expandTree, inferField, leafControl, mapTreeOpen, mtDialog, mtExpanded, showAdvanced, openMapTree, refreshMapTree } from '#features/inspector/tree.ts';
import { locBareOf, loc, locVariant } from '#features/localization.ts';
import { isTyping } from '#viewport/stage.ts';
import { classOf, controlOf, deref, mapSchema, objectSchema, schemaForClass } from '#src/schema.ts';
import type { FieldSchema, HasDefs } from '#src/schema.ts';
import type { TreeData } from '#src/tree.ts';
import { markDirty } from '#core/dirty.ts';
import { stepHistory } from '#features/history.ts';
import type { Path as TreePath } from '#src/tree.ts';
import type { RosterEntryDTO } from '#electron/ipc.ts';
import { degOf, deleteSelected, rotateSelected, snap90 } from '#features/selection.ts';
const pickDialog = (): HTMLDialogElement => {
  const el = $('objpick');
  if (!(el instanceof HTMLDialogElement)) throw new Error('#objpick is not a <dialog>');
  return el;
};
const newDialog = (): HTMLDialogElement => {
  const el = $('objnew');
  if (!(el instanceof HTMLDialogElement)) throw new Error('#objnew is not a <dialog>');
  return el;
};

// A picker session, held while its <dialog> is open. `resolve` is called once,
// with the chosen id or null (cancel), and cleared so late clicks are inert.
let pick: { entries: RosterEntryDTO[]; sel: string; resolve: (v: string | null) => void } | null = null;

/** Open the type-constrained picker for `className`, preselecting `current`.
 *  Resolves the chosen ref id, or null if cancelled. */
function pickFromClass(className: string, current: string): Promise<string | null> {
  $('op-title').textContent = `Select ${className}`;
  const search = $input('op-search');
  search.value = '';
  const list = $('op-list');
  list.innerHTML = '<div class="op-empty">loading…</div>';
  pickDialog().showModal();
  search.focus();
  return new Promise<string | null>((resolve) => {
    const session = pick = { entries: [] as RosterEntryDTO[], sel: current, resolve };
    void objectsOfClass(className).then((entries) => {
      if (pick !== session) return; // closed, or another picker opened, before it loaded
      pick.entries = entries;
      renderPickList('');
    });
  });
}

/** (Re)build the picker list, filtered by `q`, grouped like the roster. */
function renderPickList(q: string): void {
  if (!pick) return;
  const list = $('op-list');
  list.innerHTML = '';
  const needle = q.trim().toLowerCase();
  const hits = pick.entries.filter((e) =>
    !needle || (e.name || e.id).toLowerCase().includes(needle) || e.id.toLowerCase().includes(needle));
  if (!hits.length) { list.innerHTML = '<div class="op-empty">nothing matches</div>'; return; }
  let group: string | undefined;
  for (const e of hits) {
    const g = e.group || '';
    if (g !== (group ?? '')) {
      group = g;
      if (g) { const gh = document.createElement('div'); gh.className = 'op-grp'; gh.textContent = g; list.appendChild(gh); }
    }
    const opt = document.createElement('div');
    opt.className = 'op-opt' + (e.id === pick.sel ? ' sel' : '');
    opt.textContent = e.name || e.id;
    opt.title = e.id;
    opt.addEventListener('click', () => {
      if (!pick) return;
      pick.sel = e.id;
      for (const el of list.querySelectorAll('.op-opt.sel')) el.classList.remove('sel');
      opt.classList.add('sel');
    });
    opt.addEventListener('dblclick', () => closePick(true));
    list.appendChild(opt);
    if (e.id === pick.sel) queueMicrotask(() => opt.scrollIntoView({ block: 'nearest' }));
  }
}

/** Settle the picker: `ok` selects the highlighted id, else cancels (null). */
function closePick(ok: boolean): void {
  const p = pick; pick = null;
  pickDialog().close();
  if (p) p.resolve(ok ? (p.sel || null) : null);
}


/** Open the create dialog. `typeLabel` shows a fixed Type row (entities) or is
 *  hidden (a plain file). Resolves the created href, or null if cancelled. */
export function openCreate(title: string, typeLabel: string | null, nameLabel: string, submit: (name: string) => Promise<string>, defaultName = ''): Promise<string | null> {
  $('on-title').textContent = title;
  $('on-typerow').style.display = typeLabel ? '' : 'none';
  if (typeLabel) $input('on-type').value = typeLabel;
  $('on-namelabel').textContent = nameLabel;
  const name = $input('on-name');
  name.value = defaultName;
  $('on-err').textContent = '';
  newDialog().showModal();
  name.focus(); name.select(); // pre-select the default so a keystroke replaces it
  return new Promise<string | null>((resolve) => { creating = { submit, resolve }; });
}

/** Create a new entity object of a class (writes Name.(Class).xdb in the map).
 *  Prefills a free `Class_00N` handle so it is never empty or a duplicate. */
async function createEntity(className: string): Promise<string | null> {
  let suggested = '';
  try { suggested = (await api.suggestName(className)).name; } catch { /* prefill is optional */ }
  return openCreate(`Create New <${className}> Object`, className, 'Name',
    (name) => api.newEntity({ className, name }).then((r) => { forgetClass(className); return r.href; }), suggested);
}

/** Name a new text file for a text ref and create it empty at once (so the ref
 *  is never left dangling), returning its basename href. The editor opens next
 *  for content. */
export function createText(): Promise<string | null> {
  return openCreate('New text file', null, 'File name', async (name) => {
    const href = /\.txt$/i.test(name) ? name : `${name}.txt`;
    // A file of that name may already be there — the map's own name.txt, a
    // message written earlier. Referencing it is what was meant; writing an
    // empty one over it would quietly destroy the text it holds.
    //
    // Asked outright rather than inferred from a failed read: reading a missing
    // file answers '' (a map with no name is a gap, not an error), so "did that
    // throw?" said yes-it-exists about every file, and "New" pointed the ref at
    // a file it never created.
    // With localization on the ref still names the plain foo.txt, but the file
    // created is the base-tagged foo.<base>.txt — the source the editor edits and
    // the export bakes back into foo.txt. Other languages are made when first
    // opened, and fall back to the base until then.
    const file = loc.state.enabled ? locVariant(locBareOf(href), loc.state.base) : href;
    const { exists } = await api.readFile(file);
    if (!exists) await api.writeFile({ href: file, text: '' });
    return href;
  });
}

function submitNew(): void {
  if (!creating) return;
  const name = $input('on-name').value.trim();
  if (!name) { $('on-err').textContent = 'name is required'; return; }
  const { submit, resolve } = creating;
  void submit(name)
    .then((href) => { creating = null; newDialog().close(); resolve(href); })
    .catch((err: unknown) => { $('on-err').textContent = err instanceof Error ? err.message : String(err); });
}
function cancelNew(): void { const c = creating; creating = null; newDialog().close(); if (c) c.resolve(null); }


// --- entity document editor (the "✎ Edit" on a structured ref) --------------
//
// Opens the referenced object's own typed fields — a Wind's Angle/Speed, an
// AdvMapBirds' Model, an AmbientLight's colours — read from the document and
// written back per field. Map-local documents are editable; the shipped library
// is shown read-only (use "New" to make an editable copy). The form reuses the
// tree's typed controls (leafControl), rooted at the entity's $def.

const entDialog = (): HTMLDialogElement => {
  const el = $('entedit');
  if (!(el instanceof HTMLDialogElement)) throw new Error('#entedit is not a <dialog>');
  return el;
};
let eeHref = '';
let eeRepoint: ((href: string) => void) | null = null;
let eeClassName = '';
// The $defs root the open document's fields resolve against (map entities vs
// object types), and — for an object type — its class, so a nested Shared field
// resolves to `${type}Shared`.
let eeRoot: HasDefs = mapSchema;
let eeObjType = '';
const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Open the entity editor for `href`. `onRepoint` (from the ref control) lets a
 *  read-only library entity be copied into the map and the ref re-pointed. */
async function openEntityEdit(href: string, className: string, onRepoint?: (href: string) => void): Promise<void> {
  // Only one entity dialog at a time — a nested ref's Edit would clash with the
  // single <dialog>. Such refs are rare inside these documents; ignore the nest.
  if (entDialog().open) return;
  eeRepoint = onRepoint ?? null;
  eeClassName = className;
  entDialog().showModal();
  await loadEntity(href);
}

/** Read `href` and (re)build the form; used on open and after copy-to-map. */
async function loadEntity(href: string): Promise<void> {
  eeHref = href;
  $('ee-title').textContent = `${eeClassName} — ${href.split('#')[0]}`;
  const note = $('ee-note'); note.textContent = '';
  const host = $('ee-form'); host.innerHTML = '<div class="ph">loading…</div>';
  $('ee-copy').style.display = 'none';
  let res;
  try { res = await api.readEntity(href); }
  catch (e) { host.innerHTML = ''; note.textContent = 'could not read: ' + errMsg(e); return; }
  if (eeHref !== href) return; // a later load won the race
  const sc = schemaForClass(res.className);
  eeRoot = sc?.root ?? mapSchema;
  eeObjType = sc && objectSchema.types[res.className] ? res.className : '';
  const rootField = sc ? deref(eeRoot, sc.field) : inferField(res.tree as TreeData);
  const fs = document.createElement('fieldset');
  fs.className = 'ee-fs' + (res.editable ? '' : ' ee-form-ro');
  fs.style.border = '0'; fs.style.padding = '0'; fs.style.margin = '0'; fs.style.minInlineSize = '0';
  fs.disabled = !res.editable;
  fillEntity(fs, rootField, res.tree as TreeData, []);
  host.innerHTML = ''; host.appendChild(fs);
  // A library entity is read-only; offer to copy it into the map to edit — but
  // only when the ref control gave us a way to re-point at the copy.
  note.textContent = res.editable ? '' : 'Read-only — from the shipped library. Save a copy in the map to edit it.';
  $('ee-copy').style.display = !res.editable && eeRepoint ? '' : 'none';
}

/** Copy the shipped-library entity into the map and switch to editing the copy. */
async function copyEntityToMap(): Promise<void> {
  try {
    const r = await api.copyEntityToMap(eeHref);
    if (eeRepoint) eeRepoint(r.href);
    markDirty(true);
    await loadEntity(r.href);
  } catch (e) { $('ee-note').textContent = 'copy failed: ' + errMsg(e); }
}

/** Commit one entity field to disk, then reflect dirty. */
async function entitySet(path: TreePath, value: string): Promise<void> {
  try { await api.setEntityPath({ href: eeHref, path, value }); markDirty(true); $('hud').textContent = `${path.join('.')} = ${value || '(empty)'}`; }
  catch (e) { $('hud').textContent = 'entity edit failed: ' + errMsg(e); }
}

/** Fill a container with an entity object's fields, schema-typed, recursing into
 *  nested objects. Arrays are shown read-only (rare in these documents). */
function fillEntity(container: HTMLElement, field: FieldSchema, data: TreeData | undefined, path: TreePath): void {
  const props = field.properties ?? {};
  const dataKeys = data && typeof data === 'object' && !Array.isArray(data) ? Object.keys(data) : [];
  const seen = new Set<string>();
  const keys = [...Object.keys(props), ...dataKeys];
  if (!keys.length) { const p = document.createElement('div'); p.className = 'ph'; p.textContent = 'no fields'; container.appendChild(p); return; }
  for (const k of keys) {
    if (seen.has(k)) continue; seen.add(k);
    const cf = props[k] ? deref(eeRoot, props[k]) : inferField(dataAt(data, k));
    container.appendChild(entNode(k, cf, dataAt(data, k), [...path, k]));
  }
}

/** One entity field: a nested object becomes a collapsible group; everything
 *  else a typed row (arrays are shown read-only). */
function entNode(name: string, field: FieldSchema, data: TreeData | undefined, path: TreePath): HTMLElement {
  const c = controlOf(field);
  if (c === 'group' && field.type !== 'array') {
    const grp = document.createElement('div'); grp.className = 'mt-grp';
    const head = document.createElement('div'); head.className = 'mt-ghead';
    const tw = document.createElement('span'); tw.className = 'tw'; tw.textContent = '▸';
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = field.title || name;
    head.append(tw, nm);
    const kids = document.createElement('div'); kids.className = 'mt-kids collapsed';
    let filled = false;
    head.addEventListener('click', () => {
      const open = kids.classList.toggle('collapsed') === false;
      tw.textContent = open ? '▾' : '▸';
      if (open && !filled) { filled = true; fillEntity(kids, field, data, path); }
    });
    grp.append(head, kids);
    return grp;
  }
  const row = document.createElement('div'); row.className = 'mt-row';
  const label = document.createElement('label'); label.textContent = field.title || name; label.title = name;
  row.appendChild(label);
  if (c === 'group') { // an array — read-only summary for now
    const ro = document.createElement('span'); ro.className = 'ro';
    ro.textContent = Array.isArray(data) ? `[${data.length} items]` : '(list)';
    row.appendChild(ro);
  } else {
    const value = typeof data === 'string' ? data : '';
    const commit = (v: string): void => void entitySet(path, v);
    // An object document's Shared identity resolves to `${type}Shared` — give it
    // the type-constrained picker, which leafControl can't (it has no objType).
    const cls = field['x-shared'] ? classOf(field, eeObjType) : null;
    row.appendChild(cls ? entityRefControl(cls, value, commit) : leafControl(field, value, commit));
  }
  return row;
}


// Esc or a backdrop close docks the tree back rather than losing it — the tree
// stays open, just to the side again.

// Tabs are built dynamically (buildMpTabs), each with its own click handler.
// A click on the backdrop lands on the dialog element itself (the card stops its
// own clicks), so that dismisses — the one behaviour <dialog> leaves to us. Esc,
// the backdrop paint and focus are the platform's.

// Keyboard shortcuts for the selection. Registered separately from the WASD set
// because those are held-key state and these are one-shot actions. The rotate
// keys sit next to each other on the keyboard and are free: WASD pans and the
// brush owns no keys.
// Undo/redo are the one pair that must work while typing is NOT happening but
// with a modifier held, so they are checked before the selection shortcuts —
// which bail out on any modifier.

/** Bind the reference pickers, the create dialog and the entity editor. */

// A create session. `submit` turns the entered name into the href the ref
// should store (creating a file as a side effect); it throws to show an error
// and keep the dialog open. The picker and this share the #objnew dialog.
let creating: { submit: (name: string) => Promise<string>; resolve: (v: string | null) => void } | null = null;

/**
 * A structured-reference control: the reference shown inline (read-only), then
 * a "…" browse picker and, where the class is authorable, a "New" button. On a
 * pick/create it commits the new href and updates the shown value in place.
 */
export function entityRefControl(className: string, value: string, commit: (v: string) => void): HTMLElement {
  const wrap = document.createElement('span'); wrap.style.display = 'contents';
  const box = document.createElement('span'); box.className = 'mt-ref';
  const rv = document.createElement('span'); rv.className = 'rv';
  // Edit the referenced object's own fields (map-local: editable; library:
  // shown read-only). Enabled only when something is referenced.
  const edit = document.createElement('button'); edit.textContent = '✎'; edit.title = 'edit the referenced object';
  const show = (v: string): void => { rv.textContent = v || '(none)'; rv.title = v; edit.disabled = !v; };
  show(value);
  const set = (v: string | null): void => { if (v != null) { commit(v); show(v); } };
  const browse = document.createElement('button'); browse.textContent = '…'; browse.title = `pick a ${className}`;
  browse.addEventListener('click', () => { void pickFromClass(className, rv.title).then(set); });
  box.append(rv, browse);
  if (canCreateClass(className)) {
    const nw = document.createElement('button'); nw.textContent = 'New'; nw.title = `create a new ${className}`;
    nw.addEventListener('click', () => { void createEntity(className).then(set); });
    box.appendChild(nw);
  }
  edit.addEventListener('click', () => { if (rv.title) void openEntityEdit(rv.title, className, set); });
  box.appendChild(edit);
  wrap.appendChild(box);
  return wrap;
}

export function initRefs(): void {
  pickDialog().addEventListener('click', (e) => { if (e.target === pickDialog()) closePick(false); });
  pickDialog().addEventListener('cancel', () => closePick(false)); // Esc

  newDialog().addEventListener('click', (e) => { if (e.target === newDialog()) cancelNew(); });
  newDialog().addEventListener('cancel', () => cancelNew()); // Esc

  entDialog().addEventListener('click', (e) => { if (e.target === entDialog()) entDialog().close(); });
  mtDialog().addEventListener('close', () => collapseTree());
  mtDialog().addEventListener('click', (e) => { if (e.target === mtDialog()) collapseTree(); });
  mapDialog().addEventListener('click', (e) => { if (e.target === mapDialog()) closeMapProps(); });
  $input('op-search').addEventListener('input', (e) => renderPickList((e.currentTarget as HTMLInputElement).value));
  $('op-ok').onclick = () => closePick(true);
  $('op-cancel').onclick = () => closePick(false);
  $('op-close').onclick = () => closePick(false);
  $('on-ok').onclick = () => submitNew();
  $('on-cancel').onclick = () => cancelNew();
  $('on-close').onclick = () => cancelNew();
  $input('on-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submitNew(); } });
  $('ee-done').onclick = () => entDialog().close();
  $('ee-close').onclick = () => entDialog().close();
  $('ee-copy').onclick = () => void copyEntityToMap();
  $('maptreebtn').onclick = () => { if (mapTreeOpen()) closeMapTree(); else openMapTree(); };
  $('mt-close').onclick = () => closeMapTree();
  $('mt-expand').onclick = () => { if (mtExpanded) collapseTree(); else expandTree(); };
  $input('mt-adv').addEventListener('change', (e) => { showAdvanced((e.currentTarget as HTMLInputElement).checked); if (mapTreeOpen()) void refreshMapTree(); });
  $('mapbtn').onclick = () => { if (mapPropsOpen()) closeMapProps(); else openMapProps(); };
  $('mp-close').onclick = () => closeMapProps();
  addEventListener('keydown', (e) => {
    if (isTyping(e.target) || !(e.ctrlKey || e.metaKey) || e.altKey) return;
    const z = e.code === 'KeyZ', y = e.code === 'KeyY';
    if (!z && !y) return;
    e.preventDefault();
    void stepHistory(y || e.shiftKey ? 'redo' : 'undo');
  });
  addEventListener('keydown', (e) => {
    if (!state.selected || isTyping(e.target) || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
    const cur = snap90(degOf(state.selected.inst.r));
    if (e.code === 'BracketLeft') { void rotateSelected(cur - 90); }
    else if (e.code === 'BracketRight') { void rotateSelected(cur + 90); }
    else if (e.code === 'Delete') { void deleteSelected(); }
    else return;
    e.preventDefault();
  });
}
