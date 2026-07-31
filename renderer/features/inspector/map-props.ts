// (header pending)

//
// The map's own properties — the original's map-properties form — read from the
// <AdvMapDesc> root through map.mapProps(). Two views in one modal: a curated
// General tab and the full field tree, mirroring the two forms the original
// offers (a friendly dialog and a raw property tree). Opened from the toolbar,
// since these are map-level and not tied to any selection.

// The eight tabs of the original's Adventure Map Properties, driven by the
// schema: each field's x-tab says where it belongs, its control comes from its
// type, its value from the map tree (map:tree). Edits go through the same path
// API as the tree, so dialog and tree stay in sync.
import { $ } from '#core/dom.ts';
import { api } from '#core/ipc.ts';
import { roster } from '#core/rosters.ts';
import { dataAt, leafRow, setMapPath } from '#features/inspector/tree.ts';
import { fileRefControl } from '#features/text-editor/document.ts';
import { controlOf, deref, mapSchema, resolveSchemaAtPath } from '#src/schema/schema.ts';
import type { TreeData } from '#src/schema/tree.ts';
import { markDirty } from '#core/dirty.ts';
import type { Path as TreePath } from '#src/schema/tree.ts';
const MP_TABS: { id: string; label: string }[] = [
  { id: 'general', label: 'General' }, { id: 'players', label: 'Players' },
  { id: 'teams', label: 'Teams' }, { id: 'heroes', label: 'Heroes' },
  { id: 'spells', label: 'Spells' }, { id: 'artifacts', label: 'Artifacts' },
  { id: 'script', label: 'Script' }, { id: 'rumours', label: 'Rumours' },
];
let mpData: TreeData = {};
let mpNameDesc = { name: '', description: '' };
let mpTab = 'general';
let mpPlayer = 0;

export const mapDialog = (): HTMLDialogElement => {
  const el = $('mapprops');
  if (!(el instanceof HTMLDialogElement)) throw new Error('#mapprops is not a <dialog>');
  return el;
};
export const mapPropsOpen = (): boolean => mapDialog().open;

export async function openMapProps(): Promise<void> {
  buildMpTabs();
  mpTab = 'general'; mpPlayer = 0;
  await loadMpData();
  renderMpTab();
  mapDialog().showModal();
}
export function closeMapProps(): void { mapDialog().close(); }

function buildMpTabs(): void {
  const bar = $('mp-tabs'); bar.innerHTML = '';
  for (const t of MP_TABS) {
    const b = document.createElement('button');
    b.className = 'mp-tab'; b.textContent = t.label; b.dataset.tab = t.id;
    b.addEventListener('click', () => { mpTab = t.id; renderMpTab(); });
    bar.appendChild(b);
  }
}

/** Read the whole map tree (values) plus the resolved name/description. */
async function loadMpData(): Promise<void> {
  try { mpData = (await api.mapTree()).tree as TreeData; } catch { mpData = {}; }
  try { const r = await api.mapProps(); mpNameDesc = { name: r.name, description: r.description }; } catch { /* keep */ }
}
/** Re-read after a structural edit (a rumour added/removed), then re-render. */
async function mpReload(): Promise<void> { await loadMpData(); renderMpTab(); }

/** The value/subtree at a path within the dialog's cached map data. */
function mpAt(path: TreePath): TreeData | undefined {
  let c: TreeData | undefined = mpData;
  for (const s of path) c = dataAt(c, s);
  return c;
}
const mpVal = (path: TreePath): string => { const v = mpAt(path); return typeof v === 'string' ? v : ''; };

function renderMpTab(): void {
  for (const b of document.querySelectorAll('.mp-tab'))
    b.classList.toggle('on', (b as HTMLElement).dataset.tab === mpTab);
  const body = $('mp-body'); body.innerHTML = '';
  ({
    general: mpGeneral, players: mpPlayers, teams: mpTeams,
    heroes: (b: HTMLElement) => mpChecklist(b, 'AvailableHeroes', 'heroes'),
    spells: (b: HTMLElement) => mpChecklist(b, 'spellIDs', 'spells'),
    artifacts: (b: HTMLElement) => mpChecklist(b, 'artifactIDs', 'artifacts'),
    script: mpScript, rumours: mpRumours,
  } as Record<string, (b: HTMLElement) => void>)[mpTab]?.(body);
}

