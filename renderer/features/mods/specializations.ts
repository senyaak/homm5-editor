// The specialization form — a hero's, and the smallest thing the editor makes.
//
// It costs the game one enum entry: no reference table, no ceiling, no file of
// its own (src/mods/specializations.ts). What it costs US is that the engine
// does nothing with a value it has never heard of, so the effect comes from the
// native extension — which is why this form carries the same warning the
// artifact set's does, and why an effect with no extension installed is a
// number nobody will ever see.
//
// It lives inside the Heroes window, as a tab of its own: a specialization
// exists to be given to a hero, so it is authored where heroes are. It stood
// beside the hero list in a second column while those were the only two things
// the window held; the class and the skill coming next made that a layout that
// could not grow (features/mods/hero-tabs.ts).

import { $, $input, $select, $button, fillSelect } from '#core/dom.ts';
import { ask, modDialog, openOnTop } from '#core/dialog.ts';
import { api } from '#core/ipc.ts';
import { requireFilled } from '#core/form-gate.ts';
import { modRow } from '#features/mods/shared.ts';
import { registerHeroTab } from '#features/mods/hero-tabs.ts';
import { showExtensionState } from '#features/mods/artifacts.ts';
import type { ModListEntry } from '#electron/ipc.ts';

/**
 * What the build refuses: an id of the right shape that nobody holds, and a
 * name. `addSpecialization` throws for both in as many words, which is exactly
 * the pair worth saying before the press.
 */
let specGate: { check: () => void; rewatch: () => void } | null = null;
const gateSpec = (): { check: () => void; rewatch: () => void } => (specGate ??= requireFilled({
  ok: 'hs-ok',
  missing: 'hs-missing',
  fields: { identifier: 'hs-id', name: 'hs-name' },
}));

/** The one being changed, or '' when the form is making a new one. */
let editingSpec = '';

/** Every specialization installed, across the mods found. */
function installedSpecs(mods: ModListEntry[]): (ModListEntry['specializations'][number])[] {
  return mods.flatMap((m) => m.specializations ?? []);
}

/** The list inside the Heroes dialog. */
function renderSpecList(mods: ModListEntry[]): void {
  const box = $('hs-list');
  box.innerHTML = '';
  const specs = installedSpecs(mods);
  if (!specs.length) {
    box.textContent = 'No specializations of our own. One is a single entry in an enum — '
      + 'and an effect only where the extension has been taught to add one.';
    return;
  }
  for (const s of specs) {
    const row = modRow({
      number: s.number,
      label: s.name || s.id,
      note: s.effect?.percentPerLevel
        ? `${s.effect.stat} +${s.effect.percentPerLevel}% per level`
        : 'words and a picture',
      onEdit: () => { void editSpec(s.id); },
      onRemove: () => { void removeSpec(s.id, s.name || s.id); },
    });
    row.title = s.description ? `${s.id} — ${s.description}` : s.id;
    box.append(row);
  }
}

/** Fill the stat picker. One entry so far; the list grows by reverse engineering. */
async function fillSpecForm(): Promise<void> {
  const stats = (await api.modFormData()).specializationStats ?? [];
  fillSelect($select('hs-stat'), stats.map((id) => ({ id, label: id })), $select('hs-stat').value);
}

/** Load one back into the form — all of it, or saving writes back what the boxes held. */
async function editSpec(id: string): Promise<void> {
  const { mods } = await api.listMods();
  const s = installedSpecs(mods).find((x) => x.id === id);
  if (!s) return;
  editingSpec = id;
  $('hs-err').textContent = '';
  $('specedit-title').textContent = `Edit ${s.name || s.id}`;
  openOnTop('specedit');
  await fillSpecForm();
  // The identifier is what a hero's document names, so an installed one cannot
  // be renamed — the same rule an artifact's id follows.
  $input('hs-id').value = s.id;
  $input('hs-id').disabled = true;
  $input('hs-name').value = s.name;
  $input('hs-desc').value = s.description ?? '';
  $input('hs-pic').value = s.picture ?? '';
  if (s.effect?.stat) $select('hs-stat').value = s.effect.stat;
  $input('hs-percent').value = String(s.effect?.percentPerLevel ?? 0);
  gateSpec().rewatch();
  void showExtensionState('hs-ext').catch(() => {});
}

