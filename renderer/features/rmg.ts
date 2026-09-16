// Random Map — the game's generator dialog, and the game's generator behind it.
//
// Field for field the dialog the game shows: size, levels, a template the
// game would OFFER for that size (the list narrows as the size and the levels
// change, the way the game's does), players inside the template's range,
// water, the monster level, the two multipliers, random towns, the grail, the
// minimap, and a seed — blank means the generator draws one, the way the game
// does. The lists come from the install, so a mod's template is offered
// beside the shipped ones and nothing here is typed twice — and they come
// from a process of the generator's own (electron/channels/rmg.ts), which
// reads the install ONCE a session: the dialog opens at once, covered by a
// loading overlay while the first answer is on its way, and the window keeps
// painting under it; every later opening is filled from memory.
//
// AND EVERY CHOICE CAN BE LEFT TO CHANCE. "Random" is the first option of
// each list; the generator draws it before the run, in the order the dialog's
// own dependencies go (size, levels, template, players), and the HUD says
// what came out. A fixed template with a random size is a size the template
// fits.
//
// TWO FIELDS OF OURS the game's dialog has not: a race a player, and the
// heroes. The race goes to the generator as a lobby's concrete slot would.
// The heroes are the map's `AvailableHeroes`, under a spoiler: a white list
// — the map offers these and nobody else — built one hero a click through a
// picker, or the rule "every hero of the players' races" (resolved after
// the run, since a race may be random), which locks the lists. The black
// list beside it is for keeping track and is not written: the map has only
// the one list.
//
// Generating lands the map as New Map does — packed into `<game>/H5E/`, opened
// from that archive — so from the moment it exists it is a map like any other.

import { $, $button, $input, $select, fillSelect } from '#core/dom.ts';
import { api } from '#core/ipc.ts';
import { requireFilled } from '#core/form-gate.ts';
import type { RmgChoicesResult, RmgGenerateResult, RmgTemplateEntry } from '#electron/ipc.ts';
import { openTemplateEditor } from '#features/rmg-templates.ts';

const RANDOM = 'random';

const dialog = (): HTMLDialogElement => {
  const el = $('rmg');
  if (!(el instanceof HTMLDialogElement)) throw new Error('#rmg is not a <dialog>');
  return el;
};

let choices: RmgChoicesResult | null = null;
/** What the template list holds now — the offered ones, or all of them when the size or levels are random. */
let listed: RmgTemplateEntry[] = [];
/** The two hero lists, hrefs — kept between openings like every other control. */
const white: string[] = [];
const black: string[] = [];

/** Where every question reads from: the install with its mods, or the data alone. */
const source = (): { mods: boolean } => ({ mods: $input('rmg-mods').checked });

/** `MAP_SIZE_EXTRALARGE` → `Extra Large`; the enum's spelling, made readable. */
function pretty(name: string, prefix: string): string {
  const bare = name.startsWith(prefix) ? name.slice(prefix.length) : name;
  return bare.toLowerCase().split('_').map((w) => w[0]!.toUpperCase() + w.slice(1)).join(' ')
    .replace('Extralarge', 'Extra Large');
}

const withRandom = (opts: { id: string; label: string }[]): { id: string; label: string }[] =>
  [{ id: RANDOM, label: 'Random' }, ...opts];

const enumOptions = (names: string[], prefix: string): { id: string; label: string }[] =>
  withRandom(names.map((n, i) => ({ id: String(i), label: pretty(n, prefix) })));

/** A select's value as the payload wants it: the number, or 'random'. */
const numberOr = (id: string): number | 'random' => {
  const v = $select(id).value;
  return v === RANDOM ? RANDOM : Number(v);
};
const boolOr = (id: string): boolean | 'random' => {
  const v = $select(id).value;
  return v === RANDOM ? RANDOM : v === '1';
};

/** The templates the game would offer for the size and levels now chosen — or all of them, when either is random. */
async function refreshTemplates(): Promise<void> {
  const size = $select('rmg-size').value;
  const levels = $select('rmg-two').value;
  const keep = $select('rmg-template').value;
  const note = $('rmg-template-note');
  if (size === RANDOM || levels === RANDOM) {
    listed = choices?.templates ?? [];
    note.textContent = 'any template — the size and the levels are drawn to fit it';
  } else {
    const underground = levels === '1';
    listed = await api.rmgTemplates({ sizeIndex: Number(size), underground, ...source() });
    note.textContent = listed.length
      ? `${listed.length} template${listed.length === 1 ? '' : 's'} fit this size${underground ? ' with an underground' : ''}`
      : `no template fits this size${underground ? ' with an underground' : ''} — the game would offer none either`;
  }
  fillSelect($select('rmg-template'),
    withRandom(listed.map((t) => ({ id: t.file, label: t.name === t.file ? t.file : `${t.file} — ${t.name}` }))),
    keep && (keep === RANDOM || listed.some((t) => t.file === keep)) ? keep : RANDOM);
  refreshPlayers();
  gate.check();
}

