// The window that fills a Pandora's Box.
//
// One placement at a time, opened from the inspector when the selection is a
// box. Everything on the form is CONTENTS — what the hero gets, and what he
// fights for it — and the glow at the bottom is not a choice so much as a
// consequence: the value of the contents picks it, and the dropdown is there
// for the author who means to lie about it.
//
// A GUARD COSTS WHAT A GIFT COSTS. Ten archangels handed over and ten
// archangels fought are the same ten archangels, so both lists price the same
// way and land on the same colour (src/mods/pandora-contents.ts). Nothing in
// this file decides that; it only shows what came back.
//
// The contents are stored against the placement's NAME, which is the handle
// the game's trigger uses — so the window shows the name and does not let it
// be edited here: renaming is the inspector's, and one place to do it is what
// keeps the sidecar and the map in step.

import { $, $input, $select } from '#core/dom.ts';
import { api } from '#core/ipc.ts';
import { roster } from '#core/rosters.ts';
import { markDirty } from '#core/dirty.ts';
import { state } from '#core/state.ts';
import type { PandoraGetResult, PandoraValuePart, RosterEntryDTO } from '#electron/ipc.ts';
import type { PandoraContents, PandoraStack } from '#src/mods/pandora-contents.ts';

/** The plain number fields, in the order the form shows them. */
const NUMBERS = ['exp', 'gold', 'wood', 'ore', 'mercury', 'crystal', 'sulfur', 'gem'] as const;
type NumberField = (typeof NUMBERS)[number];

/** Which placement the open window belongs to, and what it is holding. */
let openFor: string | null = null;
let draft: PandoraContents = { name: '' };
let tiers: { key: string; from: number }[] = [];

const dialog = (): HTMLDialogElement => $('pandora') as HTMLDialogElement;

/** Is the selected object one of ours? Answered by the main process, which is
 *  the side that knows what a box's shared document is. */
export async function pandoraState(id: string): Promise<PandoraGetResult> {
  try { return await api.pandoraGet(id); }
  catch { return { isBox: false }; }
}

/** Open the contents of one placed box. */
export async function openPandora(id: string): Promise<void> {
  const got = await pandoraState(id);
  if (!got.isBox) return;
  openFor = id;
  draft = { ...(got.contents ?? { name: got.name ?? '' }) };
  tiers = got.tiers ?? [];
  $('pb-name').textContent = got.name || '(unnamed)';
  ($('pb-message') as HTMLTextAreaElement).value = draft.message ?? '';
  for (const key of NUMBERS) $input(`pb-${key}`).value = String(draft[key] ?? 0);
  renderTierSelect();
  renderLists();
  showValue(got.value ?? 0, got.parts ?? [], got.tier ?? '');
  // A box the game cannot address is a box nobody can open: the trigger looks
  // the placement up by name, so an unnamed one is said out loud rather than
  // discovered when the map is played.
  note(got.name ? '' : 'this placement has no name — name it in the inspector, or the box cannot be triggered');
  dialog().showModal();
}

function note(text: string): void {
  const el = $('pb-note');
  el.textContent = text;
  el.classList.toggle('warn', !!text);
}

function renderTierSelect(): void {
  const sel = $select('pb-tier');
  sel.innerHTML = '';
  sel.appendChild(new Option('automatic — by value', ''));
  for (const t of tiers) sel.appendChild(new Option(`${t.key} — from ${t.from} gold`, t.key));
  sel.value = draft.tier ?? '';
}

function showValue(total: number, parts: PandoraValuePart[], tier: string): void {
  $('pb-total').textContent = `${total.toLocaleString('en-US')} gold · ${tier}`;
  $('pb-parts').textContent = parts.map((p) => `${p.what} ${p.gold.toLocaleString('en-US')}`).join(' · ');
}

// --- the four lists ----------------------------------------------------------

/** A dropdown of a roster, with the current value selected even when the
 *  roster does not have it — a creature a mod added and then removed is still
 *  what this box says it holds, and silently swapping it would be a lie. */
function rosterSelect(name: string, value: string, commit: (v: string) => void): HTMLSelectElement {
  const sel = document.createElement('select');
  sel.appendChild(new Option(value || '(pick one)', value));
  sel.value = value;
  sel.addEventListener('change', () => commit(sel.value));
  void roster(name).then((entries: RosterEntryDTO[]) => {
    const held = sel.value;
    sel.innerHTML = '';
    if (held && !entries.some((e) => e.id === held)) sel.appendChild(new Option(`${held} (not in this install)`, held));
    for (const e of entries) sel.appendChild(new Option(e.name || e.id, e.id));
    sel.value = held;
  });
  return sel;
}

