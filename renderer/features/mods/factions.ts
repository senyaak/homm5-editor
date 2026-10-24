// The Factions window: a town type of our own.
//
// A faction is most of what the mod already knows how to make — creatures,
// heroes, classes — gathered under one type, plus the town: a shipped one
// copied and made ours. The DONOR is the town's base — its screen, exterior,
// siege — and everything there is the donor's until said otherwise.
//
// The building TREE is the author's and starts empty (Senya, 2026-10-25): a
// building stands in it because it was put there, as a building of one of
// the eight towns (`from`), into a cell of a grid drawn like the game's own
// build screen (five by six; one building per cell; its upgrade levels
// stacked on it unless a level is given a cell of its own; a dependency an
// arrow from the cell above in the same column). A PRESET puts a town's
// whole tree. Every field of a building shows what it is — the record's
// value until changed, as a preset fills a creature's form — and the
// manifest keeps what differs (`BuildingEdit` per level), which is what the
// copier applies (src/mods/town-files.ts, `tree: 'empty'`).
//
// What the form offers is read from the main process through
// mods:faction-data — the eight donors, the enums, the mod's own creatures —
// not written out here.

import { $, $button, $input, $select, fillSelect } from '#core/dom.ts';
import { ask, modDialog, openOnTop } from '#core/dialog.ts';
import { api } from '#core/ipc.ts';
import { requireFilled } from '#core/form-gate.ts';
import { modRow, NL } from '#features/mods/shared.ts';
import { startWarning } from '#src/mods/faction-ready.ts';
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
/** The three roles a skill is valued by, in the order the record and the `skillvalue` line hold them. */
const AI_ROLES: readonly { key: keyof SkillValues; label: string; title: string }[] = [
  { key: 'commander', label: 'commander', title: 'a hero that fights' },
  { key: 'collectorSupplier', label: 'collector', title: 'a hero that gathers and supplies' },
  { key: 'freelancer', label: 'freelancer', title: 'a hero that roams' },
];
/** The donor's tree — the base's, whose buildings a model of ours can stand in place of. */
let tree: FactionTreeDTO | null = null;
/** The eight towns' trees, by type: what a building is put from. Loaded when the form opens. */
const trees = new Map<string, FactionTreeDTO>();
/**
 * The tree, by key — the copier's `buildings`: a building is in it when its
 * first level names its town (`from`); the rest of an edit is what differs
 * from that town's record. A level dropped is `null`.
 */
