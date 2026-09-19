// The Factions window: a town type of our own.
//
// A faction is most of what the mod already knows how to make — creatures,
// heroes, classes — gathered under one type, plus the town: a shipped one
// copied and made ours. So the form is built the way the town is built: a
// DONOR is chosen and everything is the donor's until said otherwise. "Fill
// from donor" reads the donor's building tree onto a grid drawn like the
// game's own build screen (five by six; one building per cell; its upgrade
// levels stacked on it unless a level is given a cell of its own; a
// dependency an arrow from the cell above in the same column), and every
// edit is a DIFF against the donor — `BuildingEdit` per level — which is
// what the copier applies (src/mods/town-files.ts). Nothing typed here is
// the town; the town is the donor with these said over it.
//
// What the form offers is read from the main process through
// mods:faction-data — the eight donors, the enums, the mod's own creatures —
// not written out here.

import { $, $button, $input, $select, fillSelect } from '#core/dom.ts';
import { ask, modDialog, openOnTop } from '#core/dialog.ts';
import { api } from '#core/ipc.ts';
import { requireFilled } from '#core/form-gate.ts';
import { modRow, NL } from '#features/mods/shared.ts';
import type { FactionTreeDTO, ModFactionDTO, ModsFactionDataResult, ModsFactionPayload } from '#electron/ipc.ts';
import type { BuildingEdit, BuildingKey, Resource, SiegeMix, ExteriorMix } from '#src/mods/town-files.ts';
import type { TreeBuilding } from '#src/mods/town-tree.ts';
import type { MoatSpell, OwnSounds, OwnTracks, SoundSlot, TrackSlot } from '#src/mods/town-type-info.ts';
import type { IconPictures } from '#src/mods/faction-icons.ts';
import type { OwnSiegePart, SiegePartName } from '#src/mods/siege-parts.ts';
import type { FactionAi, SkillValues } from '#src/mods/factions.ts';

const RESOURCES: readonly Resource[] = ['Wood', 'Ore', 'Mercury', 'Crystal', 'Sulfur', 'Gem', 'Gold'];
const COLUMNS = 5;
const ROWS = 6;
const SCHOOLS = ['MAGIC_SCHOOL_DESTRUCTIVE', 'MAGIC_SCHOOL_DARK', 'MAGIC_SCHOOL_LIGHT', 'MAGIC_SCHOOL_SUMMONING'];

/** The donors, enums and rosters, fetched once per opening. */
let facData: ModsFactionDataResult | null = null;
const factionData = async (): Promise<ModsFactionDataResult> => (facData ??= await api.factionData());

/** The file stem being edited, or '' when the form is making a new one. */
let editingFile = '';
/** The AI's per-skill values of the faction being edited — kept as they were; the form has no widget for them yet. */
let keptSkillValues: Record<number, SkillValues> | undefined;
/** The donor's tree, once filled; the grid is drawn from it. */
let tree: FactionTreeDTO | null = null;
/** Trees of the towns buildings were taken from (`from`), by type. */
const trees = new Map<string, FactionTreeDTO>();
/** The edits, by key — the diff the copier applies. */
let edits: Record<BuildingKey, BuildingEdit | null> = {};
/** The cell and level under the editor. */
let picked: { x: number; y: number; key: BuildingKey | null } | null = null;
/** Siege parts of our own: per part, per piece, the three ruin levels' files. */
const SIEGE_PIECE_LABELS: Record<SiegePartName, readonly string[]> = {
  walls: ['wall 1', 'wall 2', 'wall 3', 'wall 4'], towers: ['left tower', 'right tower', 'big tower'], gate: ['gate'], moat: ['moat'],
};
const blankSiegeOwn = (): Record<SiegePartName, { models: string[]; damaged: string[]; destroyed: string[] }> => ({
  walls: { models: [], damaged: [], destroyed: [] }, towers: { models: [], damaged: [], destroyed: [] },
  gate: { models: [], damaged: [], destroyed: [] }, moat: { models: [], damaged: [], destroyed: [] },
});
let siegeOwn = blankSiegeOwn();

function drawSiegeOwn(): void {
  const box = $('fac-siege-own');
  box.innerHTML = '';
  for (const part of ['walls', 'towers', 'gate', 'moat'] as const) {
    const own = siegeOwn[part];
    for (const [i, label] of SIEGE_PIECE_LABELS[part].entries()) {
      const row = document.createElement('div');
      row.className = 'on-row';
      const l = document.createElement('span');
      l.textContent = label;
      row.appendChild(l);
      for (const level of ['models', 'damaged', 'destroyed'] as const) {
        const input = document.createElement('input');
        input.type = 'text';
        input.spellcheck = false;
        input.className = `fc-siege-file fc-siege-${part}-${level}`;
        input.placeholder = level === 'models' ? 'whole — a Model of yours' : level === 'damaged' ? 'breached (optional)' : 'razed (optional)';
        input.value = own[level][i] ?? '';
        input.oninput = () => { own[level][i] = input.value.trim(); formGate().check(); };
        const pick = document.createElement('button');
        pick.className = 'ghost he-file';
        pick.textContent = 'file…';
        pick.onclick = (ev) => {
          ev.preventDefault();
          void api.pickFactionFile('model').then((path) => { if (path) { input.value = path; own[level][i] = path; formGate().check(); } });
        };
        row.append(input, pick);
      }
      box.appendChild(row);
    }
  }
}

/** The parts with any model of ours, as the spec takes them; a part half given is a problem named. */
function readSiegeOwn(): { parts: Partial<Record<SiegePartName, OwnSiegePart>>; problems: string[] } {
  const parts: Partial<Record<SiegePartName, OwnSiegePart>> = {};
  const problems: string[] = [];
  for (const part of ['walls', 'towers', 'gate', 'moat'] as const) {
    const own = siegeOwn[part];
    const n = SIEGE_PIECE_LABELS[part].length;
    if (![...own.models, ...own.damaged, ...own.destroyed].some((v) => v)) continue;
    const models = Array.from({ length: n }, (_, i) => own.models[i] ?? '');
    if (models.some((m) => !m)) { problems.push(`every whole model of the ${part} (${n})`); continue; }
    const opt = (list: string[]): (string | undefined)[] | undefined => {
      const out = Array.from({ length: n }, (_, i) => list[i] || undefined);
      return out.some((v) => v) ? out : undefined;
    };
    const p: OwnSiegePart = { models };
    const damaged = opt(own.damaged);
    const destroyed = opt(own.destroyed);
    if (damaged) p.damaged = damaged;
    if (destroyed) p.destroyed = destroyed;
    parts[part] = p;
  }
  return { parts, problems };
}

/** Tracks of our own, by slot; the battle themes as a list. */
const TRACK_LABELS: ReadonlyArray<{ id: TrackSlot | 'combat.0' | 'combat.1' | 'combat.2'; label: string }> = [
  { id: 'town', label: 'Town' }, { id: 'tavern', label: 'Tavern' }, { id: 'dwelling', label: 'Dwellings' },
  { id: 'combat.0', label: 'Battle 1' }, { id: 'combat.1', label: 'Battle 2' }, { id: 'combat.2', label: 'Battle 3' },
  { id: 'siege', label: 'Siege' }, { id: 'win', label: 'Victory' }, { id: 'loss', label: 'Defeat' },
  { id: 'retreat', label: 'Retreat' }, { id: 'wait', label: "The AI's turn" },
];
let tracks: Record<string, string> = {};
const SOUND_LABELS: ReadonlyArray<{ id: SoundSlot; label: string }> = [
  { id: 'ambient', label: 'Town ambience' }, { id: 'guild', label: 'Guild click' }, { id: 'hall', label: 'Hall click' },
  { id: 'marketplace', label: 'Market click' }, { id: 'shipyard', label: 'Shipyard click' }, { id: 'blacksmith', label: 'Smithy click' },
  { id: 'upgrade', label: 'Building built' },
];
let sounds: Record<string, string> = {};

