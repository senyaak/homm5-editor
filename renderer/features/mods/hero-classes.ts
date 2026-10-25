// The class form — the tenth class, where the game ships nine.
//
// A class answers two questions and the form is two sections, one each:
//
//   PRIORITIES  how often a level up offers each skill, and how often each
//               attribute grows. Both are distributions summing to a hundred in
//               all nine shipped classes, so both totals are shown as they are
//               typed and the build refuses anything else.
//   AVAILABILITY which PERKS this class may take — which is not on the class at
//               all. The gate is a list of classes on each perk, so the two
//               sides here are "in that list" and "not in it", and a perk with
//               no list is open to everybody already and is in neither.
//
// The lists come from mods:class-data, read off the game's own two tables. A
// copy of them kept here would be a second copy to drift, and the perks alone
// are 194 rows with a dependency list apiece.
//
// The donor button fills EVERYTHING — weights, attributes, allowed perks — from
// a shipped class, and every one of them stays editable. That is what makes
// "the Ranger, but she may pitch a plague tent" one press and one move.

import { $, $input, $select } from '#core/dom.ts';
import { modDialog, openOnTop, ask } from '#core/dialog.ts';
import { api } from '#core/ipc.ts';
import { pickPreset } from '#features/mods/preset.ts';
import { registerHeroTab } from '#features/mods/hero-tabs.ts';
import { modRow } from '#features/mods/shared.ts';
import { requireFilled } from '#core/form-gate.ts';
import type { ModListEntry, ModsClassDataResult } from '#electron/ipc.ts';

/** What the two sections are built from, fetched once per window opening. */
let data: Promise<ModsClassDataResult> | null = null;
export const classData = (): Promise<ModsClassDataResult> => (data ??= api.classData());

/** The one being changed, or '' when the form is making a new one. */
let editingClass = '';
/** What the class prefers in the magic shop — carried from the donor, not edited. */
let preferredSpells: string[] = [];
/** Perk id → the dependencies its entry will carry. Filled from the perk itself. */
const dependencies = new Map<string, string[]>();

/** What the build refuses in as many words, said before the press. */
let gate: { check: () => void; rewatch: () => void } | null = null;
const gateClass = (): { check: () => void; rewatch: () => void } => (gate ??= requireFilled({
  ok: 'hc-ok',
  missing: 'hc-missing',
  fields: { identifier: 'hc-id', name: 'hc-name' },
  // The two sums are the class's own rule and the build enforces them, so the
  // form says so first — a hundred is not something anyone gets right by luck.
  extra: () => {
    const out: string[] = [];
    if (skillTotal() !== 100) out.push(`skill weights adding to 100 (now ${skillTotal()})`);
    if (attrTotal() !== 100) out.push(`attributes adding to 100 (now ${attrTotal()})`);
    return out;
  },
}));

const ATTRS = ['hc-off', 'hc-def', 'hc-sp', 'hc-kn'] as const;
const num = (id: string): number => Number($input(id).value) || 0;
const attrTotal = (): number => ATTRS.reduce((n, id) => n + num(id), 0);
const skillTotal = (): number => [...weightInputs()].reduce((n, el) => n + (Number(el.value) || 0), 0);
const weightInputs = (): NodeListOf<HTMLInputElement> =>
  document.querySelectorAll<HTMLInputElement>('#hc-skills input');

/** Both totals, as the form shows them while they are typed. */
function showTotals(): void {
  for (const [id, total] of [['hc-skill-total', skillTotal()], ['hc-attr-total', attrTotal()]] as const) {
    $(id).textContent = total === 100 ? '100 ✓' : `${total} — must be 100`;
    $(id).style.color = total === 100 ? '#3fb950' : '#f0883e';
  }
  gateClass().check();
}

/** One number per skill a class may weight, in the order the game lists them. */
async function drawWeights(values: Map<string, number> = new Map()): Promise<void> {
  const d = await classData();
  const box = $('hc-skills');
  box.innerHTML = '';
  for (const s of d.skills) {
    const label = document.createElement('label');
    const name = document.createElement('span');
    name.textContent = s.name || s.id;
    name.title = s.id;
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.max = '100';
    input.value = String(values.get(s.id) ?? 0);
    input.dataset.skill = s.id;
    input.oninput = showTotals;
    label.append(name, input);
    box.append(label);
  }
  showTotals();
}