let edits: Record<BuildingKey, BuildingEdit | null> = {};
/** A building taken out this session, by type: its first level's edit as it was, so "keep it" puts it back as it stood. */
let takenOut: Record<string, BuildingEdit> = {};
/** The town an empty cell's "Put here" last offered, so the next cell offers it again. */
let putTown = '';
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
    if (k === 'buildings') {
      // Only the levels the tree holds: a picture of a building taken out goes with it.
      const standing = new Set(effectiveBuildings().filter((b) => !isDropped(b.key)).map((b) => b.key));
      const kept = Object.fromEntries(Object.entries(pictures.buildings).filter(([key]) => standing.has(key)));
      if (Object.keys(kept).length) out.buildings = kept;
      continue;
    }
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
  const creatures = mods.flatMap((m) => m.creatures);
  for (const m of mods) {
    for (const f of m.factions ?? []) {
      n++;
      list.appendChild(modRow({
        number: f.number, label: `${f.race?.name || f.file} — ${f.name}`, note: `${f.type}, from ${f.donor}, ${f.towns.length} town(s)`,
        onEdit: () => { void openFactionForm(f); },
        onRemove: () => { void removeFaction(f); },
      }));
      // Under its row, while it lasts: a race without its first three tiers
      // installs fine and crashes the game that plays it.
      const warning = startWarning(f.type, creatures);
      if (warning) {
        const line = document.createElement('div');
        line.className = 'um-warn fac-start-warn';
        line.textContent = `${f.race?.name || f.file}: ${warning}`;
        list.appendChild(line);
      }
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
  takenOut = {};
  putTown = '';
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
  fillSelect($select('fac-preset'), data.donors.map((d) => ({ id: d.type, label: d.label })), existing?.donor ?? data.donors[0]!.type);
  $('fac-preset-note').textContent = existing ? '' : 'the tree is empty — put buildings in its cells, or load a town\'s whole tree';
  $select('fac-magic').value = existing?.magic ?? 'guild';
  fillSelect($select('fac-school-1'), SCHOOLS.map((s) => ({ id: s, label: s.replace('MAGIC_SCHOOL_', '').toLowerCase() })), existing?.magicSchools?.[0] ?? SCHOOLS[2]!);
  fillSelect($select('fac-school-2'), SCHOOLS.map((s) => ({ id: s, label: s.replace('MAGIC_SCHOOL_', '').toLowerCase() })), existing?.magicSchools?.[1] ?? SCHOOLS[1]!);
  showSchools();
  $select('fac-alignment').value = existing?.alignment ?? '';
  fillSelect($select('fac-ai-like'), [{ id: '', label: 'nobody — a blank row is worth nothing' }, ...data.donors.map((d) => ({ id: d.type, label: `${d.label}'s` }))], existing?.ai?.skillsLike ?? '');
  fillSelect($select('fac-ai-fill-from'), data.donors.map((d) => ({ id: d.type, label: d.label })), existing?.ai?.skillsLike || existing?.donor || data.donors[0]!.type);
  drawSkillValues(data, existing?.ai?.skillValues ?? {});
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
  // A whole exterior is its ten stages, its gate and its ground, said in the
  // rows as a preset says them (see the Exterior select's handler).
  const whole = typeof existing?.exterior === 'string' ? existing.exterior : '';
  const exterior: ExteriorMix = whole
    ? { stages: Object.fromEntries(data.exteriorStages.map((s) => [s, whole])), gates: whole, ground: whole }
    : (existing?.exterior as ExteriorMix | undefined) ?? { stages: {} };
  fillSelect($select('fac-exterior'), townOptions(data, 'the donor\'s'), whole);
  {
    const gates = exterior.gates ?? '';
    const own = /^[A-Za-z]:[\\/]|^[\\/]{2}/.test(gates);
    fillSelect($select('fac-exterior-gates'), townOptions(data, 'the donor\'s'), own ? '' : gates);
    $input('fac-exterior-gates-file').value = own ? gates : '';
    $select('fac-exterior-gates').disabled = own;
  }
  fillSelect($select('fac-exterior-ground'), townOptions(data, 'the exterior\'s or the gate\'s town'), exterior.ground ?? '');
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
  // The eight trees at once: a building is put from any of them, and an
  // existing faction's grid is drawn from the ones it names.
  try {
    await Promise.all(data.donors.map((d) => ensureTree(d.type)));
    tree = trees.get($select('fac-donor').value) ?? null;
    if (existing && existing.tree !== 'empty') edits = asEmptyTree(edits, existing.donor);
  } catch (e) {
    $('fac-form-err').textContent = e instanceof Error ? e.message : String(e);
  }
  drawGrid();
  drawCellEditor();
  formGate().check();
}

/**
 * A faction saved before the tree started empty — the donor's tree with
 * edits over it — as the tree it was: each donor building not dropped PUT,
 * from the donor, and doing what it did then, which was nothing of its own
 * (a donor's building granted no effect unless told to).
 */
function asEmptyTree(old: Record<BuildingKey, BuildingEdit | null>, donor: string): Record<BuildingKey, BuildingEdit | null> {
  const out: Record<BuildingKey, BuildingEdit | null> = {};
  const base = trees.get(donor)?.buildings ?? [];
  for (const [key, edit] of Object.entries(old)) if (!(parseKey(key).type in old && old[parseKey(key).type] === null)) out[key] = edit;
  for (const type of new Set(base.map((b) => b.type))) {
    const edit = old[type];
    if (edit === null) continue;
    if (edit?.from) continue;
    out[type] = { ...(edit ?? {}), from: donor, ...(edit?.grants === undefined ? { grants: null } : {}) };
  }
  return out;
}

function showSchools(): void {
  $('fac-schools-row').style.display = $select('fac-magic').value === 'guild' ? '' : 'none';
}

/**
 * The AI's skill table: every skill and perk, three numbers each. A blank cell
 * is nothing said; a row with a number in it is said whole, its blanks as
 * zero — the `skillvalue` line takes three numbers or none.
 */
function drawSkillValues(data: ModsFactionDataResult, current: Record<number, SkillValues>): void {
  const table = document.createElement('table');
  const head = table.createTHead().insertRow();
  head.append(Object.assign(document.createElement('th'), { textContent: 'skill' }));
  for (const role of AI_ROLES) head.append(Object.assign(document.createElement('th'), { textContent: role.label, title: role.title, className: 'n' }));
  const body = table.createTBody();
  for (const row of data.skillValues) {
    const tr = body.insertRow();
    tr.dataset.ordinal = String(row.ordinal);
    tr.dataset.text = `${row.name ?? ''} ${row.id}`.toLowerCase();
    if (row.perk) tr.classList.add('perk');
    const skill = tr.insertCell();
    skill.className = 'skill';
    skill.title = `${row.id} — ordinal ${row.ordinal}`;
    skill.append(row.name ?? row.id, Object.assign(document.createElement('small'), { textContent: row.id.replace('HERO_SKILL_', '').toLowerCase() }));
    const said = current[row.ordinal];
    for (const role of AI_ROLES) {
      const td = tr.insertCell();
      td.className = 'n';
      const input = document.createElement('input');
      input.type = 'number';
      input.step = '1';
      input.dataset.role = role.key;
      input.value = said ? String(said[role.key]) : '';
      input.oninput = () => { markSaidRow(tr); countSaidRows(); };
      td.append(input);
    }
    markSaidRow(tr);
  }
  $('fac-ai-table').replaceChildren(table);
  filterSkillRows();
  countSaidRows();
}

/** A row is said when any of its three has a number. */
function markSaidRow(tr: HTMLTableRowElement): void {
  tr.classList.toggle('said', [...tr.querySelectorAll('input')].some((i) => i.value.trim() !== ''));
}

function countSaidRows(): void {
  const rows = $('fac-ai-table').querySelectorAll('tbody tr');
  const said = $('fac-ai-table').querySelectorAll('tbody tr.said').length;
  $('fac-ai-count').textContent = `${said} of ${rows.length} said`;
}

function filterSkillRows(): void {
  const q = $input('fac-ai-filter').value.trim().toLowerCase();
  for (const tr of $('fac-ai-table').querySelectorAll<HTMLTableRowElement>('tbody tr')) {
    tr.classList.toggle('hidden', !!q && !(tr.dataset.text ?? '').includes(q));
  }
}

/** Every row takes the chosen race's three — or blanks, when `town` is empty. */
function fillSkillRows(town: string): void {
  if (!facData) return;
  const byOrdinal = new Map(facData.skillValues.map((r) => [r.ordinal, r.values[town]]));
  for (const tr of $('fac-ai-table').querySelectorAll<HTMLTableRowElement>('tbody tr')) {
    const v = byOrdinal.get(Number(tr.dataset.ordinal));
    for (const input of tr.querySelectorAll('input')) {
      input.value = v ? String(v[input.dataset.role as keyof SkillValues]) : '';
    }
    markSaidRow(tr);
  }
  countSaidRows();
  formGate().check();
}

/** What the table says, by ordinal — said rows only, their blanks as zero. */
function readSkillValues(): Record<number, SkillValues> {
  const out: Record<number, SkillValues> = {};
  for (const tr of $('fac-ai-table').querySelectorAll<HTMLTableRowElement>('tbody tr.said')) {
    const v: SkillValues = { commander: 0, collectorSupplier: 0, freelancer: 0 };
    for (const input of tr.querySelectorAll('input')) v[input.dataset.role as keyof SkillValues] = Math.trunc(Number(input.value) || 0);
    out[Number(tr.dataset.ordinal)] = v;
  }
  return out;
}

/** The three creatures of a tier, as the window offers them. */
const TIER_ROLES = [
  { role: 'base', title: 'the base creature, hired by the dwelling', none: "the donor's" },
  { role: 'upgrade', title: 'its upgrade, hired by the upgraded dwelling', none: "the donor's" },
  // Not the donor's when left empty: a tier of ours with the donor's second
  // upgrade sold Haven's Seraphs in a Necropolis clone (town-files.ts).
  { role: 'alternate', title: 'the second upgrade, hired by the upgraded dwelling beside the first', none: 'none' },
] as const;

/** The seven tiers: base, upgrade and second upgrade, out of the mod's creatures. */
function drawDwellings(data: ModsFactionDataResult, current: NonNullable<ModsFactionPayload['dwellings']>): void {
  const box = $('fac-dwellings');
  box.innerHTML = '';
  const creatures = data.creatures.map((c) => ({ id: c.id, label: c.name ? `${c.name} (${c.id})` : c.id }));
  for (let tier = 1; tier <= 7; tier++) {
    const row = document.createElement('div');
    row.className = 'on-row';
    const label = document.createElement('span');
    label.textContent = `Tier ${tier}`;
    row.append(label);
    for (const { role, title, none } of TIER_ROLES) {
      const sel = document.createElement('select');
      sel.className = 'fc-dwelling';
      sel.dataset.tier = String(tier);
      sel.dataset.role = role;
      sel.title = title;
      fillSelect(sel, [{ id: '', label: none }, ...creatures], current[tier]?.[role] ?? '');
      row.append(sel);
    }
    // A base that names its upgrades (the Units window's links) brings them:
    // the tier is that creature's line, and the two others were the old
    // base's. A base with no links leaves them for the author to choose.
    const [base, upgrade, alternate] = [...row.querySelectorAll<HTMLSelectElement>('select')];
    base!.onchange = () => {
      const links = data.creatures.find((c) => c.id === base!.value)?.upgrades;
      if (!links?.length) return;
      upgrade!.value = links[0]!;
      alternate!.value = links[1] ?? '';
    };
    box.appendChild(row);
  }
}

function readDwellings(): ModsFactionPayload['dwellings'] {
  const out: Record<number, { base: string; upgrade: string; alternate?: string }> = {};
  for (const el of document.querySelectorAll<HTMLSelectElement>('.fc-dwelling')) {
    const tier = Number(el.dataset.tier);
    if (!el.value) continue;
    const t = out[tier] ?? (out[tier] = { base: '', upgrade: '' });
    t[el.dataset.role as 'base' | 'upgrade' | 'alternate'] = el.value;
  }
  // A tier without both of the first two is not a tier: those or the donor's.
  for (const [tier, t] of Object.entries(out)) if (!t.base || !t.upgrade) delete out[Number(tier)];
  return Object.keys(out).length ? out : undefined;
}

/** The ten exterior stages, each a town's (the donor's when blank) or a model of the author's own. */
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
    fillSelect(sel, townOptions(data, 'the donor\'s'), own ? '' : value);
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

/**
 * The Exterior select is a PRESET (Senya, 2026-10-23): it says the ten stage
 * rows, the gate and the ground, all of one town, where they can be seen —
 * and a stage changed afterwards is visibly the difference. A model or a
 * gate of the author's own in a row goes with it; that is what a preset does.
 */
function applyExteriorPreset(town: string): void {
  for (const row of document.querySelectorAll<HTMLElement>('#fac-stages .on-row')) {
    const sel = row.querySelector<HTMLSelectElement>('.fc-stage')!;
    const file = row.querySelector<HTMLInputElement>('.fc-stage-file')!;
    file.value = '';
    sel.dataset.file = '';
    sel.disabled = false;
    sel.value = town;
  }
  $input('fac-exterior-gates-file').value = '';
  $select('fac-exterior-gates').disabled = false;
  $select('fac-exterior-gates').value = town;
  $select('fac-exterior-ground').value = town;
}

/**
 * What the rows say. Every stage, the gate and the ground of one town is that
 * town's whole exterior, said once; nothing said is the donor's; anything
 * else is a mix, its blank rows the donor's.
 */
function readExterior(): ModsFactionPayload['exterior'] {
  const gates = $input('fac-exterior-gates-file').value.trim() || $select('fac-exterior-gates').value;
  const ground = $select('fac-exterior-ground').value;
  const rows = [...document.querySelectorAll<HTMLSelectElement>('.fc-stage')].map((el) => ({ stage: el.dataset.stage!, value: el.dataset.file || el.value }));
  const first = rows[0]?.value ?? '';
  if (first && rows.every((r) => r.value === first) && gates === first && (ground === first || !ground)) return first;
  const stages: Record<string, string> = {};
  for (const r of rows) if (r.value) stages[r.stage] = r.value;
  if (!Object.keys(stages).length && !gates && !ground) return undefined;
  return { stages: stages as ExteriorMix['stages'], ...(gates ? { gates } : {}), ...(ground ? { ground } : {}) };
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

/** The town a type is put from — or was, when it was taken out this session. */
const fromOf = (type: string): string | undefined => edits[type]?.from ?? takenOut[type]?.from;

/**
 * The buildings as the faction has them: each type put, as its town's records
 * of it — and one taken out this session, struck through until saved.
 */
function effectiveBuildings(): TreeBuilding[] {
  const out: TreeBuilding[] = [];
  const types = new Set([...Object.keys(edits).map((k) => parseKey(k).type), ...Object.keys(takenOut)]);
  for (const type of types) {
    const from = fromOf(type);
    const theirs = from ? trees.get(from) : null;
    if (theirs) out.push(...theirs.buildings.filter((b) => b.type === type));
  }
  // As many levels as the author said (`levels`): past the records, the one
  // below again — what the copier makes of it (town-files.ts); fewer, the
  // levels above are not there.
  for (const [key, edit] of Object.entries(edits)) {
    if (!edit?.levels) continue;
    const { type } = parseKey(key);
    const mine = out.filter((b) => b.type === type).sort((a, b) => a.level - b.level);
    for (const b of mine) if (b.level > edit.levels) out.splice(out.indexOf(b), 1);
    let below = mine[mine.length - 1];
    for (let n = (below?.level ?? 0) + 1; below && n <= edit.levels; n++) {
      // Its texts and price are the level below's until edited, as in the copy.
      const made: TreeBuilding = { ...below, key: keyOf(type, n), level: n, requires: [below.key] };
      out.push(made);
      below = made;
    }
  }
  return out;
}

/** How many levels the records of a type have, before `levels` says otherwise. */
function recordLevels(type: string): number {
  const from = fromOf(type);
  return ((from && trees.get(from)?.buildings) || []).filter((b) => b.type === type).length;
}

/**
 * Say how many levels a type has: the edits and icons of the levels above go
 * with them. A level added past the records starts as the level below AS IT
 * STANDS — its name, description, price, town level and icon written into its
 * own fields, where the author sees them and changes the difference — not as
 * the donor's record it is copied from (Senya, 23.10: a preset fills the rows).
 */
function setLevels(type: string, levels: number): void {
  const had = Math.max(effectiveBuildings().filter((b) => b.type === type).length, recordLevels(type));
  for (let l = levels + 1; l <= (facData?.buildingLevels ?? 5); l++) {
    delete edits[keyOf(type, l)];
    delete pictures.buildings[keyOf(type, l)];
  }
  setEdit(type, { levels: levels === recordLevels(type) ? undefined : levels });
  for (let n = had + 1; n <= levels; n++) {
    const below = keyOf(type, n - 1);
    const shown = effectiveBuildings().find((b) => b.key === below);
    if (!shown) break;
    const said = edits[below] ?? {};
    setEdit(keyOf(type, n), {
      name: said.name ?? shown.name,
      description: said.description ?? shown.description,
      cost: { ...shown.cost, ...said.cost },
      devLevel: said.devLevel ?? shown.devLevel,
    });
    const icon = pictures.buildings[below];
    if (icon) pictures.buildings[keyOf(type, n)] = icon;
  }
}

/** Where a level stands: the edit's cell, else the tree's. */
const cellOf = (b: TreeBuilding): { x: number; y: number } | null =>
  edits[b.key]?.slot ?? (edits[b.key] === null && b.level === 1 ? takenOut[b.type]?.slot : undefined) ?? b.cell;

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
          const here = standingAt(x, y);
          picked = { x, y, key: here[0]?.key ?? null };
          drawGrid();
          drawCellEditor();
        };
        // A building is DRAGGED to an empty cell, with the levels standing in
        // its cell; what it needs is the cell above in its new column, and a
        // need that no longer is says so on the cell.
        cell.ondragstart = (ev) => {
          if (!standingAt(x, y).length) { ev.preventDefault(); return; }
          ev.dataTransfer?.setData('text/plain', `${x},${y}`);
        };
        // Any cell takes the drop — a taken one to say what holds it.
        cell.ondragover = (ev) => { ev.preventDefault(); if (!standingAt(x, y).length) cell.classList.add('over'); };
        cell.ondragleave = () => cell.classList.remove('over');
        cell.ondrop = (ev) => {
          ev.preventDefault();
          cell.classList.remove('over');
          const [fx, fy] = (ev.dataTransfer?.getData('text/plain') ?? '').split(',').map(Number) as [number, number];
          if (fx && fy) moveCell(fx, fy, x, y);
        };
        grid.appendChild(cell);
      }
    }
  }
  return [...grid.children] as HTMLElement[];
}

