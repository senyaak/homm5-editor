// The Buildings window: everything a hero walks up to.
//
// THE TABS ARE THE CLASSES. A building is one of a fixed set of classes, and the class
// is not a property among others — it decides whether a behaviour is picked or
// the class IS one, what fields the document adds, and how many lines it shows
// (docs/mapPlaceables/buildings/BUILDINGS.md). So each list holds one class and
// nothing else, and New opens a form built for that class.
//
// What the form offers is read from the game's spec through mods:building-data,
// not written out here: a field the class declares is a row, and its values come
// from the same enum the game reads. Nothing to keep in step by hand.
//
// A building of ours owns its art — the build copies the whole closure behind
// the model into the mod — so the paths in the form are only where the copy
// comes FROM. After that it is ours to recolour and to edit.

import { $, $input, $select, $button } from '#core/dom.ts';
import { ask, modDialog, openOnTop } from '#core/dialog.ts';
import { api } from '#core/ipc.ts';
import { pickPreset } from '#features/mods/preset.ts';
import { openRecolor } from '#features/mods/recolor.ts';
import { modRow, NL } from '#features/mods/shared.ts';
import { requireFilled } from '#core/form-gate.ts';
import type { BuildingClassDTO, ModBuildingDTO, ModsBuildingDataResult } from '#electron/ipc.ts';

/** The classes, donors and value lists, fetched once. */
let bldData: Promise<ModsBuildingDataResult> | null = null;
const buildingData = (): Promise<ModsBuildingDataResult> => (bldData ??= api.buildingData());

/** Which class's list is open. */
let activeClass = '';
/** The file stem being edited, or '' when the form is making a new one. */
let editingFile = '';
/** The art slots, as the form holds them. */
const ART: ReadonlyArray<[string, 'model' | 'animSet' | 'effect' | 'sound' | 'icon']> = [
  ['bld-model', 'model'], ['bld-animset', 'animSet'],
  ['bld-effect', 'effect'], ['bld-sound', 'sound'], ['bld-icon', 'icon'],
];

const classOf = (data: ModsBuildingDataResult, shared: string): BuildingClassDTO =>
  data.classes.find((c) => c.shared === shared) ?? data.classes[0]!;

/** Open the window, on the class it was last left on. */
export async function openBuildings(): Promise<void> {
  const data = await buildingData();
  if (!activeClass) activeClass = data.classes[0]!.shared;
  drawTabs(data);
  modDialog('bldmod').showModal();
  await refreshBuildings();
}

/** One tab per class. The count rides along, so an empty class says so. */
function drawTabs(data: ModsBuildingDataResult): void {
  const box = $('bld-tabs');
  box.innerHTML = '';
  for (const c of data.classes) {
    const tab = document.createElement('button');
    tab.className = 'mp-tab' + (c.shared === activeClass ? ' on' : '');
    tab.textContent = c.label;
    tab.title = c.about;
    tab.onclick = () => {
      activeClass = c.shared;
      drawTabs(data);
      void refreshBuildings();
    };
    box.appendChild(tab);
  }
}

/** The installed buildings of the open class. */
async function refreshBuildings(): Promise<void> {
  const data = await buildingData();
  const cls = classOf(data, activeClass);
  $('bld-legend').textContent = `Installed — ${cls.label}`;
  $('bld-about').textContent = cls.about;
  $button('bld-new').textContent = `New ${cls.label.toLowerCase()}…`;
  const list = $('bld-list');
  list.innerHTML = '';
  $('bld-err').textContent = '';

  const { gameRoot, mods } = await api.listMods();
  if (!gameRoot) {
    list.innerHTML = '<div class="um-empty">no game install configured — nowhere to install to</div>';
    return;
  }
  let n = 0;
  for (const m of mods) {
    for (const b of (m.buildings ?? []).filter((x) => x.className === activeClass)) {
      n++;
      const row = modRow({
        number: n,
        label: b.messages?.name || b.file,
        note: b.type ?? b.file,
        onEdit: () => { void openBuildingForm(b); },
        onRemove: () => { void removeBuilding(b); },
      });
      // Its textures are the mod's own copies, so repainting one touches nothing
      // shipped — the same brush the creature list carries.
      if (!m.reconstructed) {
        const paint = document.createElement('button');
        paint.className = 'um-recolor um-paint';
        paint.textContent = '🎨';
        paint.title = `repaint ${b.file}'s textures`;
        paint.onclick = () => {
          void openRecolor({ building: b.file }, b.messages?.name || b.file).catch((e: unknown) => {
            $('bld-err').textContent = e instanceof Error ? e.message : String(e);
          });
        };
        row.insertBefore(paint, row.lastChild);
      }
      list.appendChild(row);
    }
  }
  if (!n) list.innerHTML = `<div class="um-empty">none of this class yet — the game's own are untouched</div>`;
}