const ph = (text: string): HTMLElement => { const d = document.createElement('div'); d.className = 'ph'; d.textContent = text; return d; };
const mpNote = (text: string): HTMLElement => { const d = document.createElement('div'); d.className = 'mp-note'; d.textContent = text; return d; };

function mpGeneral(body: HTMLElement): void {
  body.appendChild(nameBlock());
  body.appendChild(restrictHeroLevel(mpVal(['HeroMaxLevel'])));
  body.appendChild(ph('rules'));
  const skip = new Set(['HeroMaxLevel', 'NameFileRef', 'DescriptionFileRef']);
  for (const [name, raw] of Object.entries(mapSchema.properties)) {
    const field = deref(mapSchema, raw);
    if (field['x-tab'] !== 'general' || skip.has(name)) continue;
    body.appendChild(leafRow(name, field, mpVal([name]), [name]));
  }
  body.appendChild(mpNote('Size and version are read-only. The Tree panel shows every field, including advanced ones this tab omits.'));
}

function mpPlayers(body: HTMLElement): void {
  const players = mpAt(['players']);
  const n = Array.isArray(players) ? players.length : 0;
  if (!n) { body.textContent = 'this map has no players'; return; }
  if (mpPlayer >= n) mpPlayer = 0;
  const pick = document.createElement('div'); pick.className = 'mp-picker';
  const lab = document.createElement('label'); lab.textContent = 'Player:';
  const sel = document.createElement('select');
  for (let i = 0; i < n; i++) {
    const o = document.createElement('option'); o.value = String(i);
    o.textContent = `Player ${i + 1}${mpVal(['players', i, 'Colour']) ? ` (${mpVal(['players', i, 'Colour']).replace('PCOLOR_', '').toLowerCase()})` : ''}`;
    if (i === mpPlayer) o.selected = true; sel.appendChild(o);
  }
  sel.addEventListener('change', () => { mpPlayer = +sel.value; renderMpTab(); });
  pick.append(lab, sel); body.appendChild(pick);
  const playerDef = deref(mapSchema, resolveSchemaAtPath(mapSchema, ['players', 0]) || {});
  for (const [name, raw] of Object.entries(playerDef.properties ?? {})) {
    const field = deref(mapSchema, raw);
    if (field['x-tab'] !== 'players' || controlOf(field) === 'group') continue;
    body.appendChild(leafRow(name, field, mpVal(['players', mpPlayer, name]), ['players', mpPlayer, name]));
  }
}

function mpTeams(body: HTMLElement): void {
  const ct = document.createElement('label'); ct.className = 'mp-restrict';
  const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = mpVal(['CustomTeams']) === 'true';
  cb.addEventListener('change', () => { void setMapPath(['CustomTeams'], String(cb.checked)); });
  ct.append(cb, document.createTextNode('Custom teams')); body.appendChild(ct);
  const players = mpAt(['players']); const n = Array.isArray(players) ? players.length : 0;
  const table = document.createElement('table'); table.className = 'mp-teams';
  const head = document.createElement('tr'); head.appendChild(document.createElement('th'));
  for (const t of ['—', '1', '2', '3', '4', '5', '6', '7', '8']) { const th = document.createElement('th'); th.textContent = t; head.appendChild(th); }
  table.appendChild(head);
  for (let i = 0; i < n; i++) {
    const tr = document.createElement('tr');
    const pl = document.createElement('td'); pl.className = 'pl'; pl.textContent = `Player ${i + 1}`; tr.appendChild(pl);
    for (let team = 0; team <= 8; team++) {
      const td = document.createElement('td');
      const r = document.createElement('input'); r.type = 'radio'; r.name = `mpteam${i}`;
      r.checked = (+mpVal(['players', i, 'Team']) || 0) === team;
      r.addEventListener('change', () => { void setMapPath(['players', i, 'Team'], String(team)); });
      td.appendChild(r); tr.appendChild(td);
    }
    table.appendChild(tr);
  }
  body.appendChild(table);
}