/** The two sides of the availability section. */
async function drawPerks(allowed: Set<string>): Promise<void> {
  const d = await classData();
  for (const [id, wanted] of [['hc-allowed', true], ['hc-denied', false]] as const) {
    const box = $select(id);
    box.innerHTML = '';
    // A perk nobody is listed on is open to whoever has the branch, so it is in
    // neither list: moving it would write an entry that CLOSED it to everyone
    // else, which is the opposite of what pressing ← means.
    for (const p of d.perks.filter((x) => x.classes.length || allowed.has(x.id))) {
      if (allowed.has(p.id) !== wanted) continue;
      const option = new Option(`${p.name} — ${branchName(d, p.branch)}`, p.id);
      option.title = p.dependencies.length ? `needs ${p.dependencies.join(', ')}` : 'needs nothing but the branch';
      box.append(option);
    }
  }
}

/** A branch's name, for the line each perk is listed on. */
function branchName(d: ModsClassDataResult, branch: string): string {
  return d.skills.find((s) => s.id === branch)?.name ?? branch.replace('HERO_SKILL_', '').toLowerCase();
}

/** Which perks are on the allowed side right now. */
function allowedNow(): Set<string> {
  return new Set([...$select('hc-allowed').options].map((o) => o.value));
}

/** Move what is selected from one side to the other. */
async function move(from: 'hc-allowed' | 'hc-denied'): Promise<void> {
  const d = await classData();
  const picked = [...$select(from).selectedOptions].map((o) => o.value);
  const allowed = allowedNow();
  for (const id of picked) {
    if (from === 'hc-denied') {
      allowed.add(id);
      // The dependencies the OTHER classes need, which is what a new entry
      // should ask for unless somebody says otherwise.
      if (!dependencies.has(id)) {
        dependencies.set(id, d.perks.find((p) => p.id === id)?.dependencies ?? []);
      }
    } else allowed.delete(id);
  }
  await drawPerks(allowed);
}

/** The installed classes, as the list inside the window shows them. */
function renderClassList(mods: ModListEntry[]): void {
  const box = $('hc-list');
  box.innerHTML = '';
  const classes = mods.flatMap((m) => m.classes ?? []);
  if (!classes.length) {
    box.textContent = 'No classes of our own. One is a tenth entry in a table the game sizes at nine — '
      + 'the archive carries it and our copy of the executable is retuned to match.';
    return;
  }
  for (const c of classes) {
    const row = modRow({
      number: c.number,
      label: c.name || c.id,
      note: `${c.skills.length} weights · ${c.allowedPerks?.length ?? 0} perks opened`,
      onEdit: () => { void editClass(c.id); },
      onRemove: () => { void removeClass(c.id, c.name || c.id); },
    });
    row.title = c.id;
    box.append(row);
  }
}

async function refreshClassList(): Promise<void> {
  const { mods } = await api.listMods();
  renderClassList(mods);
}

/** Fill the form from what is in the mod already. */
async function editClass(id: string): Promise<void> {
  const { mods } = await api.listMods();
  const c = mods.flatMap((m) => m.classes ?? []).find((x) => x.id === id);
  if (!c) return;
  editingClass = id;
  $('hc-err').textContent = '';
  $('classedit-title').textContent = `Edit ${c.name || c.id}`;
  $input('hc-id').value = c.id;
  $input('hc-id').disabled = true;      // the id is what heroes name
  $input('hc-name').value = c.name;
  $input('hc-off').value = String(c.attributes.offence);
  $input('hc-def').value = String(c.attributes.defence);
  $input('hc-sp').value = String(c.attributes.spellpower);
  $input('hc-kn').value = String(c.attributes.knowledge);
  preferredSpells = c.preferredSpells ?? [];
  dependencies.clear();
  for (const p of c.allowedPerks ?? []) dependencies.set(p.perk, p.dependencies);
  await drawWeights(new Map(c.skills.map((w) => [w.skill, w.prob])));
  await drawPerks(new Set((c.allowedPerks ?? []).map((p) => p.perk)));
  gateClass().rewatch();
  openOnTop('classedit');
}

/** Take one out — refused while a hero is of it or a skill belongs to it. */
async function removeClass(id: string, label: string): Promise<void> {
  const question = `Remove ${label}?

The class leaves the mod, and the executable comes back down to the nine the game ships.`;
  if (!await ask(question, 'Remove')) return;
  try {
    await api.removeHeroClass({ id });
    $('hm-note').textContent = `${label} removed.`;
    await refreshClassList();
  } catch (e) {
    $('hm-err').textContent = e instanceof Error ? e.message : String(e);
  }
}

