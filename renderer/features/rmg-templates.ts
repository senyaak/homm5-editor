// The template editor — the random map generator's templates, drawn and edited.
//
// A template is a graph: zones, and which are joined. The diagram draws it the
// way an ER diagram draws entities — each zone a rectangle with its index and
// race in the header and its properties as rows below, a GLYPH and a number
// rather than a field name (a castle for the town and its guard, a pick for
// the mines, coins for the treasure, a gem for the relic ranges, a crate for
// the named objects; the name on hover) — and each connection a line labelled
// with its guard, dashed when it carries no road, two lines for a pair
// written twice. Click a zone or a line for its panel on the right, where
// every field is a control built from the field tables (`src/rmg/template.ts`:
// the game's fields and ours, each with the tag for its label and its doc for
// the tooltip); click the background for the template's own.
//
// The picture is not the map. The generator lays the map out from the graph
// alone; the diagram's positions are for the eye, laid out from the graph on
// opening (`src/rmg/diagram-layout.ts`) or kept in the file's `<Diagram>` once
// the author has dragged a box. Nothing here refuses a template — the
// generator warns instead — but the warning line under the diagram says what
// the generator would say.
//
// Saving writes `<game>/H5E/RMG/Templates/<file>.h5et`, the install's own
// folder, which the generator's dialog lists in front of the editor's and the
// game's: a game template opened here and saved under its own name shadows it.

import { $, $button, $input, $select, fillSelect } from '#core/dom.ts';
import { ask, modDialog } from '#core/dialog.ts';
import { api } from '#core/ipc.ts';
import type { PlaceableObject, RmgTemplateEntry } from '#electron/ipc.ts';
import { pickFromEntries } from '#features/inspector/refs.ts';
import type { PickEntry } from '#features/inspector/refs.ts';
import { layoutDiagram } from '#src/rmg/diagram-layout.ts';
import type { DiagramSize } from '#src/rmg/diagram-layout.ts';
import { RACE_BY_NAME } from '#src/rmg/load-template.ts';
import { CONNECTION_FIELDS, TEMPLATE_FIELDS, ZONE_FIELDS, ZONE_LAYOUT_KINDS, OUR_CONNECTION_FIELDS, OUR_TEMPLATE_FIELDS, OUR_ZONE_FIELDS } from '#src/rmg/template.ts';
import type { FieldSpec, RmgConnection, RmgTemplate, RmgZone, ZoneLayoutKind } from '#src/rmg/template.ts';

type Source = RmgTemplateEntry['source'] | 'new';
type Selection = { kind: 'zone'; index: number } | { kind: 'conn'; at: number } | null;

interface Point { x: number; y: number }

let list: RmgTemplateEntry[] = [];
let t: RmgTemplate | null = null;
let file = '';
let source: Source = 'new';
/** Where each zone's box is drawn, by index, in thousandths of the square. */
let pos = new Map<number, Point>();
let sel: Selection = null;
/** Connect mode: off, or waiting for the first zone (-1), or holding it. */
let connectFrom: number | null = null;
let dirty = false;
/** How many templates have been taken up — what an opening checks after its wait, see `openTemplateEditor`. */
let takes = 0;
/** Told when a template was saved or removed, so the generator's list can follow. */
let onChanged: () => void = () => {};

const SVG_NS = 'http://www.w3.org/2000/svg';
const dialog = (): HTMLDialogElement => modDialog('rte');

// ---------------------------------------------------------------------------
// The defaults a new zone and a new template start from
// ---------------------------------------------------------------------------

/**
 * A zone to start from: the first zone of `S1P2Z2M1`, the game's smallest
 * two-player template — a start zone with a town, one mine of each kind but
 * gold, one tier-1 dwelling, and the densities every shipped template uses.
 * Copied here rather than read, because a new template must be possible
 * with nothing open; the numbers are the file's. The dead fields are not
 * here: the writer fills them in (`template-game.ts`).
 */
function starterZone(index: number): RmgZone {
  return {
    index, setting: 'RACE_RANDOM_TYPE', size: 10, canBePlayerStart: true, town: true, townGuardStrenght: 1, shipyard: null,
    mines: [1, 1, 1, 1, 1, 1, 0], abandonedMines: 0, dwellings: [1, 0, 0, 0, 0, 0, 0],
    upgBuildingsDensity: 40, treasureDensity: 15, treasureChestDensity: 5, prisons: 0, landCartographer: 0,
    shopPoints: 10, shrinePoints: 10, luckMoralBuildingsDensity: 60, resourceBuildingsDensity: 80,
    treasureBuildingPoints: 10, treasureBlocksTotalValue: 10000,
    guardMultiplier: 1, treasureBlocks: [], objects: [],
  };
}

/** A connection between two zones, guarded the way `S1P2Z2M1` guards its start zones' passages. */
function starterConnection(a: number, b: number): RmgConnection {
  return { sourceZoneIndex: a, destZoneIndex: b, guardStrenght: 3, road: true };
}

