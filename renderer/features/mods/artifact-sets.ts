// The artifact-set form: which pieces make a set, what wearing several of them
// gives, and the Lua a set can carry.
//
// A set is thresholds rather than a single bonus — two pieces give one thing,
// four give another — so the form is rows of (stat, at how many, how much),
// and the counts under the member list are there because a threshold above the
// number of pieces can never fire.



import { $, $input, $select, $button, fillSelect } from '#core/dom.ts';
import { ask, modDialog, openOnTop } from '#core/dialog.ts';
import { api } from '#core/ipc.ts';
import { mountCodeEditor } from '#features/text-editor/code-editor.ts';
import type { CodeEditor } from '#features/text-editor/code-editor.ts';
import { loadScriptContext, scriptContextNote, scriptContextReady } from '#features/text-editor/context.ts';
import { effectStats, idFrom, idTouched, listActions, refreshModLists, shortArtifactId } from '#features/mods/shared.ts';
import { requireFilled } from '#core/form-gate.ts';
import { showExtensionState } from '#features/mods/artifacts.ts';

/** The game's artifacts, which do not change while the window is open. */
let setShipped: { id: string; name: string }[] | null = null;

/** Bind the artifact-set form to its markup. Called once, from app. */
/**
 * What a set cannot be built without.
 *
 * The members are the one the core refuses outright — "a set of 1 never
 * combines" — and it is the one a form of checkboxes cannot star, so it is
 * counted instead. The stem names its text files and the effect is what the
 * executable's table gets; both are refused empty.
 */
let setGate: { check: () => void; rewatch: () => void } | null = null;
const gateSet = (): { check: () => void; rewatch: () => void } => (setGate ??= requireFilled({
  ok: 'as-ok',
  missing: 'as-missing',
  fields: { files: 'as-file', effect: 'as-effect', name: 'as-name' },
  extra: () => (setMembers().length < 2 ? ['two members or more'] : []),
  watch: '#as-members input',
}));

export function initArtifactSets(): void {
  listActions.editSet = (effect) => { void editArtifactSet(effect); };
  listActions.removeSet = (effect, label) => { void removeSet(effect, label); };
  $input('as-effect').addEventListener('input', () => { idTouched.set = true; });
  $input('as-file').addEventListener('input', () => {
    if (!idTouched.set) $input('as-effect').value = idFrom('ARTFSET_EFFECT_', $input('as-file').value);
  });
  $('as-members').addEventListener('change', renderSetCounts);
  // Esc closes a <dialog> on its own, and this one must behave like Cancel when it
  // does: the alternative is a script kept because a key was pressed.
  modDialog('setscript').addEventListener('cancel', () => { closeSetScript(false); });
  $('ss-ok').onclick = () => closeSetScript(true);
  $('ss-cancel').onclick = () => closeSetScript(false);
  $('ss-x').onclick = () => closeSetScript(false);
  $('as-effect-add').onclick = () => addSetEffectRow();
  $('as-draft').onclick = (e) => { e.preventDefault(); draftCountTexts(); };
  $('as-ok').onclick = () => { void submitArtifactSet(); };
  $('as-new').onclick = () => {
    idTouched.set = false;
    void fillSetMembers().then(newSet).catch((e: unknown) => {
      $('as-err').textContent = e instanceof Error ? e.message : String(e);
    });
  };
  $('setedit-x').onclick = () => modDialog('setedit').close();
  $('setedit-cancel').onclick = () => modDialog('setedit').close();
}

/**
 * The members list: every artifact a set can be built from — the game's, and
 * this mod's own.
 *
 * Ticked from a list rather than typed. A misspelt member is accepted by the
 * file format, builds cleanly, and shows up as a set that simply never
 * combines — the failure that costs an evening to find.
 *
 * REBUILT every time, because the interesting members are the ones added a
 * minute ago: filling this once on first open left an artifact installed after
 * it missing from the list, with no sign that anything was stale.
 */
export async function fillSetMembers(): Promise<void> {
  const box = $('as-members');
  const ticked = new Set(setMembers());
  if (!setShipped) {
    setShipped = (await api.modFormData()).artifactDonors
      .map((a) => ({ id: a.id, name: a.name ?? '' }));
  }
  const shipped = setShipped;
  const { mods } = await api.listMods();
  const mine = new Set(mods.flatMap((m) => m.artifacts).map((a) => a.id));
  box.innerHTML = '';
  const rows = [
    ...mods.flatMap((m) => m.artifacts).map((a) => ({ id: a.id, name: a.name })),
    ...shipped.filter((a) => !mine.has(a.id)),
  ];
  for (const a of rows) {
    const label = document.createElement('label');
    const tick = document.createElement('input');
    tick.type = 'checkbox';
    tick.value = a.id;
    tick.checked = ticked.has(a.id);
    label.append(tick, a.name || shortArtifactId(a.id));
    const note = document.createElement('i');
    note.textContent = mine.has(a.id) ? ' · this mod' : ` · ${shortArtifactId(a.id)}`;
    label.appendChild(note);
    box.appendChild(label);
  }
  renderSetCounts();
}

