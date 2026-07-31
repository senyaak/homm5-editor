// (header pending)

//
// The property panel upgrades each field to the control its schema declares
// (src/schema.ts): an enum or registry-backed field becomes a dropdown, a
// dimension read-only, a bounded number a spinner. Anything the schema does not
// describe falls back to propRow()'s value-shape inference, so the panel is
// always usable.

import { heightAt, tileCenter } from '#core/coords.ts';
import { $, $input } from '#core/dom.ts';
import { api } from '#core/ipc.ts';
import { mapNames, roster } from '#core/rosters.ts';
import { activeFloor, state } from '#core/state.ts';
import { propRow, specSelect } from '#features/inspector/panel.ts';
import { entityRefControl } from '#features/inspector/refs.ts';
import { objectTree, openMapTree } from '#features/inspector/tree.ts';
import { fileRefControl, specRefControl } from '#features/text-editor/document.ts';
import { syncInstance } from '#viewport/instancing.ts';
import { syncFootprints } from '#viewport/overlays.ts';
import type { ObjectProp } from '#src/map/map.ts';
import { classOf, controlOf } from '#src/schema/schema.ts';
import type { FieldSchema } from '#src/schema/schema.ts';
import { markDirty } from '#core/dirty.ts';
import { degOf, deleteSelected, rotateSelected, snap90, updatePanel } from '#features/selection.ts';
/** A text input with a <datalist> of names defined elsewhere in the map — a
 *  reference hint, not a hard constraint (a value not yet defined is still
 *  typeable). `display:contents` lets the input be the flex child, not the span. */
let datalistSeq = 0;
export function nameRefInput(kind: string, value: string, commit: (v: string) => void): HTMLElement {
  const wrap = document.createElement('span'); wrap.style.display = 'contents';
  const inp = document.createElement('input'); inp.type = 'text'; inp.value = value;
  const id = `nl${datalistSeq++}`;
  const list = document.createElement('datalist'); list.id = id; inp.setAttribute('list', id);
  inp.title = `references a ${kind} by name`;
  inp.addEventListener('change', () => commit(inp.value));
  void mapNames(kind).then((names) => {
    for (const n of names) { const o = document.createElement('option'); o.value = n; list.appendChild(o); }
  });
  wrap.append(inp, list);
  return wrap;
}

/** A label + its title/description tooltip — the left half every row shares. */
export function rowShell(field: FieldSchema | null, rawName: string): { row: HTMLElement } {
  const row = document.createElement('div');
  row.className = 'pf';
  const label = document.createElement('label');
  label.textContent = field?.title || rawName;
  label.title = field?.description ? `${rawName} — ${field.description}` : rawName;
  // The field's own name, on the element rather than only inside a tooltip that
  // also carries its description. Automation addresses rows by it, and so does
  // anything else that needs to find "the Amount row" without parsing English.
  label.dataset.field = rawName;
  row.appendChild(label);
  return { row };
}