/** Two start zones joined — the least a playable template is. */
function starterTemplate(): RmgTemplate {
  return {
    nameFileRef: null, descriptionFileRef: '', name: 'New Template',
    zones: [starterZone(1), starterZone(2)], connections: [starterConnection(1, 2)],
    minPlayers: 2, maxPlayers: 2, minMapSize: 5, maxMapSize: 14, testTemplate: false,
    diagram: [], zoneLayout: 'Engine', layoutJitter: 0, uniqueRaces: false,
  };
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

/** `RACE_RANDOM_TYPE` → `random`, `RACE_HEAVEN` → `Heaven`. */
function raceWord(setting: string): string {
  if (setting === 'RACE_RANDOM_TYPE') return 'random';
  const bare = setting.replace(/^RACE_/, '').toLowerCase();
  return bare[0]!.toUpperCase() + bare.slice(1);
}

/** `/MapObjects/Dragon_Utopia.(AdvMapBuildingShared).xdb#xpointer(…)` → `Dragon_Utopia`. */
function objectWord(href: string): string {
  const base = href.split('#')[0]!.split('/').pop() ?? href;
  return base.replace(/\.\(.*$/, '').replace(/\.xdb$/, '');
}

/** 15000 → `15k`, 2500 → `2.5k`, 800 → `800`. */
function thousands(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  return `${Number.isInteger(k) ? k : k.toFixed(1)}k`;
}

const sourceWord: Record<Source, string> = { user: 'yours', app: 'the editor\'s', game: 'the game\'s', new: 'unsaved' };

// ---------------------------------------------------------------------------
// The diagram
// ---------------------------------------------------------------------------

/** A box's width: enough for its longest row (about 11 units a character at 22px), never under this. */
const BOX_W = 210;
const boxWidth = (z: RmgZone): number =>
  Math.max(BOX_W, ...zoneRows(z).map((r) => PAD + 30 + r.text.length * 11.5 + PAD));
const HEAD_H = 34;
const ROW_H = 26;
const PAD = 8;

/** The glyphs, drawn by hand in a 24×24 box — one sign per notion. */
const GLYPHS: Record<string, { d: string; solid?: boolean }> = {
  area: { d: 'M5 5h14v14H5z' },
  flag: { d: 'M6 3v18M6 4l12 4-12 4z' },
  castle: { d: 'M4 20V9h3V6h3v3h4V6h3v3h3v11zM10 20v-5h4v5' },
  times: { d: 'M6 6l12 12M18 6L6 18' },
  pick: { d: 'M4 20L15 9M8 6q7-3 11 4' },
  house: { d: 'M4 12l8-8 8 8v8H4zM10 20v-5h4v5' },
  coins: { d: 'M9 14a4 4 0 1 0 0.01 0M15 10a4 4 0 1 0 0.01 0' },
  gem: { d: 'M12 3l9 7-9 11-9-7zM3 10h18' },
  crate: { d: 'M4 8h16v12H4zM4 12h16M12 8v12' },
  sword: { d: 'M5 19L16 8M14 6l4 4M4 20l2-2' },
};

/** One row of a zone's box: which glyph, and what it says. */
interface Row { glyph: string; text: string; title: string }

/**
 * The rows of a zone's box — the essentials, one line a notion, the way the
 * HotA editor's picture shows a zone's size, owner, towns and riches and
 * leaves the lists to the settings: which mines, which tiers, each range,
 * each named object are the panel's; the box says how much of each there
 * is, and the full list is on hover.
 */
function zoneRows(z: RmgZone): Row[] {
  const sum = (a: number[]): number => a.reduce((s, n) => s + n, 0);
  const rows: Row[] = [{ glyph: 'area', text: String(z.size), title: 'Size — relative; the zones divide the map in proportion' }];
  if (z.town) rows.push({ glyph: 'castle', text: String(z.townGuardStrenght), title: 'Town, and its guard (TownGuardStrenght)' });
  if (z.guardMultiplier !== 1) rows.push({ glyph: 'times', text: `×${z.guardMultiplier}`, title: 'GuardMultiplier — the zone\'s own guards, scaled' });
  if (sum(z.mines)) rows.push({ glyph: 'pick', text: String(sum(z.mines)), title: `Mines: ${z.mines.join(' ')} — wood, ore, mercury, crystal, sulfur, gems, gold` });
  if (sum(z.dwellings)) rows.push({ glyph: 'house', text: String(sum(z.dwellings)), title: `Dwellings by tier: ${z.dwellings.join(' ')}` });
  if (z.treasureBlocks.length) {
    const lo = Math.min(...z.treasureBlocks.map((r) => r.min));
    const hi = Math.max(...z.treasureBlocks.map((r) => r.max));
    const each = z.treasureBlocks.map((r) => `${r.count}× ${thousands(r.min)}–${thousands(r.max)}`).join(', ');
    rows.push({ glyph: 'gem', text: `${sum(z.treasureBlocks.map((r) => r.count))}× ${thousands(lo)}–${thousands(hi)}`, title: `TreasureBlocks — ${each}` });
  } else {
    rows.push({ glyph: 'coins', text: thousands(z.treasureBlocksTotalValue), title: 'TreasureBlocksTotalValue' });
  }
  if (z.objects.length) {
    const forced = sum(z.objects.map((o) => o.min));
    const barred = z.objects.filter((o) => o.max === 0).length;
    const each = z.objects.map((o) => {
      const how = o.max === 0 ? 'barred' : `${o.min}${Number.isFinite(o.max) ? `..${o.max}` : '+'}`;
      return `${objectWord(o.href)} ${how}${o.guardStrenght ? ` ⚔${o.guardStrenght}` : ''}`;
    }).join(', ');
    const text = [forced ? `+${forced}` : '', barred ? `−${barred}` : ''].filter(Boolean).join(' ') || '∅';
    rows.push({ glyph: 'crate', text, title: `Objects — ${each}` });
  }
  return rows;
}

const boxHeight = (z: RmgZone): number => HEAD_H + zoneRows(z).length * ROW_H + PAD;

/** Every box's size, for the layout to keep them apart. */
const boxSizes = (): Map<number, DiagramSize> => new Map(t!.zones.map((z) => [z.index, { w: boxWidth(z), h: boxHeight(z) }]));
const layout = (): Map<number, Point> => layoutDiagram(t!.zones, t!.connections, boxSizes());

/**
 * The view fits the picture: the boxes' bounding box with a margin, never
 * smaller than the bare square, so a small template keeps its scale and a
 * big one — seven zones with a dozen named objects each — is all on screen.
 */
function fitView(svg: SVGSVGElement): void {
  let minX = Number.POSITIVE_INFINITY, minY = Number.POSITIVE_INFINITY, maxX = 0, maxY = 0;
  for (const z of t!.zones) {
    const p = centre(z.index);
    const w = boxWidth(z), h = boxHeight(z);
    minX = Math.min(minX, p.x - w / 2); maxX = Math.max(maxX, p.x + w / 2);
    minY = Math.min(minY, p.y - h / 2); maxY = Math.max(maxY, p.y + h / 2);
  }
  if (!Number.isFinite(minX)) { svg.setAttribute('viewBox', '0 0 1000 1000'); return; }
  const m = 40;
  const w = Math.max(1000, maxX - minX + 2 * m);
  const h = Math.max(1000, maxY - minY + 2 * m);
  svg.setAttribute('viewBox', `${Math.min(0, minX - m)} ${Math.min(0, minY - m)} ${w} ${h}`);
}

function el<K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

/**
 * A glyph at (x, y), 22 units square, with its name on hover. Drawn in place
 * rather than through <symbol>/<use>: Chrome styles a use's shadow tree by
 * the referenced element alone, so a rule with an ancestor in it
 * (`.rte-zone .glyph`) never reaches the path and the shapes come out black.
 */
function glyph(name: string, x: number, y: number, title: string): SVGGElement {
  const shape = GLYPHS[name]!;
  const g = el('g', { class: 'glyph-box', transform: `translate(${x} ${y}) scale(${22 / 24})` });
  g.appendChild(el('path', { d: shape.d, class: `glyph${shape.solid ? ' solid' : ''}` }));
  const tt = el('title');
  tt.textContent = title;
  g.appendChild(tt);
  return g;
}

function textEl(x: number, y: number, s: string, cls = ''): SVGTextElement {
  const e = el('text', { x, y, class: cls });
  e.textContent = s;
  return e;
}

/** A box's centre, laying the picture out from the graph when a zone has none yet. */
function centre(index: number): Point {
  let p = pos.get(index);
  if (!p) {
    pos = layout();
    p = pos.get(index) ?? { x: 500, y: 500 };
  }
  return p;
}

/** Draw the picture from the model. Cheap enough to redo on every change. */
function render(): void {
  const svg = $('rte-svg') as unknown as SVGSVGElement;
  svg.replaceChildren();
  if (!t) return;

  // The connections first, so the boxes cover their ends. A pair joined more
  // than once bows each line a little to one side so both can be seen.
  const seen = new Map<string, number>();
  const key = (c: RmgConnection): string => [c.sourceZoneIndex, c.destZoneIndex].sort((a, b) => a - b).join('-');
  const total = new Map<string, number>();
  for (const c of t.connections) total.set(key(c), (total.get(key(c)) ?? 0) + 1);
  t.connections.forEach((c, at) => {
    const a = t!.zones.find((z) => z.index === c.sourceZoneIndex);
    const b = t!.zones.find((z) => z.index === c.destZoneIndex);
    if (!a || !b) return;
    const pa = centre(a.index);
    const pb = centre(b.index);
    const k = seen.get(key(c)) ?? 0;
    seen.set(key(c), k + 1);
    const n = total.get(key(c)) ?? 1;
    const bow = (k - (n - 1) / 2) * 90;
    const dx = pb.x - pa.x;
    const dy = pb.y - pa.y;
    const d = Math.max(1, Math.hypot(dx, dy));
    const mx = (pa.x + pb.x) / 2 - (dy / d) * bow;
    const my = (pa.y + pb.y) / 2 + (dx / d) * bow;
    const g = el('g', { class: `rte-conn${c.road ? '' : ' roadless'}${sel?.kind === 'conn' && sel.at === at ? ' selected' : ''}`, 'data-at': at });
    const path = `M${pa.x} ${pa.y} Q${mx} ${my} ${pb.x} ${pb.y}`;
    g.appendChild(el('path', { d: path, class: 'hit' }));
    g.appendChild(el('path', { d: path, class: 'line' }));
    // The label on the curve's midpoint, which for a quadratic is a quarter of the way to the control point.
    const lx = (pa.x + pb.x) / 2 * 0.5 + mx * 0.5;
    const ly = (pa.y + pb.y) / 2 * 0.5 + my * 0.5;
    g.appendChild(textEl(lx, ly + 7, `${c.guardStrenght}${c.road ? '' : ' ⋯'}`));
    const title = el('title');
    title.textContent = `${c.sourceZoneIndex} — ${c.destZoneIndex}: guard ${c.guardStrenght}${c.road ? '' : ', no road'}`;
    g.appendChild(title);
    g.addEventListener('pointerdown', (e) => { e.stopPropagation(); select({ kind: 'conn', at }); });
    svg.appendChild(g);
  });

  for (const z of t.zones) {
    const p = centre(z.index);
    const h = boxHeight(z);
    const w = boxWidth(z);
    const x = p.x - w / 2;
    const y = p.y - h / 2;
    const cls = ['rte-zone', z.canBePlayerStart ? 'start' : '', sel?.kind === 'zone' && sel.index === z.index ? 'selected' : '',
      connectFrom === z.index ? 'connecting' : ''].filter(Boolean).join(' ');
    const g = el('g', { class: cls, 'data-index': z.index, transform: `translate(${x} ${y})` });
    g.appendChild(el('rect', { class: 'box', width: w, height: h, rx: 10 }));
    g.appendChild(el('rect', { class: 'head', x: 2, y: 2, width: w - 4, height: HEAD_H - 2, rx: 8 }));
    g.appendChild(textEl(PAD + 2, 25, `#${z.index}`, 'title'));
    g.appendChild(textEl(PAD + 50, 25, raceWord(z.setting), z.setting === 'RACE_RANDOM_TYPE' ? 'dim' : ''));
    if (z.canBePlayerStart) g.appendChild(glyph('flag', w - 30, 6, 'CanBePlayerStart — a player starts here'));
    zoneRows(z).forEach((row, i) => {
      const ry = HEAD_H + i * ROW_H;
      g.appendChild(glyph(row.glyph, PAD, ry + 3, row.title));
      g.appendChild(textEl(PAD + 30, ry + 21, row.text));
    });
    g.addEventListener('pointerdown', (e) => onZoneDown(e, z.index));
    svg.appendChild(g);
  }
  fitView(svg);
  warn();
}

// ---------------------------------------------------------------------------
// Dragging, selecting, connecting
// ---------------------------------------------------------------------------

/** A pointer's place in the diagram's own units. */
function diagramPoint(e: PointerEvent): Point {
  const svg = $('rte-svg') as unknown as SVGSVGElement;
  const m = svg.getScreenCTM();
  if (!m) return { x: 0, y: 0 };
  const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
  return { x: p.x, y: p.y };
}

function onZoneDown(e: PointerEvent, index: number): void {
  e.stopPropagation();
  if (connectFrom !== null) {
    if (connectFrom < 0) {
      connectFrom = index;
      $('rte-hint').textContent = `zone #${index} — now click the zone to join it to (Esc to stop)`;
      render();
    } else {
      addConnection(connectFrom, index);
    }
    return;
  }
  select({ kind: 'zone', index });
  const svg = $('rte-svg') as unknown as SVGSVGElement;
  const start = diagramPoint(e);
  const from = { ...centre(index) };
  let moved = false;
  const g = svg.querySelector(`.rte-zone[data-index="${index}"]`);
  g?.classList.add('dragging');
  const move = (ev: PointerEvent): void => {
    const now = diagramPoint(ev);
    const next = { x: Math.round(from.x + now.x - start.x), y: Math.round(from.y + now.y - start.y) };
    if (!moved && Math.hypot(next.x - from.x, next.y - from.y) < 4) return;
    moved = true;
    pos.set(index, next);
    render();
  };
  const up = (): void => {
    svg.removeEventListener('pointermove', move);
    svg.removeEventListener('pointerup', up);
    svg.removeEventListener('pointercancel', up);
    if (moved) markDirty();
    render();
  };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerup', up);
  svg.addEventListener('pointercancel', up);
}

function select(s: Selection): void {
  sel = s;
  $button('rte-remove').disabled = !s;
  render();
  panel();
}

function setConnectMode(on: boolean): void {
  connectFrom = on ? -1 : null;
  $button('rte-connect').classList.toggle('on', on);
  $('rte-hint').textContent = on ? 'click the first zone (Esc to stop)' : '';
  render();
}

function addConnection(a: number, b: number): void {
  if (!t) return;
  t.connections.push(starterConnection(a, b));
  markDirty();
  setConnectMode(false);
  select({ kind: 'conn', at: t.connections.length - 1 });
}

function addZone(): void {
  if (!t) return;
  const index = t.zones.reduce((m, z) => Math.max(m, z.index), 0) + 1;
  const last = t.zones[t.zones.length - 1];
  // A copy of the last zone, its own index — the way an author adds "one more like that".
  const z: RmgZone = last ? structuredClone({ ...last, index }) : starterZone(index);
  t.zones.push(z);
  // Beside the last box, or wherever the springs put it when there is none.
  const near = last ? centre(last.index) : { x: 500, y: 500 };
  pos.set(index, { x: near.x + (last ? boxWidth(last) : BOX_W) / 2 + BOX_W / 2 + 40, y: near.y });
  markDirty();
  select({ kind: 'zone', index });
}

function removeSelected(): void {
  if (!t || !sel) return;
  if (sel.kind === 'zone') {
    const index = sel.index;
    t.zones = t.zones.filter((z) => z.index !== index);
    t.connections = t.connections.filter((c) => c.sourceZoneIndex !== index && c.destZoneIndex !== index);
    pos.delete(index);
  } else {
    t.connections.splice(sel.at, 1);
  }
  markDirty();
  select(null);
}

function arrange(): void {
  if (!t) return;
  pos = layout();
  markDirty();
  render();
}

// ---------------------------------------------------------------------------
// The panel — controls from the field tables
// ---------------------------------------------------------------------------

/** A labelled row: the tag as the label, the doc on hover, ours in their own colour. */
function row(f: FieldSpec, ours: boolean, control: HTMLElement): HTMLElement {
  const r = document.createElement('div');
  r.className = 'rte-row';
  const label = document.createElement('span');
  label.textContent = f.tag;
  label.title = f.doc;
  if (ours) label.className = 'ours';
  r.append(label, control);
  return r;
}

function numberInput(value: number, step: number, onChange: (v: number) => void): HTMLInputElement {
  const i = document.createElement('input');
  i.type = 'number';
  i.step = String(step);
  i.value = String(value);
  i.addEventListener('change', () => { onChange(Number(i.value) || 0); });
  return i;
}

function selectInput(options: { id: string; label: string }[], value: string, onChange: (v: string) => void): HTMLSelectElement {
  const s = document.createElement('select');
  fillSelect(s, options, value);
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

const boolOptions = [{ id: 'true', label: 'true' }, { id: 'false', label: 'false' }];

/** Seven small boxes; a list shorter than seven grows as far as the edited tier (its length is the file's). */
function tiersInput(initial: number[], onChange: (v: number[]) => void): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'rte-tiers';
  // The list as it stands NOW — each change starts from the last one, not
  // from the list the row was built with (a second edit once undid the first).
  let values = initial;
  for (let tier = 0; tier < 7; tier++) {
    const i = document.createElement('input');
    i.type = 'number';
    i.min = '0';
    i.value = String(values[tier] ?? 0);
    i.title = `tier ${tier + 1}`;
    i.addEventListener('change', () => {
      const next = values.slice();
      while (next.length <= tier) next.push(0);
      next[tier] = Math.max(0, Math.round(Number(i.value) || 0));
      values = next;
      onChange(next);
    });
    wrap.appendChild(i);
  }
  return wrap;
}

/** One field of a record as a control, by its kind; null for the kinds the panel does not show. */
function control(f: FieldSpec, record: Record<string, unknown>, key: string, after: () => void): HTMLElement | null {
  const set = (v: unknown): void => { record[key] = v; markDirty(); after(); };
  const value = record[key];
  switch (f.kind) {
    case 'int': return numberInput(value as number, 1, (v) => set(Math.round(v)));
    case 'float': return numberInput(value as number, 0.1, (v) => set(f.min !== undefined && f.max !== undefined ? Math.min(f.max, Math.max(f.min, v)) : v));
    case 'bool':
      if (f.optional) {
        return selectInput([{ id: '', label: '(not written — the engine\'s default)' }, ...boolOptions], value === null ? '' : String(value),
          (v) => set(v === '' ? null : v === 'true'));
      }
      return selectInput(boolOptions, String(value), (v) => set(v === 'true'));
    case 'text': {
      if (key === 'setting') {
        return selectInput(Object.keys(RACE_BY_NAME).map((id) => ({ id, label: raceWord(id) })), value as string, set);
      }
      const i = document.createElement('input');
      i.type = 'text';
      i.value = value as string;
      i.addEventListener('change', () => set(i.value));
      return i;
    }
    case 'tiers': return tiersInput(value as number[], set);
    case 'layout': return selectInput(ZONE_LAYOUT_KINDS.map((id) => ({ id, label: id })), value as string, (v) => set(v as ZoneLayoutKind));
    default: return null;
  }
}

function heading(text: string, level: 'h3' | 'h4' = 'h3'): HTMLElement {
  const h = document.createElement(level);
  h.textContent = text;
  return h;
}

/** The plain fields of a record, the game's then ours, skipping the dead and the structured. */
function plainRows(panelEl: HTMLElement, record: Record<string, unknown>, fields: Record<string, FieldSpec>, ours: Record<string, FieldSpec>, after: () => void, skip: string[] = []): void {
  for (const [key, f] of Object.entries(fields)) {
    if (f.dead || skip.includes(key)) continue;
    const c = control(f, record, key, after);
    if (c) panelEl.appendChild(row(f, key in ours, c));
  }
}

/** A `+` under a list, and a `×` beside each item. */
function listEditor<T>(items: T[], make: () => T, item: (x: T, remove: () => void) => HTMLElement, rerender: () => void): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'rte-list';
  items.forEach((x, i) => wrap.appendChild(item(x, () => { items.splice(i, 1); markDirty(); rerender(); })));
  const add = document.createElement('button');
  add.className = 'rte-add';
  add.textContent = '+ add';
  add.addEventListener('click', () => { items.push(make()); markDirty(); rerender(); });
  wrap.appendChild(add);
  return wrap;
}

function smallNumber(value: number, title: string, onChange: (v: number) => void, blankIsInfinity = false): HTMLInputElement {
  const i = document.createElement('input');
  i.className = 'num';
  i.type = 'number';
  i.title = title;
  i.value = Number.isFinite(value) ? String(value) : '';
  if (blankIsInfinity) i.placeholder = '∞';
  i.addEventListener('change', () => {
    if (blankIsInfinity && i.value.trim() === '') { onChange(Number.POSITIVE_INFINITY); return; }
    onChange(Math.round(Number(i.value) || 0));
  });
  return i;
}

function removeButton(remove: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = '×';
  b.title = 'remove';
  b.addEventListener('click', remove);
  return b;
}

/**
 * What a zone may name: the palette's buildings, each by the shared
 * document a placed one points at (the href the template writes), labelled
 * as the palette labels it and grouped as the original's filter groups it.
 * Read once; the palette scans the same catalogue.
 */
let buildingsLoad: Promise<PickEntry[]> | null = null;
function buildings(): Promise<PickEntry[]> {
  buildingsLoad ??= api.listObjects().then((r) => r.objects
    .filter((o: PlaceableObject) => o.type === 'AdvMapBuilding' && !o.random && !o.hidden)
    .sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label))
    .map((o) => ({ id: o.shared, name: o.label, group: o.group })));
  return buildingsLoad;
}