/** The levels standing in a cell, lowest first. */
function standingAt(x: number, y: number): TreeBuilding[] {
  return effectiveBuildings().filter((b) => { const c = cellOf(b); return c?.x === x && c?.y === y; }).sort((a, b) => a.level - b.level);
}

/** Move what stands in one cell to an empty one: each level's cell said, or forgotten when it is its record's own. */
function moveCell(fx: number, fy: number, tx: number, ty: number): void {
  const here = standingAt(fx, fy);
  if (!here.length || (fx === tx && fy === ty)) return;
  const there = standingAt(tx, ty);
  if (there.length) { $('fac-form-err').textContent = `cell ${tx},${ty} holds ${there[0]!.key}`; return; }
  $('fac-form-err').textContent = '';
  for (const b of here) {
    if (edits[b.key] === null) continue;
    setEdit(b.key, { slot: b.cell?.x === tx && b.cell?.y === ty ? undefined : { x: tx, y: ty } });
  }
  picked = { x: tx, y: ty, key: here[0]!.key };
  drawGrid();
  drawCellEditor();
}

/** What a level standing at (x, y) needs that is not the cell above in its column — the screen draws no arrow for it. */
function violatedNeeds(b: TreeBuilding, x: number, y: number, all: readonly TreeBuilding[]): BuildingKey[] {
  return (edits[b.key]?.requires ?? b.requires).filter((k) => !dependableFrom(x, y, b.type).includes(k) && !all.some((o) => o.type === b.type && o.key === k));
}