function drawSounds(): void {
  const box = $('fac-sounds');
  box.innerHTML = '';
  for (const s of SOUND_LABELS) {
    box.appendChild(fileRow(s.label, sounds[s.id] ?? '', 'sound', (v) => { if (v) sounds[s.id] = v; else delete sounds[s.id]; }, '.wav (PCM) or .ogg'));
  }
}

function readSounds(): OwnSounds | undefined {
  const out: OwnSounds = {};
  for (const s of SOUND_LABELS) if (sounds[s.id]) out[s.id] = sounds[s.id];
  return Object.keys(out).length ? out : undefined;
}

function drawTracks(): void {
  const box = $('fac-tracks');
  box.innerHTML = '';
  for (const t of TRACK_LABELS) {
    box.appendChild(fileRow(t.label, tracks[t.id] ?? '', 'sound', (v) => { if (v) tracks[t.id] = v; else delete tracks[t.id]; }));
  }
}

function readTracks(): OwnTracks | undefined {
  const out: Record<string, unknown> = {};
  const combat: string[] = [];
  for (const [k, v] of Object.entries(tracks)) {
    if (!v) continue;
    if (k.startsWith('combat.')) combat[Number(k.slice(7))] = v; else out[k] = v;
  }
  const battle = combat.filter((x) => x);
  if (battle.length) out.combat = battle;
  return Object.keys(out).length ? (out as OwnTracks) : undefined;
}

/** Pictures of our own for the icons, by slot; the buildings' by key. */
let pictures: { buildings: Record<BuildingKey, string>; [slot: string]: unknown } = { buildings: {} };

/** The picture slots beside the buildings', with the size each is read at. */
const PICTURE_SLOTS: ReadonlyArray<{ id: string; label: string; size: number }> = [
  { id: 'town', label: 'Town, 55', size: 55 }, { id: 'townFort', label: 'Town with fort, 55', size: 55 },
  { id: 'race', label: 'Race tile, 55', size: 55 }, { id: 'tower', label: 'Siege tower, 128', size: 128 },
  { id: 'kingdom.0', label: 'Overview: village', size: 128 }, { id: 'kingdom.1', label: 'Overview: town', size: 128 },
  { id: 'kingdom.2', label: 'Overview: city', size: 128 }, { id: 'kingdom.3', label: 'Overview: capital', size: 128 },
  { id: 'button.normal', label: 'Button, 82', size: 82 }, { id: 'button.pushed', label: 'Button pushed', size: 82 },
  { id: 'button.disabled', label: 'Button disabled', size: 82 },
  { id: 'capture.sign', label: 'Capture sign, 128', size: 128 }, { id: 'capture.flag', label: 'Capture flag, 55', size: 55 },
];

/** A path box with a file picker beside it — the shape every file of ours is given in. */
function fileRow(label: string, value: string, kind: 'model' | 'picture' | 'sound', on: (v: string) => void, title = ''): HTMLElement {
  const row = document.createElement('label');
  row.className = 'on-row';
  const l = document.createElement('span');
  l.textContent = label;
  const input = document.createElement('input');
  input.type = 'text';
  input.spellcheck = false;
  input.className = 'fc-file';
  input.placeholder = kind === 'picture' ? 'a PNG or GIF of yours' : kind === 'sound' ? 'an .ogg of yours' : 'a path in the data, or a file of yours';
  input.title = title;
  input.value = value;
  input.oninput = () => on(input.value.trim());
  const pick = document.createElement('button');
  pick.className = 'ghost he-file';
  pick.textContent = 'file…';
  pick.onclick = (ev) => {
    ev.preventDefault();
    void api.pickFactionFile(kind).then((path) => { if (path) { input.value = path; on(path); } });
  };
  row.append(l, input, pick);
  return row;
}

function drawPictures(): void {
  const box = $('fac-pictures');
  box.innerHTML = '';
  for (const slot of PICTURE_SLOTS) {
    const [head, sub] = slot.id.split('.') as [string, string | undefined];
    const current = sub === undefined ? pictures[head] : (pictures[head] as Record<string, string> | undefined)?.[sub];
    box.appendChild(fileRow(slot.label, typeof current === 'string' ? current : '', 'picture', (v) => {
      if (sub === undefined) { if (v) pictures[head] = v; else delete pictures[head]; }
      else {
        const group = { ...((pictures[head] as Record<string, string> | undefined) ?? {}) };
        if (v) group[sub] = v; else delete group[sub];
        if (Object.keys(group).length) pictures[head] = group; else delete pictures[head];
      }
      formGate().check();
    }, `read at ${slot.size}×${slot.size}`));
  }
}

/** What the form holds as the spec's `pictures`, or nothing. */
function readPictures(): IconPictures | undefined {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(pictures)) {
    if (k === 'buildings') { if (Object.keys(pictures.buildings).length) out.buildings = { ...pictures.buildings }; continue; }
    if (k === 'kingdom') {
      const g = v as Record<string, string>;
      const four = ['0', '1', '2', '3'].map((i) => g[i]);
      // Four or none: the overview has four levels and reads them by index.
      if (four.every((x) => x)) out.kingdom = four; else if (four.some((x) => x)) out.kingdom = four.map((x) => x ?? four.find((y) => y)!);
      continue;
    }
    if (k === 'capture') {
      const g = v as Record<string, string>;
      if (g.sign && g.flag) out.capture = { sign: g.sign, flag: g.flag };
      else if (g.sign || g.flag) {
        // Both or the marker is refused; one given serves as the other too.
        const one = g.sign ?? g.flag!;
        out.capture = { sign: g.sign ?? one, flag: g.flag ?? one };
      }
      continue;
    }
    if (k === 'button') {
      const g = v as Record<string, string>;
      if (g.normal && g.pushed && g.disabled) out.button = { normal: g.normal, pushed: g.pushed, disabled: g.disabled };
      else if (g.normal || g.pushed || g.disabled) {
        const one = g.normal ?? g.pushed ?? g.disabled!;
        out.button = { normal: g.normal ?? one, pushed: g.pushed ?? one, disabled: g.disabled ?? one };
      }
      continue;
    }
    if (v) out[k] = v;
  }
  return Object.keys(out).length ? (out as IconPictures) : undefined;
}

const townTypeFor = (file: string): string =>
  `TOWN_${file.trim().replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`;
const parseKey = (key: BuildingKey): { type: string; level: number } => {
  const m = /^(TB_[A-Z0-9_]+?)(?:\/([1-9]))?$/.exec(key);
  return { type: m?.[1] ?? key, level: m?.[2] ? Number(m[2]) : 1 };
};
const keyOf = (type: string, level: number): BuildingKey => (level === 1 ? type : `${type}/${level}`);

// --- the list -----------------------------------------------------------------

export async function openFactions(): Promise<void> {
  facData = null;
  $('fac-err').textContent = '';
  modDialog('facmod').showModal();
  await refreshFactions();
}

async function refreshFactions(): Promise<void> {
  const list = $('fac-list');
  list.innerHTML = '';
  const { gameRoot, mods } = await api.listMods();
  if (!gameRoot) {
    list.innerHTML = '<div class="um-empty">no game install configured — nowhere to install to</div>';
    return;
  }
  let n = 0;
  for (const m of mods) {
    for (const f of m.factions ?? []) {
      n++;
      list.appendChild(modRow({
        number: f.number, label: `${f.race?.name || f.file} — ${f.name}`, note: `${f.type}, from ${f.donor}, ${f.towns.length} town(s)`,
        onEdit: () => { void openFactionForm(f); },
        onRemove: () => { void removeFaction(f); },
      }));
    }
  }
  if (!n) list.innerHTML = '<div class="um-empty">none yet — the game holds its eight</div>';
}