function zonePanel(z: RmgZone): void {
  const p = $('rte-panel');
  p.replaceChildren(heading(`Zone #${z.index}`));
  const record = z as unknown as Record<string, unknown>;
  const after = (): void => render();
  // The index is the zone's name to every connection; it is not edited here.
  const idx = document.createElement('input');
  idx.type = 'number';
  idx.value = String(z.index);
  idx.readOnly = true;
  p.appendChild(row(ZONE_FIELDS.index, false, idx));
  plainRows(p, record, ZONE_FIELDS, OUR_ZONE_FIELDS, after, ['index']);

  p.appendChild(heading(ZONE_FIELDS.treasureBlocks.tag, 'h4'));
  p.appendChild(doc(ZONE_FIELDS.treasureBlocks.doc));
  p.appendChild(listEditor(z.treasureBlocks, () => ({ min: 2000, max: 5000, count: 1 }), (r, remove) => {
    const d = document.createElement('div');
    d.className = 'rte-item';
    d.append(
      smallNumber(r.count, 'Count', (v) => { r.count = v; markDirty(); render(); }),
      textNode('×'),
      smallNumber(r.min, 'Min', (v) => { r.min = v; markDirty(); render(); }),
      textNode('–'),
      smallNumber(r.max, 'Max', (v) => { r.max = v; markDirty(); render(); }),
      removeButton(remove));
    return d;
  }, () => zonePanel(z)));

  p.appendChild(heading(ZONE_FIELDS.objects.tag, 'h4'));
  p.appendChild(doc(ZONE_FIELDS.objects.doc));
  p.appendChild(listEditor(z.objects, () => ({ href: '/MapObjects/Dragon_Utopia.(AdvMapBuildingShared).xdb', min: 1, max: 1, guardStrenght: 0 }), (o, remove) => {
    const d = document.createElement('div');
    d.className = 'rte-item';
    const href = document.createElement('input');
    href.type = 'text';
    href.value = o.href;
    href.title = 'Href — the building\'s document';
    href.spellcheck = false;
    href.addEventListener('change', () => { o.href = href.value.trim(); markDirty(); render(); });
    // The picker: the palette's buildings, since a named object is placed
    // and written as a building (`run.ts`, `priced`).
    const browse = document.createElement('button');
    browse.textContent = '…';
    browse.title = 'pick a building from the palette';
    browse.addEventListener('click', () => {
      void pickFromEntries('Select a building', buildings(), o.href).then((picked) => {
        if (picked === null) return;
        o.href = picked;
        markDirty();
        render();
        zonePanel(z);
      });
    });
    d.append(href, browse,
      smallNumber(o.min, 'Min — placed before the budgets', (v) => { o.min = v; markDirty(); render(); }),
      smallNumber(o.max, 'Max — the ceiling; blank for none, 0 to forbid', (v) => { o.max = v; markDirty(); render(); }, true),
      smallNumber(o.guardStrenght, 'GuardStrenght — on each forced one; 0 for none', (v) => { o.guardStrenght = v; markDirty(); render(); }),
      removeButton(remove));
    return d;
  }, () => zonePanel(z)));
}

