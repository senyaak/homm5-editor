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

import { $, $input, $select, $button, fillSelect } from '#core/dom.ts';
import { ask, modDialog, openOnTop } from '#core/dialog.ts';
import { api } from '#core/ipc.ts';
import { mountCodeEditor } from '#features/text-editor/code-editor.ts';
import type { CodeEditor } from '#features/text-editor/code-editor.ts';
import { openRecolor } from '#features/mods/recolor.ts';
import { pickPreset } from '#features/mods/preset.ts';
import { loadScriptContext, scriptContextNote, scriptContextReady } from '#features/text-editor/context.ts';
import { modRow, NL } from '#features/mods/shared.ts';
import type { CreatureStats, ModListEntry, ModsFormDataResult, RosterEntryDTO } from '#electron/ipc.ts';


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

/** An id stem typed as a file name, spelled the way the enums spell it. */
const idFrom = (prefix: string, file: string): string =>
  `${prefix}${file.trim().replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`;

/** The rosters and enums both forms are built from, fetched once. */
let modForms: Promise<ModsFormDataResult> | null = null;
const modFormData = (): Promise<ModsFormDataResult> =>
  (modForms ??= api.modFormData());

function fillModSelect(sel: HTMLSelectElement, entries: { id: string; name?: string }[], skipUnset = false): void {
  sel.innerHTML = '';
  for (const e of entries) {
    if (skipUnset && /_(NONE|UNKNOWN)$/.test(e.id)) continue;
    const o = document.createElement('option');
    o.value = e.id;
    o.textContent = e.name ? `${e.name} (${e.id})` : e.id;
    sel.appendChild(o);
  }
}

async function fillModForms(): Promise<void> {
  const data = await modFormData();
  {
    umAbilities = data.abilityNames;
    fillModSelect($select('um-town'), data.towns);
  }
  effectStats = data.effectStats;
  heroStats = data.heroStats;
  if (!$select('am-donor').options.length) {
    fillModSelect($select('am-donor'), data.artifactDonors, true);
  }
}

/**
 * Which artifact the form is editing, or '' when it is making a new one.
 *
 * The dialog used to be a read-only list with a permanent "new" form under it,
 * which left no way to change or remove anything that was already installed.
 * Now the list is the thing you act on and the form follows it.
 */
let editingArtifact = '';
let editingCreature = '';

/**
 * Ask what would break, show it, and only then remove.
 *
 * A map names an artifact or a creature by name, so this is an exact list
 * rather than a warning in general terms — and it is shown BEFORE anything
 * happens, which is the whole point.
 */
async function removeWithWarning(
  kind: 'artifact' | 'creature', id: string, label: string, errBox: string,
): Promise<void> {
  const { uses } = kind === 'artifact'
    ? await api.artifactUses({ id })
    : await api.creatureUses({ id });
  const shown = uses.slice(0, 12).join(NL);
  const more = uses.length > 12 ? `${NL}… and ${uses.length - 12} more` : '';
  const warning = uses.length
    ? `${label} is named by ${uses.length} map(s):${NL}${NL}${shown}${more}${NL}${NL}`
      + 'They will stop resolving it. Remove anyway?'
    : `Remove ${label}? No map names it.`;
  if (!await ask(warning, 'Remove')) return;
  try {
    if (kind === 'artifact') await api.removeArtifact({ id });
    else await api.removeCreature({ id });
    await refreshModLists();
  } catch (e) {
    $(errBox).textContent = e instanceof Error ? e.message : String(e);
  }
}

