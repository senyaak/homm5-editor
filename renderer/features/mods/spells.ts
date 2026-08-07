// The spell form: a page of our own in the spellbook, and what happens when it
// is cast.
//
// TWO HALVES THAT LOOK ALIKE AND TRAVEL DIFFERENTLY, which is the thing this
// form exists to make visible. The school, the level, the mana, the target, the
// element and the four damage entries go into the spell's own DOCUMENT, and the
// engine reads them out of it with the same code it uses for its own spells —
// they work for a number nothing was compiled against. The tiles an area covers
// and the creature kinds the damage passes over have no field in the document at
// all: the engine picks a shape and applies a kind filter by switching on the
// spell's NUMBER, one case per shipped spell, so ours reach it through the file
// the extension reads.
//
// WHAT IT REACHES IS ONE QUESTION, NOT TWO. The engine has a damage branch per
// shape and what chooses between them is the pair of booleans the document
// already carries; they separate the shipped spells with nothing left over. So
// the form asks once and writes both — see the Reach select.
//
// See docs/engineInternals/SPELLS.md.

import { $, $button, $input, $select, fillSelect } from '#core/dom.ts';
import { ask, modDialog, openOnTop } from '#core/dialog.ts';
import { api } from '#core/ipc.ts';
import { requireFilled } from '#core/form-gate.ts';
import { idFrom, modRow } from '#features/mods/shared.ts';
import { showExtensionState } from '#features/mods/artifacts.ts';
import { mountCodeEditor } from '#features/text-editor/code-editor.ts';
import type { CodeEditor } from '#features/text-editor/code-editor.ts';
import { loadScriptContext, scriptContextNote, scriptContextReady } from '#features/text-editor/context.ts';
import { spellStarter } from '#src/mods/spells.ts';
import type { ModsSpellDataResult } from '#electron/ipc.ts';

/** Which spell the form is editing, or '' when it is making a new one. */
let editingSpell = '';

/** Its Lua, kept out of the DOM — a script is written in an editor, never in a field. */
let script = '';

/**
 * Whether the id has been typed by hand.
 *
 * It follows the file stem until it is edited, and then it stops — otherwise a
 * deliberate id is silently overwritten by the next keystroke in the stem. Local
 * rather than in the shared flags, because the spell window is one form and
 * nothing else clears it.
 */
let idTouched = false;

/**
 * The tiles an area spell covers, as `"x,y"` offsets from the tile aimed at.
 *
 * Kept here rather than read off the grid, because the grid is redrawn whenever
 * its size changes and a tick that survived only in the DOM would not survive
 * that. What does NOT survive is a tile outside the new grid — it is dropped and
 * counted, because a covered tile nobody can see is worse than one that is gone.
 */
const tiles = new Set<string>();

/** The four the engine reads positionally, in the document's own order. */
const MASTERIES = ['No mastery', 'Basic', 'Advanced', 'Expert'];

/** The three reaches, and the pair of document flags each one is. */
const REACH = {
  field: { aimed: false, areaAttack: false },
  area: { aimed: true, areaAttack: true },
  stack: { aimed: true, areaAttack: false },
} as const;
type Reach = keyof typeof REACH;

/** Which reach a pair of flags is — how an installed spell comes back into the form. */
function reachOf(aimed: boolean | undefined, area: boolean | undefined): Reach {
  if (!aimed) return 'field';
  return area ? 'area' : 'stack';
}

/** The closed lists the form offers, fetched once. */
let spellData: Promise<ModsSpellDataResult> | null = null;
const formData = (): Promise<ModsSpellDataResult> => (spellData ??= api.spellData());

let gate: { check: () => void; rewatch: () => void } | null = null;
const gateSpell = (): { check: () => void; rewatch: () => void } => (gate ??= requireFilled({
  ok: 'sm-ok',
  missing: 'sm-missing',
  fields: { files: 'sm-file', id: 'sm-id', name: 'sm-name' },
  // The one the record cannot express and the build refuses: `IsAreaAttack`
  // says a spell hits an area and never says which, so a spell carrying the flag
  // with no tiles is a cast that spends its mana and touches nobody.
  extra: () => ($select('sm-reach').value === 'area' && !tiles.size
    ? ['the tiles it covers — an area spell with none covers nothing'] : []),
}));

