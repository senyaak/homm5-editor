// (header pending)

//
// A text ref names the plain `name.txt`, but with localization on that file is an
// export artefact — the sources are TAGGED (`name.en.txt`, `name.ru.txt`). So the
// editor resolves the ref to the active language's tagged file, works on that, and
// the tabs switch which language is active. See electron/main.ts for the model.

import { ask } from '#core/dialog.ts';
import { $ } from '#core/dom.ts';
import { api } from '#core/ipc.ts';
import { mapTreeOpen, refreshMapTree } from '#features/inspector/tree.ts';
import { mountCodeEditor } from '#features/text-editor/code-editor.ts';
import type { CodeEditor } from '#features/text-editor/code-editor.ts';
import { loadScriptContext, scriptContextNote } from '#features/text-editor/context.ts';
import { doc, docDialog, langOf, openTextEdit, docEdited } from '#features/text-editor/document.ts';
import type { LuaDiagnostic } from '#src/script/lua-lint.ts';
import { markDirty } from '#core/dirty.ts';
import type { LocResult } from '#electron/ipc.ts';
interface LocLangDef { code: string; name: string }
const LOC_LANGS: LocLangDef[] = [
  { code: 'en', name: 'English' }, { code: 'ru', name: 'Russian' }, { code: 'de', name: 'German' },
  { code: 'fr', name: 'French' }, { code: 'es', name: 'Spanish' }, { code: 'it', name: 'Italian' },
  { code: 'pl', name: 'Polish' }, { code: 'cz', name: 'Czech' }, { code: 'hu', name: 'Hungarian' },
];
const LOC_KNOWN = new Set(LOC_LANGS.map((l) => l.code));
const langName = (code: string): string => LOC_LANGS.find((l) => l.code === code)?.name ?? code.toUpperCase();
const LOC_TAG_RE = /\.([a-z]{2})\.txt$/i;
const locTagOf = (href: string): string => { const t = LOC_TAG_RE.exec(href)?.[1]?.toLowerCase(); return t && LOC_KNOWN.has(t) ? t : ''; };
export const locBareOf = (href: string): string => (locTagOf(href) ? href.replace(LOC_TAG_RE, '.txt') : href);
export const locVariant = (bare: string, lang: string): string => bare.replace(/\.txt$/i, `.${lang}.txt`);

/** The map's localization, and which language tab is being edited. */
export const loc = {
  state: { enabled: false, base: '', languages: [] } as LocResult,
  active: '',
};

/** Fetch the map's localization state (called when a map opens). */
export async function loadLocState(): Promise<void> {
  try { loc.state = await api.locGet(); }
  catch { loc.state = { enabled: false, base: '', languages: [] }; }
  if (!loc.state.languages.includes(loc.active)) loc.active = loc.state.base;
}

/**
 * Open a file of the map folder in the editor.
 *
 * The same window for a one-line name.txt and for a 700-line mission script:
 * both are files the map carries, and the difference — highlighting, completion
 * and the room to read — follows from the name. With localization on, a text ref
 * resolves to the active language's tagged file.
 */
/** The language tabs above the editor — one per project language, plus "＋ add". */
export function renderLocTabs(): void {
  const bar = $('de-langs');
  const show = loc.state.enabled && langOf(doc.ref) === 'text';
  bar.hidden = !show;
  if (!show) { bar.innerHTML = ''; return; }
  bar.innerHTML = '';
  for (const code of loc.state.languages) {
    const b = document.createElement('button');
    b.textContent = langName(code) + (code === loc.state.base ? ' · base' : '');
    b.dataset.lang = code;
    if (code === loc.active) b.className = 'active';
    b.addEventListener('click', () => void switchLocTab(code));
    bar.appendChild(b);
  }
  const missing = LOC_LANGS.filter((l) => !loc.state.languages.includes(l.code));
  if (missing.length) {
    const sel = document.createElement('select');
    sel.className = 'de-addlang';
    sel.appendChild(new Option('＋ add language', ''));
    for (const l of missing) sel.appendChild(new Option(l.name, l.code));
    sel.addEventListener('change', () => { if (sel.value) void addLocLanguage(sel.value); });
    bar.appendChild(sel);
  }
}