/** Back to making a new one — every box cleared, or the next one inherits this. */
function newSpec(): void {
  editingSpec = '';
  $('hs-err').textContent = '';
  $('specedit-title').textContent = 'New specialization';
  $input('hs-id').disabled = false;
  for (const id of ['hs-id', 'hs-name', 'hs-desc', 'hs-pic']) $input(id).value = '';
  $input('hs-percent').value = '0';
  gateSpec().rewatch();
  openOnTop('specedit');
  void fillSpecForm().catch(() => {});
  void showExtensionState('hs-ext').catch(() => {});
}

/**
 * Take one away.
 *
 * Nothing outside the mod names it — no map stores a specialization and no save
 * we can read — but a HERO of ours may hold it, and the channel refuses that
 * rather than leaving him naming a value the enum no longer declares. So the
 * question here is only whether to go ahead.
 */
async function removeSpec(id: string, label: string): Promise<void> {
  if (!await ask(`Remove ${label}? Any hero holding it must be changed first.`, 'Remove')) return;
  try {
    await api.removeSpecialization({ id });
    await refreshSpecList();
    $('hm-note').textContent = `${label} removed.`;
  } catch (e) {
    $('hm-err').textContent = e instanceof Error ? e.message : String(e);
  }
}

/** Build it and install it, then back to the list that now holds it. */
async function submitSpec(): Promise<void> {
  const ok = $button('hs-ok');
  ok.disabled = true;
  $('hs-err').textContent = '';
  $('hm-note').textContent = '';
  try {
    const percent = Number($input('hs-percent').value) || 0;
    const send = editingSpec ? api.updateSpecialization : api.installSpecialization;
    const res = await send({
      id: $input('hs-id').value.trim(),
      name: $input('hs-name').value,
      description: $input('hs-desc').value,
      ...($input('hs-pic').value.trim() ? { picture: $input('hs-pic').value.trim() } : {}),
      // No percentage is no effect: a row that adds nothing is a row nobody can
      // tell from one that was never written, so it is not sent at all.
      ...(percent ? { effect: { stat: $select('hs-stat').value, percentPerLevel: percent } } : {}),
    });
    modDialog('specedit').close();
    await refreshSpecList();
    $('hm-note').textContent = `${editingSpec ? 'Updated' : 'Installed'} in `
      + `${res.archive.split(/[\\/]/).pop()} — value ${res.number}`;
  } catch (e) {
    $('hs-err').textContent = e instanceof Error ? e.message : String(e);
  } finally {
    ok.disabled = false;
  }
}

async function refreshSpecList(): Promise<void> {
  const { mods } = await api.listMods();
  renderSpecList(mods);
}

/** Bind the list and the form to their markup. */
export function initSpecializations(): void {
  // A tab of the Heroes window, registered from here — heroes.ts owns the button
  // that opens it and neither list is the other's business. The list is read
  // when this tab is opened rather than when the window is, so a window opened
  // on the heroes never reads the mods for a list nobody is looking at.
  registerHeroTab({
    id: 'specializations',
    label: 'Specializations',
    about: 'One entry in an enum — and an effect only where the extension has been taught to add one.',
    pane: 'hm-pane-specs',
    onShow: () => {
      void refreshSpecList().catch((e: unknown) => {
        $('hm-err').textContent = e instanceof Error ? e.message : String(e);
      });
    },
  });
  $('hs-new').onclick = newSpec;
  $('specedit-x').onclick = () => modDialog('specedit').close();
  $('specedit-cancel').onclick = () => modDialog('specedit').close();
  $('hs-ok').onclick = () => { void submitSpec(); };
  for (const btn of document.querySelectorAll<HTMLButtonElement>('button.hs-picture')) {
    btn.onclick = () => {
      void (async () => {
        const picked = await api.pickPicture();
        if (picked) $input(btn.dataset.for!).value = picked;
      })().catch((e) => { $('hs-err').textContent = e instanceof Error ? e.message : String(e); });
    };
  }
}