const setMembers = (): string[] =>
  [...$('as-members').querySelectorAll<HTMLInputElement>('input:checked')].map((i) => i.value);

/**
 * One text field per number of pieces worn, kept in step with what is ticked.
 *
 * Indexed from ONE piece, not from none — the array the game reads has one
 * entry per member and position IS the count. One piece is not a set, so the
 * first is normally left blank, which is what every shipped set does.
 */
function renderSetCounts(): void {
  const box = $('as-counts');
  const had = [...box.querySelectorAll<HTMLInputElement>('input')].map((i) => i.value);
  box.innerHTML = '';
  const n = setMembers().length;
  if (!n) {
    box.innerHTML = '<div class="um-empty">tick two or more members above</div>';
    return;
  }
  for (let i = 0; i < n; i++) {
    const label = document.createElement('label');
    const span = document.createElement('span');
    span.textContent = i === 0 ? '1 piece' : `${i + 1} pieces`;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = had[i] ?? '';
    // A blank box is a real answer for one piece and a hole for the rest, and
    // the two look identical until it is said which is which.
    input.placeholder = i === 0
      ? 'one piece is not a set — normally blank'
      : 'nothing shown at this count';
    input.placeholder = i === 0 ? 'one piece is not a set — normally blank' : 'what the tooltip says';
    label.append(span, input);
    box.appendChild(label);
  }
}

/**
 * One row of what the set GIVES: a stat, how many pieces it takes, how much.
 *
 * The threshold is a field rather than a fixed 2-or-all because it is OURS —
 * the extension counts the worn members itself, so nothing here has to line up
 * with the 2/3/4 the engine compiled into its own eleven set effects.
 */
function addSetEffectRow(stat = '', threshold = '', amount = ''): void {
  const row = document.createElement('label');
  const select = document.createElement('select');
  // The engine's sums, and then LUA — the same list, because to whoever is
  // authoring the set both are "what it does". What differs is where it lands:
  // a sum goes to the extension's config, a script into the mod.
  for (const s of [...effectStats, LUA_ROW]) {
    const option = document.createElement('option');
    option.value = option.textContent = s;
    select.appendChild(option);
  }
  if (stat) select.value = stat;
  select.className = 'as-effect-stat';
  const worn = document.createElement('input');
  worn.type = 'number';
  worn.min = '1';
  worn.value = threshold || '2';
  worn.className = 'as-effect-worn';
  worn.title = 'pieces worn, at least this many';
  const value = document.createElement('input');
  value.type = 'number';
  value.value = amount || '0';
  value.className = 'as-effect-amount';
  value.title = 'how much — see the unit beside it';
  // The unit, shown rather than implied: the two sums are counted in different
  // things, and "10" in the box meant either a tenth of the raise or ten points
  // of ceiling depending on a dropdown three controls to the left.
  const unit = document.createElement('i');
  unit.className = 'as-effect-unit';
  // Lua is never written among fields: the row carries a pencil, and the pencil
  // opens the editor on top — the same one the map's scripts use.
  const edit = document.createElement('button');
  edit.className = 'um-recolor as-effect-edit';
  edit.textContent = '✎ script';
  edit.title = 'write the script — opens the editor';
  edit.onclick = (e) => { e.preventDefault(); openSetScriptSafely(); };
  const drop = document.createElement('button');
  drop.className = 'um-recolor';
  drop.textContent = '×';
  drop.title = 'remove this effect';
  drop.onclick = () => { row.remove(); if (select.value === LUA_ROW) setScript = ''; };
  const show = (): void => {
    const lua = select.value === LUA_ROW;
    worn.style.display = value.style.display = unit.style.display = lua ? 'none' : '';
    edit.style.display = lua ? '' : 'none';
    unit.textContent = UNITS[select.value] ?? '';
  };
  select.onchange = show;
  row.append(select, worn, value, unit, edit, drop);
  $('as-effects').appendChild(row);
  show();
}

/** The row kind that is a script rather than a number. */
const LUA_ROW = 'lua';

