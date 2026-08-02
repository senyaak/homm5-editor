// The skill form — a racial for a class of ours, or a perk of its branch.
//
// Short, because a skill has little to decide and one thing it cannot: what it
// DOES. The executable's arithmetic is compiled against the values it was built
// with, so a value of ours has a name, an icon and a place in the tree and no
// behaviour at all until the native extension is taught one — the same bargain
// a specialization makes, and the form says so rather than implying otherwise.
//
// A RACIAL is named and described at four levels, the fourth being the one an
// artifact grants. One name here becomes «name I…IV», which is enough while a
// port is being written and is four distinguishable rows on the hero screen —
// four identical ones read as a skill that never advanced.
//
// A PERK hangs off a branch and asks for something first. Both of those come
// from OUR side of the table: a perk of a shipped branch is a different thing
// (it is opened to a class in the class form, where the gate actually lives).

import { $, $input, $select, fillSelect } from '#core/dom.ts';
import { modDialog, openOnTop, ask } from '#core/dialog.ts';
import { api } from '#core/ipc.ts';
import { registerHeroTab } from '#features/mods/hero-tabs.ts';
import { forgetClassData } from '#features/mods/hero-classes.ts';
import { effectStats, ensureEffectStats, modRow } from '#features/mods/shared.ts';
import { requireFilled } from '#core/form-gate.ts';
import { mountCodeEditor } from '#features/text-editor/code-editor.ts';
import type { CodeEditor } from '#features/text-editor/code-editor.ts';
import { loadScriptContext, scriptContextNote, scriptContextReady } from '#features/text-editor/context.ts';
import { skillStarter } from '#src/mods/skill-scripts.ts';
import type { ModListEntry } from '#electron/ipc.ts';

/** The one being changed, or '' when the form is making a new one. */
let editingSkill = '';

/**
 * The two scripts the form is holding, kept out of the DOM.
 *
 * Lua is written in an editor, never in an input among fields, so the form has
 * nowhere to keep the text but here — the same arrangement the set form has.
 */
const scripts: Record<Side, string> = { map: '', combat: '' };

/** Which context a script belongs to: the adventure map, or a battle. */
type Side = 'map' | 'combat';

let gate: { check: () => void; rewatch: () => void } | null = null;
const gateSkill = (): { check: () => void; rewatch: () => void } => (gate ??= requireFilled({
  ok: 'hk-ok',
  missing: 'hk-missing',
  fields: { identifier: 'hk-id', name: 'hk-name' },
  // A skill belongs to a class, and ours is the only kind it may belong to: a
  // racial names its class and that is the whole of the binding.
  extra: () => ($select('hk-class').value ? [] : ['a class of ours to belong to']),
}));

/** The picture rows, in the order the record wants them. */
const PICTURES = ['hk-pic-1', 'hk-pic-2', 'hk-pic-3', 'hk-pic-4'];

/**
 * A perk needs a branch and something to ask for; a racial needs neither. And
 * the two are drawn differently: four levels against a grey/lit pair.
 */
function showKind(): void {
  const perk = $select('hk-kind').value === 'perk';
  for (const el of document.querySelectorAll<HTMLElement>('.hk-perk')) el.style.display = perk ? '' : 'none';
  const rows = document.querySelectorAll<HTMLElement>('.hk-pic-row');
  const labels = perk ? ['Picture (grey)', 'Picture (lit)'] : ['Picture I', 'Picture II', 'Picture III', 'Picture IV'];
  rows.forEach((row, i) => {
    row.style.display = i < labels.length ? '' : 'none';
    $(`hk-pic-label-${i + 1}`).textContent = labels[i] ?? '';
  });
}

/**
 * One "what it adds" row: a sum the extension knows, and how much per mastery.
 *
 * A list you add to rather than a field per stat, the same as an artifact's —
 * the stats come from the main process because each one is a place in the
 * executable where we found where to append our term, and the form should not
 * have to be edited when another is found. Only the extension's stats are
 * offered: a skill record has no fields of its own to write into.
 */