async function removeFaction(f: ModFactionDTO): Promise<void> {
  const label = f.race?.name || f.file;
  if (!await ask(`Remove ${label} (${f.type})?${NL}${NL}Any map that placed a town of it will stop resolving the type, and the factions after it move down one ordinal.`, 'Remove')) return;
  try {
    await api.removeFaction({ file: f.file });
    await refreshFactions();
  } catch (e) {
    $('fac-err').textContent = e instanceof Error ? e.message : String(e);
  }
}

// --- the form -----------------------------------------------------------------

const townOptions = (data: ModsFactionDataResult, none: string): { id: string; label: string }[] =>
  [{ id: '', label: none }, ...data.donors.map((d) => ({ id: d.type, label: d.label }))];

async function openFactionForm(existing: ModFactionDTO | null): Promise<void> {
  const data = await factionData();
  editingFile = existing?.file ?? '';
  tree = null;
  trees.clear();
  edits = { ...(existing?.buildings ?? {}) };
  picked = null;
  {
    const p = existing?.pictures;
    pictures = { buildings: { ...(p?.buildings ?? {}) } };
    if (p?.town) pictures.town = p.town;
    if (p?.townFort) pictures.townFort = p.townFort;
    if (p?.race) pictures.race = p.race;
    if (p?.tower) pictures.tower = p.tower;
    if (p?.kingdom) pictures.kingdom = { 0: p.kingdom[0], 1: p.kingdom[1], 2: p.kingdom[2], 3: p.kingdom[3] };
    if (p?.button) pictures.button = { ...p.button };
    if (p?.capture) pictures.capture = { ...(p.capture.sign ? { sign: p.capture.sign } : {}), ...(p.capture.flag ? { flag: p.capture.flag } : {}) };
  }

  $('facedit-title').textContent = existing ? 'Edit faction' : 'New faction';
  $('fac-editing').textContent = existing ? `editing ${existing.file} (${existing.type}, ordinal ${existing.number}) — its identifier cannot change` : '';
  $('fac-form-err').textContent = '';
  $input('fac-file').value = existing?.file ?? '';
  $input('fac-file').readOnly = !!existing;
  $input('fac-type').value = existing?.type ?? '';
  $input('fac-race-name').value = existing?.race?.name ?? '';
  $input('fac-race-tooltip').value = existing?.race?.tooltip ?? '';
  $input('fac-name').value = existing?.name ?? '';
  fillSelect($select('fac-donor'), data.donors.map((d) => ({ id: d.type, label: d.label })), existing?.donor ?? data.donors[0]!.type);
  $('fac-donor-note').textContent = existing ? 'the tree below is the donor\'s with the faction\'s edits over it' : 'press to load the donor\'s tree';
  $select('fac-magic').value = existing?.magic ?? 'guild';
  fillSelect($select('fac-school-1'), SCHOOLS.map((s) => ({ id: s, label: s.replace('MAGIC_SCHOOL_', '').toLowerCase() })), existing?.magicSchools?.[0] ?? SCHOOLS[2]!);
  fillSelect($select('fac-school-2'), SCHOOLS.map((s) => ({ id: s, label: s.replace('MAGIC_SCHOOL_', '').toLowerCase() })), existing?.magicSchools?.[1] ?? SCHOOLS[1]!);
  showSchools();
  $select('fac-alignment').value = existing?.alignment ?? '';
  keptSkillValues = existing?.ai?.skillValues;
  fillSelect($select('fac-ai-like'), [{ id: '', label: 'none — an AI hero of the race levels up blind' }, ...data.donors.map((d) => ({ id: d.type, label: `${d.label}'s` }))], existing?.ai?.skillsLike ?? '');
  {
    const list = $select('fac-map-dwellings');
    list.replaceChildren(...data.dwellings.map((d) => { const o = document.createElement('option'); o.value = d.id; o.textContent = d.id; return o; }));
    const want = new Set(existing?.mapDwellings ?? []);
    for (const o of list.options) o.selected = want.has(o.value);
    if (!data.dwellings.length) list.title = 'the mod has no dwellings yet — add one under Dwellings… first';
  }

  drawDwellings(data, existing?.dwellings ?? {});
  fillSelect($select('fac-shooter'), [{ id: '', label: 'the donor\'s' }, ...data.creatures.map((c) => ({ id: c.id, label: c.name ? `${c.name} (${c.id})` : c.id }))], existing?.shooter ?? '');

  const siege: SiegeMix = typeof existing?.siege === 'string' ? { arena: existing.siege } : (existing?.siege ?? { arena: '' });
  siegeOwn = blankSiegeOwn();
  for (const part of ['arena', 'walls', 'gate', 'towers', 'moat'] as const) {
    const v = siege[part];
    if (part !== 'arena' && v && typeof v !== 'string') {
      siegeOwn[part] = { models: [...v.models], damaged: [...(v.damaged ?? [])].map((x) => x ?? ''), destroyed: [...(v.destroyed ?? [])].map((x) => x ?? '') };
    }
    fillSelect($select(`fac-siege-${part}`), townOptions(data, part === 'arena' ? 'the donor\'s siege' : 'as the arena\'s'), typeof v === 'string' ? v : '');
  }
  drawSiegeOwn();
  const exterior: ExteriorMix = typeof existing?.exterior === 'string' ? { stages: {} } : (existing?.exterior ?? { stages: {} });
  fillSelect($select('fac-exterior'), townOptions(data, 'the donor\'s'), typeof existing?.exterior === 'string' ? existing.exterior : '');
  {
    const gates = exterior.gates ?? '';
    const own = /^[A-Za-z]:[\\/]|^[\\/]{2}/.test(gates);
    fillSelect($select('fac-exterior-gates'), townOptions(data, 'the donor\'s'), own ? '' : gates);
    $input('fac-exterior-gates-file').value = own ? gates : '';
    $select('fac-exterior-gates').disabled = own;
  }
  drawStages(data, exterior.stages);

  fillSelect($select('fac-machine'), [{ id: '', label: 'the donor\'s' }, ...data.warMachines.map((m) => ({ id: m, label: m.replace('WAR_MACHINE_', '').toLowerCase() }))], existing?.race?.warMachine ?? '');
  fillSelect($select('fac-music'), townOptions(data, 'the donor\'s'), existing?.race?.music ?? '');
  drawSilo(existing?.race?.siloIncome ?? {});
  $input('fac-moat-damage').value = existing?.race?.moat?.damage === undefined ? '' : String(existing.race.moat.damage);
  drawMoatSpells(data, existing?.race?.moat?.spells ?? []);
  $input('fac-icons').checked = !!existing?.icons;
  if (existing?.icons) {
    const hex = (c: readonly number[]): string => `#${c.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    $input('fac-icon-field').value = hex(existing.icons.field);
    $input('fac-icon-rim').value = hex(existing.icons.rim);
    $input('fac-icon-ink').value = hex(existing.icons.ink);
    $input('fac-icon-accent').value = hex(existing.icons.accent);
  }
  drawTowns(data, existing?.towns ?? []);
  drawPictures();
  tracks = {};
  for (const [k, v] of Object.entries(existing?.race?.tracks ?? {})) {
    if (k === 'combat') (v as string[]).forEach((x, i) => { tracks[`combat.${i}`] = x; });
    else if (typeof v === 'string') tracks[k] = v;
  }
  drawTracks();
  sounds = { ...(existing?.race?.sounds ?? {}) } as Record<string, string>;
  drawSounds();
  (document.getElementById('fac-script') as HTMLTextAreaElement).value = existing?.script ?? '';

  drawGrid();
  drawCellEditor();
  watchForm();
  openOnTop('facedit');
  // An existing faction's tree is loaded at once — the grid is where the edits
  // live, and a form without it shows the edits as keys and nothing else.
  if (existing) await loadTree(existing.donor, true);
}

function showSchools(): void {
  $('fac-schools-row').style.display = $select('fac-magic').value === 'guild' ? '' : 'none';
}

/** The seven tiers: base and upgrade, out of the mod's creatures. */
function drawDwellings(data: ModsFactionDataResult, current: NonNullable<ModsFactionPayload['dwellings']>): void {
  const box = $('fac-dwellings');
  box.innerHTML = '';
  const creatures = [{ id: '', label: 'the donor\'s' }, ...data.creatures.map((c) => ({ id: c.id, label: c.name ? `${c.name} (${c.id})` : c.id }))];
  for (let tier = 1; tier <= 7; tier++) {
    const row = document.createElement('div');
    row.className = 'on-row';
    const label = document.createElement('span');
    label.textContent = `Tier ${tier}`;
    const base = document.createElement('select');
    base.className = 'fc-dwelling';
    base.dataset.tier = String(tier);
    base.dataset.role = 'base';
    base.title = 'the base creature, hired by the dwelling';
    fillSelect(base, creatures, current[tier]?.base ?? '');
    const up = document.createElement('select');
    up.className = 'fc-dwelling';
    up.dataset.tier = String(tier);
    up.dataset.role = 'upgrade';
    up.title = 'its upgrade, hired by the upgraded dwelling';
    fillSelect(up, creatures, current[tier]?.upgrade ?? '');
    row.append(label, base, up);
    box.appendChild(row);
  }
}

function readDwellings(): ModsFactionPayload['dwellings'] {
  const out: Record<number, { base: string; upgrade: string }> = {};
  for (const el of document.querySelectorAll<HTMLSelectElement>('.fc-dwelling')) {
    const tier = Number(el.dataset.tier);
    if (!el.value) continue;
    const t = out[tier] ?? (out[tier] = { base: '', upgrade: '' });
    t[el.dataset.role as 'base' | 'upgrade'] = el.value;
  }
  // A tier with one of the two is not a tier: both or the donor's.
  for (const [tier, t] of Object.entries(out)) if (!t.base || !t.upgrade) delete out[Number(tier)];
  return Object.keys(out).length ? out : undefined;
}

/** The ten exterior stages, each a town or the whole exterior's. */
function drawStages(data: ModsFactionDataResult, current: ExteriorMix['stages']): void {
  const box = $('fac-stages');
  box.innerHTML = '';
  for (const stage of data.exteriorStages) {
    const row = document.createElement('label');
    row.className = 'on-row';
    const label = document.createElement('span');
    label.textContent = stage;
    const sel = document.createElement('select');
    sel.className = 'fc-stage';
    sel.dataset.stage = stage;
    const value = (current as Record<string, string>)[stage] ?? '';
    const own = /^[A-Za-z]:[\\/]|^[\\/]{2}/.test(value);
    fillSelect(sel, townOptions(data, 'as the exterior'), own ? '' : value);
    // Or a model of ours at the stage: the file's path rides on the row, and
    // the select stands down while it is there.
    sel.dataset.file = own ? value : '';
    sel.disabled = own;
    const file = document.createElement('input');
    file.type = 'text';
    file.spellcheck = false;
    file.className = 'fc-stage-file';
    file.placeholder = 'or a Model of yours';
    file.title = 'a Model document of yours for this stage; its folder is read as a data root';
    file.value = own ? value : '';
    const setFile = (path: string): void => {
      sel.dataset.file = path;
      sel.disabled = !!path;
      if (path) sel.value = '';
    };
    file.oninput = () => setFile(file.value.trim());
    const pick = document.createElement('button');
    pick.className = 'ghost he-file';
    pick.textContent = 'file…';
    pick.onclick = (ev) => {
      ev.preventDefault();
      void api.pickFactionFile('model').then((path) => { if (path) { file.value = path; setFile(path); } });
    };
    row.append(label, sel, file, pick);
    box.appendChild(row);
  }
}

function readExterior(): ModsFactionPayload['exterior'] {
  const whole = $select('fac-exterior').value;
  const gates = $input('fac-exterior-gates-file').value.trim() || $select('fac-exterior-gates').value;
  const stages: Record<string, string> = {};
  for (const el of document.querySelectorAll<HTMLSelectElement>('.fc-stage')) {
    const v = el.dataset.file || el.value;
    if (v) stages[el.dataset.stage!] = v;
  }
  if (!Object.keys(stages).length && !gates) return whole || undefined;
  // A whole exterior with a stage or a gate said differently is a mix whose
  // unsaid stages are the whole's — which the copier reads as the donor's, so
  // the whole is spelt out per stage.
  if (whole) for (const stage of (facData?.exteriorStages ?? [])) stages[stage] ??= whole;
  return { stages: stages as ExteriorMix['stages'], ...(gates ? { gates } : {}) };
}

function readSiege(): ModsFactionPayload['siege'] {
  const own = readSiegeOwn().parts;
  // The arena is the donor's when unsaid — a part of ours needs one to stand in.
  const arena = $select('fac-siege-arena').value || (Object.keys(own).length ? $select('fac-donor').value : '');
  if (!arena) return undefined;
  const mix: SiegeMix = { arena };
  for (const part of ['walls', 'gate', 'towers', 'moat'] as const) {
    const v = own[part] ?? $select(`fac-siege-${part}`).value;
    if (v) mix[part] = v;
  }
  return Object.keys(mix).length === 1 ? arena : mix;
}

function drawSilo(current: Partial<Record<Resource, number>>): void {
  const box = $('fac-silo');
  box.innerHTML = '';
  for (const res of RESOURCES) {
    const label = document.createElement('label');
    label.textContent = res;
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.className = 'fc-silo';
    input.dataset.res = res;
    input.placeholder = '–';
    input.title = `${res} a week from the resource silo; blank keeps the donor's`;
    input.value = current[res] === undefined ? '' : String(current[res]);
    label.appendChild(input);
    box.appendChild(label);
  }
}