// --- the amounts ------------------------------------------------------------

/** One `<Item>` per mastery: a flat part and a part times the hero's spell power. */
function drawAmounts(box: 'sm-damage' | 'sm-duration', values: { base: number; perPower: number }[]): void {
  const kind = box === 'sm-damage' ? 'dmg' : 'dur';
  const root = $(box);
  root.innerHTML = '';
  MASTERIES.forEach((label, i) => {
    const row = document.createElement('label');
    const name = document.createElement('span');
    name.textContent = label;
    const base = document.createElement('input');
    base.type = 'number';
    base.id = `sm-${kind}-${i}-base`;
    base.value = String(values[i]?.base ?? 0);
    base.title = 'the flat part';
    const per = document.createElement('input');
    per.type = 'number';
    per.id = `sm-${kind}-${i}-per`;
    per.value = String(values[i]?.perPower ?? 0);
    per.title = 'multiplied by the hero\'s spell power';
    const sign = document.createElement('span');
    sign.className = 'as-effect-unit';
    sign.textContent = '+ power ×';
    row.append(name, base, sign, per);
    root.appendChild(row);
  });
}

/** What those rows say. All four, always — the engine reads the list positionally. */
function amountsOf(box: 'sm-damage' | 'sm-duration'): { base: number; perPower: number }[] {
  const kind = box === 'sm-damage' ? 'dmg' : 'dur';
  return MASTERIES.map((_, i) => ({
    base: Number($input(`sm-${kind}-${i}-base`).value) || 0,
    perPower: Number($input(`sm-${kind}-${i}-per`).value) || 0,
  }));
}

/** A list of four is worth sending only when one of the eight numbers is not zero. */
const anyAmount = (list: { base: number; perPower: number }[]): boolean =>
  list.some((a) => a.base || a.perPower);

// --- the tiles --------------------------------------------------------------

/** The grid is centred on the tile aimed at, so its sides are odd. */
const oddSize = (id: string): number => {
  const n = Math.max(1, Math.min(15, Number($input(id).value) || 1));
  const odd = n % 2 ? n : n + 1;
  if (String(odd) !== $input(id).value) $input(id).value = String(odd);
  return odd;
};

/**
 * Draw the grid, one checkbox per tile, and say what is covered.
 *
 * The offsets are plain (x, y) added to the tile aimed at, and (0, 0) — the
 * middle, marked — is the aim point itself. It is a tick like any other: a ring
 * around a target is a legal shape and the game has one (Frost Ring).
 *
 * WHICH WAY THE GRID FACES on screen is not something we have measured; what is
 * measured is that the combat grid is SQUARE, because the engine's own "adjacent
 * tiles" table is the eight offsets of a 3×3 block. For a symmetric shape the
 * question does not arise, and for an asymmetric one it is one battle to settle.
 */
function drawTiles(): void {
  const w = oddSize('sm-area-w');
  const h = oddSize('sm-area-h');
  const rx = (w - 1) / 2;
  const ry = (h - 1) / 2;
  let dropped = 0;
  for (const key of [...tiles]) {
    const [x, y] = key.split(',').map(Number) as [number, number];
    if (Math.abs(x) > rx || Math.abs(y) > ry) { tiles.delete(key); dropped++; }
  }
  const grid = $('sm-area-grid');
  grid.innerHTML = '';
  grid.style.gridTemplateColumns = `repeat(${w}, 22px)`;
  for (let y = -ry; y <= ry; y++) {
    for (let x = -rx; x <= rx; x++) {
      const key = `${x},${y}`;
      const cell = document.createElement('label');
      cell.className = 'sm-tile' + (tiles.has(key) ? ' on' : '') + (x === 0 && y === 0 ? ' aim' : '');
      cell.title = x === 0 && y === 0 ? 'the tile aimed at' : `${x >= 0 ? '+' : ''}${x}, ${y >= 0 ? '+' : ''}${y}`;
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = tiles.has(key);
      box.onchange = () => {
        if (box.checked) tiles.add(key); else tiles.delete(key);
        cell.classList.toggle('on', box.checked);
        showTiles(0);
        gateSpell().check();
      };
      cell.appendChild(box);
      grid.appendChild(cell);
    }
  }
  showTiles(dropped);
  gateSpell().check();
}

