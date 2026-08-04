// The Units & Artifacts window: creatures, artifacts and artifact sets.
//
// The game-global mod — what UserMODs adds, and the window's way of adding a
// creature or an artifact without the CLI. Main does the building and
// installing (mods:* channels); these are only the forms over it. No map has to
// be open — a mod is UserMODs plus the executable's ceilings, nothing of the
// map. The mod is always OURS (the one manifest-carrying archive); the forms
// never ask where a thing goes.
//
// The donor select IS the preset: picking one loads every field — stats, texts,
// abilities, art — and the person edits the difference. The art hrefs are the
// copy handles: point one at another file (a recolour, another model) and only
// that piece changes.

import { $, $input, $select, $button } from '#core/dom.ts';
import { modDialog, openOnTop } from '#core/dialog.ts';
import { api } from '#core/ipc.ts';
import { pickPreset } from '#features/mods/preset.ts';
import { idFrom, listActions, openModDialog, refreshModLists, umAbilities } from '#features/mods/shared.ts';
import { requireFilled } from '#core/form-gate.ts';
import type { CreatureStats } from '#electron/ipc.ts';
import { DRAGON_TAG } from '#src/mods/creatures.ts';


/** Form input id → the CreatureStats field it fills. */
const UM_STATS: ReadonlyArray<[string, keyof CreatureStats]> = [
  ['um-attack', 'attack'], ['um-defence', 'defence'],
  ['um-mindmg', 'minDamage'], ['um-maxdmg', 'maxDamage'],
  ['um-health', 'health'], ['um-speed', 'speed'], ['um-init', 'initiative'],
  ['um-shots', 'shots'], ['um-range', 'range'], ['um-growth', 'weeklyGrowth'],
  ['um-gold', 'gold'], ['um-tier', 'tier'], ['um-exp', 'exp'],
  ['um-power', 'power'], ['um-size', 'combatSize'], ['um-command', 'timeToCommand'],
];


const UM_ART: ReadonlyArray<[string, 'character' | 'model' | 'animSet' | 'icon']> = [
  ['um-art-character', 'character'], ['um-art-model', 'model'],
  ['um-art-animset', 'animSet'], ['um-art-icon', 'icon'],
];
let editingCreature = '';

/**
 * What a creature cannot be built without.
 *
 * The preset is the surprise one: a creature is a COPY of a shipped creature's
 * two documents, and with none picked the build got as far as the channel and
 * came back "cannot resolve the donor (none)" — a sentence about a field the
 * form never said was needed. The identifier names its files and makes the
 * CREATURE_ id maps store; the name is what the hire dialog and the army show.
 */
let unitGate: { check: () => void; rewatch: () => void } | null = null;
const gateUnits = (): { check: () => void; rewatch: () => void } => (unitGate ??= requireFilled({
  ok: 'um-ok',
  missing: 'um-missing',
  fields: { identifier: 'um-file', name: 'um-name' },
  // Only a NEW creature needs one: one already in the mod keeps the documents
  // it was built from, and creatures made before the preset was recorded have
  // none to show — refusing to save those would be a refusal invented here.
  extra: () => (!editingCreature && !$input('um-donor').value.trim() ? ['preset'] : []),
}));

/** Load the donor into every creature field — the form's "preset". */
async function loadUnitPreset(): Promise<void> {
  const donor = $input('um-donor').value;
  if (!donor) return;
  const p = await api.modPreset(donor);
  $input('um-name').value = p.name;
  $input('um-desc').value = p.description;
  for (const [input, key] of UM_STATS) $input(input).value = String(p.stats[key] ?? 0);
  $input('um-fly').checked = p.stats.flying;
  $select('um-town').value = p.stats.town;
  // The preset's abilities, one row each — and the printed line follows them,
  // so it says what this creature can do rather than what the donor could.
  $('um-abilities').innerHTML = '';
  for (const id of p.stats.abilities) addAbilityRow(id);
  showAbilityLine();
  for (const [input, slot] of UM_ART) $input(input).value = p.art[slot] ?? '';
}