function readSilo(): Partial<Record<Resource, number>> | undefined {
  const out: Partial<Record<Resource, number>> = {};
  for (const el of document.querySelectorAll<HTMLInputElement>('.fc-silo')) {
    if (el.value.trim() !== '') out[el.dataset.res as Resource] = Number(el.value);
  }
  return Object.keys(out).length ? out : undefined;
}

function drawMoatSpells(data: ModsFactionDataResult, current: readonly MoatSpell[]): void {
  const box = $('fac-moat-spells');
  box.innerHTML = '';
  for (const s of current) addMoatSpellRow(data, s);
}

function addMoatSpellRow(data: ModsFactionDataResult, s?: MoatSpell): void {
  const box = $('fac-moat-spells');
  const row = document.createElement('div');
  row.className = 'on-row fc-moat';
  const spell = document.createElement('select');
  spell.className = 'moat-spell';
  fillSelect(spell, data.spells.map((x) => ({ id: x.id, label: x.name ? `${x.name} (${x.id})` : x.id })), s?.spell ?? data.spells[0]?.id ?? '');
  const chance = document.createElement('input');
  chance.type = 'number'; chance.min = '0'; chance.max = '100'; chance.className = 'moat-chance narrow'; chance.title = 'chance, percent';
  chance.value = String(s?.chance ?? 100);
  const mastery = document.createElement('select');
  mastery.className = 'moat-mastery narrow';
  fillSelect(mastery, data.masteries.map((m) => ({ id: m, label: m.replace('MASTERY_', '').toLowerCase() })), s?.mastery ?? 'MASTERY_BASIC');
  const power = document.createElement('input');
  power.type = 'number'; power.min = '0'; power.className = 'moat-power narrow'; power.title = 'spell power';
  power.value = String(s?.power ?? 1);
  const drop = document.createElement('button');
  drop.className = 'um-recolor'; drop.textContent = '×'; drop.title = 'remove';
  drop.onclick = () => row.remove();
  row.append(spell, chance, mastery, power, drop);
  box.appendChild(row);
}