function connectionPanel(c: RmgConnection, at: number): void {
  const p = $('rte-panel');
  p.replaceChildren(heading(`Connection ${c.sourceZoneIndex} — ${c.destZoneIndex}`));
  const zones = t!.zones.map((z) => ({ id: String(z.index), label: `#${z.index} ${raceWord(z.setting)}` }));
  p.appendChild(row(CONNECTION_FIELDS.sourceZoneIndex, false, selectInput(zones, String(c.sourceZoneIndex), (v) => { c.sourceZoneIndex = Number(v); markDirty(); connectionPanel(c, at); render(); })));
  p.appendChild(row(CONNECTION_FIELDS.destZoneIndex, false, selectInput(zones, String(c.destZoneIndex), (v) => { c.destZoneIndex = Number(v); markDirty(); connectionPanel(c, at); render(); })));
  plainRows(p, c as unknown as Record<string, unknown>, CONNECTION_FIELDS, OUR_CONNECTION_FIELDS, render, ['sourceZoneIndex', 'destZoneIndex']);
  p.appendChild(doc(OUR_CONNECTION_FIELDS.road.doc));
}

function templatePanel(): void {
  const p = $('rte-panel');
  p.replaceChildren(heading('Template'));
  plainRows(p, t as unknown as Record<string, unknown>, TEMPLATE_FIELDS, OUR_TEMPLATE_FIELDS, () => { render(); refreshList(); });
  p.appendChild(doc(`${t!.zones.length} zones, ${t!.connections.length} connections. Click a zone or a line to edit it; drag a zone to arrange the picture.`));
}