/**
 * What each sum is counted in, and how a tooltip says it.
 *
 * Two, because two is what the extension can add to natively: the necromancy
 * raise percentage and the dark-energy ceiling, each a term in a sum the engine
 * already computes (docs/ARTIFACT_EFFECTS.md). A hero's attack or luck is not
 * here and cannot be — there is no hook — so a set that wants those carries a
 * script row instead, and the hint under the rows says so.
 */
const UNITS: Record<string, string> = { necromancy: '%', energy: 'ceiling points' };
const READS: Record<string, (n: number) => string> = {
  necromancy: (n) => `Raises necromancy by ${n}%.`,
  energy: (n) => `Raises the dark energy ceiling by ${n}.`,
};

/**
 * A first version of every tooltip, written from the effects.
 *
 * The shipped sets word each line as what the set does AT that count, not as
 * the step it adds — Necromancers_Desc4 repeats the speed penalty from Desc2
 * and then adds its own — so this is cumulative: every effect whose threshold
 * has been reached. Only blank boxes are filled; a line somebody wrote is never
 * overwritten, because a draft is worth less than a sentence.
 */
function draftCountTexts(): void {
  const boxes = [...$('as-counts').querySelectorAll<HTMLInputElement>('input')];
  const rows = setEffects();
  let written = 0;
  boxes.forEach((box, i) => {
    const worn = i + 1;
    if (box.value.trim()) return;
    const said = rows.filter((r) => r.threshold <= worn)
      .map((r) => READS[r.stat]?.(r.amount) ?? `${r.stat} ${r.amount}`);
    if (!said.length) return;
    box.value = said.join(' ');
    written++;
  });
  $('as-note').textContent = written
    ? `wrote ${written} line(s) from the effects — edit them, they are only a first version`
    : rows.length
      ? 'nothing to write: every line at a count the effects reach is already written'
      : 'nothing to write from: the set has no numbered effect yet';
}

/** The set's script, held while the form is open. The row is only its handle. */
let setScript = '';

/** Which rows are scripts — a set has one, and the option says so. */
const luaRows = (): HTMLSelectElement[] =>
  [...$('as-effects').querySelectorAll<HTMLSelectElement>('.as-effect-stat')].filter((s) => s.value === LUA_ROW);

/** What the rows say, as the payload wants it. */
function setEffects(): { stat: string; threshold: number; amount: number }[] {
  const out: { stat: string; threshold: number; amount: number }[] = [];
  for (const row of $('as-effects').querySelectorAll('label')) {
    const stat = row.querySelector<HTMLSelectElement>('.as-effect-stat')?.value;
    const threshold = Number(row.querySelector<HTMLInputElement>('.as-effect-worn')?.value) || 1;
    const amount = Number(row.querySelector<HTMLInputElement>('.as-effect-amount')?.value) || 0;
    if (stat && stat !== LUA_ROW && amount) out.push({ stat, threshold, amount });
  }
  return out;
}

/** Which set the form is editing, or '' when it is making a new one. */
let editingSet = '';

/**
 * Put an installed set into the form.
 *
 * The effect value is locked: `DefaultStats` names it and the enum holds it,
 * so renaming it here would leave the data pointing at nothing. Members and
 * texts are all free to move.
 */
async function editArtifactSet(effect: string): Promise<void> {
  const { mods } = await api.listMods();
  const s = mods.flatMap((m) => m.sets).find((x) => x.effect === effect);
  if (!s) return;
  editingSet = effect;
  await fillSetMembers();
  for (const box of $('as-members').querySelectorAll<HTMLInputElement>('input')) {
    box.checked = s.artifacts.includes(box.value);
  }
  renderSetCounts();
  $input('as-effect').value = s.effect;
  $input('as-file').value = s.file;
  $input('as-name').value = s.name;
  // The texts and the bonus come back with it. A set opened for editing without
  // them saved blanks over what was written — the same trap artifacts had.
  $input('as-desc').value = s.description ?? '';
  const counts = [...$('as-counts').querySelectorAll<HTMLInputElement>('input')];
  counts.forEach((input, i) => { input.value = s.perCount?.[i] ?? ''; });
  $('as-effects').innerHTML = '';
  for (const e of s.effects ?? []) addSetEffectRow(e.stat, String(e.threshold), String(e.amount));
  setScript = s.script ?? '';
  if (setScript) addSetEffectRow(LUA_ROW);
  $input('as-effect').disabled = true;
  $input('as-file').disabled = true;
  $button('as-ok').textContent = 'Save & install';
  $('as-note').textContent = '';
  gateSet().rewatch();
  openOnTop('setedit');
  $('setedit-title').textContent = 'Editing set';
  void showExtensionState('as-ext').catch(() => {});
}