async function refreshModLists(): Promise<void> {
  const { gameRoot, mods } = await api.listMods();
  const empty = (msg: string): string => `<div class="um-empty">${msg}</div>`;
  const units = $('um-list');
  const arts = $('am-list');
  const sets = $('as-list');
  sets.innerHTML = '';
  units.innerHTML = '';
  arts.innerHTML = '';
  if (!gameRoot) {
    units.innerHTML = arts.innerHTML = sets.innerHTML = empty('no game install configured — nowhere to install to');
    return;
  }
  if (!mods.length) units.innerHTML = empty('none — the game holds its shipped creatures only');
  if (!mods.some((m) => m.artifacts.length)) arts.innerHTML = empty('none — the game holds its shipped artifacts only');
  if (!mods.some((m) => m.sets?.length)) sets.innerHTML = empty('no sets of ours');
  for (const m of mods) {
    const head = document.createElement('div');
    head.append(`${m.stem}.h5u — ${m.creatures.length} creature(s), ceiling ${m.limit}`
      + (m.reconstructed ? ' (no manifest)' : ''));
    units.appendChild(head);
    for (const c of m.creatures) {
      const row = modRow({
        number: c.number, label: c.name || c.id, note: c.id,
        onEdit: () => { void editCreature(c.id); },
        onRemove: () => { void removeWithWarning('creature', c.id, c.name || c.id, 'um-err'); },
      });
      // Each creature of OUR mod can be repainted: its textures are the mod's
      // own copies, so a recolour touches nothing shipped.
      if (!m.reconstructed) {
        const paint = document.createElement('button');
        // Three buttons on a row share the look; only this one is the brush, and
        // a class of its own is how anything else can say which it means — the
        // emoji is not a handle.
        paint.className = 'um-recolor um-paint';
        paint.textContent = '🎨';
        paint.title = `repaint ${c.id}'s textures`;
        paint.onclick = () => {
          void openRecolor(c.id, c.name || c.id).catch((e: unknown) => {
            $('um-err').textContent = e instanceof Error ? e.message : String(e);
          });
        };
        row.insertBefore(paint, row.lastChild);
      }
      units.appendChild(row);
    }
    for (const a of m.artifacts) {
      arts.appendChild(modRow({
        number: a.number, label: `${a.name || a.id} (${a.slot})`, note: a.id,
        onEdit: () => { void editArtifact(a.id); },
        onRemove: () => { void removeWithWarning('artifact', a.id, a.name || a.id, 'am-err'); },
      }));
    }
    // Sets get a list of their own beside the artifacts they are made of.
    // Without one an installed set is invisible here, and "nothing happened"
    // reads exactly like "it worked".
    for (const s of m.sets) {
      sets.appendChild(modRow({
        number: s.number, label: s.name || s.effect,
        note: `${s.artifacts.length} piece(s): ${s.artifacts.map(shortArtifactId).join(', ')}`,
        onEdit: () => { void editArtifactSet(s.effect); },
        onRemove: () => { void removeSet(s.effect, s.name || s.effect); },
      }));
    }
  }
  // More than one creature mod is a conflict, not a set — each carries a whole
  // copy of the registry, so the game reads one and the rest do not exist.
  $('um-conflict').textContent = mods.length > 1
    ? 'more than one creature mod: they conflict — the game reads one and ignores the others'
    : '';
}

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

function openModDialog(id: 'unitsmod' | 'artsmod'): void {
  const p = id === 'unitsmod' ? 'um' : 'am';
  $(`${p}-err`).textContent = '';
  $(`${p}-note`).textContent = '';
  modDialog(id).showModal();
  const report = (e: unknown): void => {
    $(`${p}-err`).textContent = e instanceof Error ? e.message : String(e);
  };
  void refreshModLists().catch(report);
  void fillModForms().then(() => (id === 'unitsmod' ? loadUnitPreset() : loadArtifactPreset())).catch(report);
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
 * The effects rows in the artifact form: what the extension should add while
 * this artifact is worn.
 *
 * A list you add to rather than a field per stat. The stats come from the main
 * process because they are a property of the EXTENSION — each one is a place in
 * the executable where we found where to append our term — and the form should
 * not have to be edited every time another is found.
 */
let effectStats: string[] = [];
/**
 * The six the artifact RECORD can hold, offered in the same list.
 *
 * The split matters to the code and to nobody else: a row naming one of these
 * is written into the artifact's own document, and a row naming anything else
 * goes to the file the extension reads. To whoever is filling the form they are
 * one list of "what it gives".
 */
let heroStats: string[] = [];
const isHeroStat = (stat: string): boolean => heroStats.includes(stat);

/** Every ability the engine knows, by id, with the name a player sees. */
let umAbilities: RosterEntryDTO[] = [];

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
  const line = chosenAbilities().map((id) => names.get(id) ?? id).join(', ');
  $('um-abil-preview').textContent = line ? `Hire dialog will print: ${line}` : '';
}