/** While translating a non-base language, show the base text so the source is in view. */
export async function showLocRef(): Promise<void> {
  const ref = $('de-ref');
  if (!loc.state.enabled || langOf(doc.ref) !== 'text' || loc.active === loc.state.base) { ref.hidden = true; return; }
  let base = '';
  try { base = (await api.readFile(locVariant(doc.ref, loc.state.base))).text; }
  catch { /* the base may not exist yet */ }
  ref.hidden = false;
  ref.innerHTML = '';
  const b = document.createElement('b');
  b.textContent = `${langName(loc.state.base)}: `;
  ref.append(b, document.createTextNode(base || '(empty)'));
}

/** Switch the editor to another language, guarding unsaved work. */
async function switchLocTab(code: string): Promise<void> {
  if (code === loc.active) return;
  if (docEdited() && !await ask(`${doc.href} has unsaved changes. Switch language anyway?`, 'Switch')) {
    renderLocTabs();   // keep the visual on the language still open
    return;
  }
  loc.active = code;
  await openTextEdit(doc.ref, doc.label);
}

/** Add a language: provisions a copy of every base text, then edits it. */
async function addLocLanguage(code: string): Promise<void> {
  try { loc.state = await api.locAddLanguage({ lang: code }); markDirty(true); }
  catch (e) { $('hud').textContent = 'could not add language: ' + (e instanceof Error ? e.message : String(e)); return; }
  loc.active = code;
  await openTextEdit(doc.ref, doc.label);
}

/** Fetch the completion sources and reflect them in the open editor. */
const scriptDialog = (): HTMLDialogElement => {
  const el = $('scriptpick');
  if (!(el instanceof HTMLDialogElement)) throw new Error('#scriptpick is not a <dialog>');
  return el;
};

async function openScriptList(): Promise<void> {
  const list = $('sp-list');
  list.innerHTML = '';
  const note = document.createElement('div');
  note.className = 'sp-empty';
  note.textContent = 'reading the map folder…';
  list.appendChild(note);
  scriptDialog().showModal();
  let files: string[] = [];
  try { files = (await api.mapFiles({ exts: ['.lua'] })).files; }
  catch (e) { note.textContent = 'could not list: ' + (e instanceof Error ? e.message : String(e)); return; }
  list.innerHTML = '';
  if (!files.length) {
    const d = document.createElement('div');
    d.className = 'sp-empty';
    d.textContent = 'This map carries no .lua files yet.';
    list.appendChild(d);
    return;
  }
  for (const f of files) {
    const b = document.createElement('button');
    b.textContent = f;
    b.dataset.file = f;
    b.addEventListener('click', () => { scriptDialog().close(); void openTextEdit(f, f); });
    list.appendChild(b);
  }
}


// --- the Localization dialog -------------------------------------------------
//
// Turn localization on for the map, declare what language the existing texts are
// in, and add or remove target languages. Everything else (editing each language,
// exporting one) happens elsewhere — this is where the set of languages lives.

const locDialog = (): HTMLDialogElement => {
  const el = $('localize');
  if (!(el instanceof HTMLDialogElement)) throw new Error('#localize is not a <dialog>');
  return el;
};

async function openLocDialog(): Promise<void> {
  await loadLocState();
  renderLocDialog();
  locDialog().showModal();
}