function readMoat(): { damage?: number; spells?: MoatSpell[] } | undefined {
  const out: { damage?: number; spells?: MoatSpell[] } = {};
  const damage = $input('fac-moat-damage').value.trim();
  if (damage !== '') out.damage = Number(damage);
  const spells: MoatSpell[] = [];
  for (const row of document.querySelectorAll<HTMLElement>('.fc-moat')) {
    spells.push({
      spell: row.querySelector<HTMLSelectElement>('.moat-spell')!.value,
      chance: Number(row.querySelector<HTMLInputElement>('.moat-chance')!.value) || 0,
      mastery: row.querySelector<HTMLSelectElement>('.moat-mastery')!.value as MoatSpell['mastery'],
      power: Number(row.querySelector<HTMLInputElement>('.moat-power')!.value) || 0,
    });
  }
  if (spells.length) out.spells = spells;
  return Object.keys(out).length ? out : undefined;
}

function readIcons(): ModsFactionPayload['icons'] {
  if (!$input('fac-icons').checked) return undefined;
  const rgba = (id: string): [number, number, number, number] => {
    const v = $input(id).value.replace('#', '');
    return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16), 255];
  };
  return { field: rgba('fac-icon-field'), rim: rgba('fac-icon-rim'), ink: rgba('fac-icon-ink'), accent: rgba('fac-icon-accent') };
}

// --- the named towns ----------------------------------------------------------

function drawTowns(data: ModsFactionDataResult, current: ModsFactionPayload['towns']): void {
  const box = $('fac-towns');
  box.innerHTML = '';
  for (const t of current) addTownRow(data, t);
}

function addTownRow(data: ModsFactionDataResult, t?: ModsFactionPayload['towns'][number]): void {
  const box = $('fac-towns');
  const row = document.createElement('div');
  row.className = 'on-row fc-town-row';
  const file = document.createElement('input');
  file.type = 'text'; file.className = 'town-file narrow'; file.placeholder = 'id'; file.spellcheck = false; file.title = 'identifier: letters and digits';
  file.value = t?.file ?? '';
  const name = document.createElement('input');
  name.type = 'text'; name.className = 'town-name'; name.placeholder = 'name'; name.value = t?.name ?? '';
  const bio = document.createElement('input');
  bio.type = 'text'; bio.className = 'town-bio'; bio.placeholder = 'history'; bio.value = t?.biography ?? '';
  const bonusText = document.createElement('input');
  bonusText.type = 'text'; bonusText.className = 'town-bonus-text'; bonusText.placeholder = 'the bonus, in words (optional)'; bonusText.value = t?.bonusText ?? '';
  const bonus = document.createElement('select');
  bonus.className = 'town-bonus';
  fillSelect(bonus, data.bonuses.map((b) => ({ id: b, label: b.replace('TOWN_BONUS_', '').replace('TOWN_', '').toLowerCase() })), t?.bonus ?? 'TOWN_NO_BONUS');
  const scripted = document.createElement('input');
  scripted.type = 'checkbox'; scripted.className = 'town-scripted'; scripted.title = 'for scripted maps only — never drawn for a random town';
  scripted.checked = !!t?.scripted;
  const drop = document.createElement('button');
  drop.className = 'um-recolor'; drop.textContent = '×'; drop.title = 'remove';
  drop.onclick = () => { row.remove(); formGate().check(); };
  row.append(file, name, bio, bonus, bonusText, scripted, drop);
  box.appendChild(row);
  formGate().rewatch();
}

function readTowns(): ModsFactionPayload['towns'] {
  const out: ModsFactionPayload['towns'] = [];
  for (const row of document.querySelectorAll<HTMLElement>('.fc-town-row')) {
    const scripted = row.querySelector<HTMLInputElement>('.town-scripted')!.checked;
    const bonusText = row.querySelector<HTMLInputElement>('.town-bonus-text')!.value.trim();
    out.push({
      file: row.querySelector<HTMLInputElement>('.town-file')!.value.trim(),
      name: row.querySelector<HTMLInputElement>('.town-name')!.value.trim(),
      biography: row.querySelector<HTMLInputElement>('.town-bio')!.value,
      bonus: row.querySelector<HTMLSelectElement>('.town-bonus')!.value,
      ...(bonusText ? { bonusText } : {}),
      ...(scripted ? { scripted: true } : {}),
    });
  }
  return out;
}

// --- the grid -----------------------------------------------------------------

/**
 * The buildings as the faction has them: the donor's, with a type taken from
 * another town replaced by that town's records of it.
 */
function effectiveBuildings(): TreeBuilding[] {
  if (!tree) return [];
  const out: TreeBuilding[] = [];
  const replaced = new Set<string>();
  for (const [key, edit] of Object.entries(edits)) {
    if (edit?.from && edit.from !== tree.type) replaced.add(parseKey(key).type);
  }
  for (const b of tree.buildings) if (!replaced.has(b.type)) out.push(b);
  for (const type of replaced) {
    const from = edits[type]?.from;
    const theirs = from ? trees.get(from) : null;
    if (theirs) out.push(...theirs.buildings.filter((b) => b.type === type));
  }
  return out;
}

/** Where a level stands: the edit's cell, else the tree's. */
const cellOf = (b: TreeBuilding): { x: number; y: number } | null => edits[b.key]?.slot ?? b.cell;

/** Whether a key is dropped: its own edit is null, or a lower level's is. */
function isDropped(key: BuildingKey): boolean {
  const { type, level } = parseKey(key);
  for (let l = 1; l <= level; l++) if (edits[keyOf(type, l)] === null) return true;
  return false;
}

/**
 * The thirty cells, made once and redrawn in place; a cell is picked on
 * MOUSEDOWN, not click.
 *
 * Because a redraw can happen inside the press: a field of the editor is
 * being typed into, the press on a cell blurs it, its `change` lands the edit
 * and redraws — and Chromium fires no click when the node the press began on
 * is gone by the time it ends. Mousedown is dispatched before the blur that
 * is its default action, so the pick lands first, whatever the blur does. The
 * editor's text fields store on `input` for the same reason: an edit that
 * waited for `change` could be lost with the field the press removes.
 */
function gridCells(): HTMLElement[] {
  const grid = $('fac-grid');
  if (grid.children.length !== COLUMNS * ROWS) {
    grid.innerHTML = '';
    for (let y = 1; y <= ROWS; y++) {
      for (let x = 1; x <= COLUMNS; x++) {
        const cell = document.createElement('div');
        cell.className = 'fc-cell';
        cell.dataset.x = String(x);
        cell.dataset.y = String(y);
        cell.onmousedown = () => {
          if (!tree) return;
          const here = effectiveBuildings().filter((b) => { const c = cellOf(b); return c?.x === x && c?.y === y; }).sort((a, b) => a.level - b.level);
          picked = { x, y, key: here[0]?.key ?? null };
          drawGrid();
          drawCellEditor();
        };
        grid.appendChild(cell);
      }
    }
  }
  return [...grid.children] as HTMLElement[];
}