function doc(text: string): HTMLElement {
  const d = document.createElement('div');
  d.className = 'rte-doc';
  d.textContent = text;
  return d;
}

const textNode = (s: string): Text => document.createTextNode(s);

function panel(): void {
  if (!t) { $('rte-panel').replaceChildren(); return; }
  if (sel?.kind === 'zone') {
    const index = sel.index;
    const z = t.zones.find((x) => x.index === index);
    if (z) { zonePanel(z); return; }
  }
  if (sel?.kind === 'conn') {
    const c = t.connections[sel.at];
    if (c) { connectionPanel(c, sel.at); return; }
  }
  templatePanel();
}

// ---------------------------------------------------------------------------
// What the generator would say
// ---------------------------------------------------------------------------

function warn(): void {
  const out: string[] = [];
  if (t) {
    const indices = t.zones.map((z) => z.index);
    const dup = indices.filter((i, k) => indices.indexOf(i) !== k);
    if (dup.length) out.push(`zone index ${[...new Set(dup)].join(', ')} used twice`);
    if (!t.zones.length) out.push('no zones');
    const starts = t.zones.filter((z) => z.canBePlayerStart).length;
    if (t.zones.length && !starts) out.push('no zone can be a player start');
    if (starts && t.maxPlayers > starts) out.push(`${t.maxPlayers} players asked, ${starts} start zone${starts === 1 ? '' : 's'}`);
    if (t.minPlayers > t.maxPlayers) out.push('MinPlayers above MaxPlayers');
    if (t.minMapSize > t.maxMapSize) out.push('MinMapSize above MaxMapSize');
    const known = new Set(indices);
    for (const c of t.connections) {
      if (!known.has(c.sourceZoneIndex) || !known.has(c.destZoneIndex)) out.push(`connection ${c.sourceZoneIndex} — ${c.destZoneIndex} names a zone that is not there`);
      if (c.sourceZoneIndex === c.destZoneIndex) out.push(`connection ${c.sourceZoneIndex} — ${c.destZoneIndex} joins a zone to itself`);
    }
    const joined = new Set(t.connections.flatMap((c) => [c.sourceZoneIndex, c.destZoneIndex]));
    const lonely = t.zones.filter((z) => !joined.has(z.index)).map((z) => `#${z.index}`);
    if (t.zones.length > 1 && lonely.length) out.push(`joined to nothing: ${lonely.join(', ')}`);
    if (!t.name.trim()) out.push('no name');
  }
  $('rte-warn').textContent = out.join('\n');
}

