// Regions: the named rectangles a mission's script addresses.
//
// Drawn as an outline over the floor they belong to, listed beside it, and
// dragged out on the terrain like a selection box.

//
// A region is a named rectangle of tiles with two script hooks. Nothing in the
// game draws one: they exist so a mission can say "when the hero enters the
// pass", and C1M1 has seventeen of them, addressed from Lua by name.
//
// Which makes them the one map structure that is BOTH spatial and textual. The
// tree can already author every field of one — it is a schema `$def` like any
// other — but typing four tile coordinates for a rectangle you can see is not
// how a person draws a box. So the rectangle is dragged out on the map, and the
// rest (its triggers, its floor) stays in the tree, where it belongs.

import { markDirty } from '#core/dirty.ts';
import { fillOpen, setFillPanel } from '#features/fill.ts';
import { $, $button, $input, $select } from '#core/dom.ts';
import { api } from '#core/ipc.ts';
import { saveUiPrefs, uiPrefs } from '#core/prefs.ts';
import { activeFloor, state } from '#core/state.ts';
import { updateHistoryUI } from '#features/history.ts';
import { MAP_TREE, dataAt, mapTreeOpen, mtOpen, openMapTree, pathKey, refreshMapTree, showAdvanced, treeTarget } from '#features/inspector/tree.ts';
import { loadLocState, loc } from '#features/localization.ts';
import { OBJ_PAGE, allTiles, armObject, initObjectPalette, objCat, objPalOpen, objSearch, objShown, armed, paletteOpen, renderObjGrid, renderPalette, setObjPalette, setPalette, showHiddenObjects, tiles } from '#features/palettes.ts';
import { renderExList } from '#features/selection.ts';
import { brush, updateBrushCursor } from '#features/terrain-brush/brush.ts';
import type { TileRect } from '#features/terrain-brush/brush.ts';
import { BRUSH_SAYS, setBrush, syncBrushPanel } from '#features/terrain-brush/sculpt.ts';

import { forgetScriptContext } from '#features/text-editor/context.ts';
import { refreshScriptContext } from '#features/text-editor/document.ts';
import { setIdleMode } from '#viewport/idle.ts';
import { setShowBlocked, showBlocked } from '#viewport/overlays.ts';
import { cliffsOn, setCliffAmount, setGroundScale } from '#viewport/splat.ts';
import { isTyping, renderer, scene, setTopView } from '#viewport/stage.ts';
import { asTileSpace, sea } from '#viewport/terrain-mesh.ts';
import type { TreeData } from '#src/schema/tree.ts';
import type { Path as TreePath } from '#src/schema/tree.ts';
import * as THREE from 'three';
/** One region, as the panel and the overlay need it. */
interface RegionInfo {
  /** Its index in `<regions>` — the path every edit is written through. */
  i: number;
  floor: number;
  /** Inclusive tile bounds, in the file's own order. */
  x1: number; y1: number; x2: number; y2: number;
  name: string;
  /** Its colour, 0..1 per channel, as the file keeps it. */
  color: [number, number, number];
}

export let regionList: RegionInfo[] = [];
export let regionsOpen = false;
/** True while the region tool is armed: a left-drag draws a rectangle. */
export let regionDraw = false;
/** Where the current region drag started. */
/** Where the current region drag started. */
export const region = { anchor: null as { x: number; y: number } | null };
export let regionOverlay: THREE.LineSegments | null = null;

/**
 * Colours a fresh region cycles through.
 *
 * Not random: two regions of the same colour on the same ground are two
 * rectangles you cannot tell apart, and random would hand out the same colour
 * twice sooner or later. The shipped missions use flat primaries, so these are
 * the primaries, in an order that keeps neighbours distinct.
 */
const REGION_COLOURS: [number, number, number][] = [
  [1, 0, 0], [0, 1, 0], [0, 0.6, 1], [1, 1, 0], [1, 0, 1], [0, 1, 1], [1, 1, 1], [1, 0.5, 0],
];

const num = (v: TreeData | undefined, d = 0): number => {
  const n = Number(typeof v === 'string' ? v : NaN);
  return Number.isFinite(n) ? n : d;
};
/**
 * A colour channel as the file writes it.
 *
 * Six decimals, because the picker is 8-bit and the original's was too: C1M1's
 * purple regions carry 0.501961, which is 128/255 to exactly this many places.
 * Rounding shorter would make a colour we set differ from the same colour the
 * original set.
 */
const chan = (v: number): string => String(+v.toFixed(6));
const hexOf = (c: [number, number, number]): string =>
  '#' + c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
const fromHex = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255,
];

