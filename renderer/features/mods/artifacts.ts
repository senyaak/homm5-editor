// The artifact form: what a new artifact is, and what it gives whoever wears
// it.
//
// Two halves the person filling it in should not have to think about: six of
// the bonuses go into the artifact's own record, and everything else is a term
// the extension adds while the artifact is worn (see showExtensionState — the
// form says so when the extension is not installed, because those rows would
// otherwise be typed and quietly do nothing).



import { $, $input, $select, $button } from '#core/dom.ts';
import { modDialog, openOnTop } from '#core/dialog.ts';
import { api } from '#core/ipc.ts';
import { fillSetMembers } from '#features/mods/artifact-sets.ts';
import { effectStats, heroStats, idFrom, idTouched, listActions, openModDialog, refreshModLists } from '#features/mods/shared.ts';
import { requireFilled } from '#core/form-gate.ts';

/**
 * Which artifact the form is editing, or '' when it is making a new one.
 *
 * The dialog used to be a read-only list with a permanent "new" form under it,
 * which left no way to change or remove anything that was already installed.
 * Now the list is the thing you act on and the form follows it.
 */
let editingArtifact = '';

/** Bind the artifact form to its markup. Called once, from app. */
export function initArtifactsMod(): void {
  listActions.editArtifact = (id) => { void editArtifact(id); };
  $input('am-id').addEventListener('input', () => { idTouched.artifact = true; });
  $input('am-file').addEventListener('input', () => {
    if (!idTouched.artifact) $input('am-id').value = idFrom('ARTIFACT_', $input('am-file').value);
  });
  $('am-effect-add').onclick = () => addEffectRow();
  $('am-new').onclick = () => { idTouched.artifact = false; newArtifact(); };
  $('artedit-x').onclick = () => modDialog('artedit').close();
  $('artedit-cancel').onclick = () => modDialog('artedit').close();
  // The window holds both this form and the set form, so opening it clears both
  // id flags — a set's id follows its file name again on the next visit.
  $('artsbtn').onclick = () => {
    idTouched.artifact = false;
    idTouched.set = false;
    // Ours, not the donor's: a shipped artifact has no effects of this kind, so
    // carrying them over from a preset would invent them.
    $('am-effects').innerHTML = '';
    openModDialog('artsmod', loadArtifactPreset);
    void showExtensionState().catch(() => {});
  };
  $select('am-donor').addEventListener('change', () => { void loadArtifactPreset().catch(() => {}); });
  $('am-close').onclick = () => modDialog('artsmod').close();
  $('am-cancel').onclick = () => modDialog('artsmod').close();
  $('am-ok').onclick = () => { void submitArtifactMod(); };
}

/** Load the donor into every artifact field. */
async function loadArtifactPreset(): Promise<void> {
  const donor = $select('am-donor').value;
  if (!donor) return;
  const p = await api.modArtifactPreset(donor);
  $input('am-name').value = p.name;
  $input('am-desc').value = p.description;
  $select('am-slot').value = p.slot;
  $select('am-rank').value = p.rank;
  $input('am-cost').value = String(p.cost);
  $input('am-ai').value = String(p.aiValue);
  $input('am-sell').checked = p.canBeGeneratedToSell;
  // The preset's stats arrive as rows like everything else it gives; a donor
  // with none leaves the list empty rather than six zeroes to scroll past.
  $('am-effects').innerHTML = '';
  for (const stat of heroStats) {
    const v = Number(p.stats[stat as keyof typeof p.stats] ?? 0);
    if (v) addEffectRow(stat, String(v));
  }
  $input('am-icon').value = p.icon;
  $input('am-model').value = p.model;
}
const isHeroStat = (stat: string): boolean => heroStats.includes(stat);