async function removeBuilding(b: ModBuildingDTO): Promise<void> {
  const label = b.messages?.name || b.file;
  // A map names a building by the path of its definition, so removing one breaks
  // whatever placed it — said plainly rather than searched for, which is a scan
  // of every map for a path the placement stores.
  if (!await ask(`Remove ${label}?${NL}${NL}Any map that placed it will stop resolving it.`, 'Remove')) return;
  try {
    await api.removeBuilding({ file: b.file });
    await refreshBuildings();
  } catch (e) {
    $('bld-err').textContent = e instanceof Error ? e.message : String(e);
  }
}

/** Open the form: blank for a new building, filled for one being changed. */
async function openBuildingForm(existing: ModBuildingDTO | null): Promise<void> {
  const data = await buildingData();
  const cls = classOf(data, existing?.className ?? activeClass);
  editingFile = existing?.file ?? '';

  $('bldedit-title').textContent = existing ? `Edit ${cls.label.toLowerCase()}` : `New ${cls.label.toLowerCase()}`;
  $('bld-form-legend').textContent = cls.label;
  $('bld-editing').textContent = existing ? `editing ${existing.file} — its identifier cannot change` : '';
  $('bld-form-err').textContent = '';
  $input('bld-donor').value = '';
  $('bld-donor-name').textContent = 'nothing yet — the form is blank';
  $input('bld-file').value = existing?.file ?? '';
  $input('bld-file').readOnly = !!existing;

  // The behaviour, for the seven classes that pick one.
  $('bld-typerow').style.display = cls.takesType ? '' : 'none';
  if (cls.takesType) {
    const sel = $select('bld-type');
    sel.innerHTML = '';
    for (const t of data.types) {
      const o = document.createElement('option');
      o.value = t;
      o.textContent = t;
      sel.appendChild(o);
    }
    sel.value = existing?.type ?? data.types[0] ?? '';
  }

  for (const [id, slot] of ART) $input(id).value = existing?.[slot] ?? '';
  $input('bld-bake').value = String(existing?.bake?.tiles ?? 0);
  $input('bld-bake-ground').value = existing?.bake?.ground === undefined ? '' : String(existing.bake.ground);
  fillArtLists(data);
  drawClassFields(data, cls, existing?.fields ?? {});
  drawTexts(cls, existing?.messages ?? {});
  // Every control the form has now exists, so the check can watch them all.
  watchForm();
  $button('bld-recolor').style.display = existing ? '' : 'none';
  $button('bld-recolor').onclick = () => {
    if (!existing) return;
    void openRecolor({ building: existing.file }, existing.messages?.name || existing.file).catch((e: unknown) => {
      $('bld-form-err').textContent = e instanceof Error ? e.message : String(e);
    });
  };
  openOnTop('bldedit');
}

/**
 * What the art boxes suggest: every path the shipped objects use for that slot.
 *
 * A suggestion list rather than a picker of its own, because these are paths
 * into the game's data and the person usually wants the one a shipped building
 * already uses — which is exactly what a preset gives them in one press.
 */
function fillArtLists(data: ModsBuildingDataResult): void {
  const seen: Record<string, Set<string>> = {
    'bld-models': new Set(), 'bld-animsets': new Set(),
    'bld-effects': new Set(), 'bld-sounds': new Set(), 'bld-icons': new Set(),
  };
  for (const d of data.donors) {
    // The donor list carries paths, not art; the art comes with the preset. What
    // can be offered without reading 234 documents is the donor path itself, so
    // the model box suggests the definitions and the rest stay free text until a
    // preset fills them.
    seen['bld-models']!.add(d.path);
  }
  for (const [id, values] of Object.entries(seen)) {
    const box = $(id);
    box.innerHTML = '';
    for (const v of [...values].sort()) {
      const o = document.createElement('option');
      o.value = v;
      box.appendChild(o);
    }
  }
}