async function submitUnitsMod(): Promise<void> {
  const ok = $button('um-ok');
  ok.disabled = true;
  $('ue-err').textContent = '';
  $('um-note').textContent = '';
  try {
    const stats: Partial<CreatureStats> = {
      flying: $input('um-fly').checked,
      town: $select('um-town').value,
      abilities: chosenAbilities(),
    };
    for (const [input, key] of UM_STATS) {
      (stats as Record<string, number | boolean | string>)[key] = Number($input(input).value) || 0;
    }
    const art: Partial<Record<'character' | 'model' | 'animSet' | 'icon', string>> = {};
    for (const [input, slot] of UM_ART) art[slot] = $input(input).value.trim();
    const send = editingCreature ? api.updateMod : api.installMod;
    const res = await send({
      id: $input('um-id').value,
      file: $input('um-file').value,
      name: $input('um-name').value,
      description: $input('um-desc').value,
      donor: $input('um-donor').value,
      stats,
      art,
    });
    // Back to the list, which now holds the creature — and the note saying so.
    // The same shape as an artifact build, which had it right first: the form
    // is done with, and what happened belongs where the user is left standing.
    $('um-note').textContent = `installed ${res.archive}\n${res.exe} · ${res.art} art file(s) copied`;
    await refreshModLists();
    modDialog('unitedit').close();
  } catch (e) {
    // The form's own line, not the list's behind it — see openOnTop.
    $('ue-err').textContent = e instanceof Error ? e.message : String(e);
  } finally {
    ok.disabled = false;
  }
}

/**
 * One ability the creature has.
 *
 * A row rather than an entry in a multi-select, for the reason the artifact
 * bonuses are rows: a creature has two or three, and picking them out of a list
 * of 198 by ctrl-clicking is a way to lose one without noticing.
 */
function addAbilityRow(id = ''): void {
  const row = document.createElement('label');
  const select = document.createElement('select');
  select.className = 'um-ability-id';
  for (const a of umAbilities) {
    const option = document.createElement('option');
    option.value = a.id;
    // The name a player reads, with the id behind it: two creatures can print
    // the same word and the id is what actually goes in the file.
    option.textContent = a.name && a.name !== a.id ? `${a.name} — ${a.id}` : a.id;
    select.appendChild(option);
  }
  if (id) select.value = id;
  select.onchange = showAbilityLine;
  const drop = document.createElement('button');
  drop.className = 'um-recolor';
  drop.textContent = '×';
  drop.title = 'the creature does not have this one';
  drop.onclick = () => { row.remove(); showAbilityLine(); };
  row.append(select, drop);
  $('um-abilities').appendChild(row);
  showAbilityLine();
}

/** What the hire dialog will print, shown as it is being decided. */
function showAbilityLine(): void {
  const names = new Map(umAbilities.map((a) => [a.id, a.name || a.id]));
  // The dragon tag is left out, because the build leaves it out: it decides
  // what a rune may be cast on, and this line is what a player reads.
  const line = chosenAbilities().filter((id) => id !== DRAGON_TAG)
    .map((id) => names.get(id) ?? id).join(', ');
  $('um-abil-preview').textContent = line ? `Hire dialog will print: ${line}` : '';
}

/** The abilities the form currently holds, in the order they were added. */
function chosenAbilities(): string[] {
  // Deduplicated: two rows naming one ability is a slip, and the creature
  // record would carry it twice — which the hire dialog then prints twice.
  return [...new Set([...document.querySelectorAll<HTMLSelectElement>('#um-abilities .um-ability-id')]
    .map((el) => el.value).filter(Boolean))];
}

async function editCreature(id: string): Promise<void> {
  const { mods } = await api.listMods();
  const c = mods.flatMap((m) => m.creatures).find((x) => x.id === id);
  if (!c) return;
  editingCreature = id;
  $input('um-id').value = c.id;
  $input('um-file').value = c.file;
  $input('um-name').value = c.name;
  $input('um-desc').value = c.description;
  // Everything else it was built with. Left out, the form would show the last
  // creature's numbers — or a blank one's — and saving would write those.
  for (const [input, key] of UM_STATS) $input(input).value = String(c.stats[key] ?? 0);
  $input('um-fly').checked = !!c.stats.flying;
  $select('um-town').value = c.stats.town;
  $('um-abilities').innerHTML = '';
  for (const a of c.stats.abilities ?? []) addAbilityRow(a);
  showAbilityLine();
  // The art it actually wears, which is where its files resolved to — not the
  // donor's, since a recolour or a swap since then lives in the mod.
  for (const [input, slot] of UM_ART) $input(input).value = (c.from ?? {})[slot] ?? '';
  // The preset it was made from, so Save has what the build needs and the form
  // says what this creature is a copy of. Creatures built before that was
  // recorded show none, and the update keeps the sources they already have.
  $input('um-donor').value = c.donor ?? '';
  $('um-donor-name').textContent = c.donor ?? 'not recorded — its own art is kept';
  $input('um-id').disabled = true;
  $input('um-file').disabled = true;
  $('um-editing').textContent = `${c.name || c.id} — id and files are fixed; everything else can move`;
  $button('um-ok').textContent = 'Save & install';
  $('um-note').textContent = '';
  gateUnits().rewatch();
  openOnTop('unitedit');
  $('unitedit-title').textContent = 'Editing creature';
}

