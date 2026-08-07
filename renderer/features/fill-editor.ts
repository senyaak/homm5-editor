// Making a fill preset: the window behind New / Copy / Edit in the Fills panel.
//
// A preset is four numbers per layer and a list of objects, and none of it means
// anything on its own — so the window is built around saying what the numbers
// DO. Layers are listed in the order they read as bands (outermost first, the
// order the panel shows), the inset each one actually starts at is computed
// beside its Width, and the footer plants the draft on a scratch 8x8 patch so
// "is this too thick" is a number rather than a guess. That preview runs the
// real planner (src/fill/plan.ts) — the same code the fill itself uses.
//
// The shipped presets are files we do not own: the game's Editor folder and the
// editor's own assets. Editing one opens a COPY, which is why the window takes
// a source and a mode rather than a file position.

import { $, $button, $input } from '#core/dom.ts';
import { ask, modDialog } from '#core/dialog.ts';
import { api } from '#core/ipc.ts';
import { pickPreset } from '#features/mods/preset.ts';
import { planFill } from '#src/fill/plan.ts';
import { insetOf } from '#src/fill/plan.ts';
import { presetFromDraft, presetRefOf } from '#src/fill/preset.ts';
import type { FillDraft, FillDraftLayer } from '#src/fill/preset.ts';
import type { FillPresetInfo } from '#electron/ipc.ts';

/** The draft on screen. Rebuilt whenever the window opens. */
let draft: FillDraft = { name: '', layers: [] };
/** The preset this replaces on save, or null when it is a new one. */
let replacing: string | null = null;
/**
 * Told after a save, with the name that was written.
 *
 * The name and not just "something changed": the panel re-reads the list and
 * has to land on the preset that was just saved, which is neither where it was
 * before (a new one did not exist) nor derivable from the button pressed (the
 * name box is editable, so a copy is not necessarily "X copy").
 */
let afterSave: ((name: string) => void) | null = null;

/** Catalogue entries a preset can name, fetched once. */
let choices: { id: string; label: string }[] | null = null;

const dialog = (): HTMLDialogElement => modDialog('fillpreset');

/** A fresh layer: one tile spacing, nothing in it yet. */
const blankLayer = (): FillDraftLayer => ({ dispersion: 1, width: 0, noRandomAngle: false, objects: [] });

/**
 * The objects a preset can name, as the picker lists them.
 *
 * Everything in the catalogue whose shared reference is a `MapObjects` path with
 * a class on it — which is what a preset's `Type` + `ID` spell out. That is most
 * of it, and it deliberately includes the "Shared: …" entries no object link
 * points at (fences, mushrooms, particular trees) and anything a mod added,
 * since those are exactly what a hand-made preset reaches for.
 */