/**
 * What is still missing, and whether Save may be pressed.
 *
 * The rule is the same one the channel would have thrown after the press: an
 * identifier names the folder, a model is the thing that stands on the map, the
 * name is what the palette and the flyover show, and a class's required field is
 * what makes the building that class (a dwelling with no creatures hires
 * nobody). Refusing early beats refusing after a rebuild — and naming what is
 * missing beats a disabled button with no reason on it.
 */
let gate: { check: () => void; rewatch: () => void } | null = null;

/**
 * Built on the first draw, not at load: the class's own rows and its text boxes
 * do not exist until a class is chosen, and they are drawn again whenever it
 * changes.
 */
const formGate = (): { check: () => void; rewatch: () => void } => (gate ??= requireFilled({
  ok: 'bld-ok',
  missing: 'bld-missing',
  fields: { identifier: 'bld-file', model: 'bld-model' },
  extra: () => {
    const missing: string[] = [];
    const name = document.querySelector<HTMLInputElement>('.bld-text');
    if (name && !name.value.trim()) missing.push('name');
    for (const el of document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('.bld-field')) {
      if (el.dataset.required && !el.value.trim()) missing.push(el.dataset.field ?? 'a field');
    }
    return missing;
  },
  watch: '#bldedit .bld-field, #bldedit .bld-text',
}));

/** Watch every control the check reads, so the button follows the typing. */
function watchForm(): void {
  formGate().rewatch();
}

/** A row per field the class declares, with the game's own values where it has them. */
function drawClassFields(data: ModsBuildingDataResult, cls: BuildingClassDTO, values: Record<string, string | string[]>): void {
  const box = $('bld-fields');
  box.innerHTML = '';
  if (!cls.fields.length) return;
  const head = document.createElement('div');
  head.className = 'on-row um-span';
  head.innerHTML = `<span style="opacity:.7">${cls.label} — its own fields</span>`;
  box.appendChild(head);
  for (const name of cls.fields) {
    const row = document.createElement('label');
    row.className = 'on-row um-span';
    const label = document.createElement('span');
    label.textContent = name;
    // The star means Save will not go until it is filled — see formGate.
    if (cls.required.includes(name)) {
      const star = document.createElement('b');
      star.className = 'req';
      star.textContent = '*';
      label.appendChild(star);
    }
    const current = values[name];
    const choices = data.enums[name];
    let control: HTMLElement;
    if (choices?.length) {
      const sel = document.createElement('select');
      sel.dataset.field = name;
      for (const v of choices) {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = v;
        sel.appendChild(o);
      }
      sel.value = typeof current === 'string' ? current : choices[0]!;
      control = sel;
    } else {
      const input = document.createElement('input');
      input.type = 'text';
      input.spellcheck = false;
      input.dataset.field = name;
      // Whether this is a list is the SPEC's answer, carried on the class —
      // never guessed from the value. One creature typed into `creatures` has no
      // comma in it, and written as a plain value the dwelling hires nothing.
      if (cls.lists.includes(name)) input.dataset.list = 'yes';
      if (cls.required.includes(name)) input.dataset.required = 'yes';
      input.dataset.field = name;
      input.value = Array.isArray(current) ? current.join(', ') : (current ?? '');
      input.placeholder = cls.lists.includes(name) ? 'one per comma' : '';
      control = input;
    }
    control.classList.add('bld-field');
    row.append(label, control);
    box.appendChild(row);
  }
}

/** A box per line the class shows, in the order the engine reads them. */
function drawTexts(cls: BuildingClassDTO, values: Record<string, string>): void {
  const box = $('bld-texts');
  box.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'on-row um-span';
  head.innerHTML = '<span style="opacity:.7">What it says — shipped as our own text files</span>';
  box.appendChild(head);
  for (const [i, slot] of cls.slots.entries()) {
    const row = document.createElement('label');
    row.className = 'on-row um-span';
    const label = document.createElement('span');
    label.textContent = slot;
    // The first line is the NAME — what the palette lists it under and what the
    // flyover shows. A building without one is a nameless thing in both.
    if (i === 0) {
      const star = document.createElement('b');
      star.className = 'req';
      star.textContent = '*';
      label.appendChild(star);
    }
    const input = document.createElement('input');
    input.type = 'text';
    input.dataset.slot = slot;
    input.className = 'bld-text';
    input.value = values[slot] ?? '';
    row.append(label, input);
    box.appendChild(row);
  }
}

/** Read the class-field rows back. */
function readClassFields(): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const el of document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('.bld-field')) {
    const name = el.dataset.field;
    const value = el.value.trim();
    if (!name || !value) continue;
    out[name] = el.dataset.list
      ? value.split(',').map((v) => v.trim()).filter(Boolean)
      : value;
  }
  return out;
}

