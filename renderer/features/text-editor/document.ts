// (header pending)

//
// A text reference (NameFileRef, a rumour's Text…) shows its path plus an Edit
// button that opens the referenced file in a plain-text editor — the original's
// behaviour. The file is its own document, written straight to disk on Save.

import { $ } from '#core/dom.ts';
import { api } from '#core/ipc.ts';
import { roster } from '#core/rosters.ts';
import { createText, openCreate } from '#features/inspector/refs.ts';
import { loc, locBareOf, locVariant, renderLocTabs, showLocRef } from '#features/localization.ts';
import { ask } from '#core/dialog.ts';
import { markDirty } from '#core/dirty.ts';
import { mountCodeEditor } from '#features/text-editor/code-editor.ts';
import { loadScriptContext, scriptContextNote } from '#features/text-editor/context.ts';
import { mapTreeOpen, refreshMapTree } from '#features/inspector/tree.ts';
import type { LuaDiagnostic } from '#src/script/lua-lint.ts';
import type { CodeEditor } from '#features/text-editor/code-editor.ts';
import { TOWN_BONUSES } from '#src/schema/town-bonuses.ts';
/** A ref row's control: the path, then an ✎ button opening the text editor. */
export function fileRefControl(href: string, label: string, commit: (v: string) => void): HTMLElement {
  const wrap = document.createElement('span'); wrap.style.display = 'contents';
  const box = document.createElement('span'); box.className = 'mt-ref';
  const rv = document.createElement('span'); rv.className = 'rv';
  const edit = document.createElement('button'); edit.textContent = '✎'; edit.title = 'edit text';
  const show = (v: string): void => { rv.textContent = v || '(none)'; rv.title = v; edit.disabled = !v; };
  show(href);
  const browse = document.createElement('button'); browse.textContent = '…'; browse.title = 'pick an existing text file';
  browse.addEventListener('click', () => {
    void api.pickText().then((r) => { if (r.href) { commit(r.href); show(r.href); } });
  });
  const nw = document.createElement('button'); nw.textContent = 'New'; nw.title = 'create a new text file';
  nw.addEventListener('click', () => {
    void createText().then((v) => { if (v != null) { commit(v); show(v); void openTextEdit(v, label || v); } });
  });
  edit.addEventListener('click', () => { if (rv.title) void openTextEdit(rv.title, label || rv.title); });
  box.append(rv, browse, nw, edit);
  wrap.appendChild(box);
  return wrap;
}

/**
 * A script reference — the map's `MapScript`, a hero's `CombatScript`.
 *
 * The value stored is the WRAPPER's xpointer (`MapScript.xdb#xpointer(/Script)`),
 * never the `.lua`: the engine references a Script document, and the document
 * names the file. So "New" creates both — the wrapper and an empty `.lua` — binds
 * the ref to the wrapper, and opens the code; "Edit" follows the wrapper to its
 * `.lua` and opens that. Typing the name of a script that already exists re-binds
 * to it without touching its contents (the handler adopts rather than overwrites),
 * which is also how an existing mission script gets pointed at.
 */
export function scriptRefControl(value: string, commit: (v: string) => void): HTMLElement {
  const wrap = document.createElement('span'); wrap.style.display = 'contents';
  const box = document.createElement('span'); box.className = 'mt-ref';
  const rv = document.createElement('span'); rv.className = 'rv';
  const edit = document.createElement('button'); edit.textContent = '✎'; edit.title = 'edit the script';
  const show = (v: string): void => { rv.textContent = v || '(none)'; rv.title = v; edit.disabled = !v; };
  show(value);
  const nw = document.createElement('button'); nw.textContent = 'New'; nw.title = 'create or bind a script';
  nw.addEventListener('click', () => {
    void openCreate('New map script', null, 'Script name', async (name) => {
      const r = await api.newScript({ base: name });
      queueMicrotask(() => void openTextEdit(r.lua, r.lua));
      return r.href;
    }, 'MapScript').then((href) => { if (href != null) { commit(href); show(href); } });
  });
  edit.addEventListener('click', () => {
    if (!rv.title) return;
    void api.resolveScript({ href: rv.title })
      .then((r) => openTextEdit(r.lua, r.lua))
      .catch((e: unknown) => { $('hud').textContent = 'cannot open script: ' + (e instanceof Error ? e.message : String(e)); });
  });
  box.append(rv, nw, edit);
  wrap.appendChild(box);
  return wrap;
}

/**
 * The Specialization control — a named town bonus. Shows the current ref and a
 * New button that creates a map-local TownSpecialization (a bonus packed beside
 * map.xdb) and links it by a relative href, the same map-local pattern scripts
 * and texts use; ✕ clears it. A shipped specialization is still a plain href, so
 * one can also be typed/pasted, but the point here is authoring your own.
 */
