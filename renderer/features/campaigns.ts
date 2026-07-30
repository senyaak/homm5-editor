// Campaigns: pick or create one, edit it, edit one mission.
//
// Three dialogs, mirroring the original editor. What the original cannot do is
// REOPEN a campaign, so the list exists — a campaign here is a project folder,
// editable for as long as it is around, and packing it to .h5c is a separate
// step.
//
// The document is edited whole: main hands over a CampaignDoc, this edits a
// copy, and Save hands it back. Mission ORDER carries meaning (a hero travels
// to the mission after its own), so reordering is a document edit, not a view
// one — main renumbers the handovers when it writes.

import { $, $input, $select, $button, fillSelect } from '#core/dom.ts';
import { ask, modDialog } from '#core/dialog.ts';
import { api } from '#core/ipc.ts';
import { roster } from '#core/rosters.ts';
import { TOWN_BONUSES } from '#src/town-bonuses.ts';
import type { CampaignDoc, CampaignListEntry, CampaignMissionDto, MapListEntry, RosterEntryDTO } from '#electron/ipc.ts';

/** The campaign being edited, and which mission row is selected. */
let campDoc: CampaignDoc | null = null;
let campSel = -1;
/** Maps a mission can point at. */
let campMaps: MapListEntry[] = [];

/**
 * What a mission calls a map: its path under `Maps/`, which is how the game
 * addresses it — `SingleMissions/Foo` for an archive carrying `Maps/SingleMissions/Foo`.
 */