// ---------------------------------------------------------------------------
// The list, opening, saving
// ---------------------------------------------------------------------------

function markDirty(): void {
  dirty = true;
  updateWhere();
}

function updateWhere(): void {
  const f = $input('rte-file').value.trim() || file;
  $('rte-where').textContent = `${sourceWord[source]}${dirty ? ', edited' : ''} → <game>/H5E/RMG/Templates/${f || '…'}.h5et`;
  $button('rte-delete').disabled = source !== 'user';
}

function refreshList(): void {
  const opts = list.map((e) => ({ id: e.file, label: `${e.file}${e.name && e.name !== e.file ? ` — ${e.name}` : ''} · ${sourceWord[e.source]}` }));
  if (source === 'new') opts.unshift({ id: '', label: `${t?.name ?? 'New Template'} · unsaved` });
  fillSelect($select('rte-list'), opts, source === 'new' ? '' : file);
}

/** The list, from the generator's own process — seconds the first time a session, when the spinner shows. */
async function loadList(): Promise<void> {
  $('rte-loading').hidden = false;
  try {
    list = (await api.rmgChoices()).templates;
  } finally {
    $('rte-loading').hidden = true;
  }
  refreshList();
}

/** Take a template up: its picture from the file, or from the graph. */
function take(template: RmgTemplate, name: string, from: Source): void {
  takes++;
  t = template;
  file = name;
  source = from;
  dirty = false;
  sel = null;
  connectFrom = null;
  $button('rte-connect').classList.remove('on');
  $('rte-hint').textContent = '';
  $('rte-err').textContent = '';
  $input('rte-file').value = name;
  pos = new Map(t.diagram.map((n) => [n.index, { x: n.x, y: n.y }]));
  if (t.zones.some((z) => !pos.has(z.index))) pos = layout();
  $button('rte-remove').disabled = true;
  updateWhere();
  refreshList();
  render();
  panel();
}