function addSkillEffectRow(stat = '', amount = ''): void {
  const row = document.createElement('label');
  const select = document.createElement('select');
  for (const s of effectStats) {
    const option = document.createElement('option');
    option.value = option.textContent = s;
    select.appendChild(option);
  }
  if (stat) select.value = stat;
  select.className = 'hk-effect-stat';
  const value = document.createElement('input');
  value.type = 'number';
  value.value = amount || '0';
  value.className = 'hk-effect-amount';
  value.title = 'per level of mastery; negative takes away';
  const drop = document.createElement('button');
  drop.className = 'um-recolor';
  drop.textContent = '×';
  drop.title = 'remove this bonus';
  drop.onclick = () => row.remove();
  row.append(select, value, drop);
  $('hk-effects').appendChild(row);
}

/** What those rows say. A zero is dropped by the main process, not here. */
function skillEffects(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of $('hk-effects').querySelectorAll('label')) {
    const stat = row.querySelector<HTMLSelectElement>('.hk-effect-stat')?.value;
    const amount = Number(row.querySelector<HTMLInputElement>('.hk-effect-amount')?.value) || 0;
    if (stat) out[stat] = (out[stat] ?? 0) + amount;
  }
  return out;
}

/** What the picture rows currently hold, trailing blanks dropped. */
function pictures(): string[] {
  const all = PICTURES.map((id) => $input(id).value.trim());
  while (all.length && !all[all.length - 1]) all.pop();
  return all;
}

/** Fill the three selects from what the mod already holds. */
async function fillSkillForm(): Promise<void> {
  await ensureEffectStats();
  const { mods } = await api.listMods();
  const classes = mods.flatMap((m) => m.classes ?? []);
  const skills = mods.flatMap((m) => m.skills ?? []);
  fillSelect($select('hk-class'), classes.map((c) => ({ id: c.id, label: c.name || c.id })), $select('hk-class').value);
  // A branch is a racial of ours: a perk hung off a shipped branch is the class
  // form's business, because there the gate is the perk's class list.
  const racials = skills.filter((s) => s.kind === 'racial').map((s) => ({ id: s.id, label: s.name || s.id }));
  fillSelect($select('hk-branch'), racials, $select('hk-branch').value);
  // Perks only, and never the branch: holding the branch is what BasicSkillID
  // already says, and no shipped perk asks for a base skill by name.
  fillSelect($select('hk-needs'), [{ id: '', label: '— nothing but the branch' },
    ...skills.filter((s) => s.kind === 'perk').map((s) => ({ id: s.id, label: s.name || s.id }))],
  $select('hk-needs').value);
  gateSkill().check();
}

/** The installed skills, as the list shows them. */
function renderSkillList(mods: ModListEntry[]): void {
  const box = $('hk-list');
  box.innerHTML = '';
  const skills = mods.flatMap((m) => m.skills ?? []);
  if (!skills.length) {
    box.textContent = 'No skills of our own. One is an entry in the table that holds all 221 of the game\'s — '
      + 'and a name, an icon and a place in the tree until the extension is taught what it does.';
    return;
  }
  for (const s of skills) {
    const row = modRow({
      number: s.number,
      label: s.name || s.id,
      note: s.kind === 'racial' ? `racial of ${s.heroClass.replace('HERO_CLASS_', '').toLowerCase()}`
        : `perk of ${(s.basicSkill ?? '').replace('HERO_SKILL_', '').toLowerCase()}`,
      onEdit: () => { void editSkill(s.id); },
      onRemove: () => { void removeSkill(s.id, s.name || s.id); },
    });
    row.title = s.id;
    box.append(row);
  }
}

async function refreshSkillList(): Promise<void> {
  const { mods } = await api.listMods();
  renderSkillList(mods);
}