/** The abilities the form currently holds, in the order they were added. */
function chosenAbilities(): string[] {
  // Deduplicated: two rows naming one ability is a slip, and the creature
  // record would carry it twice — which the hire dialog then prints twice.
  return [...new Set([...document.querySelectorAll<HTMLSelectElement>('#um-abilities .um-ability-id')]
    .map((el) => el.value).filter(Boolean))];
}

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
  $input('am-id').disabled = false;
  $input('am-file').disabled = false;
  $('am-editing').textContent = '';
  $button('am-ok').textContent = 'Build & install';
  openOnTop('artedit');
  $('artedit-title').textContent = 'New artifact';
  void showExtensionState().catch(() => {});
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
  $input('um-id').disabled = true;
  $input('um-file').disabled = true;
  $('um-editing').textContent = `${c.name || c.id} — id and files are fixed; everything else can move`;
  $button('um-ok').textContent = 'Save & install';
  $('um-note').textContent = '';
  openOnTop('unitedit');
  $('unitedit-title').textContent = 'Editing creature';
}

function newCreature(): void {
  editingCreature = '';
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
  openOnTop('unitedit');
  $('unitedit-title').textContent = 'New creature';
}

/**
 * Say whether the native extension is in place, and offer to put it there.
 *
 * An effect typed into the form above is written to a file whichever way this
 * goes — but without the extension nothing reads that file, and the artifact is
 * its six stats. Saying so here is the difference between "it does not work"
 * and "it is not installed", which look identical in game.
 */
async function showExtensionState(where: 'am-ext' | 'as-ext' = 'am-ext'): Promise<void> {
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

// --- artifact sets ----------------------------------------------------------
//
// A set is two data edits — an effect value of ours appended to the enum, and a
// row naming its members — and from those the game names the set, counts the
// pieces a hero wears and draws the tooltip. It does NOT make the set do
// anything: every shipped set's behaviour is compiled against its own value and
// ours is one the executable never heard of. See docs/ARTIFACT_EFFECTS.md.

/** `ARTIFACT_H3_VAMPIRES_CLOAK` → `H3_VAMPIRES_CLOAK`, for a list that fits. */
const shortArtifactId = (id: string): string => id.replace(/^ARTIFACT_/, '');

/** The game's artifacts, which do not change while the window is open. */
let setShipped: { id: string; name: string }[] | null = null;

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
async function fillSetMembers(): Promise<void> {
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
  value.title = 'how much — percentage points, or energy';
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
    worn.style.display = value.style.display = lua ? 'none' : '';
    edit.style.display = lua ? '' : 'none';
  };
  select.onchange = show;
  row.append(select, worn, value, edit, drop);
  $('as-effects').appendChild(row);
  show();
}

/** The row kind that is a script rather than a number. */
const LUA_ROW = 'lua';

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
  openOnTop('setedit');
  $('setedit-title').textContent = 'Editing set';
  void showExtensionState('as-ext').catch(() => {});
}