function newCreature(): void {
  editingCreature = '';
  // Blank means blank: every box keeps what the last creature put in it
  // otherwise. The donor is the dangerous one — hidden, so nothing shows that
  // the next creature is quietly a copy of whatever the last one copied — and
  // the identifier is the visible one, since saving under a name the mod
  // already has is refused after a full rebuild.
  $input('um-donor').value = '';
  $('um-donor-name').textContent = 'nothing yet — the form is blank';
  for (const id of ['um-file', 'um-id', 'um-name', 'um-desc']) $input(id).value = '';
  for (const [input] of UM_ART) $input(input).value = '';
  // A new creature has no abilities. Cleared here and not only on open, because
  // the form is reached again without closing it — author one, press New,
  // author the next — and a row left standing gives the second one the first
  // one's ability. The artifact rows learned this the same way.
  $('um-abilities').innerHTML = '';
  showAbilityLine();
  $input('um-id').disabled = false;
  $input('um-file').disabled = false;
  $('um-editing').textContent = '';
  $button('um-ok').textContent = 'Build & install';
  gateUnits().rewatch();
  openOnTop('unitedit');
  $('unitedit-title').textContent = 'New creature';
}

/** Bind the creature form to its markup. Called once, from app. */
export function initUnitsMod(): void {
  // The list draws itself; what editing a creature MEANS is here.
  listActions.editCreature = (id) => { void editCreature(id); };
  // A creature's id is MADE from its identifier and shown, never typed: they
  // were two boxes holding the same string, and the second one existed only to
  // be got wrong. Shown rather than hidden because it is what maps, saves and
  // scripts store, and an author deserves to see what they are committing to.
  $input('um-file').addEventListener('input', () => {
    $input('um-id').value = idFrom('CREATURE_', $input('um-file').value);
  });
  $('um-ability-add').onclick = () => addAbilityRow();
  // A file of your own for one art slot — copied into the creature's folder when
  // it is built, exactly as the hero form does it.
  for (const btn of document.querySelectorAll<HTMLButtonElement>('button.um-pick')) {
    btn.onclick = () => {
      const target = btn.dataset.for!;
      void (async () => {
        const picked = await api.pickHeroFile({ id: $input('um-file').value.trim(), slot: target });
        if (picked.href) $input(target).value = picked.href;
      })().catch((e) => { $('ue-err').textContent = e instanceof Error ? e.message : String(e); });
    };
  }
  $('um-donor-pick').onclick = () => {
    void (async () => {
      const creatures = (await api.modFormData()).donors;
      pickPreset('Start this creature from', creatures.map((c) => ({
        id: c.id, label: c.name || c.id,
      })), (id, label) => {
        $input('um-donor').value = id;
        $('um-donor-name').textContent = label;
        void loadUnitPreset().then(() => gateUnits().check()).catch(() => {});
        gateUnits().check();
      });
    })().catch((e) => { $('ue-err').textContent = e instanceof Error ? e.message : String(e); });
  };

  $('unitsbtn').onclick = () => { openModDialog('unitsmod', loadUnitPreset); };
  $('um-new').onclick = () => { newCreature(); };
  $('unitedit-x').onclick = () => modDialog('unitedit').close();
  $('unitedit-cancel').onclick = () => modDialog('unitedit').close();
  $('um-close').onclick = () => modDialog('unitsmod').close();
  $('um-cancel').onclick = () => modDialog('unitsmod').close();
  $('um-ok').onclick = () => { void submitUnitsMod(); };
}