/** Re-read the regions from the map and redraw both the list and the overlay. */
export async function loadRegions(): Promise<void> {
  if (!state.world) { regionList = []; renderRegionList(); drawRegionOverlay(); return; }
  let tree: TreeData;
  try { tree = (await api.mapTree()).tree as TreeData; }
  catch { return; }
  const raw = dataAt(tree, 'regions');
  regionList = (Array.isArray(raw) ? raw : []).map((it, i): RegionInfo => {
    const rect = dataAt(it, 'Rect'), col = dataAt(it, 'Color');
    const name = dataAt(it, 'Name');
    return {
      i,
      floor: num(dataAt(it, 'Floor')),
      x1: num(dataAt(rect, 'x1')), y1: num(dataAt(rect, 'y1')),
      x2: num(dataAt(rect, 'x2')), y2: num(dataAt(rect, 'y2')),
      name: typeof name === 'string' ? name : '',
      color: [num(dataAt(col, 'x'), 1), num(dataAt(col, 'y'), 1), num(dataAt(col, 'z'), 1)],
    };
  });
  renderRegionList();
  drawRegionOverlay();
}

/** Write one field of one region, by path. */
async function setRegionField(i: number, path: TreePath, value: string): Promise<void> {
  try {
    await api.setMapPath({ path: ['regions', i, ...path], value });
    markDirty(true);
  } catch (e) {
    $('hud').textContent = 'region: ' + (e instanceof Error ? e.message : String(e));
  }
}

/** A name no region has yet — region1, region2, … */
function freshRegionName(): string {
  const taken = new Set(regionList.map((r) => r.name));
  for (let n = 1; ; n++) if (!taken.has(`region${n}`)) return `region${n}`;
}

/**
 * Add a region covering a dragged rectangle.
 *
 * The item itself is built from the schema — the same "+ add" the tree offers,
 * so a region drawn here and one added there are the same element — and this
 * only fills in what the drag knows: where it is, which floor it is on, and a
 * name and colour to tell it apart by. Everything else stays at its default,
 * which for the two triggers is an empty function name.
 */
export async function addRegion(r: TileRect): Promise<void> {
  if (!state.world) return;
  const i = regionList.length;
  const name = freshRegionName();
  const c = REGION_COLOURS[i % REGION_COLOURS.length]!;
  try {
    await api.addMapItem({ path: ['regions'] });
    const set = (path: TreePath, value: string): Promise<unknown> =>
      api.setMapPath({ path: ['regions', i, ...path], value });
    await set(['Floor'], String(state.world.active));
    await set(['Rect', 'x1'], String(r.x0));
    await set(['Rect', 'y1'], String(r.y0));
    await set(['Rect', 'x2'], String(r.x1));
    await set(['Rect', 'y2'], String(r.y1));
    await set(['Name'], name);
    await set(['Color', 'x'], chan(c[0]));
    await set(['Color', 'y'], chan(c[1]));
    await set(['Color', 'z'], chan(c[2]));
    markDirty(true);
    $('hud').textContent = `region ${name}: ${r.x0}, ${r.y0} — ${r.x1}, ${r.y1}`;
  } catch (e) {
    $('hud').textContent = 'could not add region: ' + (e instanceof Error ? e.message : String(e));
  }
  await loadRegions();
  if (mapTreeOpen() && treeTarget === MAP_TREE) await refreshMapTree();
}

/** Delete a region, by index. */
async function removeRegion(i: number): Promise<void> {
  try {
    await api.removeMapItem({ path: ['regions', i] });
    markDirty(true);
  } catch (e) {
    $('hud').textContent = 'could not remove region: ' + (e instanceof Error ? e.message : String(e));
  }
  await loadRegions();
  if (mapTreeOpen() && treeTarget === MAP_TREE) await refreshMapTree();
}

export function renderRegionList(): void {
  const list = $('rg-list');
  list.innerHTML = '';
  for (const r of regionList) {
    const row = document.createElement('div');
    row.className = 'rg' + (state.world && r.floor !== state.world.active ? ' other' : '');
    row.dataset.region = String(r.i);
    const top = document.createElement('div');
    top.className = 'top';
    const col = document.createElement('input');
    col.type = 'color';
    col.value = hexOf(r.color);
    col.title = 'the colour this region is outlined in';
    col.addEventListener('change', () => {
      const [x, y, z] = fromHex(col.value);
      void (async () => {
        await setRegionField(r.i, ['Color', 'x'], chan(x));
        await setRegionField(r.i, ['Color', 'y'], chan(y));
        await setRegionField(r.i, ['Color', 'z'], chan(z));
        await loadRegions();
      })();
    });
    const name = document.createElement('input');
    name.type = 'text';
    name.value = r.name;
    name.title = 'the name scripts address this region by';
    name.addEventListener('change', () => {
      void (async () => { await setRegionField(r.i, ['Name'], name.value); await loadRegions(); })();
    });
    top.append(col, name);
    const rect = document.createElement('div');
    rect.className = 'rect';
    const span = document.createElement('span');
    span.textContent = `${r.x1}, ${r.y1} — ${r.x2}, ${r.y2}` + (r.floor ? ' · underground' : '');
    const sp = document.createElement('span');
    sp.className = 'sp';
    const tree = document.createElement('button');
    tree.textContent = 'Tree…';
    tree.title = 'its floor, its rectangle and its two script triggers';
    tree.addEventListener('click', () => {
      // Opened AT this region rather than at the top of a tree with a hundred
      // fields: regions are an advanced field, so the switch has to be on too,
      // or the group the button points at is not rendered at all.
      showAdvanced(true);
      $input('mt-adv').checked = true;
      mtOpen.add(pathKey(['regions']));
      mtOpen.add(pathKey(['regions', r.i]));
      openMapTree(MAP_TREE);
      void refreshMapTree().then(() => {
        $('maptree-body')
          .querySelector(`[data-path='${JSON.stringify(['regions', r.i])}']`)
          ?.scrollIntoView({ block: 'center' });
      });
    });
    const del = document.createElement('button');
    del.className = 'danger';
    del.textContent = '✕';
    del.title = 'delete this region';
    del.addEventListener('click', () => { void removeRegion(r.i); });
    rect.append(span, sp, tree, del);
    row.append(top, rect);
    list.appendChild(row);
  }
  $('rg-count').textContent = state.world
    ? `${regionList.length} region(s)`
    : 'no map';
}