/** What the form currently says, as the channel takes it. */
function payload(): Parameters<typeof api.installHeroClass>[0] {
  return {
    id: $input('hc-id').value.trim(),
    name: $input('hc-name').value,
    skills: [...weightInputs()].map((el) => ({ skill: el.dataset.skill!, prob: Number(el.value) || 0 })),
    attributes: {
      offence: num('hc-off'), defence: num('hc-def'), spellpower: num('hc-sp'), knowledge: num('hc-kn'),
    },
    ...(preferredSpells.length ? { preferredSpells } : {}),
    allowedPerks: [...allowedNow()].map((perk) => ({ perk, dependencies: dependencies.get(perk) ?? [] })),
  };
}

async function submitClass(): Promise<void> {
  $('hc-err').textContent = '';
  try {
    const p = payload();
    const r = editingClass ? await api.updateHeroClass(p) : await api.installHeroClass(p);
    // The VALUE is the useful half: it is what a hero's document resolves to and
    // what the executable's ceiling has to cover.
    $('hm-note').textContent = `${editingClass ? 'Updated' : 'Installed'} ${p.name} as value ${r.number} in ${r.archive}`;
    modDialog('classedit').close();
    await refreshClassList();
  } catch (e) {
    $('hc-err').textContent = e instanceof Error ? e.message : String(e);
  }
}

/** Bind the tab, the list and the form to their markup. */
export function initHeroClasses(): void {
  registerHeroTab({
    id: 'classes',
    label: 'Classes',
    about: 'A tenth entry in a table the game sizes at nine — the archive and our copy of the executable move together.',
    pane: 'hm-pane-classes',
    onShow: () => {
      void refreshClassList().catch((e: unknown) => {
        $('hm-err').textContent = e instanceof Error ? e.message : String(e);
      });
    },
  });

  $('hc-new').onclick = () => {
    editingClass = '';
    preferredSpells = [];
    dependencies.clear();
    $('hc-err').textContent = '';
    $('classedit-title').textContent = 'New class';
    $input('hc-id').disabled = false;
    $input('hc-id').value = '';
    $input('hc-name').value = '';
    $input('hc-donor').value = '';
    $('hc-donor-name').textContent = 'nothing yet — the form is blank';
    for (const id of ATTRS) $input(id).value = '0';
    gateClass().rewatch();
    openOnTop('classedit');
    void Promise.all([drawWeights(), drawPerks(new Set())]).catch((e: unknown) => {
      $('hc-err').textContent = e instanceof Error ? e.message : String(e);
    });
  };

  $('hc-donor-pick').onclick = () => {
    void (async () => {
      const d = await classData();
      pickPreset('Fill this class from', d.donors.map((c) => ({ id: c.id, label: `${c.name} (${c.id})` })),
        (id, label) => {
          const donor = d.donors.find((c) => c.id === id);
          if (!donor) return;
          $input('hc-donor').value = id;
          $('hc-donor-name').textContent = label;
          $input('hc-off').value = String(donor.attributes.offence);
          $input('hc-def').value = String(donor.attributes.defence);
          $input('hc-sp').value = String(donor.attributes.spellpower);
          $input('hc-kn').value = String(donor.attributes.knowledge);
          preferredSpells = donor.preferredSpells;
          dependencies.clear();
          for (const p of donor.perks) dependencies.set(p.perk, p.dependencies);
          void drawWeights(new Map(donor.skills.map((w) => [w.skill, w.prob])));
          void drawPerks(new Set(donor.perks.map((p) => p.perk)));
        });
    })().catch((e) => { $('hc-err').textContent = e instanceof Error ? e.message : String(e); });
  };

  $('hc-allow').onclick = () => { void move('hc-denied'); };
  $('hc-deny').onclick = () => { void move('hc-allowed'); };
  for (const id of ATTRS) $input(id).oninput = showTotals;
  $('classedit-x').onclick = () => modDialog('classedit').close();
  $('classedit-cancel').onclick = () => modDialog('classedit').close();
  $('hc-ok').onclick = () => { void submitClass(); };
  // The window may be open on this tab already when a class is installed from
  // elsewhere; redrawing the bar is how the list catches up.
  $('heroesbtn').addEventListener('click', () => { data = null; });
}

/** Re-read the two tables — after a skill of ours joined them. */
export function forgetClassData(): void {
  data = null;
}