/** Build the dialog body from the current state — enable, or manage languages. */
function renderLocDialog(): void {
  const body = $('lz-body');
  body.innerHTML = '';
  if (!loc.state.enabled) {
    // Not yet localized: pick the language the existing texts are in and enable.
    const p = document.createElement('div'); p.className = 'lz-note';
    p.textContent = 'Author the map\'s texts in several languages side by side, and export one language at a time. '
      + 'The existing texts are tagged with the base language you pick here.';
    const row = document.createElement('div'); row.className = 'lz-row';
    const lab = document.createElement('span'); lab.textContent = 'Base language:';
    const sel = document.createElement('select');
    for (const l of LOC_LANGS) sel.appendChild(new Option(l.name, l.code));
    sel.value = 'en';
    const btn = document.createElement('button'); btn.textContent = 'Enable localization';
    btn.addEventListener('click', () => void enableLoc(sel.value));
    row.append(lab, sel, btn);
    body.append(p, row);
    return;
  }
  // Enabled: list the languages, export each, add a target, remove a target.
  const note = document.createElement('div'); note.className = 'lz-note';
  note.textContent = `Texts are authored in ${loc.state.languages.length} language(s). `
    + 'Edit each in the text window\'s tabs; export one at a time as an ordinary map.';
  const list = document.createElement('div'); list.className = 'lz-langs';
  for (const code of loc.state.languages) {
    const row = document.createElement('div'); row.className = 'lz-lang';
    const name = document.createElement('span'); name.textContent = langName(code);
    row.appendChild(name);
    if (code === loc.state.base) {
      const b = document.createElement('span'); b.className = 'lz-base'; b.textContent = 'base'; row.appendChild(b);
    }
    const exp = document.createElement('button'); exp.className = 'lz-export'; exp.textContent = 'export .h5m';
    exp.title = `pack a single-language ${code} map`;
    exp.addEventListener('click', () => void exportLoc(code));
    row.appendChild(exp);
    if (code !== loc.state.base) {
      const rm = document.createElement('button'); rm.className = 'lz-rm'; rm.textContent = 'remove'; rm.title = `delete every ${code}.txt`;
      rm.addEventListener('click', () => void removeLoc(code));
      row.appendChild(rm);
    }
    list.appendChild(row);
  }
  const addRow = document.createElement('div'); addRow.className = 'lz-row';
  const missing = LOC_LANGS.filter((l) => !loc.state.languages.includes(l.code));
  if (missing.length) {
    const sel = document.createElement('select');
    sel.appendChild(new Option('＋ add a language…', ''));
    for (const l of missing) sel.appendChild(new Option(l.name, l.code));
    sel.addEventListener('change', () => { if (sel.value) void addLocFromDialog(sel.value); });
    addRow.appendChild(sel);
  }
  body.append(note, list, addRow);
}

async function enableLoc(base: string): Promise<void> {
  try { loc.state = await api.locEnable({ base }); markDirty(true); $('hud').textContent = `localization on · base ${base}`; }
  catch (e) { $('hud').textContent = 'could not enable: ' + (e instanceof Error ? e.message : String(e)); return; }
  loc.active = loc.state.base;
  renderLocDialog();
}

async function addLocFromDialog(code: string): Promise<void> {
  try { loc.state = await api.locAddLanguage({ lang: code }); markDirty(true); }
  catch (e) { $('hud').textContent = 'could not add language: ' + (e instanceof Error ? e.message : String(e)); return; }
  renderLocDialog();
}

async function exportLoc(code: string): Promise<void> {
  $('hud').textContent = `exporting ${code}…`;
  try {
    const r = await api.locExport({ lang: code });
    if ('ok' in r) $('hud').textContent = `exported ${langName(code)} → ${r.output} (${r.entries} files)`;
    else $('hud').textContent = 'export cancelled';
  } catch (e) { $('hud').textContent = 'export failed: ' + (e instanceof Error ? e.message : String(e)); }
}

async function removeLoc(code: string): Promise<void> {
  if (!await ask(`Remove ${langName(code)}? Every ${code}.txt is deleted.`, 'Remove')) return;
  try { loc.state = await api.locRemoveLanguage({ lang: code }); markDirty(true); }
  catch (e) { $('hud').textContent = 'could not remove: ' + (e instanceof Error ? e.message : String(e)); return; }
  if (loc.active === code) loc.active = loc.state.base;
  renderLocDialog();
}


/** Bind the localization dialog and the script list. */

export function initLocalization(): void {
  scriptDialog().addEventListener('click', (e) => { if (e.target === scriptDialog()) scriptDialog().close(); });
  locDialog().addEventListener('click', (e) => { if (e.target === locDialog()) locDialog().close(); });
  $('scriptbtn').onclick = () => void openScriptList();
  $('sp-close').onclick = () => scriptDialog().close();
  $('locbtn').onclick = () => void openLocDialog();
  $('lz-close').onclick = () => locDialog().close();
}