/** What the note under the grid says: how many tiles, and what the resize cost. */
function showTiles(dropped: number): void {
  const note = $('sm-area-note');
  note.textContent = `${tiles.size} tile(s) covered`
    + (dropped ? ` · ${dropped} outside the new grid dropped` : '');
  note.style.color = dropped ? '#d29922' : '';
}

/** Tick every tile of the grid as it stands, or none of them. */
function fillTiles(on: boolean): void {
  tiles.clear();
  if (on) {
    const rx = (oddSize('sm-area-w') - 1) / 2;
    const ry = (oddSize('sm-area-h') - 1) / 2;
    for (let y = -ry; y <= ry; y++) for (let x = -rx; x <= rx; x++) tiles.add(`${x},${y}`);
  }
  drawTiles();
}

/** Put a spell's own tiles into the form, sizing the grid to hold them. */
function setTiles(area: readonly { x: number; y: number }[] | undefined): void {
  tiles.clear();
  let reach = 1;
  for (const t of area ?? []) {
    tiles.add(`${t.x},${t.y}`);
    reach = Math.max(reach, Math.abs(t.x), Math.abs(t.y));
  }
  const side = String(Math.min(15, reach * 2 + 1));
  $input('sm-area-w').value = side;
  $input('sm-area-h').value = side;
  drawTiles();
}

/** The tiles, as the payload wants them. */
const tilesOf = (): { x: number; y: number }[] => [...tiles].map((key) => {
  const [x, y] = key.split(',').map(Number) as [number, number];
  return { x, y };
});

// --- the form ---------------------------------------------------------------

/** Only an area spell has tiles to draw, so only then is the grid there. */
function showReach(): void {
  $('sm-area-grid').parentElement?.classList.toggle('on', $select('sm-reach').value === 'area');
  gateSpell().check();
}

/** Fill the three selects and the kinds list from the game's own data. */
async function fillSpellForm(): Promise<void> {
  const data = await formData();
  fillSelect($select('sm-school'), data.schools.map((id) => ({ id, label: id })), $select('sm-school').value || 'MAGIC_SCHOOL_DESTRUCTIVE');
  fillSelect($select('sm-target'), data.targets.map((id) => ({ id, label: id })), $select('sm-target').value || 'TARGET_NEUTRAL');
  fillSelect($select('sm-element'), data.elements.map((id) => ({ id, label: id })), $select('sm-element').value || 'ELEMENT_NONE');
  const spares = $select('sm-spares');
  const chosen = new Set([...spares.selectedOptions].map((o) => o.value));
  spares.innerHTML = '';
  for (const a of data.abilities) {
    const option = document.createElement('option');
    option.value = a.id;
    option.textContent = a.name && a.name !== a.id ? `${a.name} (${a.id})` : a.id;
    option.selected = chosen.has(a.id);
    spares.appendChild(option);
  }
  showSpares();
  gateSpell().check();
}

/** Which kinds are ticked, in one line under the list. */
function showSpares(): void {
  const chosen = [...$select('sm-spares').selectedOptions].map((o) => o.value);
  $('sm-spares-note').textContent = chosen.length
    ? `passes over ${chosen.map((id) => id.replace(/^ABILITY_/, '').toLowerCase()).join(', ')}`
    : 'hits everything it reaches';
}

/** Select exactly these ids in the kinds list. */
function setSpares(ids: readonly string[]): void {
  const want = new Set(ids);
  for (const o of $select('sm-spares').options) o.selected = want.has(o.value);
  showSpares();
}

/** How many lines the script has, or none. */
function showScript(): void {
  const text = script.trim();
  const lines = text ? text.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('--')).length : 0;
  $('sm-script-note').textContent = text ? `${lines} line${lines === 1 ? '' : 's'}` : 'none';
}