async function load(name: string): Promise<void> {
  try {
    const r = await api.rmgTemplateRead(name);
    take(r.template, r.file, r.source);
  } catch (e) {
    $('rte-err').textContent = e instanceof Error ? e.message : String(e);
  }
}

/** Leave the one on screen? Asks when it has unsaved edits. */
async function mayLeave(): Promise<boolean> {
  if (!dirty) return true;
  return ask(`${t?.name ?? 'This template'} has unsaved changes — discard them?`, 'Discard');
}

async function save(): Promise<void> {
  if (!t) return;
  const name = $input('rte-file').value.trim();
  $('rte-err').textContent = '';
  try {
    // The picture goes with the file — every box, as it stands.
    t.diagram = t.zones.map((z) => { const p = centre(z.index); return { index: z.index, x: Math.round(p.x), y: Math.round(p.y) }; });
    await api.rmgTemplateSave({ file: name, template: t });
    file = name;
    source = 'user';
    dirty = false;
    await loadList();
    updateWhere();
    onChanged();
  } catch (e) {
    $('rte-err').textContent = e instanceof Error ? e.message : String(e);
  }
}

async function remove(): Promise<void> {
  if (source !== 'user') return;
  if (!(await ask(`Delete ${file}.h5et — the install's own copy? ${list.some((e) => e.file === file && e.source !== 'user') ? '' : 'Nothing else has this template.'}`, 'Delete'))) return;
  try {
    await api.rmgTemplateDelete(file);
    dirty = false;
    await loadList();
    onChanged();
    const still = list.find((e) => e.file === file);
    if (still) await load(still.file);
    else if (list.length) await load(list[0]!.file);
    else take(starterTemplate(), 'New Template', 'new');
  } catch (e) {
    $('rte-err').textContent = e instanceof Error ? e.message : String(e);
  }
}