/** Back to making a new one. */
function newSet(): void {
  editingSet = '';
  $input('as-effect').disabled = false;
  $input('as-file').disabled = false;
  for (const id of ['as-file', 'as-effect', 'as-name', 'as-desc']) $input(id).value = '';
  $button('as-ok').textContent = 'Build & install';
  for (const box of $('as-members').querySelectorAll<HTMLInputElement>('input')) box.checked = false;
  // A new set has no bonus and no script. The form is reached again without
  // closing it, and what was left standing would land on the next set.
  $('as-effects').innerHTML = '';
  setScript = '';
  renderSetCounts();
  gateSet().rewatch();
  openOnTop('setedit');
  $('setedit-title').textContent = 'New set';
  void showExtensionState('as-ext').catch(() => {});
}

/** A set's effect value is named by nothing outside the mod, so no scan. */
async function removeSet(effect: string, label: string): Promise<void> {
  if (!await ask(`Remove ${label}? Its members stay; only the set goes.`, 'Remove')) return;
  try {
    await api.removeArtifactSet({ id: effect });
    await refreshModLists();
  } catch (e) {
    $('am-err').textContent = e instanceof Error ? e.message : String(e);
  }
}
async function submitArtifactSet(): Promise<void> {
  const ok = $button('as-ok');
  ok.disabled = true;
  $('as-err').textContent = '';
  $('as-note').textContent = '';
  try {
    const send = editingSet ? api.updateArtifactSet : api.installArtifactSet;
    const res = await send({
      effect: $input('as-effect').value,
      artifacts: setMembers(),
      file: $input('as-file').value,
      name: $input('as-name').value,
      description: $input('as-desc').value,
      perCount: [...$('as-counts').querySelectorAll<HTMLInputElement>('input')].map((i) => i.value),
      effects: setEffects(),
      // Only when the set carries a script row: taking the row off is how a set
      // stops having one, and an install that ignored that would leave the old
      // text in the mod forever.
      script: luaRows().length ? setScript : '',
    });
    modDialog('setedit').close();
    editingSet = '';
    $('am-note').textContent = `installed ${res.archive}\nset effect ${res.number}`
      + ' — the game will count its pieces; the bonus itself is native code';
    await refreshModLists();
  } catch (e) {
    $('as-err').textContent = e instanceof Error ? e.message : String(e);
  } finally {
    ok.disabled = false;
  }
}
let setScriptEditor: CodeEditor | null = null;

/**
 * The set's script, in the editor — on top of the set form, never inside it.
 *
 * A second instance of the map editor's own CodeMirror: the same highlighting,
 * the same completion (the engine's API, ours from the extension, the names the
 * map defines) and the same linter in the gutter. Mounted once, lazily, because
 * a set without a script never opens it.
 */

function openSetScript(): void {
  // The completion sources are fetched when a MAP opens, and this dialog is
  // reachable with none: the mods window works on its own. Without this the
  // editor comes up with an empty API list and completes nothing, which looks
  // like the feature being broken rather than like a list not being asked for.
  if (!scriptContextReady()) {
    void loadScriptContext()
      .then(() => { $('ss-info').textContent = scriptContextNote(); })
      .catch(() => { $('ss-info').textContent = 'no completion available'; });
  }
  if (!setScriptEditor) {
    setScriptEditor = mountCodeEditor($('ss-text'), () => closeSetScript(true), (diags) => {
      const errors = diags.filter((d) => d.severity === 'error').length;
      const el = $('ss-lint');
      el.className = 'de-lint ' + (errors ? 'err' : diags.length ? 'warn' : 'ok');
      el.textContent = errors ? `⚠ ${errors} error${errors === 1 ? '' : 's'}`
        : diags.length ? `⚠ ${diags.length} warning${diags.length === 1 ? '' : 's'}` : '✓ no errors';
    });
  }
  setScriptEditor.setDoc(setScript, 'lua');
  $('ss-info').textContent = scriptContextNote();
  openOnTop('setscript');
  setScriptEditor.focus();
}


/**
 * The pencil, with the editor's own failures kept out of the click handler.
 *
 * A modal that fails to open leaves the form looking dead and a spec waiting for
 * something that will never appear; a line in the form's error slot says what
 * happened instead.
 */
function openSetScriptSafely(): void {
  try {
    openSetScript();
  } catch (e) {
    $('as-err').textContent = 'could not open the script editor: '
      + (e instanceof Error ? e.message : String(e));
  }
}

/** Done keeps what was written; Cancel leaves the set with what it had. */
function closeSetScript(keep: boolean): void {
  if (keep && setScriptEditor) setScript = setScriptEditor.getDoc();
  modDialog('setscript').close();
}