/** The players list follows the template's own range — or the union of the listed ones' when the template is random. */
function refreshPlayers(): void {
  const file = $select('rmg-template').value;
  const pool = file === RANDOM ? listed : listed.filter((t) => t.file === file);
  const min = pool.length ? Math.min(...pool.map((t) => t.minPlayers)) : 2;
  const max = pool.length ? Math.max(...pool.map((t) => t.maxPlayers)) : 8;
  const keep = $select('rmg-players').value;
  const opts = withRandom(Array.from({ length: max - min + 1 }, (_, i) => ({ id: String(min + i), label: String(min + i) })));
  fillSelect($select('rmg-players'), opts, opts.some((o) => o.id === keep) ? keep : RANDOM);
  showRaceSlots();
}

/** The race lists, one a player: the engine's draw, or one of the races a slot can be set to. */
function fillRaces(): void {
  const opts = withRandom((choices?.races ?? []).map((t) => ({ id: t, label: pretty(t, 'TOWN_') })));
  for (let i = 1; i <= 8; i++) {
    const sel = $select(`rmg-race-${i}`);
    fillSelect(sel, opts, opts.some((o) => o.id === sel.value) ? sel.value : RANDOM);
  }
}

/** Only the slots the players count reaches — all eight while it is left to chance. */
function showRaceSlots(): void {
  const players = $select('rmg-players').value;
  const shown = players === RANDOM ? 8 : Number(players);
  // `display`, not the `hidden` attribute: the row's own `display: flex`
  // would win over the attribute and the slot would stay on screen.
  for (let i = 1; i <= 8; i++) $select(`rmg-race-${i}`).parentElement!.style.display = i > shown ? 'none' : '';
}

// --- the hero lists ---------------------------------------------------------

const heroOf = (href: string): { href: string; town: string; name: string } | undefined =>
  choices?.heroes.find((h) => h.href === href);

/** Both lists drawn from their arrays: a name, its town, an arrow to the other list, a cross. */
function renderLists(): void {
  const draw = (id: string, own: string[], other: string[], arrow: string): void => {
    const body = $(id);
    body.replaceChildren();
    for (const href of own) {
      const h = heroOf(href);
      const row = document.createElement('div');
      row.className = 'rmg-hero';
      const name = document.createElement('span');
      name.className = 'rmg-hero-name';
      name.textContent = h?.name ?? href;
      const town = document.createElement('span');
      town.className = 'rmg-hero-town';
      town.textContent = h ? pretty(h.town, 'TOWN_') : '';
      const move = document.createElement('button');
      move.textContent = arrow;
      move.title = 'to the other list';
      move.onclick = () => { own.splice(own.indexOf(href), 1); other.push(href); renderLists(); };
      const drop = document.createElement('button');
      drop.textContent = '×';
      drop.title = 'remove';
      drop.onclick = () => { own.splice(own.indexOf(href), 1); renderLists(); };
      row.append(name, town, move, drop);
      body.appendChild(row);
    }
  };
  draw('rmg-white', white, black, '→');
  draw('rmg-black', black, white, '←');
  $('rmg-lists').classList.toggle('locked', $input('rmg-heroes-of-races').checked);
}

/**
 * Setting a hero aside is a statement about everyone else: the first hero
 * put on the black list pulls every hero not yet on either list into the
 * white one, so the two lists partition the roster from then on and the
 * map's list (the white one) is "everybody but these".
 */
function setAside(href: string): void {
  black.push(href);
  const listed = new Set([...white, ...black]);
  for (const h of choices?.heroes ?? []) if (!listed.has(h.href)) white.push(h.href);
}