/** A checklist tab (Heroes / Spells / Artifacts): the whole roster as checkboxes,
 *  with search and Check/Uncheck All; a change rewrites the list in one call. */
function mpChecklist(body: HTMLElement, fieldName: string, regName: string): void {
  const currentArr = (() => { const v = mpAt([fieldName]); return Array.isArray(v) ? v.map(String) : []; })();
  const currentSet = new Set(currentArr);
  const tools = document.createElement('div'); tools.className = 'mp-cl-tools';
  const search = document.createElement('input'); search.type = 'text'; search.placeholder = 'filter…';
  const checkAll = document.createElement('button'); checkAll.textContent = 'Check all';
  const uncheckAll = document.createElement('button'); uncheckAll.textContent = 'Uncheck all';
  const count = document.createElement('span'); count.className = 'mp-cl-count';
  tools.append(search, checkAll, uncheckAll, count);
  const grid = document.createElement('div'); grid.className = 'mp-checklist';
  body.append(tools, grid);
  grid.textContent = 'loading…';
  void roster(regName).then((entries) => {
    const ros = entries.map((e, i) => ({ id: e.id, name: e.name || e.id, order: e.order ?? i }));
    const known = new Set(ros.map((e) => e.id));
    for (const id of currentArr) if (!known.has(id)) ros.push({ id, name: id, order: ros.length });  // keep custom entries
    const updateCount = (): void => { count.textContent = `${currentSet.size} / ${ros.length}`; };
    const commitList = (): void => {
      // Written in the SOURCE table's order, not the picker's alphabetical one:
      // that is the order the game's own files keep these lists in.
      const vals = ros.filter((e) => currentSet.has(e.id))
        .sort((a, b) => a.order - b.order).map((e) => e.id);
      (mpData as Record<string, TreeData>)[fieldName] = vals;
      void api.setMapList({ path: [fieldName], values: vals }).then(() => markDirty(true));
    };
    const render = (): void => {
      const f = search.value.toLowerCase();
      grid.innerHTML = '';
      for (const e of ros) {
        if (f && !e.name.toLowerCase().includes(f) && !e.id.toLowerCase().includes(f)) continue;
        const label = document.createElement('label');
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = currentSet.has(e.id);
        cb.addEventListener('change', () => { if (cb.checked) currentSet.add(e.id); else currentSet.delete(e.id); commitList(); updateCount(); });
        label.append(cb, document.createTextNode(e.name)); label.title = e.id; grid.appendChild(label);
      }
    };
    search.addEventListener('input', render);
    checkAll.addEventListener('click', () => { ros.forEach((e) => currentSet.add(e.id)); commitList(); render(); updateCount(); });
    uncheckAll.addEventListener('click', () => { currentSet.clear(); commitList(); render(); updateCount(); });
    render(); updateCount();
  });
}

function mpScript(body: HTMLElement): void {
  const f = deref(mapSchema, mapSchema.properties.MapScript!);
  body.appendChild(leafRow('MapScript', f, mpVal(['MapScript']), ['MapScript']));
  body.appendChild(mpNote('The map script reference. Full Lua editing is Phase 5.'));
}