const missionMapRel = (m: MapListEntry): string => (m.inner ?? '').replace(/^Maps\//i, '');

const dlg = (id: string): HTMLDialogElement => $(id) as HTMLDialogElement;
const $sel = (id: string): HTMLSelectElement => $(id) as HTMLSelectElement;

/** The bonus kinds the format offers, labelled as the original editor labels them. */
const BONUS_KINDS: { id: string; label: string }[] = [
  { id: 'E_BONUS_NONE', label: 'No bonus' },
  { id: 'E_BONUS_ARTIFACT', label: 'Artifact' },
  { id: 'E_BONUS_CREATURE', label: 'Creatures' },
  { id: 'E_BONUS_RESOURCE', label: 'Resources' },
  { id: 'E_BONUS_SPELL', label: 'Spell' },
  { id: 'E_BONUS_BUILDING', label: 'Town building' },
];
const RESOURCE_KINDS = ['Wood', 'Ore', 'Mercury', 'Crystal', 'Sulfur', 'Gem', 'Gold'];

/** A roster as dropdown options — the shared cache above does the fetching. */
async function rosterOptions(name: string): Promise<{ id: string; label: string }[]> {
  return (await roster(name)).map((e) => ({ id: e.id, label: e.name || e.id }));
}

export async function openCampaignList(): Promise<void> {
  const list = $('cl-list');
  list.replaceChildren();
  let campaigns: CampaignListEntry[] = [];
  try { campaigns = (await api.listCampaigns()).campaigns; }
  catch (e) { $('hud').textContent = 'could not list campaigns: ' + msgOf(e); }
  if (!campaigns.length) {
    const empty = document.createElement('div');
    empty.className = 'cl-empty';
    empty.textContent = 'no campaigns yet — name one below and create it';
    list.appendChild(empty);
  }
  for (const c of campaigns) {
    const row = document.createElement('div');
    row.className = 'cl-row';
    const name = document.createElement('span');
    name.textContent = c.name;
    const n = document.createElement('i');
    n.textContent = c.missions === 1 ? '1 mission' : `${c.missions} missions`;
    row.append(name, n);
    row.onclick = () => { void openCampaign(c.dir); };
    list.appendChild(row);
  }
  $input('cl-name').value = '';
  modDialog('camplist').showModal();
}

async function openCampaign(dir: string): Promise<void> {
  try { campDoc = await api.openCampaign(dir); }
  catch (e) { $('hud').textContent = 'could not open: ' + msgOf(e); return; }
  modDialog('camplist').close();
  campSel = -1;
  if (!campMaps.length) {
    // A mission names the map's path in the game's file system, which is the
    // folder the archive carries it at — so an archive that holds no map folder
    // is not a mission's map.
    try { campMaps = (await api.listMaps()).maps.filter((m) => !!m.inner); }
    catch { campMaps = []; }
  }
  renderCampaign();
  modDialog('campaign').showModal();
}

function renderCampaign(): void {
  if (!campDoc) return;
  $('cp-title').textContent = `Campaign — ${campDoc.name}`;
  $input('cp-name').value = campDoc.name;
  $input('cp-summary').value = campDoc.summary;
  ($('cp-description') as HTMLTextAreaElement).value = campDoc.description;

  const rows = $('cp-rows');
  rows.replaceChildren();
  campDoc.missions.forEach((m, i) => {
    const tr = document.createElement('tr');
    if (i === campSel) tr.className = 'sel';
    const n = document.createElement('td');
    n.textContent = String(i + 1);
    const map = document.createElement('td');
    // A mission with no map lists in the menu but cannot start, so say so here.
    map.textContent = m.mapRel ? (m.mapRel.split('/').pop() ?? m.mapRel) : '(no map)';
    if (!m.mapRel) map.className = 'none';
    tr.append(n, map);
    tr.onclick = () => { campSel = i; renderCampaign(); };
    tr.ondblclick = () => { void editMission(i); };
    rows.appendChild(tr);
  });

  const has = campSel >= 0 && campSel < campDoc.missions.length;
  for (const [id, on] of [
    ['cp-edit', has], ['cp-remove', has],
    ['cp-up', has && campSel > 0], ['cp-down', has && campSel < campDoc.missions.length - 1],
  ] as [string, boolean][]) ($(id) as HTMLButtonElement).disabled = !on;
  $('cp-err').textContent = '';
}

/** Pull the campaign-wide fields out of the form before anything that saves. */
function readCampaignForm(): void {
  if (!campDoc) return;
  campDoc.summary = $input('cp-summary').value;
  campDoc.description = ($('cp-description') as HTMLTextAreaElement).value;
}

// --- one mission --------------------------------------------------------------

/** The mission being edited, as a copy: Cancel must leave the campaign alone. */
let missionDraft: CampaignMissionDto | null = null;
let missionAt = -1;

async function editMission(index: number): Promise<void> {
  if (!campDoc) return;
  const m = campDoc.missions[index];
  if (!m) return;
  missionAt = index;
  missionDraft = JSON.parse(JSON.stringify(m)) as CampaignMissionDto;
  heroSlotsShown = '';

  fillSelect($sel('ms-map'), campMaps.map((x) => ({ id: missionMapRel(x), label: x.rel })), missionDraft.mapRel);
  $input('ms-name').value = missionDraft.name;
  $input('ms-description').value = missionDraft.description;
  $input('ms-hcount').value = String(missionDraft.heroes.length);
  await renderHeroSlots();
  await renderBonusSlots();
  modDialog('mission').showModal();
}

/**
 * The heroes this mission hands on. The list comes off the mission's own map —
 * its named heroes — because a hero travels under its script name.
 */
let heroSlotsShown = '';

async function renderHeroSlots(): Promise<void> {
  if (!missionDraft) return;
  const want = Math.max(0, Math.min(4, Number($input('ms-hcount').value) || 0));
  // Redrawing when nothing changed is not merely wasted work. This runs on the
  // count field's `change`, which fires when the field loses focus — including
  // to a click on OK. Rebuilding the rows then resizes the dialog between that
  // click's mousedown and mouseup, the button moves out from under the cursor,
  // no click event is ever produced, and the dialog looks frozen.
  const key = `${missionDraft.mapRel}|${want}`;
  if (key === heroSlotsShown) return;
  heroSlotsShown = key;

  const host = $('ms-heroes');
  host.replaceChildren();
  while (missionDraft.heroes.length < want) missionDraft.heroes.push({ scriptName: '' });
  missionDraft.heroes.length = want;

  let heroes: string[] = [];
  let entryPoint = false;
  if (missionDraft.mapRel) {
    try { ({ heroes, entryPoint } = await api.mapHeroes(missionDraft.mapRel)); }
    catch { /* an unreadable map just offers nothing */ }
  }
  const opts = [{ id: '', label: '(default hero)' }, ...heroes.map((h) => ({ id: h, label: h }))];

  missionDraft.heroes.forEach((h, i) => {
    const row = document.createElement('div');
    row.className = 'ms-hero';
    const n = document.createElement('span');
    n.textContent = `${i + 1}.`;
    const who = $selNew('who', opts, h.scriptName, (v) => { h.scriptName = v; });
    row.append(n, who);
    host.appendChild(row);
  });

  // Where they go: the mission after this one. Said plainly rather than warned
  // about — while a campaign is being built one mission at a time, whichever is
  // being edited is the last one there is, and a warning about that is noise.
  //
  // The receiving map needs no EntryPoint: the hero arrives on the copy of
  // himself that map places, which is how the shipped campaigns do it and why
  // none of their 93 maps carries an EntryPoint at all.
  const next = campDoc?.missions[missionAt + 1];
  let note = '';
  if (want) {
    const where = next?.mapRel ? ` (${next.mapRel.split('/').pop()})` : '';
    note = next
      ? `handed on to mission ${missionAt + 2}${where} — that map must place these heroes too`
      : 'nothing follows this mission yet; heroes handed on here are dropped unless one does';
  }
  $('ms-entry').textContent = note;
}

/** A labelled <select> that writes straight back into the draft. */
function $selNew(
  cls: string, opts: { id: string; label: string }[], value: string, onPick: (v: string) => void,
): HTMLSelectElement {
  const sel = document.createElement('select');
  sel.className = cls;
  fillSelect(sel, opts, value);
  sel.onchange = () => onPick(sel.value);
  return sel;
}

/** The three start-bonus slots: a kind, what it grants, and how many. */
async function renderBonusSlots(): Promise<void> {
  if (!missionDraft) return;
  while (missionDraft.bonuses.length < 3) missionDraft.bonuses.push({ type: 'E_BONUS_NONE', value: '', count: 1 });
  missionDraft.bonuses.length = 3;

  const host = $('ms-bonuses');
  host.replaceChildren();
  for (const [i, b] of missionDraft.bonuses.entries()) {
    const row = document.createElement('div');
    row.className = 'ms-bonus';
    const label = document.createElement('label');
    label.textContent = `Item ${i + 1}:`;

    const kind = $selNew('kind', BONUS_KINDS, b.type || 'E_BONUS_NONE', (v) => {
      b.type = v;
      b.value = '';
      void renderBonusSlots();
    });
    const what = document.createElement('select');
    const count = document.createElement('input');
    count.type = 'number';
    count.min = '0';
    count.value = String(b.count || 1);
    count.onchange = () => { b.count = Number(count.value) || 0; };

    const opts = await bonusOptions(b.type);
    what.disabled = !opts.length;
    // Only creatures and resources are counted; the rest grant one thing.
    count.disabled = !(b.type === 'E_BONUS_CREATURE' || b.type === 'E_BONUS_RESOURCE');
    if (opts.length) {
      if (!b.value) b.value = opts[0]!.id;
      fillSelect(what, opts, b.value);
      what.onchange = () => { b.value = what.value; };
    }
    row.append(label, kind, what, count);
    host.appendChild(row);
  }
}

/** What a bonus of this kind can grant. */
async function bonusOptions(type: string): Promise<{ id: string; label: string }[]> {
  if (type === 'E_BONUS_ARTIFACT') return rosterOptions('artifacts');
  if (type === 'E_BONUS_CREATURE') return rosterOptions('creatures');
  if (type === 'E_BONUS_SPELL') return rosterOptions('spells');
  if (type === 'E_BONUS_RESOURCE') return RESOURCE_KINDS.map((r) => ({ id: r, label: r }));
  if (type === 'E_BONUS_BUILDING') return TOWN_BONUSES.map((b) => ({ id: b.id, label: b.label }));
  return [];
}

const msgOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// --- wiring -------------------------------------------------------------------

$('campaignbtn').onclick = () => { void openCampaignList(); };
$('cl-close').onclick = () => modDialog('camplist').close();
$('cl-new').onclick = async () => {
  const name = $input('cl-name').value.trim();
  if (!name) return;
  try { campDoc = await api.newCampaign(name); }
  catch (e) { $('hud').textContent = 'could not create: ' + msgOf(e); return; }
  await openCampaign(campDoc.dir);
};
$input('cl-name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); $('cl-new').click(); }
});