/** The picker: every hero not yet in either list, by town, narrowed by the search; a click adds one and closes. */
function openPicker(into: string[], title: string): void {
  const d = $('rmg-pick');
  if (!(d instanceof HTMLDialogElement)) throw new Error('#rmg-pick is not a <dialog>');
  $('rmg-pick-title').textContent = title;
  const search = $input('rmg-pick-search');
  search.value = '';
  const fill = (): void => {
    const q = search.value.trim().toLowerCase();
    const list = $('rmg-pick-list');
    list.replaceChildren();
    const taken = new Set([...white, ...black]);
    const byTown = new Map<string, { href: string; name: string }[]>();
    for (const h of choices?.heroes ?? []) {
      if (taken.has(h.href)) continue;
      if (q && !h.name.toLowerCase().includes(q) && !pretty(h.town, 'TOWN_').toLowerCase().includes(q)) continue;
      if (!byTown.has(h.town)) byTown.set(h.town, []);
      byTown.get(h.town)!.push(h);
    }
    for (const [town, heroes] of [...byTown].sort(([a], [b]) => a.localeCompare(b))) {
      const head = document.createElement('div');
      head.className = 'rmg-pick-town';
      head.textContent = pretty(town, 'TOWN_');
      list.appendChild(head);
      for (const h of heroes) {
        const b = document.createElement('button');
        b.className = 'rmg-pick-hero';
        b.textContent = h.name;
        b.onclick = () => {
          if (into === black) setAside(h.href);
          else into.push(h.href);
          renderLists();
          d.close();
        };
        list.appendChild(b);
      }
    }
    if (!byTown.size) {
      const none = document.createElement('div');
      none.className = 'rmg-pick-none';
      none.textContent = q ? 'nobody by that name' : 'everybody is listed already';
      list.appendChild(none);
    }
  };
  search.oninput = fill;
  fill();
  d.showModal();
  search.focus();
}

function updateWhere(): void {
  const name = $input('rmg-name').value.trim() || 'Random Map';
  $('rmg-where').textContent = `→ <game>/H5E/${name}.h5m · inside it Maps/RMG/<guid>, where the game keeps its own`;
}

/**
 * The lists, asked for on every opening and read once a session: the first
 * answer takes seconds (the spinner says so), the rest are immediate. A mod
 * installed meanwhile shows up after a restart.
 */
async function fill(): Promise<void> {
  $('rmg-loading').hidden = false;
  try {
    choices = await api.rmgChoices(source());
  } finally {
    $('rmg-loading').hidden = true;
  }
  const sizeSel = $select('rmg-size');
  const keepSize = sizeSel.value;
  fillSelect(sizeSel, withRandom(choices.sizes.map((s, i) => ({ id: String(i), label: `${pretty(s.name, 'MAP_SIZE_')} (${s.tiles}×${s.tiles})` }))),
    keepSize || '1');
  fillSelect($select('rmg-monsters'), enumOptions(choices.monsterLevels, 'MONSTER_LEVEL_'), $select('rmg-monsters').value || '1');
  fillSelect($select('rmg-resource'), enumOptions(choices.resourceMultipliers, 'RESOURCE_'), $select('rmg-resource').value || '2');
  fillSelect($select('rmg-exp'), enumOptions(choices.expMultipliers, 'EXP_'), $select('rmg-exp').value || '2');
  fillRaces();
  renderLists();
  await refreshTemplates();
}

async function open(): Promise<void> {
  $('rmg-err').textContent = '';
  $('rmg-busy').hidden = true;
  updateWhere();
  dialog().showModal();
  try {
    await fill();
  } catch (e) {
    $('rmg-err').textContent = e instanceof Error ? e.message : String(e);
  }
  $input('rmg-name').select();
}

/** Every list to Random; the name, the seed and the minimap stay. */
async function allRandom(): Promise<void> {
  for (const id of ['rmg-size', 'rmg-two', 'rmg-water', 'rmg-monsters', 'rmg-resource', 'rmg-exp', 'rmg-towns', 'rmg-grail']) {
    $select(id).value = RANDOM;
  }
  await refreshTemplates();
  $select('rmg-template').value = RANDOM;
  refreshPlayers();
  $select('rmg-players').value = RANDOM;
  gate.check();
}

/** The order in one line for the HUD — what was drawn, spelled the way the lists spell it, and what came out. */
function describe(r: RmgGenerateResult): string {
  const c = choices!;
  const o = r.order;
  return `${o.template} ${o.tiles}×${o.tiles}${o.underground ? ' two-level' : ''}, ${o.players} players`
    + ` (${r.playerRaces.map((t) => pretty(t, 'TOWN_')).join(', ')})`
    + `${o.water ? ', island map' : ''}, ${pretty(c.monsterLevels[o.monsterLevel] ?? '', 'MONSTER_LEVEL_').toLowerCase()} monsters`
    + `, resources ${pretty(c.resourceMultipliers[o.resourceMultiplier] ?? '', 'RESOURCE_').toLowerCase()}`
    + `, experience ${pretty(c.expMultipliers[o.expMultiplier] ?? '', 'EXP_').toLowerCase()}`
    + `${o.randomTowns ? ', random towns' : ''}${o.grail ? ', grail' : ''}`
    + `${r.heroes.length ? `, ${r.heroes.length} heroes listed` : ''}`;
}