async function editSkill(id: string): Promise<void> {
  const { mods } = await api.listMods();
  const s = mods.flatMap((m) => m.skills ?? []).find((x) => x.id === id);
  if (!s) return;
  editingSkill = id;
  $('skilledit-title').textContent = `Edit ${s.name || s.id}`;
  $input('hk-id').value = s.id;
  $input('hk-id').disabled = true;         // classes and heroes name it
  $select('hk-kind').value = s.kind;
  $input('hk-name').value = s.name;
  $input('hk-desc').value = s.description;
  const drawn = s.pictures?.length ? s.pictures : s.picture ? [s.picture] : [];
  PICTURES.forEach((id, i) => { $input(id).value = drawn[i] ?? ''; });
  await fillSkillForm();
  // After the form is filled, not before: a row's select is built from the
  // stats the extension knows, and those arrive with everything else.
  $('hk-effects').innerHTML = '';
  for (const [stat, amount] of Object.entries(s.effects ?? {})) addSkillEffectRow(stat, String(amount));
  $select('hk-class').value = s.heroClass;
  $select('hk-branch').value = s.basicSkill ?? '';
  $select('hk-needs').value = s.prerequisites?.[0] ?? '';
  scripts.map = s.script ?? '';
  scripts.combat = s.combatScript ?? '';
  showScripts();
  showKind();
  gateSkill().rewatch();
  openOnTop('skilledit');
}

async function removeSkill(id: string, label: string): Promise<void> {
  const question = `Remove ${label}?\n\nRefused while a hero holds it, a class weights it or a perk hangs off it — `
    + 'each of those would be left naming a value the enum no longer declares.';
  if (!await ask(question, 'Remove')) return;
  try {
    await api.removeHeroSkill({ id });
    forgetClassData();
    $('hm-note').textContent = `${label} removed.`;
    await refreshSkillList();
  } catch (e) {
    $('hm-err').textContent = e instanceof Error ? e.message : String(e);
  }
}

async function submitSkill(): Promise<void> {
  $('hk-err').textContent = '';
  try {
    const kind = $select('hk-kind').value === 'perk' ? 'perk' as const : 'racial' as const;
    const needs = $select('hk-needs').value;
    const p = {
      id: $input('hk-id').value.trim(),
      kind,
      heroClass: $select('hk-class').value,
      name: $input('hk-name').value,
      description: $input('hk-desc').value,
      // One row filled is one texture for every level; more than one is a
      // drawing per level, and the record repeats the last to fill the rest.
      ...(pictures().length === 1 ? { picture: pictures()[0]! } : {}),
      ...(pictures().length > 1 ? { pictures: pictures() } : {}),
      // A perk of a branch of ours needs NOTHING written down: the branch is
      // the gate, because no other class has it — which is exactly the shape
      // the shipped Multishot has under Avenger. Something named here is an
      // extra condition on top of that.
      ...(kind === 'perk' ? {
        basicSkill: $select('hk-branch').value,
        ...(needs ? { prerequisites: [needs] } : {}),
      } : {}),
      effects: skillEffects(),
      // Sent whatever they hold, blank included: emptying the editor is how a
      // skill stops carrying a script, and an install that only ever sent text
      // would leave the old one in the mod for good.
      script: scripts.map,
      combatScript: scripts.combat,
    };
    const r = editingSkill ? await api.updateHeroSkill(p) : await api.installHeroSkill(p);
    $('hm-note').textContent = `${editingSkill ? 'Updated' : 'Installed'} ${p.name} as value ${r.number} in ${r.archive}`;
    // The class form offers every skill a class may weight, and this is now one
    // of them — its cached copy of the two tables is a launch behind otherwise.
    forgetClassData();
    modDialog('skilledit').close();
    await refreshSkillList();
  } catch (e) {
    $('hk-err').textContent = e instanceof Error ? e.message : String(e);
  }
}

let skillScriptEditor: CodeEditor | null = null;
/** Which half is open, so Done knows what it is keeping. */
let editingSide: Side = 'map';

/** What the two buttons say: whether there is a script, and how long it is. */
function showScripts(): void {
  for (const side of ['map', 'combat'] as Side[]) {
    const text = scripts[side].trim();
    const lines = text ? text.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('--')).length : 0;
    $(side === 'map' ? 'hk-script-note' : 'hk-combat-note').textContent =
      text ? `${lines} line${lines === 1 ? '' : 's'}` : 'none';
  }
}

/**
 * A skill's script, in the editor — on top of the skill form, never inside it.
 *
 * The same CodeMirror the map's scripts use, mounted once and lazily: most
 * skills are a number in a sum and never open this at all. The completion
 * sources are fetched when a MAP opens and this window works without one, so
 * they are asked for here too.
 */