export function specRefControl(value: string, commit: (v: string) => void): HTMLElement {
  const wrap = document.createElement('span'); wrap.style.display = 'contents';
  const box = document.createElement('span'); box.className = 'mt-ref';
  const rv = document.createElement('span'); rv.className = 'rv';
  const clear = document.createElement('button'); clear.textContent = '✕'; clear.title = 'clear';
  const show = (v: string): void => { rv.textContent = v || '(none)'; rv.title = v; clear.disabled = !v; };
  show(value);
  const nw = document.createElement('button'); nw.textContent = 'New'; nw.title = 'create a map-local specialization';
  nw.addEventListener('click', () => {
    void openSpecCreate().then((choice) => {
      if (!choice) return undefined;
      return api.newSpecialization(choice).then((r) => { commit(r.href); show(r.href); });
    }).catch((e: unknown) => { $('hud').textContent = 'cannot create specialization: ' + (e instanceof Error ? e.message : String(e)); });
  });
  clear.addEventListener('click', () => { commit(''); show(''); });
  box.append(rv, nw, clear);
  wrap.appendChild(box);
  return wrap;
}

interface SpecChoice { base: string; bonus: string; townType: string; name: string }
/** The New-specialization dialog: a bonus, a faction, an optional display name. */
function openSpecCreate(): Promise<SpecChoice | null> {
  const dlg = $('specnew') as HTMLDialogElement;
  const bonus = $('sn-bonus') as HTMLSelectElement;
  const faction = $('sn-faction') as HTMLSelectElement;
  const name = $('sn-name') as HTMLInputElement;
  bonus.innerHTML = '';
  for (const b of TOWN_BONUSES) {
    const o = document.createElement('option'); o.value = b.id; o.textContent = b.label; bonus.appendChild(o);
  }
  faction.innerHTML = '';
  void roster('races').then((entries) => {
    faction.innerHTML = '';
    for (const e of entries) {
      const o = document.createElement('option'); o.value = e.id; o.textContent = e.name || e.id; faction.appendChild(o);
    }
    faction.value = 'TOWN_HEAVEN';
  });
  name.value = ''; $('sn-err').textContent = '';
  return new Promise((resolve) => {
    const done = (v: SpecChoice | null): void => { cleanup(); dlg.close(); resolve(v); };
    const onOk = (): void => {
      const nm = name.value.trim();
      const base = (nm.replace(/[^A-Za-z0-9_-]+/g, '') || 'TownSpec').slice(0, 40);
      done({ base, bonus: bonus.value, townType: faction.value, name: nm });
    };
    const onCancel = (): void => done(null);
    const cleanup = (): void => {
      $('sn-ok').removeEventListener('click', onOk);
      $('sn-cancel').removeEventListener('click', onCancel);
      $('sn-close').removeEventListener('click', onCancel);
    };
    $('sn-ok').addEventListener('click', onOk);
    $('sn-cancel').addEventListener('click', onCancel);
    $('sn-close').addEventListener('click', onCancel);
    dlg.showModal();
  });
}

export const docDialog = (): HTMLDialogElement => {
  const el = $('docedit');
  if (!(el instanceof HTMLDialogElement)) throw new Error('#docedit is not a <dialog>');
  return el;
};
/** The document the editor currently holds. */
export const doc = {
  /** The file being edited — the language variant, when the map is localized. */
  href: '',
  /** The ref the map stores (bare, untagged) — for the title and the tabs. */
  ref: '',
  /** The label to keep across a language-tab switch. */
  label: '',
  /** The text as it was loaded, so closing can tell edited from untouched. */
  loaded: '',
  /** Mounted on first use — CodeMirror is not needed to open a map. */
  editor: null as CodeEditor | null,
};
export async function openTextEdit(href: string, label: string): Promise<void> {
  const lang = langOf(href);
  doc.label = label;
  const localized = lang === 'text' && loc.state.enabled;
  doc.ref = localized ? locBareOf(href) : href;
  if (localized && !loc.state.languages.includes(loc.active)) loc.active = loc.state.base;
  const file = localized ? locVariant(doc.ref, loc.active) : href;
  doc.href = file;
  $('de-title').textContent = label && label !== doc.ref ? `${label} — ${doc.ref}` : doc.ref;
  docDialog().querySelector('.de-card')?.classList.toggle('wide', lang === 'lua');
  const ed = ensureCodeEditor();
  ed.setDoc('loading…', lang);
  docDialog().showModal();
  let text = '';
  try { text = (await api.readFile(file)).text; }
  catch { $('hud').textContent = 'could not read ' + file; }
  ed.setDoc(text, lang);
  // The baseline is what the editor NOW holds, not the raw bytes: CodeMirror
  // normalises line endings (a CRLF script becomes LF), so comparing against the
  // disk text would flag an untouched file as edited and prompt on every close.
  doc.loaded = ed.getDoc();
  $('de-info').textContent = lang === 'lua' ? scriptContextNote() : '';
  renderLocTabs();
  await showLocRef();
  ed.focus();
  // The completion sources are per map, and the map may have moved on since the
  // last script was opened — a region drawn, an object named.
  if (lang === 'lua') void refreshScriptContext();
}