function mpRumours(body: HTMLElement): void {
  const rum = mpAt(['MapRumours']); const arr = Array.isArray(rum) ? rum : [];
  const rumourDef = deref(mapSchema, resolveSchemaAtPath(mapSchema, ['MapRumours', 0]) || {});
  arr.forEach((_r, i) => {
    const box = document.createElement('div'); box.className = 'mt-grp';
    const head = document.createElement('div'); head.className = 'mt-ghead';
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = `Rumour ${i + 1}`;
    const x = document.createElement('button'); x.className = 'mt-x'; x.textContent = '✕'; x.title = 'remove'; x.style.marginLeft = 'auto';
    x.addEventListener('click', () => { void api.removeMapItem({ path: ['MapRumours', i] }).then(() => { markDirty(true); return mpReload(); }); });
    head.append(nm, x); box.appendChild(head);
    for (const [name, raw] of Object.entries(rumourDef.properties ?? {})) {
      const field = deref(mapSchema, raw);
      box.appendChild(leafRow(name, field, mpVal(['MapRumours', i, name]), ['MapRumours', i, name]));
    }
    body.appendChild(box);
  });
  const add = document.createElement('div'); add.className = 'mt-add';
  const btn = document.createElement('button'); btn.textContent = '＋ add rumour';
  btn.addEventListener('click', () => { void api.addMapItem({ path: ['MapRumours'] }).then(() => { markDirty(true); return mpReload(); }); });
  add.appendChild(btn); body.appendChild(add);
}

/** The editable name + description block at the top of General. Each writes the
 *  sibling text file it references (the same files the tree's ✎ edits). When no
 *  file is referenced yet, a ref control lets one be created or picked. */
function nameBlock(): HTMLElement {
  const box = document.createElement('div');
  box.className = 'mp-name';
  box.appendChild(nameFileRow('Map name', 'NameFileRef', 'name', false));
  box.appendChild(nameFileRow('Description', 'DescriptionFileRef', 'description', true));
  return box;
}

/** One editable name/description field bound to its referenced text file. */
function nameFileRow(label: string, hrefField: string, which: 'name' | 'description', multiline: boolean): HTMLElement {
  const box = document.createElement('div');
  const k = document.createElement('div'); k.className = 'k'; k.textContent = label;
  box.appendChild(k);
  const href = mpVal([hrefField]);
  if (!href) {
    // No text file referenced — offer the …/New/✎ control to make or pick one.
    const row = document.createElement('div'); row.className = 'mt-row';
    row.appendChild(fileRefControl('', label, (v) => { void setMapPath([hrefField], v).then(mpReload); }));
    box.appendChild(row);
    return box;
  }
  const input = document.createElement(multiline ? 'textarea' : 'input') as HTMLInputElement | HTMLTextAreaElement;
  if (!multiline) (input as HTMLInputElement).type = 'text';
  input.className = multiline ? 'mp-desc-edit' : 'mp-name-edit';
  input.value = which === 'name' ? mpNameDesc.name : mpNameDesc.description;
  input.spellcheck = false;
  input.addEventListener('change', () => {
    const text = input.value;
    void api.writeFile({ href, text }).then(() => {
      markDirty(true);
      if (which === 'name') mpNameDesc.name = text; else mpNameDesc.description = text;
      $('hud').textContent = `saved ${href}`;
    }).catch((e: unknown) => { $('hud').textContent = 'save failed: ' + (e instanceof Error ? e.message : String(e)); });
  });
  box.appendChild(input);
  return box;
}

/**
 * "Restrict hero level to N": a checkbox gating a number, 0 = unrestricted,
 * matching the original's General tab. Off writes 0; on writes the number.
 */
function restrictHeroLevel(current: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'mp-restrict';
  const cur = +current || 0;
  const lab = document.createElement('label');
  const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = cur > 0;
  lab.append(cb, document.createTextNode('Restrict hero level to'));
  const num = document.createElement('input');
  num.type = 'number'; num.min = '1'; num.max = '999';
  num.value = String(cur > 0 ? cur : 40); num.disabled = cur === 0;
  wrap.append(lab, num);
  const push = (): void => { void setMapPath(['HeroMaxLevel'], cb.checked ? String(Math.max(1, +num.value || 1)) : '0'); };
  cb.addEventListener('change', () => { num.disabled = !cb.checked; if (cb.checked && !+num.value) num.value = '40'; push(); });
  num.addEventListener('change', push);
  return wrap;
}