function addEffectRow(stat = '', amount = ''): void {
  const row = document.createElement('label');
  const select = document.createElement('select');
  // The record's six first, then what only the extension can add. Order is the
  // familiar one — the hero screen reads Attack, Defence, Knowledge, Spell
  // power, Morale, Luck — and the rest follow as they are found.
  for (const s of [...heroStats, ...effectStats]) {
    const option = document.createElement('option');
    option.value = option.textContent = s;
    select.appendChild(option);
  }
  if (stat) select.value = stat;
  select.className = 'am-effect-stat';
  const value = document.createElement('input');
  value.type = 'number';
  value.value = amount || '0';
  value.className = 'am-effect-amount';
  value.title = 'how much; negative is a cursed item';
  const drop = document.createElement('button');
  drop.className = 'um-recolor';
  drop.textContent = '×';
  drop.title = 'remove this effect';
  drop.onclick = () => row.remove();
  row.append(select, value, drop);
  $('am-effects').appendChild(row);
}

/**
 * What the rows say, split the way the payload wants it: the record's six on
 * one side, the extension's bonuses on the other.
 *
 * Two rows naming the same thing add up rather than the last one winning —
 * "+2 Attack" twice is +4 by any reading, and silently dropping one would be
 * the kind of quiet the rest of this dialog exists to avoid.
 */
function artifactGives(): { stats: Record<string, number>; effects: Record<string, number> } {
  const stats: Record<string, number> = {};
  const effects: Record<string, number> = {};
  for (const row of $('am-effects').querySelectorAll('label')) {
    const stat = row.querySelector<HTMLSelectElement>('.am-effect-stat')?.value;
    const amount = Number(row.querySelector<HTMLInputElement>('.am-effect-amount')?.value) || 0;
    if (!stat || !amount) continue;
    const into = isHeroStat(stat) ? stats : effects;
    into[stat] = (into[stat] ?? 0) + amount;
  }
  return { stats, effects };
}

/**
 * Put an installed artifact into the form, and switch the form to editing it.
 *
 * The id and the file stem are locked while editing: the id is what a map, a
 * script and the manifest all name the same thing by, and the file stem names
 * every document already written for it.
 */
/**
 * What an artifact cannot be built without.
 *
 * The icon is the one that is easy to miss: it is what the hero screen and the
 * ground both show, the channel refuses an empty one, and it normally arrives
 * with the preset — so the star is really about the form that was filled in by
 * hand. The stem names its files, the id is what maps and saves store.
 */
let artGate: { check: () => void; rewatch: () => void } | null = null;
const gateArtifact = (): { check: () => void; rewatch: () => void } => (artGate ??= requireFilled({
  ok: 'am-ok',
  missing: 'am-missing',
  fields: { files: 'am-file', id: 'am-id', name: 'am-name', icon: 'am-icon' },
}));

async function editArtifact(id: string): Promise<void> {
  const { mods } = await api.listMods();
  const a = mods.flatMap((m) => m.artifacts).find((x) => x.id === id);
  if (!a) return;
  editingArtifact = id;
  $input('am-id').value = a.id;
  $input('am-file').value = a.id.replace(/^ARTIFACT_/, '');
  $input('am-name').value = a.name;
  $select('am-slot').value = a.slot;
  $input('am-id').disabled = true;
  $input('am-file').disabled = true;
  $('am-editing').textContent = `${a.name || a.id} — id and files are fixed; everything else can move`;
  $button('am-ok').textContent = 'Save & install';
  $('am-note').textContent = '';
  // EVERYTHING it already is, not just its name. The form writes back what it
  // holds, so a field left blank here is a field erased on save: opening an
  // artifact to change its price used to cost it its description, its stats and
  // its bonus at once.
  $input('am-desc').value = a.description ?? '';
  if (a.rank) $select('am-rank').value = a.rank;
  $input('am-cost').value = String(a.cost ?? 0);
  $input('am-ai').value = String(a.aiValue ?? 0);
  $input('am-sell').checked = !!a.canBeGeneratedToSell;
  $input('am-icon').value = a.icon ?? '';
  $input('am-model').value = a.model ?? '';
  $input('am-board').value = String(a.board?.tiles ?? 1);
  // What it gives, as rows: the record's six and the extension's bonuses in the
  // one list they are authored in.
  $('am-effects').innerHTML = '';
  for (const [stat, amount] of Object.entries(a.stats ?? {})) addEffectRow(stat, String(amount));
  for (const [stat, amount] of Object.entries(a.effects ?? {})) addEffectRow(stat, String(amount));
  gateArtifact().rewatch();
  openOnTop('artedit');
  $('artedit-title').textContent = 'Editing artifact';
  void showExtensionState().catch(() => {});
}