/** Back to making a new one. */
function newSet(): void {
  editingSet = '';
  $input('as-effect').disabled = false;
  $input('as-file').disabled = false;
  $button('as-ok').textContent = 'Build & install';
  for (const box of $('as-members').querySelectorAll<HTMLInputElement>('input')) box.checked = false;
  // A new set has no bonus and no script. The form is reached again without
  // closing it, and what was left standing would land on the next set.
  $('as-effects').innerHTML = '';
  setScript = '';
  renderSetCounts();
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



let amIdTouched = false;
let asIdTouched = false;
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

/** Bind the creature, artifact and set forms to their markup. */
export function initUnitsMod(): void {
  // A creature's id is MADE from its identifier and shown, never typed: they
  // were two boxes holding the same string, and the second one existed only to
  // be got wrong. Shown rather than hidden because it is what maps, saves and
  // scripts store, and an author deserves to see what they are committing to.
  $input('am-id').addEventListener('input', () => { amIdTouched = true; });
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
  $input('am-file').addEventListener('input', () => {
    if (!amIdTouched) $input('am-id').value = idFrom('ARTIFACT_', $input('am-file').value);
  });
  $input('as-effect').addEventListener('input', () => { asIdTouched = true; });
  $input('as-file').addEventListener('input', () => {
    if (!asIdTouched) $input('as-effect').value = idFrom('ARTFSET_EFFECT_', $input('as-file').value);
  });
  $('as-members').addEventListener('change', renderSetCounts);

  $('um-donor-pick').onclick = () => {
    void (async () => {
      const creatures = (await api.modFormData()).donors;
      pickPreset('Start this creature from', creatures.map((c) => ({
        id: c.id, label: c.name || c.id,
      })), (id, label) => {
        $input('um-donor').value = id;
        $('um-donor-name').textContent = label;
        void loadUnitPreset().catch(() => {});
      });
    })().catch((e) => { $('ue-err').textContent = e instanceof Error ? e.message : String(e); });
  };




  // Esc closes a <dialog> on its own, and this one must behave like Cancel when it
  // does: the alternative is a script kept because a key was pressed.
  modDialog('setscript').addEventListener('cancel', () => { closeSetScript(false); });

  $('ss-ok').onclick = () => closeSetScript(true);
  $('ss-cancel').onclick = () => closeSetScript(false);
  $('ss-x').onclick = () => closeSetScript(false);
  $('as-effect-add').onclick = () => addSetEffectRow();
  $('as-ok').onclick = () => { void submitArtifactSet(); };

  $('unitsbtn').onclick = () => { openModDialog('unitsmod'); };
  $('am-effect-add').onclick = () => addEffectRow();
  $('am-new').onclick = () => { amIdTouched = false; newArtifact(); };
  $('um-new').onclick = () => { newCreature(); };
  $('as-new').onclick = () => {
    asIdTouched = false;
    void fillSetMembers().then(newSet).catch((e: unknown) => {
      $('as-err').textContent = e instanceof Error ? e.message : String(e);
    });
  };
  for (const [dlg, back] of [['artedit', 'am'], ['unitedit', 'um'], ['setedit', 'as']] as const) {
    $(`${dlg}-x`).onclick = () => modDialog(dlg).close();
    $(`${dlg}-cancel`).onclick = () => modDialog(dlg).close();
    void back;
  }
  $('artsbtn').onclick = () => {
    amIdTouched = false;
    asIdTouched = false;
    // Ours, not the donor's: a shipped artifact has no effects of this kind, so
    // carrying them over from a preset would invent them.
    $('am-effects').innerHTML = '';
    openModDialog('artsmod');
    void showExtensionState().catch(() => {});
  };

  $select('am-donor').addEventListener('change', () => { void loadArtifactPreset().catch(() => {}); });
  $('um-close').onclick = () => modDialog('unitsmod').close();
  $('um-cancel').onclick = () => modDialog('unitsmod').close();
  $('um-ok').onclick = () => { void submitUnitsMod(); };
  $('am-close').onclick = () => modDialog('artsmod').close();
  $('am-cancel').onclick = () => modDialog('artsmod').close();
  $('am-ok').onclick = () => { void submitArtifactMod(); };
}