/** Everything the form holds, blanked — New starts from nothing, not from the last one. */
function blankForm(): void {
  for (const id of ['sm-file', 'sm-id', 'sm-name', 'sm-desc', 'sm-icon', 'sm-picture',
    'sm-visual-1', 'sm-visual-2']) $input(id).value = '';
  $input('sm-level').value = '1';
  $input('sm-mana').value = '10';
  $select('sm-reach').value = 'field';
  $select('sm-school').value = 'MAGIC_SCHOOL_DESTRUCTIVE';
  $select('sm-target').value = 'TARGET_NEUTRAL';
  $select('sm-element').value = 'ELEMENT_NONE';
  drawAmounts('sm-damage', []);
  drawAmounts('sm-duration', []);
  setSpares([]);
  script = '';
  showScript();
  tiles.clear();
  $input('sm-area-w').value = '3';
  $input('sm-area-h').value = '3';
  drawTiles();
  showReach();
}

/** Put an installed spell into the form, and switch the form to editing it. */
async function editSpell(id: string): Promise<void> {
  const { mods } = await api.listMods();
  const s = mods.flatMap((m) => m.spells ?? []).find((x) => x.id === id);
  if (!s) return;
  editingSpell = id;
  $('se-err').textContent = '';
  $('spelledit-title').textContent = `Edit ${s.name || s.id}`;
  // EVERYTHING it already is. The form writes back what it holds, so a field
  // left blank here is a field erased on save — which is how an artifact once
  // lost its description to a change of price.
  $input('sm-id').value = s.id;
  $input('sm-file').value = s.file;
  // Neither may move: the id is what the enum declares and the number behind it
  // is what a spellbook and a save store; the stem names every file already
  // written for it.
  $input('sm-id').disabled = true;
  $input('sm-file').disabled = true;
  $input('sm-name').value = s.name;
  $input('sm-desc').value = s.description ?? '';
  $input('sm-level').value = String(s.level ?? 1);
  $input('sm-mana').value = String(s.manaCost ?? 0);
  $input('sm-icon').value = s.icon ?? '';
  $input('sm-picture').value = s.picture ?? '';
  $input('sm-visual-1').value = s.visuals?.[0] ?? '';
  $input('sm-visual-2').value = s.visuals?.[1] ?? '';
  $select('sm-reach').value = reachOf(s.aimed, s.areaAttack);
  drawAmounts('sm-damage', s.damage ?? []);
  drawAmounts('sm-duration', s.duration ?? []);
  script = s.script ?? '';
  showScript();
  // After the selects are filled, not before: the school and the kinds are
  // options this fetch builds, and setting a value on an empty select is a no-op.
  await fillSpellForm();
  $select('sm-school').value = s.school;
  $select('sm-target').value = s.target;
  $select('sm-element').value = s.element ?? 'ELEMENT_NONE';
  setSpares(s.spares ?? []);
  setTiles(s.area);
  showReach();
  $button('sm-ok').textContent = 'Save & install';
  gateSpell().rewatch();
  openOnTop('spelledit');
  void showExtensionState('sm-ext').catch(() => {});
}

/** Back to making a new one. */
function newSpell(): void {
  editingSpell = '';
  idTouched = false;
  $('se-err').textContent = '';
  $('spelledit-title').textContent = 'New spell';
  $input('sm-id').disabled = false;
  $input('sm-file').disabled = false;
  blankForm();
  $button('sm-ok').textContent = 'Build & install';
  gateSpell().rewatch();
  openOnTop('spelledit');
  void fillSpellForm().catch((e: unknown) => {
    $('se-err').textContent = e instanceof Error ? e.message : String(e);
  });
  void showExtensionState('sm-ext').catch(() => {});
}

/** The installed spells, as the list shows them. */
async function refreshSpellList(): Promise<void> {
  const { gameRoot, mods } = await api.listMods();
  const box = $('sm-list');
  box.innerHTML = '';
  if (!gameRoot) {
    box.innerHTML = '<div class="um-empty">no game install configured — nowhere to install to</div>';
    return;
  }
  const spells = mods.flatMap((m) => m.spells ?? []);
  if (!spells.length) {
    box.innerHTML = '<div class="um-empty">none — the game holds its shipped 353</div>';
    return;
  }
  for (const s of spells) {
    const reach = reachOf(s.aimed, s.areaAttack);
    const note = [
      reach === 'field' ? 'the whole field' : reach === 'area' ? `an area of ${s.area?.length ?? 0} tile(s)` : 'one stack',
      `level ${s.level}`,
      `${s.manaCost} mana`,
      ...(s.element && s.element !== 'ELEMENT_NONE' ? [s.element.replace('ELEMENT_', '').toLowerCase()] : []),
    ].join(', ');
    const row = modRow({
      number: s.number, label: s.name || s.id, note,
      onEdit: () => { void editSpell(s.id).catch(report); },
      onRemove: () => { void removeSpell(s.id, s.name || s.id).catch(report); },
    });
    row.title = s.id;
    box.appendChild(row);
  }
}