async function objectChoices(): Promise<{ id: string; label: string }[]> {
  if (choices) return choices;
  const { objects } = await api.listObjects();
  const seen = new Set<string>();
  choices = [];
  for (const o of objects) {
    const ref = presetRefOf(o.shared);
    if (!ref) continue;
    const key = `${ref.type}|${ref.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // The catalogue's label is the icon cache's name where there is one and the
    // file name where there is not; saying both is only useful when they differ.
    choices.push({ id: key, label: o.label === o.name ? o.name : `${o.label} · ${o.name}` });
  }
  return choices;
}

/**
 * Number box that writes straight back into the draft.
 *
 * Tagged with what it edits: the fields are four numbers that look alike, and a
 * test (or a person reading the DOM) needs to say which one it means.
 */
function numberBox(field: string, value: number, title: string, min: number, step: number, set: (v: number) => void): HTMLInputElement {
  const el = document.createElement('input');
  el.type = 'number';
  el.dataset.field = field;
  el.value = String(value);
  el.min = String(min);
  el.step = String(step);
  el.title = title;
  el.addEventListener('change', () => {
    const v = Number(el.value);
    set(Number.isFinite(v) ? v : min);
    render();
  });
  return el;
}

function render(): void {
  const box = $('fp-layers');
  box.innerHTML = '';
  const model = safePreset();
  draft.layers.forEach((layer, i) => {
    const card = document.createElement('div');
    card.className = 'fp-layer';
    card.dataset.layer = String(i);

    const head = document.createElement('div');
    head.className = 'head';
    const title = document.createElement('b');
    title.textContent = `layer ${i + 1}`;
    const sp = document.createElement('span');
    sp.className = 'sp';
    // What this layer's Width actually amounts to for the ones after it. The
    // raw number is meaningless alone — it is the running total that decides
    // where a band starts (docs/FILL_TOOL.md).
    const inset = document.createElement('span');
    inset.className = 'num';
    inset.textContent = model ? `starts ${insetOf(model.layers, i)} in from the edge` : '';
    const up = document.createElement('button');
    up.textContent = '↑'; up.title = 'move outward — earlier layers are planted last and reach the edge';
    up.disabled = i === 0;
    up.onclick = () => { const [l] = draft.layers.splice(i, 1); draft.layers.splice(i - 1, 0, l!); render(); };
    const down = document.createElement('button');
    down.textContent = '↓'; down.title = 'move inward';
    down.disabled = i === draft.layers.length - 1;
    down.onclick = () => { const [l] = draft.layers.splice(i, 1); draft.layers.splice(i + 1, 0, l!); render(); };
    const del = document.createElement('button');
    del.className = 'danger'; del.textContent = '✕'; del.title = 'remove this layer';
    del.onclick = () => { draft.layers.splice(i, 1); render(); };
    head.append(title, sp, inset, up, down, del);

    const nums = document.createElement('div');
    nums.className = 'nums';
    const spacing = document.createElement('label');
    spacing.textContent = 'every';
    spacing.append(numberBox('dispersion', layer.dispersion, 'grid spacing in tiles — smaller is denser', 0.1, 0.1,
      (v) => { layer.dispersion = v; }));
    const width = document.createElement('label');
    width.textContent = 'push later layers in by';
    width.append(numberBox('width', layer.width, 'how much further from the painted edge every LATER layer starts', 0, 0.25,
      (v) => { layer.width = v; }));
    const still = document.createElement('label');
    still.className = 'check';
    const stillBox = document.createElement('input');
    stillBox.type = 'checkbox';
    stillBox.checked = layer.noRandomAngle;
    stillBox.title = 'plant everything in this layer at its authored facing';
    stillBox.onchange = () => { layer.noRandomAngle = stillBox.checked; };
    still.append(stillBox, document.createTextNode(' keep facings'));
    nums.append(spacing, width, still);

    const list = document.createElement('div');
    list.className = 'objs';
    layer.objects.forEach((o, j) => {
      const row = document.createElement('div');
      row.className = 'obj';
      const name = document.createElement('span');
      name.className = 'nm';
      name.textContent = o.id.split('\\').pop() ?? o.id;
      name.title = `${o.type}  ${o.id}`;
      const size = document.createElement('label');
      size.textContent = 'size';
      size.append(numberBox('size', o.size, 'radius in tiles: kept clear of the painted edge and of other objects', 0, 0.05,
        (v) => { o.size = v; }));
      const chance = document.createElement('label');
      chance.textContent = 'chance';
      chance.append(numberBox('probability', o.probability, 'chance a lattice point of this layer keeps this object, 0..1', 0, 0.05,
        (v) => { o.probability = Math.min(1, v); }));
      const fixed = document.createElement('label');
      fixed.className = 'check';
      const fixedBox = document.createElement('input');
      fixedBox.type = 'checkbox';
      fixedBox.checked = o.noRandomAngle;
      fixedBox.title = 'plant this one at its authored facing';
      fixedBox.onchange = () => { o.noRandomAngle = fixedBox.checked; };
      fixed.append(fixedBox);
      const drop = document.createElement('button');
      drop.className = 'danger'; drop.textContent = '✕'; drop.title = 'take it out of this layer';
      drop.onclick = () => { layer.objects.splice(j, 1); render(); };
      row.append(name, size, chance, fixed, drop);
      list.append(row);
    });

    const add = document.createElement('button');
    add.className = 'ghost fp-add';
    add.textContent = '+ object…';
    add.onclick = () => { void addObject(layer); };
    card.append(head, nums, list, add);
    box.append(card);
  });
  if (!draft.layers.length) {
    const empty = document.createElement('div');
    empty.className = 'fp-empty';
    empty.textContent = 'no layers yet — a preset needs at least one';
    box.append(empty);
  }
  preview();
}

/** Add an object to a layer, chosen from the catalogue. */
async function addObject(layer: FillDraftLayer): Promise<void> {
  let entries: { id: string; label: string }[];
  try { entries = await objectChoices(); }
  catch (e) { $('fp-err').textContent = e instanceof Error ? e.message : String(e); return; }
  pickPreset('Add an object to this layer', entries, (id) => {
    const [type, path] = id.split('|');
    if (!type || !path) return;
    // Sensible starting numbers rather than zeros: a candidate at probability 0
    // is one that never appears, which reads as the object not having been added.
    layer.objects.push({ type, id: path, size: 0.3, probability: 0.5, noRandomAngle: false });
    render();
  });
}

/** The draft as a preset, or null when it is not one yet. */
function safePreset(): ReturnType<typeof presetFromDraft> | null {
  try { return presetFromDraft({ ...draft, name: draft.name || 'draft' }, 'draft'); }
  catch { return null; }
}

/**
 * What this preset would plant on an 8x8 patch.
 *
 * The real planner on a scratch area, so the answer moves with the numbers as
 * they are typed. A count rather than a picture, because the question it
 * answers is "is this a thicket or three trees" — and that is exactly the thing
 * the numbers do not say on their own.
 */
function preview(): void {
  const model = safePreset();
  const out = $('fp-preview');
  if (!model) { out.textContent = ''; return; }
  const cells: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) cells.push({ x, y });
  const plan = planFill(cells, model, 1);
  const perLayer = model.layers
    .map((_, i) => plan.placements.filter((p) => p.layer === i).length)
    .join(' + ');
  out.textContent = `on an 8×8 patch: ${plan.placements.length} object(s)`
    + (model.layers.length > 1 ? ` (${perLayer})` : '');
}

/**
 * Open the window.
 *
 * `mode` is what the buttons mean: a new preset, a copy of one (the only way to
 * change a shipped preset), or an edit of one of the user's own.
 */
export function openFillEditor(from: FillPresetInfo | null, mode: 'new' | 'copy' | 'edit', done: (name: string) => void): void {
  afterSave = done;
  replacing = mode === 'edit' && from ? from.name : null;
  draft = from
    ? {
        name: mode === 'copy' ? `${from.name} copy` : from.name,
        layers: from.layers.map((l) => ({
          dispersion: l.dispersion,
          width: l.width,
          noRandomAngle: l.noRandomAngle,
          objects: l.objects.map((o) => ({
            type: o.type, id: o.id, size: o.size, probability: o.probability, noRandomAngle: o.noRandomAngle,
          })),
        })),
      }
    : { name: '', layers: [blankLayer()] };
  $('fp-title').textContent = mode === 'edit' ? 'Edit fill preset' : mode === 'copy' ? 'Copy fill preset' : 'New fill preset';
  // Where it will land, and — for a copy — where it came from, since the two
  // files are not the same kind of thing and only one of them is writable.
  $('fp-from').textContent = mode === 'copy' && from ? `copy of ${from.name} (${from.source})` : '';
  $('fp-err').textContent = '';
  $input('fp-name').value = draft.name;
  render();
  if (!dialog().open) dialog().showModal();
  $input('fp-name').focus();
}

async function save(): Promise<void> {
  $('fp-err').textContent = '';
  draft.name = $input('fp-name').value.trim();
  // Checked here as well as in the channel: the same rules, said where they can
  // still be fixed without the dialog closing.
  try { presetFromDraft(draft, 'draft'); }
  catch (e) { $('fp-err').textContent = e instanceof Error ? e.message : String(e); return; }
  const btn = $button('fp-save');
  btn.disabled = true;
  try {
    await api.saveFillPreset({ preset: draft, ...(replacing ? { original: replacing } : {}) });
    dialog().close();
    afterSave?.(draft.name);
  } catch (e) {
    $('fp-err').textContent = e instanceof Error ? e.message : String(e);
  } finally {
    btn.disabled = false;
  }
}

/** Delete one of the user's own, having asked. Returns true when it went. */
export async function deleteFillPreset(name: string): Promise<boolean> {
  if (!await ask(`Delete the fill preset "${name}"? Maps already filled with it keep their objects.`, 'Delete')) {
    return false;
  }
  await api.deleteFillPreset({ name });
  return true;
}

/** Bind the window to its markup. */
export function initFillEditor(): void {
  $('fp-x').onclick = () => dialog().close();
  $('fp-cancel').onclick = () => dialog().close();
  $('fp-save').onclick = () => { void save(); };
  $('fp-addlayer').onclick = () => { draft.layers.push(blankLayer()); render(); };
  $input('fp-name').addEventListener('input', () => { draft.name = $input('fp-name').value; });
}