async function submit(open: (path: string, archive: string) => Promise<void>, refresh: () => void): Promise<void> {
  const ok = $button('rmg-ok');
  const seedText = $input('rmg-seed').value.trim();
  const seed = seedText ? Number(seedText) : undefined;
  if (seed !== undefined && (!Number.isInteger(seed) || seed < 1 || seed > 2147483647)) {
    $('rmg-err').textContent = 'the seed is a whole number from 1 to 2147483647, or blank for a random one';
    return;
  }
  ok.disabled = true;
  $('rmg-err').textContent = '';
  $('rmg-busy').hidden = false;
  try {
    const r = await api.rmgGenerate({
      mapName: $input('rmg-name').value.trim(),
      seed,
      template: $select('rmg-template').value === RANDOM ? RANDOM : $select('rmg-template').value,
      sizeIndex: numberOr('rmg-size'),
      underground: boolOr('rmg-two'),
      water: numberOr('rmg-water'),
      players: numberOr('rmg-players'),
      monsterLevel: numberOr('rmg-monsters'),
      resourceMultiplier: numberOr('rmg-resource'),
      expMultiplier: numberOr('rmg-exp'),
      grail: boolOr('rmg-grail'),
      randomTowns: boolOr('rmg-towns'),
      minimap: $input('rmg-minimap').checked,
      ...source(),
      races: Array.from({ length: 8 }, (_, i) => $select(`rmg-race-${i + 1}`).value),
      heroesOfRaces: $input('rmg-heroes-of-races').checked,
      heroes: [...white],
    });
    dialog().close();
    await open(r.mapPath, r.archive);
    // The generator's warnings are not failures: the map is there, and the
    // line says what it could not do — a named object the zone had no room
    // for. Each is on the console in full.
    for (const w of r.warnings) console.warn(`random map: ${w}`);
    const warned = r.warnings.length ? ` · ⚠ ${r.warnings.length === 1 ? r.warnings[0] : `${r.warnings.length} warnings (see console)`}` : '';
    $('hud').textContent = `random map → ${r.archive} · ${describe(r)} · seed ${r.seed} · ${r.objects} objects in ${(r.ms / 1000).toFixed(1)}s${warned}`;
    refresh();
  } catch (e) {
    // Stay open on failure — a name clash is fixed by editing the name.
    $('rmg-err').textContent = e instanceof Error ? e.message : String(e);
  } finally {
    $('rmg-busy').hidden = true;
    ok.disabled = false;
    gate.check();
  }
}

let gate: { check: () => void };

/**
 * The template editor saved or removed one: the lists are a template out of
 * date. Reread while the dialog is up; a closed dialog rereads on opening.
 */
export function rmgListsChanged(): void {
  if (dialog().open) void fill();
}

/**
 * Wire the dialog. `openMap` is how the app opens what was made, `refresh`
 * tells the picker its list is one map out of date — both the app's own, so
 * this file does not reach into it.
 */
export function initRmg(openMap: (path: string, archive: string) => Promise<void>, refresh: () => void): void {
  gate = requireFilled({
    ok: 'rmg-ok', missing: 'rmg-missing',
    fields: { name: 'rmg-name', template: 'rmg-template' },
  });
  $('rmgbtn').onclick = () => { void open(); };
  $('rmg2').onclick = () => { void open(); };
  $('rmg-close').onclick = () => dialog().close();
  $('rmg-cancel').onclick = () => dialog().close();
  $('rmg-random').onclick = () => { void allRandom(); };
  // The door to the template editor, on the template chosen here — over this
  // dialog, which stays as it was and picks up what was saved.
  $('rmg-templates').onclick = () => {
    const chosen = $select('rmg-template').value;
    void openTemplateEditor(chosen === RANDOM ? undefined : chosen, source());
  };
  // Another install to read: the lists come from it, so they are read again.
  $input('rmg-mods').addEventListener('change', () => { void fill().catch((e) => { $('rmg-err').textContent = e instanceof Error ? e.message : String(e); }); });
  $('rmg-ok').onclick = () => { void submit(openMap, refresh); };
  $input('rmg-name').addEventListener('input', updateWhere);
  $select('rmg-size').addEventListener('change', () => { void refreshTemplates(); });
  $select('rmg-two').addEventListener('change', () => { void refreshTemplates(); });
  $select('rmg-template').addEventListener('change', refreshPlayers);
  $select('rmg-players').addEventListener('change', showRaceSlots);
  // The hero lists: a + each, the rule that makes them moot, and a clean slate.
  $('rmg-white-add').onclick = () => openPicker(white, 'Add to the white list');
  $('rmg-black-add').onclick = () => openPicker(black, 'Add to the black list');
  $input('rmg-heroes-of-races').addEventListener('change', renderLists);
  $('rmg-heroes-clear').onclick = () => { white.length = 0; black.length = 0; renderLists(); };
  $('rmg-pick-close').onclick = () => ($('rmg-pick') as HTMLDialogElement).close();
}