function drawGrid(): void {
  const all = effectiveBuildings();
  for (const cell of gridCells()) {
    const x = Number(cell.dataset.x), y = Number(cell.dataset.y);
    const here = all.filter((b) => { const c = cellOf(b); return c?.x === x && c?.y === y; });
    cell.className = 'fc-cell';
    cell.innerHTML = '';
    cell.draggable = here.some((b) => !isDropped(b.key));
    if (picked?.x === x && picked?.y === y) cell.classList.add('on');
    if (!here.length) {
      cell.classList.add('empty');
      cell.textContent = '+';
      cell.title = 'empty — click to put a building here, or drag one onto it';
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
      // Edited: anything said of it beyond whose it is.
      const e = edits[b.key];
      if (e === null || (e && Object.keys(e).some((k) => k !== 'from'))) i.classList.add('edited');
      if (isDropped(b.key)) i.style.textDecoration = 'line-through';
      levels.appendChild(i);
    }
    cell.append(type, name, levels);
    if (here.every((b) => isDropped(b.key))) cell.classList.add('dropped');
    if (fromOf(first.type) !== $select('fac-donor').value) cell.classList.add('from');
    const requires = edit?.requires ?? first.requires;
    if (requires.length) {
      const arrow = document.createElement('span');
      arrow.className = 'fc-arrow';
      arrow.textContent = '↑';
      arrow.title = `needs ${requires.join(', ')}`;
      cell.appendChild(arrow);
    }
    cell.title = here.map((b) => `${b.key}: ${edits[b.key]?.name ?? b.name} (${fromOf(b.type)})`).join(NL);
    const violated = isDropped(first.key) ? [] : here.flatMap((b) => violatedNeeds(b, x, y, all));
    if (violated.length) {
      cell.classList.add('warn');
      cell.title += `${NL}needs ${violated.join(', ')}, which is not the cell above in this column`;
    }
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
  if (!picked) {
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
    putRows(box, x, y, all, []);
    return;
  }

  const current = here.find((b) => b.key === picked!.key) ?? here[0]!;
  picked.key = current.key;
  drawBuildingEditor(box, x, y, all, here, current);
}

/**
 * An empty cell's rows — or one whose buildings are all taken out, which a
 * building put here replaces: a building of the tree MOVED here (a level of
 * it, or the whole stack), or a NEW one — any type a town of the eight has
 * and the tree has not yet, as that town's building.
 */
function putRows(box: HTMLElement, x: number, y: number, all: readonly TreeBuilding[], struck: readonly TreeBuilding[]): void {
  {
    const townRow = document.createElement('div');
    townRow.className = 'on-row';
    const townLabel = document.createElement('span');
    townLabel.textContent = 'Of the town';
    const town = document.createElement('select');
    town.className = 'fc-put-town';
    fillSelect(town, (facData?.donors ?? []).map((d) => ({ id: d.type, label: d.label })), putTown || $select('fac-donor').value);
    town.title = 'whose building a new one is: its levels, cells, price, words and effect come with it, all yours to change';
    townRow.append(townLabel, town);
    const row = document.createElement('div');
    row.className = 'on-row';
    const label = document.createElement('span');
    label.textContent = 'Put here';
    const sel = document.createElement('select');
    sel.className = 'fc-put';
    const fill = (): void => {
      const choices: { id: string; label: string }[] = [];
      for (const b of all) if (!isDropped(b.key)) choices.push({ id: `move:${b.key}`, label: `move ${b.key} (${edits[b.key]?.name ?? b.name})` });
      const have = new Set(all.filter((b) => !isDropped(b.key)).map((b) => b.type));
      for (const b of trees.get(town.value)?.buildings ?? []) {
        if (b.level === 1 && !have.has(b.type)) choices.push({ id: `new:${b.type}`, label: `new: ${b.type} (${b.name})` });
      }
      fillSelect(sel, [{ id: '', label: '—' }, ...choices], '');
    };
    fill();
    town.onchange = () => { putTown = town.value; fill(); };
    sel.onchange = () => {
      const [what, key] = sel.value.split(':') as [string, string];
      // What was taken out here is forgotten: the cell is the new one's.
      for (const b of struck) {
        if (b.level !== 1) continue;
        delete takenOut[b.type];
        for (const k of Object.keys(edits)) if (parseKey(k).type === b.type && edits[k] === null) delete edits[k];
      }
      if (what === 'move') {
        setEdit(key, { slot: { x, y } });
        picked = { x, y, key };
      } else if (what === 'new') {
        // Every level of it, stood where it stands in its town, the first
        // here; the levels that stood apart keep their own cells.
        for (const l of Object.keys(edits).filter((k) => parseKey(k).type === key)) delete edits[l];
        delete takenOut[key];
        const first = trees.get(town.value)!.buildings.find((b) => b.type === key && b.level === 1)!;
        setEdit(key, { from: town.value, ...(first.cell?.x === x && first.cell?.y === y ? {} : { slot: { x, y } }) });
        for (const b of trees.get(town.value)!.buildings) {
          if (b.type === key && b.level > 1 && b.cell?.x === first.cell?.x && b.cell?.y === first.cell?.y) setEdit(b.key, first.cell?.x === x && first.cell?.y === y ? {} : { slot: { x, y } });
        }
        picked = { x, y, key };
      }
      drawGrid();
      drawCellEditor();
    };
    row.append(label, sel);
    box.append(townRow, row);
  }
}

/** The editor of one building standing in a cell, level by level. */
function drawBuildingEditor(box: HTMLElement, x: number, y: number, all: readonly TreeBuilding[], here: readonly TreeBuilding[], current: TreeBuilding): void {
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
  // A field SHOWS the record's value until changed — as a preset fills a
  // form (Senya, 2026-10-25) — and the edit keeps only what differs: typing
  // the record's value back, or clearing the field, is no edit. `hint` is a
  // field with no value of the record's to show (the button's Lua).
  const textRow = (label: string, value: string | undefined, record: string, on: (v: string | undefined) => void, multi = false, hint = false): void => {
    const row = document.createElement('label');
    row.className = 'on-row';
    const l = document.createElement('span');
    l.textContent = label;
    const input = multi ? document.createElement('textarea') : document.createElement('input');
    if (input instanceof HTMLInputElement) { input.type = 'text'; input.spellcheck = false; }
    input.placeholder = record;
    input.value = value ?? (hint ? '' : record);
    input.title = hint ? record : `the record's: ${record}`;
    input.oninput = () => on(input.value === '' || (!hint && input.value === record) ? undefined : input.value);
    row.append(l, input);
    box.appendChild(row);
  };

  const status = document.createElement('div');
  status.className = 'um-note';
  status.textContent = `${current.key} — ${current.type}, ${fromOf(current.type) ?? '?'}'s${dropped ? ' — DROPPED' : ''}`;
  box.appendChild(status);

  const actions = document.createElement('div');
  actions.className = 'fc-level-tabs';
  const dropBtn = document.createElement('button');
  dropBtn.className = 'ghost';
  dropBtn.textContent = dropped ? 'keep it' : (current.level === 1 ? 'drop the building' : `drop level ${current.level} and above`);
  dropBtn.title = 'a dropped building is never copied: no record, no text, no icon, no cell';
  dropBtn.onclick = () => {
    // A level the author added is taken back by saying one fewer.
    if (!dropped && current.level > 1 && current.level > recordLevels(current.type)) {
      setLevels(current.type, current.level - 1);
      picked = { ...picked!, key: keyOf(current.type, current.level - 1) };
      drawGrid();
      drawCellEditor();
      return;
    }
    const { type, level } = parseKey(current.key);
    if (dropped) {
      for (let l = 1; l <= level; l++) if (edits[keyOf(type, l)] === null) delete edits[keyOf(type, l)];
      // Taken out whole: put back as it stood.
      if (takenOut[type] && edits[type] === undefined) { edits[type] = takenOut[type]!; delete takenOut[type]; }
    } else {
      if (level === 1) takenOut[type] = edits[type]!;
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
  if (dropped) {
    // Everything here taken out: the cell is free for another building.
    if (here.every((b) => isDropped(b.key))) putRows(box, x, y, all, here);
    return;
  }

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
  textRow('Name', edit.name, current.name, (v) => put({ name: v }));
  box.appendChild(fileRow('Icon', pictures.buildings[current.key] ?? '', 'picture', (v) => {
    if (v) pictures.buildings[current.key] = v; else delete pictures.buildings[current.key];
    formGate().check();
  }, "a picture of yours for this level's icon on the build screen, 128×128; blank is the theme's, or the donor's"));
  textRow('Description', edit.description, current.description, (v) => put({ description: v }), true);
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
      input.value = String(edit.cost?.[r] ?? current.cost[r]);
      input.oninput = () => {
        const cost = { ...(edits[current.key]?.cost ?? {}) };
        const v = input.value.trim();
        if (v === '' || Number(v) === current.cost[r]) delete cost[r]; else cost[r] = Number(v);
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
    // Any whole number: the town's level counts what stands in it, and the
    // shipped records' 0, 3, 6 … 15 are what Ubisoft chose, not a rule
    // (Senya, 2026-10-23: the Bone Pit at 1).
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.step = '1';
    input.className = 'narrow fc-dev-level';
    input.placeholder = `${current.devLevel}`;
    input.title = `the town level it asks for, any whole number — the record's is ${current.devLevel}`;
    input.value = String(edit.devLevel ?? current.devLevel);
    input.oninput = () => {
      const v = input.value.trim();
      const n = Number(v);
      if (v !== '' && !(Number.isInteger(n) && n >= 0)) return;
      put({ devLevel: v === '' || n === current.devLevel ? undefined : n });
    };
    row.append(l, input);
    box.appendChild(row);
  }
  if (current.level === 1) {
    {
      // How many levels: the author's, up to the game's ceiling — another
      // town's count is an example, not a template (Senya, 2026-10-21).
      const row = document.createElement('label');
      row.className = 'on-row';
      const l = document.createElement('span');
      l.textContent = 'Levels';
      const sel = document.createElement('select');
      sel.className = 'fc-levels-count';
      const ceiling = facData?.buildingLevels ?? 5;
      const records = recordLevels(current.type);
      fillSelect(sel, Array.from({ length: ceiling }, (_, i) => ({ id: String(i + 1), label: `${i + 1}${i + 1 === records ? ' (the records\')' : ''}` })),
        String(edit.levels ?? records));
      sel.title = `how many levels the building has, one to ${ceiling}; past the records each new one is the level below again, its name, price and cell then yours to change`;
      sel.onchange = () => { setLevels(current.type, Number(sel.value)); drawGrid(); drawCellEditor(); };
      row.append(l, sel);
      box.appendChild(row);
    }
    {
      const row = document.createElement('label');
      row.className = 'on-row';
      const l = document.createElement('span');
      l.textContent = 'Town';
      const sel = document.createElement('select');
      sel.className = 'fc-from';
      const having = (facData?.donors ?? []).filter((d) => trees.get(d.type)?.buildings.some((b) => b.type === current.type));
      fillSelect(sel, having.map((d) => ({ id: d.type, label: d.label })), fromOf(current.type) ?? '');
      sel.title = 'whose building it is — every level, its cells, its words and its effect — from the eight that have one';
      sel.onchange = () => {
        setEdit(current.type, { from: sel.value });
        drawGrid();
        drawCellEditor();
      };
      row.append(l, sel);
      box.appendChild(row);
    }
    {
      // What it DOES: its town's effect, none, or another town's building's
      // of the same type (town-features.ts). Its town's unless said.
      const row = document.createElement('label');
      row.className = 'on-row';
      const l = document.createElement('span');
      l.textContent = 'Effect';
      const sel = document.createElement('select');
      sel.className = 'fc-grants';
      const g = edit.grants;
      const value = g === undefined ? '' : g === null ? 'none' : g.building && g.building !== current.type ? `${g.like}:${g.building}` : g.like;
      const options = [
        { id: '', label: `${fromOf(current.type) ?? 'its town'}'s — what it does there` },
        { id: 'none', label: 'none — it only stands (a button may give it one)' },
        ...(facData?.donors ?? []).map((d) => ({ id: d.type, label: `like ${d.label}'s ${current.type}` })),
      ];
      if (value.includes(':')) options.push({ id: value, label: `like ${g!.like}'s ${g!.building}` });
      fillSelect(sel, options, value);
      sel.title = "the engine's compiled effect a building of a shipped town has, level for level; a building of ours does what its town's does unless told otherwise";
      sel.onchange = () => {
        const v = sel.value;
        put({ grants: v === '' ? undefined : v === 'none' ? null : v.includes(':') ? { like: v.split(':')[0]!, building: v.split(':')[1]! } : { like: v } });
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
        // The base's buildings that are not the base's in the tree: their
        // spots on its screen are free.
        const droppedTypes = [...new Set((tree?.buildings ?? []).filter((b) => b.level === 1 && (isDropped(b.key) || fromOf(b.type) !== $select('fac-donor').value)).map((b) => b.type))];
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
    textRow('Button → Lua', edit.button?.lua, 'no button', (v) => {
      const camp = edits[current.key]?.button?.camp;
      put({ button: v ? { lua: v, ...(camp ? { camp } : {}) } : undefined });
      campBox.disabled = !v;
      for (const t of tiers) t.disabled = !v || !campBox.checked;
    }, false, true);
    // Or the button opens a refugee camp: the function is written for it
    // (camp-script.ts) — a week's roll over those tiers, the hire screen's.
    const row = document.createElement('div');
    row.className = 'on-row';
    const l = document.createElement('span');
    l.textContent = 'Refugee camp';
    const campBox = document.createElement('input');
    campBox.type = 'checkbox';
    campBox.className = 'fc-camp';
    campBox.title = 'the button opens a refugee camp: each week it rolls creatures of these tiers and sells them through the hire screen, one offer per level of the building — the Lua is written for it';
    campBox.checked = !!edit.button?.camp;
    campBox.disabled = !edit.button?.lua;
    const tierOptions = [1, 2, 3, 4, 5, 6, 7].map((n) => ({ id: String(n), label: `tier ${n}` }));
    const tiers = (['minTier', 'maxTier'] as const).map((side) => {
      const sel = document.createElement('select');
      sel.className = `fc-camp-${side === 'minTier' ? 'min' : 'max'}`;
      fillSelect(sel, tierOptions, String(edit.button?.camp?.[side] ?? (side === 'minTier' ? 1 : 7)));
      sel.disabled = !campBox.checked;
      return sel;
    });
    const setCamp = (): void => {
      const lua = edits[current.key]?.button?.lua;
      if (!lua) return;
      const [min, max] = tiers.map((t) => Number(t.value)) as [number, number];
      put({ button: { lua, ...(campBox.checked ? { camp: { minTier: min, maxTier: max } } : {}) } });
      for (const t of tiers) t.disabled = !campBox.checked;
    };
    campBox.onchange = setCamp;
    for (const t of tiers) t.onchange = setCamp;
    const to = document.createElement('span');
    to.textContent = 'to';
    row.append(l, campBox, tiers[0]!, to, tiers[1]!);
    box.appendChild(row);
  }
  const violated = violatedNeeds(current, x, y, all);
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

/**
 * A PRESET: a town's whole tree put — every building of it, as its records
 * say, each field showing them — in place of whatever the tree held.
 */
async function loadPreset(town: string): Promise<void> {
  $('fac-form-err').textContent = '';
  if (Object.keys(edits).length && !await ask('Loading a preset puts that town\'s whole tree in place of this one, and forgets every building edit made so far. Load it?', 'Load')) return;
  try {
    await ensureTree(town);
    const theirs = trees.get(town)!;
    edits = {};
    takenOut = {};
    for (const type of new Set(theirs.buildings.map((b) => b.type))) edits[type] = { from: town };
    picked = null;
    $('fac-preset-note').textContent = `${theirs.buildings.length} building records of ${town} on the grid`;
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

/**
 * The tree as the copier takes it: what is put, with what differs. A
 * building taken out whole is simply not there; a town without magic builds
 * Stronghold's five stubs in the guild's place, so the guild says nothing of
 * whose it is (town-files.ts, `buildingEdits`).
 */
function readBuildings(magic: 'guild' | 'none'): Record<BuildingKey, BuildingEdit | null> {
  const out: Record<BuildingKey, BuildingEdit | null> = {};
  for (const [key, edit] of Object.entries(edits)) {
    const { type } = parseKey(key);
    if (edits[type] === null || !edits[type]?.from) continue;
    if (magic === 'none' && type === 'TB_MAGIC_GUILD' && edit) {
      const rest: BuildingEdit = { ...edit };
      delete rest.from;
      delete rest.name;
      delete rest.description;
      delete rest.grants;
      if (Object.keys(rest).length) out[key] = rest;
      continue;
    }
    out[key] = edit;
  }
  return out;
}

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
    tree: 'empty',
    buildings: readBuildings(magic),
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
  const skillValues = readSkillValues();
  if (Object.keys(skillValues).length) ai.skillValues = skillValues;
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
  $('fac-fill').onclick = () => { void loadPreset($select('fac-preset').value); };
  // The base is the screen the buildings stand on: its spots are what a model of ours can take.
  $select('fac-donor').addEventListener('change', () => { tree = trees.get($select('fac-donor').value) ?? null; drawGrid(); drawCellEditor(); });
  $('fac-magic').onchange = showSchools;
  // A listener, not `oninput`: the form gate binds `oninput` on the fields it
  // watches (form-gate.ts), and the identifier is one of them.
  $('fac-file').addEventListener('input', () => { $input('fac-type').value = $input('fac-file').value.trim() ? townTypeFor($input('fac-file').value) : ''; });
  $('fac-town-add').onclick = () => { if (facData) addTownRow(facData); };
  $select('fac-exterior').addEventListener('change', () => applyExteriorPreset($select('fac-exterior').value));
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
  $('fac-ai-fill').onclick = (ev) => { ev.preventDefault(); fillSkillRows($select('fac-ai-fill-from').value); };
  $('fac-ai-clear').onclick = (ev) => { ev.preventDefault(); fillSkillRows(''); };
  $('fac-ai-filter').addEventListener('input', filterSkillRows);
}