const report = (e: unknown): void => {
  $('sm-err').textContent = e instanceof Error ? e.message : String(e);
};

/**
 * Ask what would break, show it, and then remove — never refuse.
 *
 * Two different kinds of casualty, and they are shown together because from the
 * chair they are one question. OUTSIDE the mod: a map stores a spell's NAME, in
 * a hero's book, in a town's guild, in the list of what the map allows, on a
 * shrine — an exact list, not a warning in general terms. INSIDE it: a hero of
 * ours who starts knowing it and a class that prefers it, which the build simply
 * edits, since those are ours.
 *
 * What it does NOT do is stand in the way. Something you cannot delete because
 * something else names it is a trap, not a safeguard — the artifact and hero
 * windows have always warned and gone ahead, and this is the same.
 */
async function removeSpell(id: string, label: string): Promise<void> {
  const [{ uses }, { mods }] = await Promise.all([api.spellUses({ id }), api.listMods()]);
  const heroes = mods.flatMap((m) => m.heroes ?? []).filter((h) => h.spells?.includes(id));
  const classes = mods.flatMap((m) => m.classes ?? []).filter((c) => c.preferredSpells?.includes(id));
  const lines: string[] = [];
  if (uses.length) {
    lines.push(`${uses.length} map(s) name it and will stop resolving it:`, '',
      ...uses.slice(0, 12), ...(uses.length > 12 ? [`… and ${uses.length - 12} more`] : []), '');
  }
  if (heroes.length) lines.push(`${heroes.map((h) => h.name || h.id).join(', ')} will stop knowing it.`);
  if (classes.length) lines.push(`${classes.map((c) => c.name || c.id).join(', ')} will stop preferring it.`);
  const question = lines.length
    ? `Remove ${label}?\n\n${lines.join('\n')}\n\nRemove anyway?`
    : `Remove ${label}? Nothing names it.`;
  if (!await ask(question, 'Remove')) return;
  await api.removeSpell({ id });
  $('sm-note').textContent = `${label} removed.`;
  await refreshSpellList();
}

async function submitSpell(): Promise<void> {
  const ok = $button('sm-ok');
  ok.disabled = true;
  $('se-err').textContent = '';
  try {
    const reach = REACH[$select('sm-reach').value as Reach];
    const damage = amountsOf('sm-damage');
    const duration = amountsOf('sm-duration');
    const visuals = [$input('sm-visual-1').value, $input('sm-visual-2').value].filter((v) => v.trim());
    const send = editingSpell ? api.updateSpell : api.installSpell;
    const res = await send({
      id: $input('sm-id').value.trim(),
      file: $input('sm-file').value.trim(),
      name: $input('sm-name').value,
      description: $input('sm-desc').value,
      level: Number($input('sm-level').value) || 0,
      school: $select('sm-school').value,
      manaCost: Number($input('sm-mana').value) || 0,
      target: $select('sm-target').value,
      aimed: reach.aimed,
      areaAttack: reach.areaAttack,
      element: $select('sm-element').value,
      ...(anyAmount(damage) ? { damage } : {}),
      ...(anyAmount(duration) ? { duration } : {}),
      ...(visuals.length ? { visuals } : {}),
      icon: $input('sm-icon').value,
      picture: $input('sm-picture').value,
      spares: [...$select('sm-spares').selectedOptions].map((o) => o.value),
      // Only where they mean something. A spell that hits one stack carrying a
      // set of tiles would have the extension write a shape nothing reads.
      ...(reach.areaAttack ? { area: tilesOf() } : {}),
      script,
    });
    modDialog('spelledit').close();
    editingSpell = '';
    $('sm-note').textContent = `installed ${res.archive}\nspell ${res.number}`;
    await refreshSpellList();
  } catch (e) {
    $('se-err').textContent = e instanceof Error ? e.message : String(e);
  } finally {
    ok.disabled = false;
  }
}

