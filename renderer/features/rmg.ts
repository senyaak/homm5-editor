// Random Map — the game's generator dialog, and the game's generator behind it.
//
// Field for field the dialog the game shows: size, two levels, a template
// the game would OFFER for that size (the list narrows as the size and the
// floors change, the way the game's does), players inside the template's
// range, water, the monster level, the two multipliers, random towns, the
// grail, the minimap, and a seed — blank means the generator draws one, the
// way the game does. The lists come from the install through main, so a mod's
// template is offered beside the shipped ones and nothing here is typed twice.
//
// Generating lands the map as New Map does — packed into `<game>/H5E/`, opened
// from that archive — so from the moment it exists it is a map like any other.

import { $, $button, $input, $select, fillSelect } from '#core/dom.ts';
import { api } from '#core/ipc.ts';
import { requireFilled } from '#core/form-gate.ts';
import type { RmgChoicesResult, RmgTemplateEntry } from '#electron/ipc.ts';

const dialog = (): HTMLDialogElement => {
  const el = $('rmg');
  if (!(el instanceof HTMLDialogElement)) throw new Error('#rmg is not a <dialog>');
  return el;
};

let choices: RmgChoicesResult | null = null;
let offered: RmgTemplateEntry[] = [];

/** `MAP_SIZE_EXTRALARGE` → `Extra Large`; the enum's spelling, made readable. */
function pretty(name: string, prefix: string): string {
  const bare = name.startsWith(prefix) ? name.slice(prefix.length) : name;
  return bare.toLowerCase().split('_').map((w) => w[0]!.toUpperCase() + w.slice(1)).join(' ')
    .replace('Extralarge', 'Extra Large');
}

const enumOptions = (names: string[], prefix: string): { id: string; label: string }[] =>
  names.map((n, i) => ({ id: String(i), label: pretty(n, prefix) }));

/** The templates the game would offer for the size and floors now chosen. */
async function refreshTemplates(): Promise<void> {
  const sizeIndex = Number($select('rmg-size').value);
  const underground = $input('rmg-two').checked;
  const keep = $select('rmg-template').value;
  offered = await api.rmgTemplates({ sizeIndex, underground });
  fillSelect($select('rmg-template'),
    offered.map((t) => ({ id: t.file, label: t.name === t.file ? t.file : `${t.file} — ${t.name}` })),
    offered.some((t) => t.file === keep) ? keep : (offered[0]?.file ?? ''));
  $('rmg-template-note').textContent = offered.length
    ? `${offered.length} template${offered.length === 1 ? '' : 's'} fit this size${underground ? ' with an underground' : ''}`
    : `no template fits this size${underground ? ' with an underground' : ''} — the game would offer none either`;
  refreshPlayers();
  gate.check();
}

/** The players field follows the template's own range. */
function refreshPlayers(): void {
  const t = offered.find((x) => x.file === $select('rmg-template').value);
  const players = $input('rmg-players');
  if (!t) return;
  players.min = String(t.minPlayers);
  players.max = String(t.maxPlayers);
  const v = Number(players.value) || t.minPlayers;
  players.value = String(Math.min(t.maxPlayers, Math.max(t.minPlayers, v)));
  players.title = `${t.minPlayers}..${t.maxPlayers} for this template`;
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
  fillSelect(sizeSel, choices.sizes.map((s, i) => ({ id: String(i), label: `${pretty(s.name, 'MAP_SIZE_')} (${s.tiles}×${s.tiles})` })),
    keepSize || '1');
  fillSelect($select('rmg-monsters'), enumOptions(choices.monsterLevels, 'MONSTER_LEVEL_'), $select('rmg-monsters').value || '1');
  fillSelect($select('rmg-resource'), enumOptions(choices.resourceMultipliers, 'RESOURCE_'), $select('rmg-resource').value || '2');
  fillSelect($select('rmg-exp'), enumOptions(choices.expMultipliers, 'EXP_'), $select('rmg-exp').value || '2');
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
      template: $select('rmg-template').value,
      sizeIndex: Number($select('rmg-size').value),
      underground: $input('rmg-two').checked,
      water: $input('rmg-water').checked ? 2 : 0,
      players: Number($input('rmg-players').value),
      monsterLevel: Number($select('rmg-monsters').value),
      resourceMultiplier: Number($select('rmg-resource').value),
      expMultiplier: Number($select('rmg-exp').value),
      grail: $input('rmg-grail').checked,
      randomTowns: $input('rmg-towns').checked,
      minimap: $input('rmg-minimap').checked,
    });
    dialog().close();
    await open(r.mapPath, r.archive);
    $('hud').textContent = `random map → ${r.archive} · seed ${r.seed} · ${r.objects} objects in ${(r.ms / 1000).toFixed(1)}s`;
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
  $('rmg-ok').onclick = () => { void submit(openMap, refresh); };
  $input('rmg-name').addEventListener('input', updateWhere);
  $select('rmg-size').addEventListener('change', () => { void refreshTemplates(); });
  $input('rmg-two').addEventListener('change', () => { void refreshTemplates(); });
  $select('rmg-template').addEventListener('change', refreshPlayers);
  $input('rmg-players').addEventListener('change', refreshPlayers);
}