/**
 * The bake, when one was asked for.
 *
 * Zero tiles is "use the model as it lies", which is right for every model that
 * is already adventure-map art — so the field is absent rather than zero, and a
 * building keeps no bake it does not need.
 */
function bakeFrom(): { bake?: { tiles: number; ground?: number } } {
  const tiles = Number($input('bld-bake').value) || 0;
  if (tiles <= 0) return {};
  const ground = $input('bld-bake-ground').value.trim();
  return { bake: { tiles, ...(ground === '' ? {} : { ground: Number(ground) }) } };
}

function readTexts(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const el of document.querySelectorAll<HTMLInputElement>('.bld-text')) {
    const slot = el.dataset.slot;
    if (slot && el.value.trim()) out[slot] = el.value;
  }
  return out;
}

/** Fill every field from a shipped object of the open class. */
async function loadBuildingPreset(): Promise<void> {
  const donor = $input('bld-donor').value;
  if (!donor) return;
  const data = await buildingData();
  const p = await api.buildingPreset(donor);
  const cls = classOf(data, p.className);
  if (cls.takesType && p.type) $select('bld-type').value = p.type;
  for (const [id, slot] of ART) $input(id).value = p[slot] ?? '';
  drawClassFields(data, cls, p.fields);
  drawTexts(cls, p.messages);
  // The preset filled most of what the check looks at, and the rows it drew are
  // new elements — so the watch is re-attached and the button re-decided.
  watchForm();
}

async function submitBuilding(): Promise<void> {
  const ok = $button('bld-ok');
  ok.disabled = true;
  $('bld-form-err').textContent = '';
  $('bld-note').textContent = '';
  try {
    const data = await buildingData();
    const cls = classOf(data, activeClass);
    const art: Record<string, string> = {};
    for (const [id, slot] of ART) art[slot] = $input(id).value.trim();
    const payload = {
      file: $input('bld-file').value,
      className: editingFile ? (classOf(data, activeClass).shared) : cls.shared,
      ...(cls.takesType ? { type: $select('bld-type').value } : {}),
      model: art.model ?? '',
      ...(art.animSet ? { animSet: art.animSet } : {}),
      ...(art.effect ? { effect: art.effect } : {}),
      ...(art.sound ? { sound: art.sound } : {}),
      ...(art.icon ? { icon: art.icon } : {}),
      messages: readTexts(),
      fields: readClassFields(),
      ...bakeFrom(),
    };
    const send = editingFile ? api.updateBuilding : api.installBuilding;
    const res = await send(payload);
    // The note belongs to the LIST, not to the form: the form closes on success,
    // and a message written into a closing dialog is one nobody reads.
    $('bld-note').textContent = `installed ${res.archive}\n${res.art} file(s) under Buildings/${res.file}/`;
    await refreshBuildings();
    modDialog('bldedit').close();
  } catch (e) {
    $('bld-form-err').textContent = e instanceof Error ? e.message : String(e);
  } finally {
    ok.disabled = false;
  }
}

/** Bind the window to its markup. Called once, at start-up. */
export function initBuildingsMod(): void {
  $('bldbtn').onclick = () => {
    void openBuildings().catch((e: unknown) => {
      $('bld-err').textContent = e instanceof Error ? e.message : String(e);
    });
  };
  $('bld-close').onclick = () => modDialog('bldmod').close();
  $('bld-cancel').onclick = () => modDialog('bldmod').close();
  $('bldedit-x').onclick = () => modDialog('bldedit').close();
  $('bld-form-cancel').onclick = () => modDialog('bldedit').close();
  $('bld-new').onclick = () => { void openBuildingForm(null); };
  $('bld-ok').onclick = () => { void submitBuilding(); };
  $('bld-donor-pick').onclick = () => {
    void (async () => {
      const data = await buildingData();
      // Only this class's own: a preset from another class would fill fields the
      // form does not have and leave the ones it does empty.
      const entries = data.donors
        .filter((d) => d.className === activeClass)
        .map((d) => ({ id: d.path, label: d.name ? `${d.name} — ${d.path}` : d.path }));
      pickPreset(`Start from a shipped ${classOf(data, activeClass).label.toLowerCase()}`, entries, (id, label) => {
        $input('bld-donor').value = id;
        $('bld-donor-name').textContent = label;
        void loadBuildingPreset();
      });
    })();
  };
}