// --- the script -------------------------------------------------------------

let editor: CodeEditor | null = null;

/**
 * Its Lua, on top of the form — the same CodeMirror the map's scripts use.
 *
 * ONE context, unlike a skill's two: a spell of ours is caught where the cast
 * happens, which is inside a battle. Mounted lazily, because a spell whose
 * content is damage never opens this at all.
 */
function openScript(): void {
  if (!scriptContextReady()) {
    void loadScriptContext()
      .then(() => { $('sms-info').textContent = scriptContextNote(); })
      .catch(() => { $('sms-info').textContent = 'no completion available'; });
  }
  if (!editor) {
    editor = mountCodeEditor($('sms-text'), () => closeScript(true), (diags) => {
      const errors = diags.filter((d) => d.severity === 'error').length;
      const el = $('sms-lint');
      el.className = 'de-lint ' + (errors ? 'err' : diags.length ? 'warn' : 'ok');
      el.textContent = errors ? `⚠ ${errors} error${errors === 1 ? '' : 's'}`
        : diags.length ? `⚠ ${diags.length} warning${diags.length === 1 ? '' : 's'}` : '✓ no errors';
    });
  }
  if (!script.trim()) script = spellStarter($input('sm-id').value.trim());
  $('sms-info').textContent = scriptContextNote();
  editor.setDoc(script, 'lua');
  openOnTop('spellscript');
  editor.focus();
}

function closeScript(keep: boolean): void {
  if (keep && editor) script = editor.getDoc();
  showScript();
  modDialog('spellscript').close();
}

// --- wiring -----------------------------------------------------------------

/** Bind the window, the list and the form to their markup. Called once, from app. */
export function initSpellsMod(): void {
  $('spellsbtn').onclick = () => {
    $('sm-err').textContent = '';
    $('sm-note').textContent = '';
    modDialog('spellsmod').showModal();
    void refreshSpellList().catch(report);
  };
  $('sm-close').onclick = () => modDialog('spellsmod').close();
  $('sm-cancel').onclick = () => modDialog('spellsmod').close();
  $('sm-new').onclick = () => newSpell();
  // The id spells itself from the file stem until somebody types one, the way an
  // artifact's does. `check()` by hand: a value set from code fires no input
  // event, so the gate would otherwise say the id is missing for one keystroke
  // after it is there.
  $input('sm-id').addEventListener('input', () => { idTouched = true; });
  $input('sm-file').addEventListener('input', () => {
    if (idTouched) return;
    $input('sm-id').value = idFrom('SPELL_', $input('sm-file').value);
    gateSpell().check();
  });
  $('spelledit-x').onclick = () => modDialog('spelledit').close();
  $('spelledit-cancel').onclick = () => modDialog('spelledit').close();
  $('sm-ok').onclick = () => { void submitSpell(); };

  $select('sm-reach').addEventListener('change', showReach);
  for (const id of ['sm-area-w', 'sm-area-h']) $input(id).addEventListener('change', drawTiles);
  $('sm-area-all').onclick = () => fillTiles(true);
  $('sm-area-none').onclick = () => fillTiles(false);
  $select('sm-spares').addEventListener('change', showSpares);
  $('sm-spares-none').onclick = () => setSpares([]);
  $('sm-spares-notliving').onclick = () => {
    void formData().then((d) => setSpares(d.notLiving)).catch(report);
  };
  $('sm-pick-picture').onclick = () => {
    void api.pickPicture().then((picked) => { if (picked) $input('sm-picture').value = picked; })
      .catch((e: unknown) => { $('se-err').textContent = e instanceof Error ? e.message : String(e); });
  };
  $('sm-script').onclick = () => openScript();
  $('sms-ok').onclick = () => closeScript(true);
  $('sms-cancel').onclick = () => closeScript(false);
  $('sms-x').onclick = () => closeScript(false);

  // The amount rows are built rather than written out, so the four masteries are
  // one list — and the form has to hold them before anything reads them.
  drawAmounts('sm-damage', []);
  drawAmounts('sm-duration', []);
  drawTiles();
}
