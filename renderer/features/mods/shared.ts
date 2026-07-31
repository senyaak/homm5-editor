// What the three mod forms share: the installed lists, the data behind every
// select, and the removal that asks first.
//
// The lists live here rather than in whichever form drew them first, because
// one mods:list answer holds all three kinds; what a row DOES when clicked
// is the owning form's, and it says so through listActions.

import { $, $select } from '#core/dom.ts';
import { ask, modDialog } from '#core/dialog.ts';
import { api } from '#core/ipc.ts';
import { openRecolor } from '#features/mods/recolor.ts';
import type { ModsFormDataResult, RosterEntryDTO } from '#electron/ipc.ts';

/** A row in an installed list: what it is, and the two things you can do. */
export function modRow(
  { number, label, note, onEdit, onRemove }:
  { number: number; label: string; note?: string; onEdit: () => void; onRemove: () => void },
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'um-item';
  const num = document.createElement('span');
  num.className = 'num';
  num.textContent = String(number);
  const text = document.createElement('span');
  text.className = 'grow';
  text.textContent = label;
  if (note) {
    const i = document.createElement('i');
    i.textContent = ` · ${note}`;
    text.appendChild(i);
  }
  const edit = document.createElement('button');
  edit.className = 'um-recolor';
  edit.textContent = '✎';
  edit.title = 'load it into the form below and change it';
  edit.onclick = onEdit;
  const drop = document.createElement('button');
  drop.className = 'um-recolor';
  drop.textContent = '×';
  drop.title = 'remove it from the mod';
  drop.onclick = onRemove;
  row.append(num, text, edit, drop);
  return row;
}

/** A literal newline. Written as an escape it would be eaten by the template
 *  the warning text is built with, which is how a multi-line question once
 *  reached the dialog as one long run-on line. */
export const NL = String.fromCharCode(10);


/**
 * What a row in an installed list does when it is clicked.
 *
 * The three lists are drawn together — one `mods:list` answer holds all of
 * them — but only the form that owns a kind knows what editing one MEANS, and
 * a form is loaded for its `init*()` rather than for a value. So each fills in
 * its own here, and a kind whose form was never wired stays inert rather than
 * throwing under the pointer.
 */
export const listActions: {
  editCreature: (id: string) => void;
  editArtifact: (id: string) => void;
  editSet: (effect: string) => void;
  removeSet: (effect: string, label: string) => void;
} = {
  editCreature: () => {},
  editArtifact: () => {},
  editSet: () => {},
  removeSet: () => {},
};

/**
 * Whether the person has typed an id themselves, per form.
 *
 * An id follows the file name until it is edited by hand, and then it stops —
 * otherwise a deliberate id is silently overwritten by the next keystroke in
 * the name box. Shared because the artifact window carries both forms and its
 * open button clears both flags.
 */
export const idTouched = { artifact: false, set: false };

/** An id stem typed as a file name, spelled the way the enums spell it. */
export const idFrom = (prefix: string, file: string): string =>
  `${prefix}${file.trim().replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`;

/** The rosters and enums both forms are built from, fetched once. */
let modForms: Promise<ModsFormDataResult> | null = null;
const modFormData = (): Promise<ModsFormDataResult> =>
  (modForms ??= api.modFormData());

export function fillModSelect(sel: HTMLSelectElement, entries: { id: string; name?: string }[], skipUnset = false): void {
  sel.innerHTML = '';
  for (const e of entries) {
    if (skipUnset && /_(NONE|UNKNOWN)$/.test(e.id)) continue;
    const o = document.createElement('option');
    o.value = e.id;
    o.textContent = e.name ? `${e.name} (${e.id})` : e.id;
    sel.appendChild(o);
  }
}

export async function fillModForms(): Promise<void> {
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
 * Ask what would break, show it, and only then remove.
 *
 * A map names an artifact or a creature by name, so this is an exact list
 * rather than a warning in general terms — and it is shown BEFORE anything
 * happens, which is the whole point.
 */
export async function removeWithWarning(
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

export async function refreshModLists(): Promise<void> {
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
        onEdit: () => { listActions.editCreature(c.id); },
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
        onEdit: () => { listActions.editArtifact(a.id); },
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
        onEdit: () => { listActions.editSet(s.effect); },
        onRemove: () => { listActions.removeSet(s.effect, s.name || s.effect); },
      }));
    }
  }
  // More than one creature mod is a conflict, not a set — each carries a whole
  // copy of the registry, so the game reads one and the rest do not exist.
  $('um-conflict').textContent = mods.length > 1
    ? 'more than one creature mod: they conflict — the game reads one and ignores the others'
    : '';
}

/**
 * Open one of the two windows: clear its lines, draw its lists, fill its form.
 *
 * `preset` is the form's own donor load, passed in rather than chosen here —
 * this knows which window is opening, and only the form knows what a preset
 * fills. It runs after fillModForms, since a preset writes into selects that
 * one populates.
 */
export function openModDialog(id: 'unitsmod' | 'artsmod', preset: () => Promise<void>): void {
  const p = id === 'unitsmod' ? 'um' : 'am';
  $(`${p}-err`).textContent = '';
  $(`${p}-note`).textContent = '';
  modDialog(id).showModal();
  const report = (e: unknown): void => {
    $(`${p}-err`).textContent = e instanceof Error ? e.message : String(e);
  };
  void refreshModLists().catch(report);
  void fillModForms().then(preset).catch(report);
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
export let effectStats: string[] = [];
/**
 * The six the artifact RECORD can hold, offered in the same list.
 *
 * The split matters to the code and to nobody else: a row naming one of these
 * is written into the artifact's own document, and a row naming anything else
 * goes to the file the extension reads. To whoever is filling the form they are
 * one list of "what it gives".
 */
export let heroStats: string[] = [];

/** Every ability the engine knows, by id, with the name a player sees. */
export let umAbilities: RosterEntryDTO[] = [];

// --- artifact sets ----------------------------------------------------------
//
// A set is two data edits — an effect value of ours appended to the enum, and a
// row naming its members — and from those the game names the set, counts the
// pieces a hero wears and draws the tooltip. It does NOT make the set do
// anything: every shipped set's behaviour is compiled against its own value and
// ours is one the executable never heard of. See docs/ARTIFACT_EFFECTS.md.

/** `ARTIFACT_H3_VAMPIRES_CLOAK` → `H3_VAMPIRES_CLOAK`, for a list that fits. */
export const shortArtifactId = (id: string): string => id.replace(/^ARTIFACT_/, '');
