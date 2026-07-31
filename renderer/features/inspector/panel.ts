// (header pending)

//
// The fields come from the object itself rather than from a per-type table
// here: 21 object types, and the file already says what each one carries. See
// MapObject.props().
//
// Written on `change`, not on every keystroke, so a half-typed number never
// reaches the map. The panel does not re-read afterwards — the map took the
// value verbatim, so re-rendering would only risk showing something else.

import { $ } from '#core/dom.ts';
import { api } from '#core/ipc.ts';
import { state } from '#core/state.ts';
import { fieldRow, rowShell, selectFrom, setProp } from '#features/inspector/controls.ts';
import { advancedShown, dataAt, expandTree, objectTree, openMapTree, showAdvanced } from '#features/inspector/tree.ts';
import type { ObjectProp } from '#src/map/map.ts';
import { controlOf, deref, objectProps, objectSchema } from '#src/schema/schema.ts';
import type { FieldSchema } from '#src/schema/schema.ts';
import type { TreeData } from '#src/schema/tree.ts';
import type { Path as TreePath } from '#src/schema/tree.ts';
/** Which object the visible property list belongs to, so a stale reply is dropped. */
let propsFor: string | null = null;

export async function loadProps(): Promise<void> {
  const host = $('p-props');
  host.innerHTML = '';
  if (!state.selected) { propsFor = null; return; }
  const id = state.selected.id;
  propsFor = id;
  let res;
  try {
    res = await api.objectProps(id);
  } catch (e) {
    host.textContent = 'could not read properties: ' + (e instanceof Error ? e.message : String(e));
    return;
  }
  // Selection can move while the reply is in flight; showing the old object's
  // fields under the new object's heading would be a quiet lie.
  if (propsFor !== id || !state.selected || state.selected.id !== id) return;
  if (!res.props.length) { host.innerHTML = '<div class="ph">no simple fields</div>'; return; }

  const head = document.createElement('div');
  head.className = 'ph';
  head.textContent = 'properties';
  host.appendChild(head);

  // Look up this object type's schema once; each field is typed by it, or falls
  // back to inference when the schema does not describe it.
  const typeFields = objectProps(res.type);
  // And what the GAME's type spec says a field may hold — the closed sets our
  // schema does not spell out. Awaited here so a row is built once, complete.
  const allowed = await loadSpecValues(res.type);
  if (propsFor !== id || !state.selected || state.selected.id !== id) return;
  const rowFor = (p: ObjectProp): HTMLElement => {
    const raw = typeFields[p.name];
    const field = raw ? deref(objectSchema, raw) : null;
    const row = fieldRow(p, field, (n, v) => void setProp(id, n, v), res.type, allowed[p.name]);
    if (p.absent) {
      row.classList.add('absent');
      row.title = `${p.name} is not in this object yet — the game's type spec says it belongs, so setting it adds it`;
    }
    return row;
  };
  for (const p of res.props) if (!p.absent) host.appendChild(rowFor(p));

  // Fields the type has that this object does not carry, under their own
  // heading — they are a different thing from a field with an empty value, and
  // mixing them into the list would read as "set to nothing".
  const absent = res.props.filter((p) => p.absent);
  if (absent.length) {
    const h2 = document.createElement('div');
    h2.className = 'ph';
    h2.textContent = 'not set on this object';
    h2.title = 'This object was built from one the game shipped, whose version had no such field. Setting one adds it.';
    host.appendChild(h2);
    for (const p of absent) host.appendChild(rowFor(p));
  }

  // Structured fields — army, buildings, capture triggers, extra stacks — are
  // lists and sub-objects the flat panel cannot hold, so `simpleFields` drops
  // them and they used to be reachable only through "Tree…". That is why a
  // garrison's or town's army looked missing here. Surface them as their own
  // rows: the count, and Edit → the (expandable) tree where they are edited.
  const structured = Object.entries(typeFields)
    .filter(([name]) => name !== 'Pos') // Pos has its own x/y controls above
    .map(([name, raw]) => [name, deref(objectSchema, raw)] as const)
    .filter(([, f]) => controlOf(f) === 'group');
  if (structured.length) {
    const h3 = document.createElement('div');
    h3.className = 'ph';
    h3.textContent = 'structures';
    h3.title = 'Lists and sub-objects — army, buildings, triggers. Edited in the tree.';
    host.appendChild(h3);
    let data: TreeData | undefined;
    try { data = (await api.objectTree({ id })).tree as TreeData; } catch { /* count is a nicety */ }
    if (propsFor !== id || !state.selected || state.selected.id !== id) return;
    for (const [name, f] of structured) host.appendChild(structRow(id, res.type, name, f, dataAt(data, name)));
  }

  enforceEnabledBy(host, typeFields);
}

/**
 * Grey out fields a sibling boolean gates (`x-enabledBy`): a monster's Amount is
 * meaningless unless Custom is on, and the original disables it the same way.
 * Enforced after render and re-checked whenever the controlling box changes, so
 * the panel stays honest without a full rebuild.
 */