function ensureRegionOverlay(): THREE.LineSegments {
  if (regionOverlay) return regionOverlay;
  const mat = new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.95, depthTest: false,
  });
  regionOverlay = asTileSpace(new THREE.LineSegments(new THREE.BufferGeometry(), mat));
  regionOverlay.renderOrder = 997; // under both cursors, over the ground
  regionOverlay.visible = false;
  scene.add(regionOverlay);
  return regionOverlay;
}

/**
 * Outline every region of the active floor, in its own colour.
 *
 * Traced tile by tile rather than as four long lines: a region can span a hill,
 * and a straight segment between two corners would cut through it.
 */
export function drawRegionOverlay(): void {
  const o = ensureRegionOverlay();
  if (!state.world || !regionsOpen || !regionList.length) { o.visible = false; return; }
  const fl = activeFloor();
  const LIFT = 0.07; // above the brush gizmo's 0.05, so an outline never z-fights it
  const z = (x: number, y: number): number => {
    const cx = Math.min(fl.V - 1, Math.max(0, x)), cy = Math.min(fl.V - 1, Math.max(0, y));
    return fl.heights[cy * fl.V + cx]! + LIFT;
  };
  const pts: number[] = [], cols: number[] = [];
  for (const r of regionList) {
    if (r.floor !== state.world.active) continue;
    // The file keeps inclusive TILE bounds; the outline runs along the outer
    // grid lines, so the far edge is one past the last tile.
    const x0 = Math.max(0, Math.min(r.x1, r.x2)), y0 = Math.max(0, Math.min(r.y1, r.y2));
    const x1 = Math.min(fl.V - 1, Math.max(r.x1, r.x2) + 1), y1 = Math.min(fl.V - 1, Math.max(r.y1, r.y2) + 1);
    if (x1 <= x0 || y1 <= y0) continue;
    const seg = (ax: number, ay: number, bx: number, by: number): void => {
      pts.push(ax, ay, z(ax, ay), bx, by, z(bx, by));
      cols.push(...r.color, ...r.color);
    };
    for (let x = x0; x < x1; x++) { seg(x, y0, x + 1, y0); seg(x, y1, x + 1, y1); }
    for (let y = y0; y < y1; y++) { seg(x0, y, x0, y + 1); seg(x1, y, x1, y + 1); }
  }
  const g = o.geometry;
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(cols), 3));
  g.computeBoundingSphere();
  o.visible = pts.length > 0;
}

export function setRegionsPanel(open: boolean): void {
  regionsOpen = open;
  // One right-hand panel at a time; they share the strip.
  if (open && paletteOpen) setPalette(false);
  if (open && objPalOpen) setObjPalette(false);
  if (open && fillOpen) setFillPanel(false);
  $('regions').style.display = open ? 'flex' : 'none';
  $('regionbtn').classList.toggle('on', open);
  const clear = open || paletteOpen || objPalOpen ? '280px' : '12px';
  $('help').style.right = clear;
  $('panel').style.right = clear; // keep the object panel clear of the strip
  // Closing puts the tool down: the outlines go with the panel, and a tool armed
  // behind a closed panel draws rectangles nothing on screen explains.
  if (!open) setRegionDraw(false);
  if (open) void loadRegions(); else drawRegionOverlay();
}

export function setRegionDraw(on: boolean): void {
  regionDraw = on && regionsOpen;
  if (regionDraw) {
    if (brush.on) setBrush(false);
    if (armed.object) armObject(null);
    $('hud').textContent = 'drag out a rectangle on the map — it becomes a region';
    renderer.domElement.style.cursor = 'none';
  } else {
    region.anchor = null;
    renderer.domElement.style.cursor = '';
    updateBrushCursor(null);
  }
  $('rg-draw').classList.toggle('on', regionDraw);
  $('rg-draw').textContent = regionDraw ? 'draw: on' : 'draw: off';
}

/** Bind the regions panel to its markup. */
export function initRegions(): void {
  $('regionbtn').onclick = () => setRegionsPanel(!regionsOpen);
  $('rg-close').onclick = () => setRegionsPanel(false);
  $('rg-draw').onclick = () => setRegionDraw(!regionDraw);
}