function openSkillScript(side: Side): void {
  editingSide = side;
  if (!scriptContextReady()) {
    void loadScriptContext()
      .then(() => { $('ks-info').textContent = scriptContextNote(); })
      .catch(() => { $('ks-info').textContent = 'no completion available'; });
  }
  if (!skillScriptEditor) {
    skillScriptEditor = mountCodeEditor($('ks-text'), () => closeSkillScript(true), (diags) => {
      const errors = diags.filter((d) => d.severity === 'error').length;
      const el = $('ks-lint');
      el.className = 'de-lint ' + (errors ? 'err' : diags.length ? 'warn' : 'ok');
      el.textContent = errors ? `⚠ ${errors} error${errors === 1 ? '' : 's'}`
        : diags.length ? `⚠ ${diags.length} warning${diags.length === 1 ? '' : 's'}` : '✓ no errors';
    });
  }
  // An empty half opens on the shape it has: what the head declares for it, and
  // — on the map — that a function nothing triggers never runs. The battle side
  // has no hook to show, which is the thing worth saying there.
  if (!scripts[side].trim()) {
    scripts[side] = skillStarter($input('hk-id').value.trim(), side);
    $('hk-err').textContent = '';
  }
  $('ks-title').textContent = side === 'map' ? 'Skill script — on the adventure map' : 'Skill script — inside a battle';
  $('ks-info').textContent = scriptContextNote();
  skillScriptEditor.setDoc(scripts[side], 'lua');
  openOnTop('skillscript');
  skillScriptEditor.focus();
}

function closeSkillScript(keep: boolean): void {
  if (keep && skillScriptEditor) scripts[editingSide] = skillScriptEditor.getDoc();
  showScripts();
  modDialog('skillscript').close();
}

/** Bind the tab, the list and the form to their markup. */
export function initHeroSkills(): void {
  registerHeroTab({
    id: 'skills',
    label: 'Skills',
    about: 'A racial for a class of ours, or a perk of its branch — words and an icon until the extension is taught what it does.',
    pane: 'hm-pane-skills',
    onShow: () => {
      void refreshSkillList().catch((e: unknown) => {
        $('hm-err').textContent = e instanceof Error ? e.message : String(e);
      });
    },
  });

  $('hk-new').onclick = () => {
    editingSkill = '';
    $('hk-err').textContent = '';
    $('skilledit-title').textContent = 'New skill';
    $input('hk-id').disabled = false;
    $input('hk-id').value = '';
    $input('hk-name').value = '';
    $input('hk-desc').value = '';
    for (const id of PICTURES) $input(id).value = '';
    $('hk-effects').innerHTML = '';
    scripts.map = '';
    scripts.combat = '';
    showScripts();
    $select('hk-kind').value = 'racial';
    showKind();
    gateSkill().rewatch();
    openOnTop('skilledit');
    void fillSkillForm().catch((e: unknown) => {
      $('hk-err').textContent = e instanceof Error ? e.message : String(e);
    });
  };

  $('hk-effect-add').onclick = () => {
    void ensureEffectStats().then(() => addSkillEffectRow())
      .catch((e: unknown) => { $('hk-err').textContent = e instanceof Error ? e.message : String(e); });
  };
  $select('hk-kind').addEventListener('change', showKind);
  for (const btn of document.querySelectorAll<HTMLButtonElement>('button.hk-picture')) {
    btn.onclick = () => {
      void (async () => {
        const picked = await api.pickPicture();
        if (picked) $input(btn.dataset.for!).value = picked;
      })().catch((e) => { $('hk-err').textContent = e instanceof Error ? e.message : String(e); });
    };
  }
  $('hk-script').onclick = () => openSkillScript('map');
  $('hk-combat-script').onclick = () => openSkillScript('combat');
  $('ks-ok').onclick = () => closeSkillScript(true);
  $('ks-cancel').onclick = () => closeSkillScript(false);
  $('ks-x').onclick = () => closeSkillScript(false);
  $('skilledit-x').onclick = () => modDialog('skilledit').close();
  $('skilledit-cancel').onclick = () => modDialog('skilledit').close();
  $('hk-ok').onclick = () => { void submitSkill(); };
}