/** A <select>, its current value guaranteed present even if outside the options. */
export function selectFrom(current: string, options: { value: string; label: string }[], onChange: (v: string) => void): HTMLSelectElement {
  const sel = document.createElement('select');
  const opts = options.some((o) => o.value === current)
    ? options
    : [{ value: current, label: current || '(none)' }, ...options];
  for (const o of opts) {
    const el = document.createElement('option');
    el.value = o.value; el.textContent = o.label;
    if (o.value === current) el.selected = true;
    sel.appendChild(el);
  }
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

/**
 * One property row, typed by its schema when there is one. Handles the
 * single-value controls (dropdowns, enums, read-only, bounded numbers); arrays
 * and nested structures are a later pass, so those fall through to propRow.
 */
export function fieldRow(p: ObjectProp, field: FieldSchema | null, commit: (name: string, value: string) => void, objectType?: string, allowed?: string[]): HTMLElement {
  // A town specialization: its own pick-or-create control, in the panel too —
  // otherwise it falls to the read-only href row and can never be set.
  if (field?.['x-widget'] === 'specialization') {
    const { row } = rowShell(field, p.name);
    row.appendChild(specRefControl(p.value, (v) => commit(p.name, v)));
    return row;
  }
  // What the GAME allows here beats both the schema's own enum list and the
  // value-shape guess: it is the closed set the engine defines, and it is the
  // difference between typing ATTACK_MELEE from memory and picking it.
  // Registry-backed fields keep their roster — it carries display names.
  if (allowed?.length && field?.['x-registry'] === undefined) {
    const { row } = field ? rowShell(field, p.name) : rowShell({ title: p.name }, p.name);
    row.appendChild(specSelect(p.value, allowed, (v) => commit(p.name, v)));
    return row;
  }
  if (!field) return propRow(p, commit);
  // A text-file reference (a sign's message, a hero's biography): the same
  // control the tree gives it — show the file, edit its text, pick another, or
  // create one. The panel used to fall through to the read-only href row, so a
  // sign's message could be read and never written, which is most of what a
  // sign IS. One schema flag, one control, both places.
  if (field['x-file']) {
    const { row } = rowShell(field, p.name);
    row.appendChild(fileRefControl(p.value, field.title || p.name, (v) => commit(p.name, v)));
    return row;
  }
  if (field['x-nameRef']) {
    const { row } = rowShell(field, p.name);
    row.appendChild(nameRefInput(field['x-nameRef'], p.value, (v) => commit(p.name, v)));
    return row;
  }
  // A reference to a whole object — an object's Shared identity, or a single
  // entity ref: the type-constrained picker + New, same as the tree's rows.
  if (field.type !== 'array') {
    const cls = classOf(field, objectType);
    if (cls) {
      const { row } = rowShell(field, p.name);
      row.appendChild(entityRefControl(cls, p.value, (v) => commit(p.name, v)));
      return row;
    }
  }
  const control = controlOf(field);

  if (control === 'dropdown' && field['x-registry']) {
    const { row } = rowShell(field, p.name);
    // Show the current value immediately; fill the options once the roster loads.
    const sel = selectFrom(p.value, [], (v) => commit(p.name, v));
    sel.disabled = true;
    row.appendChild(sel);
    void roster(field['x-registry']).then((entries) => {
      const cur = sel.value;
      sel.innerHTML = '';
      const opts = entries.map((e) => ({ value: e.id, label: e.name || e.id }));
      if (!opts.some((o) => o.value === cur)) opts.unshift({ value: cur, label: cur || '(none)' });
      for (const o of opts) {
        const el = document.createElement('option');
        el.value = o.value; el.textContent = o.label;
        if (o.value === cur) el.selected = true;
        sel.appendChild(el);
      }
      sel.disabled = false;
    });
    return row;
  }

  if (control === 'enum' && field.enum) {
    const { row } = rowShell(field, p.name);
    row.appendChild(selectFrom(p.value, field.enum.map((v) => ({ value: v, label: v })), (v) => commit(p.name, v)));
    return row;
  }

  if (control === 'number') {
    const { row } = rowShell(field, p.name);
    const inp = document.createElement('input');
    inp.type = 'number'; inp.value = p.value;
    if (field.minimum !== undefined) inp.min = String(field.minimum);
    if (field.maximum !== undefined) inp.max = String(field.maximum);
    inp.addEventListener('change', () => commit(p.name, inp.value));
    row.appendChild(inp);
    return row;
  }

  if (control === 'checkbox') {
    const { row } = rowShell(field, p.name);
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = p.value === 'true';
    cb.addEventListener('change', () => commit(p.name, String(cb.checked)));
    row.appendChild(cb);
    return row;
  }

  // readonly, refs, and anything structural: keep the schema's nicer label but
  // let propRow render the value (it already shows href/readonly sensibly).
  return propRow(field['x-readonly'] ? { ...p, readonly: true } : p, commit, field.title || p.name);
}

export async function setProp(id: string, name: string, value: string): Promise<void> {
  try {
    await api.setObjectProp({ id, name, value });
    markDirty(true);
    $('hud').textContent = `${name} = ${value || '(empty)'}`;
  } catch (e) {
    $('hud').textContent = `could not set ${name}: ` + (e instanceof Error ? e.message : String(e));
  }
}

/**
 * Put the selected object at an exact position, in tiles.
 *
 * Dragging rounds to the grid, which is how a map is laid out by hand; this is
 * the way to say 42.494 — the fraction a shipped mission has and a drag cannot
 * express (218 of C1M1's objects, none of them on a half tile either).
 */
async function moveSelectedTo(x: number, y: number): Promise<void> {
  if (!state.selected || !state.world) return;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  state.selected.inst.x = x; state.selected.inst.y = y;
  state.selected.mesh.position.set(tileCenter(x), tileCenter(y), heightAt(Math.floor(x), Math.floor(y)));
  syncInstance(activeFloor(), state.selected.inst);
  syncFootprints();
  state.boxHelper?.setFromObject(state.selected.mesh);
  updatePanel();
  try {
    await api.moveObject(state.selected.id, x, y);
    markDirty(true);
  } catch (e) {
    $('hud').textContent = 'move failed: ' + (e instanceof Error ? e.message : String(e));
  }
}


// A button is a quarter turn from the current heading. Snapping the current
// angle first means an object at an odd shipped angle aligns to the grid on the
// first press, then turns cleanly from there.

/** Bind the property panel's own controls to their markup. */
export function initPropertyPanel(): void {
  for (const axis of ['x', 'y'] as const) {
    $input(`p-${axis}`).addEventListener('change', () => {
      if (!state.selected) return;
      void moveSelectedTo(+$input('p-x').value, +$input('p-y').value);
    });
  }
  $input('p-rot').addEventListener('change', (e) => {
    void rotateSelected(+(e.currentTarget as HTMLInputElement).value);
  });
  $('p-tree').onclick = () => {
    if (!state.selected) return;
    openMapTree(objectTree(state.selected.id, state.selected.inst.type));
  };
  $('p-del').onclick = () => { void deleteSelected(); };
  $('p-rotl').onclick = () => { if (state.selected) void rotateSelected(snap90(degOf(state.selected.inst.r)) - 90); };
  $('p-rotr').onclick = () => { if (state.selected) void rotateSelected(snap90(degOf(state.selected.inst.r)) + 90); };
  $input('p-rotslider').addEventListener('input', (e) => {
    void rotateSelected(+(e.currentTarget as HTMLInputElement).value, false);
  });
  $input('p-rotslider').addEventListener('change', (e) => {
    void rotateSelected(+(e.currentTarget as HTMLInputElement).value);
  });
}