function drawGrid(): void {
  const all = effectiveBuildings();
  for (const cell of gridCells()) {
    const x = Number(cell.dataset.x), y = Number(cell.dataset.y);
    const here = all.filter((b) => { const c = cellOf(b); return c?.x === x && c?.y === y; });
    cell.className = 'fc-cell';
    cell.innerHTML = '';
    if (picked?.x === x && picked?.y === y) cell.classList.add('on');
    if (!here.length) {
      cell.classList.add('empty');
      cell.textContent = tree ? '+' : '';
      cell.title = tree ? 'empty — click to put a building here' : 'fill from the donor first';
      continue;
    }
    // The lowest level here names the cell; the rest are its stack.
    here.sort((a, b) => a.level - b.level);
    const first = here[0]!;
    const edit = edits[first.key];
    const type = document.createElement('div');
    type.className = 'fc-type';
    type.textContent = first.type.replace('TB_', '');
    const name = document.createElement('div');
    name.className = 'fc-name';
    name.textContent = edit?.name ?? first.name ?? first.type;
    const levels = document.createElement('div');
    levels.className = 'fc-levels';
    for (const b of here) {
      const i = document.createElement('i');
      i.textContent = String(b.level);
      if (edits[b.key] !== undefined) i.classList.add('edited');
      if (isDropped(b.key)) i.style.textDecoration = 'line-through';
      levels.appendChild(i);
    }
    cell.append(type, name, levels);
    if (here.every((b) => isDropped(b.key))) cell.classList.add('dropped');
    if (edits[first.type]?.from) cell.classList.add('from');
    const requires = edit?.requires ?? first.requires;
    if (requires.length) {
      const arrow = document.createElement('span');
      arrow.className = 'fc-arrow';
      arrow.textContent = '↑';
      arrow.title = `needs ${requires.join(', ')}`;
      cell.appendChild(arrow);
    }
    cell.title = here.map((b) => `${b.key}: ${edits[b.key]?.name ?? b.name}`).join(NL);
  }
}

/** The keys a building at (x, y) may depend on: cells above in the column with nothing between. */
function dependableFrom(x: number, y: number, self: string): BuildingKey[] {
  const all = effectiveBuildings();
  const out: BuildingKey[] = [];
  for (let yy = y - 1; yy >= 1; yy--) {
    const there = all.filter((b) => { const c = cellOf(b); return c?.x === x && c?.y === yy && b.type !== self && !isDropped(b.key); });
    if (there.length) { out.push(...there.map((b) => b.key)); break; }
  }
  return out;
}