function ensureCodeEditor(): CodeEditor {
  if (!doc.editor) doc.editor = mountCodeEditor($('de-text'), () => saveDoc(), showLintStatus);
  return doc.editor!;
}

/**
 * Reflect the linter's verdict beside the file's name.
 *
 * The count is what a person reads before saving — a script with a missing `end`
 * is one the engine refuses to load, and the editor is the only place that ever
 * says so, since there is no compiler to run. A `.txt` reports nothing.
 */
function showLintStatus(diags: LuaDiagnostic[]): void {
  const el = $('de-lint');
  const errors = diags.filter((d) => d.severity === 'error').length;
  const warns = diags.length - errors;
  el.className = 'de-lint ' + (errors ? 'err' : warns ? 'warn' : 'ok');
  if (langOf(doc.href) !== 'lua') { el.textContent = ''; el.className = 'de-lint'; return; }
  const parts: string[] = [];
  if (errors) parts.push(`${errors} error${errors === 1 ? '' : 's'}`);
  if (warns) parts.push(`${warns} warning${warns === 1 ? '' : 's'}`);
  el.textContent = parts.length ? `⚠ ${parts.join(' · ')}` : '✓ no errors';
}

export async function refreshScriptContext(): Promise<void> {
  try {
    await loadScriptContext();
    if (docDialog().open && langOf(doc.href) === 'lua') $('de-info').textContent = scriptContextNote();
  } catch (e) {
    $('de-info').textContent = 'no completion: ' + (e instanceof Error ? e.message : String(e));
  }
}

function saveDoc(): void {
  const ed = doc.editor;
  if (!ed || !doc.href) return;
  const text = ed.getDoc();
  void api.writeFile({ href: doc.href, text })
    .then(() => {
      doc.loaded = text;
      markDirty(true);
      $('hud').textContent = `saved ${doc.href}`;
      // Save closes the editor, as it always has — EXCEPT for a localized text,
      // whose several languages are saved in turn through the tabs, so there the
      // window stays open. A script and a plain text still close on save.
      if (loc.state.enabled && langOf(doc.ref) === 'text') renderLocTabs();
      else docDialog().close();
      if (mapTreeOpen()) void refreshMapTree();
    })
    .catch((e: unknown) => { $('hud').textContent = 'save failed: ' + (e instanceof Error ? e.message : String(e)); });
}

/** True when the buffer differs from what was loaded. */
export const docEdited = (): boolean => !!doc.editor && doc.editor.getDoc() !== doc.loaded;

/** Close, asking first when there is unsaved work — a script is worth a prompt. */
async function closeDoc(): Promise<void> {
  if (docEdited() && !await ask(`${doc.href} has unsaved changes. Close anyway?`, 'Close')) return;
  docDialog().close();
}

// Esc reaches the dialog itself rather than our buttons, so the same guard has
// to sit here too — or one stray keypress throws an afternoon's script away.
// Asking cannot be awaited before the browser acts on Esc, so the close is
// always stopped and then done again if the answer says so.

// --- the map's scripts ------------------------------------------------------
//
// A mission's Lua sits beside its map.xdb, and there is otherwise no way in: the
// tree only reaches a file something REFERENCES, and a mission's scripts are
// referenced from a wrapper document rather than from the map.

export const langOf = (href: string): 'lua' | 'text' => (/\.lua$/i.test(href) ? 'lua' : 'text');

/** Bind the document editor dialog to its markup. */

export function initTextEditor(): void {
  docDialog().addEventListener('click', (e) => { if (e.target === docDialog()) void closeDoc(); });
  docDialog().addEventListener('cancel', (e) => {
    if (!docEdited()) return;
    e.preventDefault();
    void ask(`${doc.href} has unsaved changes. Close anyway?`, 'Close')
      .then((yes) => { if (yes) docDialog().close(); });
  });
  $('de-save').onclick = () => saveDoc();
  $('de-close').onclick = () => { void closeDoc(); };
  $('de-cancel').onclick = () => { void closeDoc(); };
}