/** Back to making a new one. */
function newArtifact(): void {
  editingArtifact = '';
  // A new artifact has no effects. The rows are cleared when the dialog opens,
  // but the form is reached again without closing it — author one piece, press
  // New, author the next — and the row left standing gave the second artifact
  // the first one's bonus.
  $('am-effects').innerHTML = '';
  // And no id, no stem, no words and no icon — the boxes hold the last
  // artifact's otherwise, and saving under an id the mod already has is
  // refused only after a full rebuild.
  for (const id of ['am-file', 'am-id', 'am-name', 'am-desc', 'am-icon', 'am-model']) $input(id).value = '';
  idTouched.artifact = false;
  $input('am-id').disabled = false;
  $input('am-file').disabled = false;
  $('am-editing').textContent = '';
  $button('am-ok').textContent = 'Build & install';
  gateArtifact().rewatch();
  openOnTop('artedit');
  $('artedit-title').textContent = 'New artifact';
  void showExtensionState().catch(() => {});
}

/**
 * Say whether the native extension is in place, and offer to put it there.
 *
 * An effect typed into the form above is written to a file whichever way this
 * goes — but without the extension nothing reads that file, and the artifact is
 * its six stats. Saying so here is the difference between "it does not work"
 * and "it is not installed", which look identical in game.
 */
export async function showExtensionState(where: 'am-ext' | 'as-ext' | 'hs-ext' = 'am-ext'): Promise<void> {
  const box = $(where);
  box.textContent = '';
  const st = await api.extensionStatus();
  if (st.installed) {
    box.style.color = '#3fb950';
    box.textContent = `extension installed (${st.size} bytes) — effects are in force in H5_Game_H5E.exe`;
    return;
  }
  box.style.color = '';
  if (st.unbuilt) {
    box.textContent = 'the extension has not been built — run npm run build-native';
    return;
  }
  box.append('effects need the extension, which is not installed yet. ');
  const button = document.createElement('button');
  button.className = 'um-recolor';
  button.textContent = 'Install extension';
  button.title = 'copies the extension beside the game and names it in OUR copy of the executable';
  button.onclick = () => {
    button.disabled = true;
    void api.installExtension()
      .then(() => showExtensionState(where))
      .catch((e: unknown) => {
        $(where === 'as-ext' ? 'as-err' : 'am-err').textContent = e instanceof Error ? e.message : String(e);
        button.disabled = false;
      });
  };
  box.appendChild(button);
}

async function submitArtifactMod(): Promise<void> {
  const ok = $button('am-ok');
  ok.disabled = true;
  $('ae-err').textContent = '';
  $('am-note').textContent = '';
  try {
    const gives = artifactGives();
    const send = editingArtifact ? api.updateArtifact : api.installArtifact;
    const res = await send({
      id: $input('am-id').value,
      file: $input('am-file').value,
      name: $input('am-name').value,
      description: $input('am-desc').value,
      slot: $select('am-slot').value,
      rank: $select('am-rank').value,
      cost: Number($input('am-cost').value) || 0,
      aiValue: Number($input('am-ai').value) || 0,
      canBeGeneratedToSell: $input('am-sell').checked,
      stats: gives.stats,
      effects: gives.effects,
      icon: $input('am-icon').value,
      model: $input('am-model').value,
      boardTiles: Number($input('am-board').value) || 1,
    });
    // The form is done with: it closes, and the note lands on the list behind
    // it where the result belongs.
    modDialog('artedit').close();
    editingArtifact = '';
    $('am-note').textContent = `installed ${res.archive}\nartifact ${res.exe}`;
    await refreshModLists();
    // The artifact just added is a member a set can be built from, and the
    // natural next step is to build one.
    await fillSetMembers();
  } catch (e) {
    // The form's own line, not the list's behind it — see openOnTop.
    $('ae-err').textContent = e instanceof Error ? e.message : String(e);
  } finally {
    ok.disabled = false;
  }
}