/** The editor beside the grid: the cell's building, level by level. */
function drawCellEditor(): void {
  const box = $('fac-cell');
  box.innerHTML = '';
  if (!picked || !tree) {
    box.innerHTML = '<div class="um-empty">no cell chosen</div>';
    return;
  }
  const { x, y } = picked;
  const all = effectiveBuildings();
  const here = all.filter((b) => { const c = cellOf(b); return c?.x === x && c?.y === y; }).sort((a, b) => a.level - b.level);
  const head = document.createElement('div');
  head.className = 'um-note';
  head.textContent = `cell ${x},${y}`;
  box.appendChild(head);

  if (!here.length) {
    // An empty cell: a building the donor has can be MOVED here (a level of
    // it, or the whole stack); one it has not is TAKEN from another town.
    const row = document.createElement('div');
    row.className = 'on-row';
    const label = document.createElement('span');
    label.textContent = 'Put here';
    const sel = document.createElement('select');
    const choices: { id: string; label: string }[] = [];
    for (const b of all) choices.push({ id: `move:${b.key}`, label: `move ${b.key} (${edits[b.key]?.name ?? b.name})` });
    const have = new Set(all.map((b) => b.type));
    for (const t of facData?.buildingTypes ?? []) if (!have.has(t)) choices.push({ id: `take:${t}`, label: `take ${t} from another town…` });
    fillSelect(sel, [{ id: '', label: '—' }, ...choices], '');
    sel.onchange = () => {
      const [what, key] = sel.value.split(':') as [string, string];
      if (what === 'move') {
        setEdit(key, { slot: { x, y } });
        picked = { x, y, key };
      } else if (what === 'take') {
        const from = $select('fac-donor').value === 'TOWN_HEAVEN' ? 'TOWN_STRONGHOLD' : 'TOWN_HEAVEN';
        setEdit(key, { from, slot: { x, y } });
        picked = { x, y, key };
        void ensureTree(from).then(() => { drawGrid(); drawCellEditor(); });
      }
      drawGrid();
      drawCellEditor();
    };
    row.append(label, sel);
    box.appendChild(row);
    return;
  }

  const current = here.find((b) => b.key === picked!.key) ?? here[0]!;
  picked.key = current.key;
  // The levels here, as tabs; a level of the type standing elsewhere is listed too, greyed.
  const tabs = document.createElement('div');
  tabs.className = 'fc-level-tabs';
  for (const b of all.filter((b) => b.type === current.type).sort((a, b) => a.level - b.level)) {
    const tab = document.createElement('button');
    tab.className = 'ghost' + (b.key === current.key ? ' on' : '');
    const c = cellOf(b);
    tab.textContent = `level ${b.level}${c && (c.x !== x || c.y !== y) ? ` (at ${c.x},${c.y})` : ''}`;
    tab.onclick = () => { picked = { x: c?.x ?? x, y: c?.y ?? y, key: b.key }; drawGrid(); drawCellEditor(); };
    tabs.appendChild(tab);
  }
  box.appendChild(tabs);

  const edit = edits[current.key] ?? {};
  const dropped = isDropped(current.key);
  const put = (patch: Partial<BuildingEdit>): void => { setEdit(current.key, patch); drawGrid(); };
  const textRow = (label: string, value: string | undefined, donor: string, on: (v: string) => void, multi = false): void => {
    const row = document.createElement('label');
    row.className = 'on-row';
    const l = document.createElement('span');
    l.textContent = label;
    const input = multi ? document.createElement('textarea') : document.createElement('input');
    if (input instanceof HTMLInputElement) { input.type = 'text'; input.spellcheck = false; }
    input.placeholder = donor;
    input.value = value ?? '';
    input.title = `blank keeps the donor's: ${donor}`;
    input.oninput = () => on(input.value);
    row.append(l, input);
    box.appendChild(row);
  };

  const status = document.createElement('div');
  status.className = 'um-note';
  status.textContent = `${current.key} — ${current.type}${edits[current.type]?.from ? `, taken from ${edits[current.type]!.from}` : ''}${dropped ? ' — DROPPED' : ''}`;
  box.appendChild(status);

  const actions = document.createElement('div');
  actions.className = 'fc-level-tabs';
  const dropBtn = document.createElement('button');
  dropBtn.className = 'ghost';
  dropBtn.textContent = dropped ? 'keep it' : (current.level === 1 ? 'drop the building' : `drop level ${current.level} and above`);
  dropBtn.title = 'a dropped building is never copied: no record, no text, no icon, no cell';
  dropBtn.onclick = () => {
    if (dropped) {
      const { type, level } = parseKey(current.key);
      for (let l = 1; l <= level; l++) if (edits[keyOf(type, l)] === null) delete edits[keyOf(type, l)];
    } else {
      edits[current.key] = null;
    }
    drawGrid();
    drawCellEditor();
    formGate().check();
  };
  actions.appendChild(dropBtn);
  const reset = document.createElement('button');
  reset.className = 'ghost';
  reset.textContent = 'donor\'s';
  reset.title = 'forget every edit of this level';
  reset.onclick = () => { delete edits[current.key]; drawGrid(); drawCellEditor(); formGate().check(); };
  actions.appendChild(reset);
  box.appendChild(actions);
  if (dropped) return;

  // Where it stands, and what it takes to build.
  {
    const row = document.createElement('div');
    row.className = 'on-row';
    const l = document.createElement('span');
    l.textContent = 'Cell';
    const cx = document.createElement('input');
    cx.type = 'number'; cx.min = '1'; cx.max = String(COLUMNS); cx.value = String(x); cx.className = 'narrow';
    const cy = document.createElement('input');
    cy.type = 'number'; cy.min = '1'; cy.max = String(ROWS); cy.value = String(y); cy.className = 'narrow';
    const move = (): void => {
      const to = { x: Number(cx.value), y: Number(cy.value) };
      if (to.x < 1 || to.x > COLUMNS || to.y < 1 || to.y > ROWS) return;
      const taken = all.find((b) => b.type !== current.type && !isDropped(b.key) && cellOf(b)?.x === to.x && cellOf(b)?.y === to.y);
      if (taken) { $('fac-form-err').textContent = `cell ${to.x},${to.y} holds ${taken.key}`; return; }
      $('fac-form-err').textContent = '';
      put(current.cell?.x === to.x && current.cell?.y === to.y ? { slot: undefined } : { slot: to });
      picked = { ...to, key: current.key };
      drawCellEditor();
    };
    cx.onchange = move;
    cy.onchange = move;
    row.append(l, cx, cy);
    box.appendChild(row);
  }
  {
    const row = document.createElement('div');
    row.className = 'on-row';
    const l = document.createElement('span');
    l.textContent = 'Needs';
    const sel = document.createElement('select');
    const options = dependableFrom(x, y, current.type);
    const value = edit.requires ?? current.requires;
    // The donor's own dependency may stand elsewhere; it is offered as it is.
    for (const v of value) if (!options.includes(v)) options.push(v);
    const same = all.filter((b) => b.type === current.type && b.level === current.level - 1).map((b) => b.key);
    fillSelect(sel, [{ id: '', label: 'nothing' }, ...options.map((k) => ({ id: k, label: k }))], value.filter((v) => !same.includes(v))[0] ?? '');
    sel.title = 'what has to stand first: the cell above in the same column with nothing between; a level always needs the one below it';
    sel.onchange = () => {
      const keep = current.level > 1 ? same : [];
      put({ requires: sel.value ? [...keep, sel.value] : keep });
    };
    row.append(l, sel);
    box.appendChild(row);
  }
  textRow('Name', edit.name, current.name, (v) => put({ name: v || undefined }));
  box.appendChild(fileRow('Icon', pictures.buildings[current.key] ?? '', 'picture', (v) => {
    if (v) pictures.buildings[current.key] = v; else delete pictures.buildings[current.key];
    formGate().check();
  }, "a picture of yours for this level's icon on the build screen, 128×128; blank is the theme's, or the donor's"));
  textRow('Description', edit.description, current.description, (v) => put({ description: v || undefined }), true);
  {
    const row = document.createElement('div');
    row.className = 'on-row';
    const l = document.createElement('span');
    l.textContent = 'Cost';
    const res = document.createElement('div');
    res.className = 'fc-resources';
    for (const r of RESOURCES) {
      const label = document.createElement('label');
      label.textContent = r;
      const input = document.createElement('input');
      input.type = 'number'; input.min = '0';
      input.placeholder = String(current.cost[r]);
      input.value = edit.cost?.[r] === undefined ? '' : String(edit.cost[r]);
      input.oninput = () => {
        const cost = { ...(edits[current.key]?.cost ?? {}) };
        if (input.value.trim() === '') delete cost[r]; else cost[r] = Number(input.value);
        put({ cost: Object.keys(cost).length ? cost : undefined });
      };
      label.appendChild(input);
      res.appendChild(label);
    }
    row.append(l, res);
    box.appendChild(row);
  }
  {
    const row = document.createElement('label');
    row.className = 'on-row';
    const l = document.createElement('span');
    l.textContent = 'Town level';
    const sel = document.createElement('select');
    fillSelect(sel, [{ id: '', label: `the donor's (${current.devLevel})` }, ...[0, 3, 6, 9, 12, 15].map((n) => ({ id: String(n), label: String(n) }))], edit.devLevel === undefined ? '' : String(edit.devLevel));
    sel.onchange = () => put({ devLevel: sel.value === '' ? undefined : Number(sel.value) });
    row.append(l, sel);
    box.appendChild(row);
  }
  if (current.level === 1) {
    {
      const row = document.createElement('label');
      row.className = 'on-row';
      const l = document.createElement('span');
      l.textContent = 'Take from';
      const sel = document.createElement('select');
      fillSelect(sel, townOptions(facData!, 'the donor'), edits[current.type]?.from ?? '');
      sel.title = 'the whole building — every level, its cell, its effect — from another shipped town';
      sel.onchange = () => {
        setEdit(current.type, { from: sel.value || undefined });
        if (sel.value) void ensureTree(sel.value).then(() => { drawGrid(); drawCellEditor(); });
        drawGrid();
      };
      row.append(l, sel);
      box.appendChild(row);
    }
    {
      // The model: a path in the game's data, or a file of our own on disk —
      // the same field, the same copy; only where it is read from differs.
      const sel = document.createElement('select');
      const coords: HTMLInputElement[] = [];
      const setModel = (v: string): void => {
        const was = edits[current.key]?.model;
        put({ model: v ? { source: v, ...(was?.place ? { place: was.place } : was?.at ? { at: was.at } : {}) } : undefined });
        sel.disabled = !v;
        for (const c of coords) c.disabled = !v || !!sel.value;
      };
      const row = document.createElement('label');
      row.className = 'on-row';
      const l = document.createElement('span');
      l.textContent = 'Model';
      const input = document.createElement('input');
      input.type = 'text';
      input.spellcheck = false;
      input.className = 'fc-model';
      input.placeholder = "the donor's model";
      input.title = "a Model document: a path in the game's data (Arenas/Town/…/X.xdb), or a file of your own on disk — blank keeps the donor's";
      input.value = edit.model?.source ?? '';
      input.oninput = () => setModel(input.value);
      const pick = document.createElement('button');
      pick.className = 'ghost he-file';
      pick.textContent = 'file…';
      pick.title = 'a Model document of your own on disk; its folder is read as a data root (geometry beside it, binaries under bin/)';
      pick.onclick = (ev) => {
        ev.preventDefault();
        void api.pickFactionFile('model').then((path) => { if (path) { input.value = path; setModel(path); } });
      };
      row.append(l, input, pick);
      box.appendChild(row);
      // Where it stands: on a dropped building's spot (its camera and pick
      // hull reused), or at a point of the scene outright. Drawn with the
      // model row and enabled by it, so typing a model never redraws the
      // editor under the typing.
      {
        const where = document.createElement('div');
        where.className = 'on-row';
        const wl = document.createElement('span');
        wl.textContent = 'Stands';
        sel.className = 'fc-model-place';
        const droppedTypes = [...new Set(all.filter((b) => b.level === 1 && isDropped(b.key)).map((b) => b.type))];
        fillSelect(sel, [{ id: '', label: 'at a point (x, y, z)' }, ...droppedTypes.map((t) => ({ id: t, label: `where ${t} stood` }))], edit.model?.place ?? '');
        sel.disabled = !edit.model;
        sel.title = "a dropped building leaves its spot, camera and pick hull; a point is in the scene's own units";
        for (const axis of ['x', 'y', 'z'] as const) {
          const c = document.createElement('input');
          c.type = 'number';
          c.className = 'narrow fc-model-at';
          c.placeholder = axis;
          c.value = edit.model?.at ? String(edit.model.at[axis]) : '';
          coords.push(c);
        }
        const place = (): void => {
          const source = edits[current.key]?.model?.source;
          if (!source) return;
          if (sel.value) put({ model: { source, place: sel.value } });
          else {
            const [x, y, z] = coords.map((c) => Number(c.value) || 0) as [number, number, number];
            put({ model: { source, at: { x, y, z } } });
          }
          for (const c of coords) c.disabled = !!sel.value;
        };
        sel.onchange = () => { place(); drawCellEditor(); };
        for (const c of coords) { c.oninput = place; c.disabled = !edit.model || !!sel.value; }
        where.append(wl, sel, ...coords);
        box.appendChild(where);
      }
    }
    textRow('Button → Lua', edit.button?.lua, 'no button', (v) => put({ button: v ? { lua: v } : undefined }));
  }
  const violated = (edit.requires ?? current.requires).filter((k) => !dependableFrom(x, y, current.type).includes(k) && !all.some((b) => b.type === current.type && b.key === k));
  if (violated.length) {
    const warn = document.createElement('div');
    warn.className = 'um-note';
    warn.style.color = '#d29922';
    warn.textContent = `needs ${violated.join(', ')}, which is not in the cell above with nothing between — the screen draws no arrow for it`;
    box.appendChild(warn);
  }
}