/**
 * Open the editor, on the named template or the first listed.
 *
 * The list may be seconds away (the first read of the install), and the
 * editor is usable meanwhile — New, and everything after it. Whatever was
 * taken up during the wait stays: the list arrives into the select, and the
 * template it would have opened is not loaded over the user's.
 */
export async function openTemplateEditor(name?: string): Promise<void> {
  const d = dialog();
  if (!d.open) d.showModal();
  $('rte-err').textContent = '';
  const taken = takes;
  try {
    await loadList();
  } catch (e) {
    $('rte-err').textContent = e instanceof Error ? e.message : String(e);
    return;
  }
  if (takes !== taken) return;
  const first = name && list.some((e) => e.file === name) ? name : list[0]?.file;
  if (first) await load(first);
  else take(starterTemplate(), 'New Template', 'new');
}

export function initRmgTemplates(changed: () => void): void {
  onChanged = changed;
  const d = dialog();
  $('rte-close').onclick = () => { void mayLeave().then((ok) => { if (ok) { dirty = false; d.close(); } }); };
  // Esc: out of connect mode first, then out of the dialog — asking about edits.
  d.addEventListener('cancel', (e) => {
    e.preventDefault();
    if (connectFrom !== null) { setConnectMode(false); return; }
    void mayLeave().then((ok) => { if (ok) { dirty = false; d.close(); } });
  });
  $select('rte-list').addEventListener('change', () => {
    const name = $select('rte-list').value;
    void mayLeave().then(async (ok) => {
      if (!ok) { refreshList(); return; }
      if (name) await load(name);
    });
  });
  $('rte-new').onclick = () => { void mayLeave().then((ok) => { if (ok) take(starterTemplate(), 'New Template', 'new'); }); };
  $('rte-add-zone').onclick = addZone;
  $('rte-connect').onclick = () => setConnectMode(connectFrom === null);
  $('rte-remove').onclick = removeSelected;
  $('rte-arrange').onclick = arrange;
  $('rte-save').onclick = () => { void save(); };
  $('rte-delete').onclick = () => { void remove(); };
  $input('rte-file').addEventListener('input', updateWhere);
  // The background: the template's own panel.
  $('rte-svg').addEventListener('pointerdown', () => { if (connectFrom === null) select(null); });
}