$('cp-close').onclick = () => modDialog('campaign').close();
$('cp-cancel').onclick = () => modDialog('campaign').close();
$('cp-add').onclick = () => {
  if (!campDoc) return;
  readCampaignForm();
  campDoc.missions.push({ mapRel: campMaps[0] ? missionMapRel(campMaps[0]) : '', name: '', description: '', heroes: [], bonuses: [] });
  campSel = campDoc.missions.length - 1;
  renderCampaign();
  void editMission(campSel);
};
$('cp-edit').onclick = () => { void editMission(campSel); };
$('cp-remove').onclick = () => {
  if (!campDoc || campSel < 0) return;
  readCampaignForm();
  campDoc.missions.splice(campSel, 1);
  campSel = Math.min(campSel, campDoc.missions.length - 1);
  renderCampaign();
};
for (const [id, delta] of [['cp-up', -1], ['cp-down', 1]] as [string, number][]) {
  $(id).onclick = () => {
    if (!campDoc || campSel < 0) return;
    readCampaignForm();
    const to = campSel + delta;
    if (to < 0 || to >= campDoc.missions.length) return;
    const [moved] = campDoc.missions.splice(campSel, 1);
    campDoc.missions.splice(to, 0, moved!);
    campSel = to;
    renderCampaign();
  };
}
$('cp-ok').onclick = () => { void saveCampaign(true); };
$('cp-pack').onclick = async () => {
  // Pack what is on screen, not what was last saved.
  if (!(await saveCampaign(false))) return;
  if (!campDoc) return;
  try {
    const r = await api.packCampaign(campDoc.dir);
    if (r.canceled) return;
    $('hud').textContent = `packed → ${r.output} (${((r.bytes ?? 0) / 1024) | 0} KB)`;
  } catch (e) { $('cp-err').textContent = msgOf(e); }
};

/** Write the campaign back. Returns false when main refused it. */
async function saveCampaign(close: boolean): Promise<boolean> {
  if (!campDoc) return false;
  readCampaignForm();
  try { campDoc = await api.saveCampaign(campDoc); }
  catch (e) { $('cp-err').textContent = msgOf(e); return false; }
  if (close) modDialog('campaign').close();
  else renderCampaign();
  return true;
}

$('ms-close').onclick = () => modDialog('mission').close();
$('ms-cancel').onclick = () => modDialog('mission').close();
$sel('ms-map').onchange = () => {
  if (!missionDraft) return;
  missionDraft.mapRel = $sel('ms-map').value;
  // A different map means different heroes to hand on.
  missionDraft.heroes = [];
  $input('ms-hcount').value = '0';
  void renderHeroSlots();
};
$input('ms-hcount').addEventListener('change', () => { void renderHeroSlots(); });
$('ms-ok').onclick = () => {
  if (!campDoc || !missionDraft || missionAt < 0) return;
  missionDraft.name = $input('ms-name').value;
  missionDraft.description = $input('ms-description').value;
  campDoc.missions[missionAt] = missionDraft;
  missionDraft = null;
  modDialog('mission').close();
  renderCampaign();
};
