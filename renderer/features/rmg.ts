// Random Map — the game's generator dialog, and the game's generator behind it.
//
// Field for field the dialog the game shows: size, levels, a template the
// game would OFFER for that size (the list narrows as the size and the levels
// change, the way the game's does), players inside the template's range,
// water, the monster level, the two multipliers, random towns, the grail, the
// minimap, and a seed — blank means the generator draws one, the way the game
// does. The lists come from the install through main, so a mod's template is
// offered beside the shipped ones and nothing here is typed twice.
//
// AND EVERY CHOICE CAN BE LEFT TO CHANCE. "Random" is the first option of
// each list; main draws it before the run, in the order the dialog's own
// dependencies go (size, levels, template, players), and the HUD says what
// came out. A fixed template with a random size is a size the template fits.
//
// Generating lands the map as New Map does — packed into `<game>/H5E/`, opened
// from that archive — so from the moment it exists it is a map like any other.

import { $, $button, $input, $select, fillSelect } from '#core/dom.ts';
import { api } from '#core/ipc.ts';
import { requireFilled } from '#core/form-gate.ts';
import type { RmgChoicesResult, RmgResolvedOrder, RmgTemplateEntry } from '#electron/ipc.ts';

const RANDOM = 'random';

const dialog = (): HTMLDialogElement => {
  const el = $('rmg');
  if (!(el instanceof HTMLDialogElement)) throw new Error('#rmg is not a <dialog>');
  return el;
};

let choices: RmgChoicesResult | null = null;
/** What the template list holds now — the offered ones, or all of them when the size or levels are random. */
let listed: RmgTemplateEntry[] = [];

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
    listed = await api.rmgTemplates({ sizeIndex: Number(size), underground });
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
  showHeroSlots();
}

/** The hero lists: the game's choice, one of the race drawn, or a named hero, grouped by race. */
function fillHeroes(): void {
  const byTown = new Map<string, { href: string; name: string }[]>();
  for (const h of choices?.heroes ?? []) {
    if (!byTown.has(h.town)) byTown.set(h.town, []);
    byTown.get(h.town)!.push(h);
  }
  for (let i = 1; i <= 8; i++) {
    const sel = $select(`rmg-hero-${i}`);
    const keep = sel.value;
    sel.replaceChildren();
    for (const [id, label] of [['any', "the game's choice"], ['random', 'one of the race, drawn']] as const) {
      const o = document.createElement('option');
      o.value = id;
      o.textContent = label;
      sel.appendChild(o);
    }
    for (const [town, heroes] of [...byTown].sort(([a], [b]) => a.localeCompare(b))) {
      const g = document.createElement('optgroup');
      g.label = pretty(town, 'TOWN_');
      for (const h of heroes) {
        const o = document.createElement('option');
        o.value = h.href;
        o.textContent = h.name;
        g.appendChild(o);
      }
      sel.appendChild(g);
    }
    sel.value = keep && [...sel.options].some((o) => o.value === keep) ? keep : 'any';
  }
}

/** Only the slots the players count reaches — all eight while it is left to chance. */
function showHeroSlots(): void {
  const players = $select('rmg-players').value;
  const shown = players === RANDOM ? 8 : Number(players);
  // `display`, not the `hidden` attribute: the row's own `display: flex`
  // would win over the attribute and the slot would stay on screen.
  for (let i = 1; i <= 8; i++) $select(`rmg-hero-${i}`).parentElement!.style.display = i > shown ? 'none' : '';
}

function updateWhere(): void {
  const name = $input('rmg-name').value.trim() || 'Random Map';
  $('rmg-where').textContent = `→ <game>/H5E/${name}.h5m · inside it Maps/RMG/<guid>, where the game keeps its own`;
}

/** The lists, read once per opening — a mod installed meanwhile shows up next time. */
async function fill(): Promise<void> {
  choices = await api.rmgChoices();
  const sizeSel = $select('rmg-size');
  const keepSize = sizeSel.value;
  fillSelect(sizeSel, withRandom(choices.sizes.map((s, i) => ({ id: String(i), label: `${pretty(s.name, 'MAP_SIZE_')} (${s.tiles}×${s.tiles})` }))),
    keepSize || '1');
  fillSelect($select('rmg-monsters'), enumOptions(choices.monsterLevels, 'MONSTER_LEVEL_'), $select('rmg-monsters').value || '1');
  fillSelect($select('rmg-resource'), enumOptions(choices.resourceMultipliers, 'RESOURCE_'), $select('rmg-resource').value || '2');
  fillSelect($select('rmg-exp'), enumOptions(choices.expMultipliers, 'EXP_'), $select('rmg-exp').value || '2');
  fillHeroes();
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

/** The order in one line for the HUD — what was drawn, spelled the way the lists spell it. */
function describe(o: RmgResolvedOrder): string {
  const c = choices!;
  return `${o.template} ${o.tiles}×${o.tiles}${o.underground ? ' two-level' : ''}, ${o.players} players`
    + `${o.water ? ', island map' : ''}, ${pretty(c.monsterLevels[o.monsterLevel] ?? '', 'MONSTER_LEVEL_').toLowerCase()} monsters`
    + `, resources ${pretty(c.resourceMultipliers[o.resourceMultiplier] ?? '', 'RESOURCE_').toLowerCase()}`
    + `, experience ${pretty(c.expMultipliers[o.expMultiplier] ?? '', 'EXP_').toLowerCase()}`
    + `${o.randomTowns ? ', random towns' : ''}${o.grail ? ', grail' : ''}`;
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
      heroes: Array.from({ length: 8 }, (_, i) => $select(`rmg-hero-${i + 1}`).value),
    });
    dialog().close();
    await open(r.mapPath, r.archive);
    // The generator's warnings are not failures: the map is there, and the
    // line says what it could not do — a named object the zone had no room
    // for. Each is on the console in full.
    for (const w of r.warnings) console.warn(`random map: ${w}`);
    const warned = r.warnings.length ? ` · ⚠ ${r.warnings.length === 1 ? r.warnings[0] : `${r.warnings.length} warnings (see console)`}` : '';
    $('hud').textContent = `random map → ${r.archive} · ${describe(r.order)} · seed ${r.seed} · ${r.objects} objects in ${(r.ms / 1000).toFixed(1)}s${warned}`;
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
  $('rmg-ok').onclick = () => { void submit(openMap, refresh); };
  $input('rmg-name').addEventListener('input', updateWhere);
  $select('rmg-size').addEventListener('change', () => { void refreshTemplates(); });
  $select('rmg-two').addEventListener('change', () => { void refreshTemplates(); });
  $select('rmg-template').addEventListener('change', refreshPlayers);
  $select('rmg-players').addEventListener('change', showHeroSlots);
}