function enforceEnabledBy(host: HTMLElement, typeFields: Record<string, FieldSchema>): void {
  const ctrl = (name: string): HTMLInputElement | HTMLSelectElement | null =>
    host.querySelector(`.pf label[data-field="${CSS.escape(name)}"]`)?.parentElement
      ?.querySelector('input, select') as HTMLInputElement | HTMLSelectElement | null;
  const deps = new Map<string, string[]>();
  for (const [name, raw] of Object.entries(typeFields)) {
    const by = deref(objectSchema, raw)['x-enabledBy'];
    if (by) { (deps.get(by) ?? deps.set(by, []).get(by)!).push(name); }
  }
  for (const [gate, names] of deps) {
    const box = ctrl(gate);
    if (!box) continue;
    const apply = (): void => {
      const on = box instanceof HTMLInputElement && box.type === 'checkbox' ? box.checked : box.value === 'true';
      for (const n of names) {
        const el = ctrl(n);
        if (!el) continue;
        el.disabled = !on;
        el.title = on ? '' : `enabled only when ${gate} is on`;
      }
    };
    apply();
    box.addEventListener('change', apply);
  }
}

/** A panel row for a structured field: title, a count, and Edit → the tree. */
function structRow(id: string, type: string, name: string, field: FieldSchema, data: TreeData | undefined): HTMLElement {
  const { row } = rowShell(field, name);
  const co = document.createElement('span');
  co.className = 'rov';
  if (field.type === 'array') {
    const n = Array.isArray(data) ? data.length : 0;
    co.textContent = n ? `${n} item${n === 1 ? '' : 's'}` : 'empty';
  } else {
    co.textContent = data && typeof data === 'object' && Object.keys(data).length ? 'set' : 'empty';
  }
  const btn = document.createElement('button');
  btn.className = 'struct-edit';
  btn.textContent = 'Edit…';
  btn.title = `edit ${field.title || name} in the tree`;
  btn.onclick = () => {
    // The tree hides what the schema marks advanced until it is asked for, and
    // a shipyard's ship tile and a seer hut's quest are marked that way — so
    // Edit… on one used to open a tree that did not show the field it named.
    // Naming it here IS asking for it.
    if (field['x-advanced'] && !advancedShown()) {
      showAdvanced(true);
      const box = document.getElementById('mt-adv');
      if (box instanceof HTMLInputElement) box.checked = true;
    }
    openMapTree(objectTree(id, type));
    expandTree();
  };
  row.append(co, btn);
  return row;
}

/**
 * One field row — a label and an editor chosen from the value's kind — shared by
 * the object panel and the map-settings dialog. `commit(name, value)` runs on
 * change. Read-only fields (href refs, and the map root's dimensions and empty
 * placeholders) are shown, not edited. An optional `label` overrides the raw
 * element name for the curated General tab.
 */
export function propRow(p: ObjectProp, commit: (name: string, value: string) => void, label = p.name): HTMLElement {
  const row = document.createElement('div');
  row.className = 'pf';
  const lab = document.createElement('label');
  lab.textContent = label;
  lab.title = p.name;
  lab.dataset.field = p.name;
  row.appendChild(lab);

  if (p.kind === 'href') {
    const ro = document.createElement('span');
    ro.className = 'ro';
    // Empty hrefs are common and mean "nothing referenced"; say so rather than
    // showing a blank that reads as a rendering bug.
    ro.textContent = p.value || '(none)';
    ro.title = p.value;
    row.appendChild(ro);
  } else if (p.readonly) {
    // A dimension or an empty asset/enum placeholder: shown, not edited. Empty
    // reads as "null", the way the original's tree shows it.
    const ro = document.createElement('span');
    ro.className = 'rov';
    ro.textContent = p.value || 'null';
    ro.title = p.value;
    row.appendChild(ro);
  } else if (p.kind === 'bool') {
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = p.value === 'true';
    cb.addEventListener('change', () => commit(p.name, String(cb.checked)));
    row.appendChild(cb);
  } else {
    const inp = document.createElement('input');
    inp.type = p.kind === 'number' ? 'number' : 'text';
    inp.value = p.value;
    // A text box only when nobody could tell us the legal set: the game's type
    // spec closes most enum fields and fieldRow() turns those into dropdowns
    // before reaching here (see loadSpecValues). Without types.xml — no game
    // data — this is still the honest control, since a guessed list would
    // refuse values the game accepts.
    if (p.kind === 'enum') inp.title = 'one of the game’s enum values (no type spec loaded)';
    inp.addEventListener('change', () => commit(p.name, inp.value));
    row.appendChild(inp);
  }
  return row;
}

/**
 * The values the game's own type spec allows for a field, by object type.
 *
 * Fetched once per type and kept: it never changes for an installation, and the
 * panel needs it while building rows rather than after. Empty when there is no
 * types.xml to read, which leaves every control exactly as it was.
 */
const specValuesByType = new Map<string, Record<string, string[]>>();
async function loadSpecValues(type: string): Promise<Record<string, string[]>> {
  const hit = specValuesByType.get(type);
  if (hit) return hit;
  let values: Record<string, string[]> = {};
  try { values = (await api.specValues(type)).values; } catch { /* no spec, no dropdowns */ }
  specValuesByType.set(type, values);
  return values;
}

/**
 * A dropdown over a closed set that still accepts what is already there.
 *
 * The current value is prepended when the set does not contain it, because a
 * control that silently drops a value the file holds is worse than one offering
 * an extra choice — and a modded install can carry values this build's spec
 * does not know.
 */
export function specSelect(value: string, allowed: string[], commit: (v: string) => void): HTMLElement {
  const opts = allowed.map((v) => ({ value: v, label: v }));
  if (value && !allowed.includes(value)) opts.unshift({ value, label: `${value} (not in the game's list)` });
  return selectFrom(value, opts, commit);
}