/** Set fields of a level's edit; an edit left with nothing in it is forgotten. */
function setEdit(key: BuildingKey, patch: Partial<BuildingEdit>): void {
  const was = edits[key] ?? {};
  const next: Record<string, unknown> = { ...(was ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete next[k]; else next[k] = v;
  }
  if (Object.keys(next).length) edits[key] = next as BuildingEdit; else delete edits[key];
  formGate().check();
}

async function ensureTree(type: string): Promise<void> {
  if (trees.has(type)) return;
  trees.set(type, await api.factionTree(type));
}

/** Load the donor's tree onto the grid. `keep` keeps the edits — an existing faction's. */
async function loadTree(donor: string, keep: boolean): Promise<void> {
  $('fac-form-err').textContent = '';
  if (!keep && Object.keys(edits).length && !await ask('Filling from the donor forgets every building edit made so far. Fill anyway?', 'Fill')) return;
  try {
    tree = await api.factionTree(donor);
    if (!keep) edits = {};
    for (const edit of Object.values(edits)) if (edit?.from) await ensureTree(edit.from);
    picked = null;
    $('fac-donor-note').textContent = `${tree.buildings.length} building records of ${donor} on the grid`;
    drawGrid();
    drawCellEditor();
    formGate().check();
  } catch (e) {
    $('fac-form-err').textContent = e instanceof Error ? e.message : String(e);
  }
}

// --- the gate and the save ------------------------------------------------------

let gate: { check: () => void; rewatch: () => void } | null = null;
const formGate = (): { check: () => void; rewatch: () => void } => (gate ??= requireFilled({
  ok: 'fac-ok',
  missing: 'fac-missing',
  fields: { identifier: 'fac-file', race: 'fac-race-name', 'town name': 'fac-name' },
  extra: () => {
    const missing: string[] = [];
    if (!tree) missing.push('the donor\'s tree (Fill from donor)');
    const towns = readTowns();
    if (!towns.length) missing.push('a named town');
    if (towns.some((t) => !t.file || !t.name)) missing.push('every named town\'s id and name');
    // The dial's button is drawn in the theme: no theme, no skins to draw it with.
    if (Object.values(edits).some((e) => e?.button) && !$input('fac-icons').checked && !(pictures.button as Record<string, string> | undefined)?.normal) missing.push("the icon theme, or pictures for the button (its skins are drawn in the theme)");
    missing.push(...readSiegeOwn().problems);
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test($input('fac-file').value.trim()) && $input('fac-file').value.trim()) missing.push('an identifier of letters and digits');
    return missing;
  },
  watch: '#facedit .town-file, #facedit .town-name, #fac-icons',
}));
const watchForm = (): void => { formGate().rewatch(); };

function readPayload(): ModsFactionPayload {
  const file = $input('fac-file').value.trim();
  const magic = $select('fac-magic').value as 'guild' | 'none';
  const race: NonNullable<ModsFactionPayload['race']> = { name: $input('fac-race-name').value.trim() };
  if ($input('fac-race-tooltip').value.trim()) race.tooltip = $input('fac-race-tooltip').value.trim();
  const silo = readSilo();
  if (silo) race.siloIncome = silo;
  if ($select('fac-machine').value) race.warMachine = $select('fac-machine').value;
  if ($select('fac-music').value) race.music = $select('fac-music').value;
  const moat = readMoat();
  if (moat) race.moat = moat;
  const own = readTracks();
  if (own) race.tracks = own;
  const ownSounds = readSounds();
  if (ownSounds) race.sounds = ownSounds;
  const p: ModsFactionPayload = {
    file,
    type: townTypeFor(file),
    donor: $select('fac-donor').value,
    name: $input('fac-name').value.trim(),
    race,
    towns: readTowns(),
    buildings: edits,
  };
  if (magic === 'none') p.magic = 'none';
  else p.magicSchools = [$select('fac-school-1').value, $select('fac-school-2').value];
  const dwellings = readDwellings();
  if (dwellings) p.dwellings = dwellings;
  if ($select('fac-shooter').value) p.shooter = $select('fac-shooter').value;
  const siege = readSiege();
  if (siege) p.siege = siege;
  const exterior = readExterior();
  if (exterior) p.exterior = exterior;
  const icons = readIcons();
  if (icons) p.icons = icons;
  const pics = readPictures();
  if (pics) p.pictures = pics;
  const script = (document.getElementById('fac-script') as HTMLTextAreaElement).value;
  if (script.trim()) p.script = script;
  const alignment = $select('fac-alignment').value;
  if (alignment === 'good' || alignment === 'evil') p.alignment = alignment;
  const mapDwellings = [...$select('fac-map-dwellings').selectedOptions].map((o) => o.value);
  if (mapDwellings.length) p.mapDwellings = mapDwellings;
  const ai: FactionAi = {};
  if ($select('fac-ai-like').value) ai.skillsLike = $select('fac-ai-like').value;
  if (keptSkillValues && Object.keys(keptSkillValues).length) ai.skillValues = keptSkillValues;
  if (ai.skillsLike || ai.skillValues) p.ai = ai;
  return p;
}

async function submitFaction(): Promise<void> {
  const ok = $button('fac-ok');
  ok.disabled = true;
  $('fac-form-err').textContent = '';
  $('fac-note').textContent = '';
  try {
    const payload = readPayload();
    const send = editingFile ? api.updateFaction : api.installFaction;
    const res = await send(payload);
    $('fac-note').textContent = `installed ${res.archive}${NL}${res.type} = ${res.number}; ${res.exe}`;
    await refreshFactions();
    modDialog('facedit').close();
  } catch (e) {
    $('fac-form-err').textContent = e instanceof Error ? e.message : String(e);
  } finally {
    ok.disabled = false;
  }
}

/** Bind the window to its markup. Called once, at start-up. */
export function initFactionsMod(): void {
  $('facbtn').onclick = () => {
    void openFactions().catch((e: unknown) => {
      $('fac-err').textContent = e instanceof Error ? e.message : String(e);
    });
  };
  $('fac-close').onclick = () => modDialog('facmod').close();
  $('fac-cancel').onclick = () => modDialog('facmod').close();
  $('facedit-x').onclick = () => modDialog('facedit').close();
  $('fac-form-cancel').onclick = () => modDialog('facedit').close();
  $('fac-new').onclick = () => {
    void openFactionForm(null).catch((e: unknown) => {
      $('fac-err').textContent = e instanceof Error ? e.message : String(e);
    });
  };
  $('fac-ok').onclick = () => { void submitFaction(); };
  $('fac-fill').onclick = () => { void loadTree($select('fac-donor').value, false); };
  $('fac-magic').onchange = showSchools;
  // A listener, not `oninput`: the form gate binds `oninput` on the fields it
  // watches (form-gate.ts), and the identifier is one of them.
  $('fac-file').addEventListener('input', () => { $input('fac-type').value = $input('fac-file').value.trim() ? townTypeFor($input('fac-file').value) : ''; });
  $('fac-town-add').onclick = () => { if (facData) addTownRow(facData); };
  $('fac-exterior-gates-file').addEventListener('input', () => {
    const own = !!$input('fac-exterior-gates-file').value.trim();
    $select('fac-exterior-gates').disabled = own;
    if (own) $select('fac-exterior-gates').value = '';
  });
  $('fac-exterior-gates-pick').onclick = (ev) => {
    ev.preventDefault();
    void api.pickFactionFile('model').then((path) => {
      if (!path) return;
      $input('fac-exterior-gates-file').value = path;
      $input('fac-exterior-gates-file').dispatchEvent(new Event('input'));
    });
  };
  $('fac-moat-add').onclick = () => { if (facData) addMoatSpellRow(facData); };
}