function dropButton(onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'pb-drop';
  b.textContent = '✕';
  b.title = 'take it out';
  b.addEventListener('click', onClick);
  return b;
}

/** One id per row — artifacts and spells. */
function renderIdList(hostId: string, registry: string, list: (string | number)[], changed: () => void): void {
  const host = $(hostId);
  host.innerHTML = '';
  list.forEach((id, i) => {
    const row = document.createElement('div');
    row.className = 'pb-row';
    row.appendChild(rosterSelect(registry, String(id), (v) => { list[i] = v; changed(); }));
    row.appendChild(dropButton(() => { list.splice(i, 1); changed(); }));
    host.appendChild(row);
  });
}

/** One creature and a count per row — the gifts and the guards alike. */
function renderStackList(hostId: string, list: PandoraStack[], changed: () => void): void {
  const host = $(hostId);
  host.innerHTML = '';
  list.forEach((stack, i) => {
    const row = document.createElement('div');
    row.className = 'pb-row';
    row.appendChild(rosterSelect('creatures', String(stack.creature), (v) => { stack.creature = v; changed(); }));
    const count = document.createElement('input');
    count.type = 'number'; count.min = '1'; count.value = String(stack.count || 1);
    count.addEventListener('change', () => { stack.count = Math.max(0, Number(count.value) || 0); changed(); });
    row.appendChild(count);
    row.appendChild(dropButton(() => { list.splice(i, 1); changed(); }));
    host.appendChild(row);
  });
}

function renderLists(): void {
  draft.artifacts ??= [];
  draft.spells ??= [];
  draft.creatures ??= [];
  draft.guards ??= [];
  renderIdList('pb-artifacts', 'artifacts', draft.artifacts, renderLists);
  renderIdList('pb-spells', 'spells', draft.spells, renderLists);
  renderStackList('pb-creatures', draft.creatures, renderLists);
  renderStackList('pb-guards', draft.guards, renderLists);
}

// --- saving ------------------------------------------------------------------

/** What the form currently says, as contents — empty fields left out entirely
 *  so a box that holds only gold stores only gold. */
function collect(): PandoraContents {
  const out: PandoraContents = { name: draft.name };
  const message = ($('pb-message') as HTMLTextAreaElement).value.trim();
  if (message) out.message = message;
  for (const key of NUMBERS) {
    const n = Math.max(0, Math.round(Number($input(`pb-${key}`).value) || 0));
    if (n) out[key as NumberField] = n;
  }
  const artifacts = (draft.artifacts ?? []).filter(Boolean);
  const spells = (draft.spells ?? []).filter(Boolean);
  const creatures = (draft.creatures ?? []).filter((s) => s.creature && s.count > 0);
  const guards = (draft.guards ?? []).filter((s) => s.creature && s.count > 0);
  if (artifacts.length) out.artifacts = artifacts;
  if (spells.length) out.spells = spells;
  if (creatures.length) out.creatures = creatures;
  if (guards.length) out.guards = guards;
  const tier = $select('pb-tier').value;
  if (tier) out.tier = tier;
  return out;
}

async function save(): Promise<void> {
  if (!openFor) return;
  const contents = collect();
  try {
    const res = await api.pandoraSet(openFor, contents);
    draft = contents;
    showValue(res.value, res.parts, res.tier);
    note('');
    // The glow may have moved, which is a change to the map: the placement now
    // points at another shared document.
    markDirty(true);
    dialog().close();
  } catch (e) {
    note(e instanceof Error ? e.message : String(e));
  }
}

/** Wire the window up. Called once, at start-up. */
export function initPandora(): void {
  $('pb-close').addEventListener('click', () => dialog().close());
  $('pb-close2').addEventListener('click', () => dialog().close());
  $('pb-save').addEventListener('click', () => void save());
  $('pb-add-artifact').addEventListener('click', () => { (draft.artifacts ??= []).push(''); renderLists(); });
  $('pb-add-spell').addEventListener('click', () => { (draft.spells ??= []).push(''); renderLists(); });
  $('pb-add-creature').addEventListener('click', () => {
    (draft.creatures ??= []).push({ creature: '', count: 1 }); renderLists();
  });
  $('pb-add-guard').addEventListener('click', () => {
    (draft.guards ??= []).push({ creature: '', count: 1 }); renderLists();
  });
  dialog().addEventListener('close', () => { openFor = null; });
}

/** Open the contents of whatever is selected, when it is a box. The inspector's
 *  button calls this; nothing happens for anything else on the map. */
export function openPandoraForSelection(): void {
  const id = state.selected?.id;
  if (id) void openPandora(id);
}
