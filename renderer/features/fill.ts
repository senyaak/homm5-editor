// The Fills panel: paint an area, pick a recipe, plant a wood.
//
// The original editor has this as a tab beside Objects and Tiles, and it works
// the way ours does: a brush marks tiles, the marked area is a scratch
// selection that is not part of the map, and one command turns it into
// objects. Everything about WHAT gets planted lives in the presets and in
// src/fill/plan.ts; this file is the gesture and the feedback.
//
// The painted area is deliberately not saved anywhere. It exists between the
// drag and the click on Fill, and the map only ever hears about the result —
// which is also why the whole fill is a single undo step: the gesture was one
// click, and taking a wood back tree by tree is not an undo anybody wants.

import { markDirty } from '#core/dirty.ts';
import { $, $button, $input, $select } from '#core/dom.ts';
import { api } from '#core/ipc.ts';
import { activeFloor, state } from '#core/state.ts';
import { saveUiPrefs, uiPrefs } from '#core/prefs.ts';
import { deleteFillPreset, openFillEditor } from '#features/fill-editor.ts';
import { addInstanceToScene, armObject, armed, objPalOpen, paletteOpen, setObjPalette, setPalette } from '#features/palettes.ts';
import { regionsOpen, setRegionsPanel, setRegionDraw } from '#features/regions.ts';
import { renderExplorer } from '#features/selection.ts';
import { setShowObjects } from '#features/shell.ts';
import { brush, updateBrushCursor } from '#features/terrain-brush/brush.ts';
import type { TileRect } from '#features/terrain-brush/brush.ts';
import { setBrush } from '#features/terrain-brush/sculpt.ts';
import { renderer, scene } from '#viewport/stage.ts';
import { asTileSpace } from '#viewport/terrain-mesh.ts';
import type { FillPresetInfo } from '#electron/ipc.ts';
import * as THREE from 'three';

/**
 * What the tool is set to. One object for the same reason the brush has one:
 * the panel, the pointer and the cursor gizmo all read it.
 */
export const fillTool = {
  /** Armed: a left-drag paints the area instead of orbiting. */
  on: false,
  /** Brush width in tiles — 1, 3, 5, 7. Ignored while `rect` is set. */
  size: 1,
  /** Drag out a rectangle instead of stamping a square. */
  rect: false,
  /** Where a Rect drag started, in tiles. */
  anchor: null as { x: number; y: number } | null,
};

export let fillOpen = false;
/** Presets as the main process listed them; the index into this is what is sent. */
let presets: FillPresetInfo[] = [];
/** Painted tiles, as "x,y". A Set because a drag revisits tiles constantly. */
const painted = new Set<string>();
let overlay: THREE.LineSegments | null = null;
/** True while a fill is being placed, so a second click cannot start another. */
let filling = false;

const cellKey = (x: number, y: number): string => `${x},${y}`;

/** The painted tiles, as the IPC wants them. */
function paintedCells(): Array<{ x: number; y: number }> {
  return [...painted].map((k) => {
    const [x, y] = k.split(',');
    return { x: Number(x), y: Number(y) };
  });
}

/** Paint (or rub out) every tile of a rectangle. */
export function paintFill(r: TileRect, erase: boolean): void {
  if (!state.world) return;
  // Tiles, not vertices: a tile needs its far corner to exist, so the last row
  // and column of the grid are not tiles at all.
  const T = activeFloor().V - 1;
  for (let y = Math.max(0, r.y0); y <= Math.min(T - 1, r.y1); y++) {
    for (let x = Math.max(0, r.x0); x <= Math.min(T - 1, r.x1); x++) {
      if (erase) painted.delete(cellKey(x, y)); else painted.add(cellKey(x, y));
    }
  }
  drawFillOverlay();
  syncFillCount();
}

/** Drop the painted area. */
export function clearFill(): void {
  painted.clear();
  drawFillOverlay();
  syncFillCount();
}

/** How many tiles are painted — what the panel and the tests read. */
export const fillCellCount = (): number => painted.size;

function ensureOverlay(): THREE.LineSegments {
  if (overlay) return overlay;
  const mat = new THREE.LineBasicMaterial({
    color: 0x3fd97f, transparent: true, opacity: 0.9, depthTest: false,
  });
  overlay = asTileSpace(new THREE.LineSegments(new THREE.BufferGeometry(), mat));
  overlay.renderOrder = 997; // under the brush gizmo, over the ground
  overlay.visible = false;
  scene.add(overlay);
  return overlay;
}

/**
 * Outline the painted area on the ground.
 *
 * Only the sides that face unpainted ground are drawn, so a solid blob reads as
 * one shape rather than as graph paper — and a hole in it is visible, which
 * matters, because a hole changes what the fill does (the layers keep their
 * clearance from its rim as much as from the outer edge).
 */
export function drawFillOverlay(): void {
  const o = ensureOverlay();
  if (!state.world || !fillOpen || !painted.size) { o.visible = false; return; }
  const fl = activeFloor();
  const LIFT = 0.06;
  const z = (x: number, y: number): number => {
    const cx = Math.min(fl.V - 1, Math.max(0, x)), cy = Math.min(fl.V - 1, Math.max(0, y));
    return fl.heights[cy * fl.V + cx]! + LIFT;
  };
  const pts: number[] = [];
  const seg = (x0: number, y0: number, x1: number, y1: number): void => {
    pts.push(x0, y0, z(x0, y0), x1, y1, z(x1, y1));
  };
  for (const k of painted) {
    const [sx, sy] = k.split(',');
    const x = Number(sx), y = Number(sy);
    if (!painted.has(cellKey(x, y - 1))) seg(x, y, x + 1, y);
    if (!painted.has(cellKey(x, y + 1))) seg(x, y + 1, x + 1, y + 1);
    if (!painted.has(cellKey(x - 1, y))) seg(x, y, x, y + 1);
    if (!painted.has(cellKey(x + 1, y))) seg(x + 1, y, x + 1, y + 1);
  }
  const g = o.geometry;
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
  g.computeBoundingSphere();
  o.visible = pts.length > 0;
}

/**
 * How thick the chosen preset is laid on, and the seed the PREVIEW is planned
 * with.
 *
 * The seed is fixed for the preview and drawn afresh for the real fill: the
 * figures beside the slider are about this recipe over this area, and a number
 * that jittered every time it was recomputed would say nothing about the knob
 * that was just moved.
 */
const density = { at: uiPrefs.fillDensity, seed: 20240807 };

/** Ask the planner what this density would plant, and put it beside the slider. */
async function previewFill(): Promise<void> {
  const n = painted.size;
  const preset = chosen();
  if (!n || preset < 0) { $('fill-preview').textContent = ''; return; }
  const want = ++previewing;
  try {
    const r = await api.previewFill({ preset, cells: paintedCells(), seed: density.seed, density: density.at });
    // A slower answer to an older question must not overwrite a newer one: the
    // slider fires faster than the round trip on a big area.
    if (want !== previewing) return;
    $('fill-preview').textContent = `≈ ${r.pieces} piece(s), `
      + `${Math.round((100 * r.covered) / Math.max(1, r.cells))}% of the ground covered`;
  } catch {
    $('fill-preview').textContent = '';
  }
}
let previewing = 0;

function syncFillCount(): void {
  const n = painted.size;
  $('fill-count').textContent = n ? `${n} tile(s) painted` : 'nothing painted';
  void previewFill();
  $button('fill-apply').disabled = !n || !presets.length || filling;
  $button('fill-clear').disabled = !n;
  // Only a preset of the user's own can be changed or deleted; the game's file
  // and the editor's own are not ours to write. Copy is how either is edited.
  const p = presets[chosen()];
  $button('fill-copy').disabled = !p;
  $button('fill-edit').disabled = !p?.editable;
  $button('fill-del').disabled = !p?.editable;
}

/** The chosen preset's index, or -1 when the list is empty. */
const chosen = (): number => {
  const v = Number($select('fill-list').value);
  return Number.isFinite(v) && presets[v] ? v : (presets.length ? 0 : -1);
};

/**
 * Show what the chosen preset will do.
 *
 * A preset is four numbers per layer and a list of files, and none of it is
 * visible on the map until it has already been planted — so the panel says it
 * out loud: how dense each layer is, how far in it starts, and what it plants.
 * Layers are listed outermost first, which is the order they read as bands.
 */
function renderDetail(): void {
  const el = $('fill-detail');
  el.innerHTML = '';
  const p = presets[chosen()];
  if (!p) {
    el.textContent = presets.length ? 'pick a preset' : 'no presets found';
    return;
  }
  let inset = 0;
  p.layers.forEach((l, i) => {
    const row = document.createElement('div');
    row.className = 'layer';
    const head = document.createElement('div');
    head.className = 'head';
    const name = document.createElement('span');
    name.textContent = `layer ${i + 1}`;
    const sp = document.createElement('span');
    sp.className = 'sp';
    const num = document.createElement('span');
    num.className = 'num';
    // The inset is the sum of the widths BEFORE this layer (src/fill/plan.ts),
    // which is the number that actually decides where the band starts — so that
    // is what is shown rather than the raw Width.
    num.textContent = `every ${l.dispersion} tile${l.dispersion === 1 ? '' : 's'}`
      + (inset > 0 ? ` · ${inset} in from the edge` : '');
    num.title = 'Dispersion is the grid spacing; the inset is every earlier layer\'s Width added up';
    head.append(name, sp, num);
    const what = document.createElement('div');
    what.className = 'what';
    l.objects.forEach((o, j) => {
      const s = document.createElement('span');
      s.textContent = `${o.id.split('\\').pop()} ${Math.round(o.probability * 100)}%`;
      s.title = `${o.id}\nsize ${o.size} · probability ${o.probability}`
        + (o.present ? '' : '\n\nno file for this in the installed data — it plants nothing');
      if (!o.present) s.className = 'gone';
      what.append(s);
      if (j < l.objects.length - 1) what.append(document.createTextNode(' · '));
    });
    row.append(head, what);
    el.append(row);
    inset += l.width;
  });
  const missing = p.layers.flatMap((l) => l.objects).filter((o) => !o.present).length;
  const note = document.createElement('div');
  note.textContent = missing
    ? `from ${p.source} — ${missing} candidate(s) missing from this installation`
    : `from ${p.source}`;
  el.append(note);
}

/** Fetch the presets once and fill the list. */
async function loadPresets(): Promise<void> {
  if (presets.length) return;
  await reloadPresets();
}

/**
 * Re-read the presets and redraw the list, keeping the chosen one where it
 * still exists — after a save it is the one just written, and jumping back to
 * the top of the list is how an edit reads as having gone somewhere else.
 */
export async function reloadPresets(keep?: string): Promise<void> {
  try {
    const want = keep ?? presets[chosen()]?.name;
    const r = await api.fillPresets();
    presets = r.presets;
    const list = $select('fill-list');
    list.innerHTML = '';
    presets.forEach((p, i) => {
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = p.name;
      o.title = `${p.name} — ${p.layers.length} layer(s), from ${p.source}`;
      list.appendChild(o);
    });
    const at = presets.findIndex((p) => p.name === want);
    if (presets.length) list.value = String(at >= 0 ? at : 0);
    $('fill-where').textContent = r.sources.length
      ? `presets from ${r.sources.join(', ')}`
      : 'no preset file found';
    renderDetail();
    syncFillCount();
  } catch (e) {
    $('fill-detail').textContent = e instanceof Error ? e.message : String(e);
  }
}

export function setFillPanel(open: boolean): void {
  fillOpen = open;
  // One right-hand panel at a time; they share the strip.
  if (open && paletteOpen) setPalette(false);
  if (open && objPalOpen) setObjPalette(false);
  if (open && regionsOpen) setRegionsPanel(false);
  // Planting a wood with objects hidden looks exactly like a fill that did
  // nothing — the same reason the object palette turns them on.
  if (open && state.world && !state.showObjects) setShowObjects(true);
  $('fillpal').style.display = open ? 'flex' : 'none';
  $('fillbtn').classList.toggle('on', open);
  const clear = open || paletteOpen || objPalOpen || regionsOpen ? '280px' : '12px';
  $('help').style.right = clear;
  $('panel').style.right = clear;
  // Closing puts the tool down and drops the paint: an area marked behind a
  // closed panel is an invisible selection that the next Fill would use.
  if (!open) { setFillDraw(false); clearFill(); }
  if (open) void loadPresets();
  drawFillOverlay();
}

export function setFillDraw(on: boolean): void {
  fillTool.on = on && fillOpen;
  if (fillTool.on) {
    // Both want the left button on the terrain; leaving another tool live
    // would paint ground or plant an object on every stroke.
    if (brush.on) setBrush(false);
    if (armed.object) armObject(null);
    setRegionDraw(false);
    $('hud').textContent = 'drag on the map to paint the area — Shift rubs it out, then press Fill';
    renderer.domElement.style.cursor = 'none';
  } else {
    fillTool.anchor = null;
    renderer.domElement.style.cursor = '';
    updateBrushCursor(null);
  }
  $('fill-draw').classList.toggle('on', fillTool.on);
  $('fill-draw').textContent = fillTool.on ? 'draw: on' : 'draw: off';
}

/**
 * Plant the chosen preset over the painted area.
 *
 * The seed is drawn here, per click, so pressing Fill twice on the same area
 * gives two different woods — and so the number that produced one is a value
 * the main process was handed rather than something it invented, which is what
 * makes a fill reproducible from a test.
 */
export async function applyFill(): Promise<void> {
  if (filling || !state.world || !painted.size) return;
  const preset = chosen();
  if (preset < 0) { $('hud').textContent = 'no fill presets to plant'; return; }
  filling = true;
  syncFillCount();
  const seed = (Math.random() * 0x7fffffff) | 0;
  $('hud').textContent = `filling ${painted.size} tiles with ${presets[preset]!.name}`
    + `${density.at === 1 ? '' : ` at density ${density.at.toFixed(2)}x`}…`;
  try {
    const r = await api.applyFill({ preset, floor: state.world.active, cells: paintedCells(), seed, density: density.at });
    for (const p of r.placed) addInstanceToScene(p.instance, p.geom);
    markDirty(true);
    renderExplorer();
    clearFill();
    $('hud').textContent = `${presets[preset]!.name}: planted ${r.placed.length} object(s)`
      + (r.unresolved ? ` — ${r.unresolved} skipped, no model we can decode` : '')
      + ' · one undo takes them all back';
  } catch (e) {
    $('hud').textContent = 'fill failed: ' + (e instanceof Error ? e.message : String(e));
  } finally {
    filling = false;
    syncFillCount();
  }
}

/**
 * Segments the painted outline is drawn with — 0 when nothing is on screen.
 *
 * The count is the check that the feedback exists at all: the paint is a
 * scratch selection, so an overlay that silently draws nothing is
 * indistinguishable from a brush that marked nothing.
 */
export function fillOutlineSegments(): number {
  if (!overlay || !overlay.visible) return 0;
  return (overlay.geometry.getAttribute('position')?.count ?? 0) / 2;
}

/** What the tool is doing, for the automation hook. */
export function fillState(): {
  open: boolean; drawing: boolean; cells: number; preset: string; size: number; rect: boolean; presets: number;
} {
  return {
    open: fillOpen,
    drawing: fillTool.on,
    cells: painted.size,
    preset: presets[chosen()]?.name ?? '',
    size: fillTool.size,
    rect: fillTool.rect,
    presets: presets.length,
  };
}

/** Bind the panel to its markup. */
export function initFill(): void {
  $('fillbtn').onclick = () => setFillPanel(!fillOpen);
  $('fill-close').onclick = () => setFillPanel(false);
  $('fill-draw').onclick = () => setFillDraw(!fillTool.on);
  $('fill-clear').onclick = () => clearFill();
  $('fill-apply').onclick = () => { void applyFill(); };
  $select('fill-list').addEventListener('change', () => { renderDetail(); syncFillCount(); });
  const slider = $input('fill-density');
  slider.value = String(density.at);
  $('fill-densityval').textContent = `${density.at.toFixed(2)}x`;
  slider.addEventListener('input', () => {
    density.at = Number(slider.value);
    $('fill-densityval').textContent = `${density.at.toFixed(2)}x`;
    saveUiPrefs({ fillDensity: density.at });
    void previewFill();
  });
  // Making one: New from nothing, Copy from whatever is chosen (the only way to
  // change a shipped preset), Edit for one of the user's own.
  $('fill-new').onclick = () => openFillEditor(null, 'new', (name) => { void reloadPresets(name); });
  $('fill-copy').onclick = () => {
    const p = presets[chosen()];
    if (p) openFillEditor(p, 'copy', (name) => { void reloadPresets(name); });
  };
  $('fill-edit').onclick = () => {
    const p = presets[chosen()];
    if (p?.editable) openFillEditor(p, 'edit', (name) => { void reloadPresets(name); });
  };
  $('fill-del').onclick = () => {
    const p = presets[chosen()];
    if (!p?.editable) return;
    void (async () => {
      try {
        if (await deleteFillPreset(p.name)) {
          await reloadPresets();
          $('hud').textContent = `deleted the fill preset ${p.name}`;
        }
      } catch (e) {
        $('hud').textContent = 'could not delete: ' + (e instanceof Error ? e.message : String(e));
      }
    })();
  };
  for (const b of document.querySelectorAll<HTMLButtonElement>('.fill-sizes button')) {
    b.onclick = () => {
      const v = b.dataset.size ?? '1';
      fillTool.rect = v === 'rect';
      fillTool.size = fillTool.rect ? 1 : Number(v);
      fillTool.anchor = null;
      for (const other of document.querySelectorAll('.fill-sizes button')) other.classList.toggle('on', other === b);
      // Choosing a brush size is the intent to paint with it.
      if (!fillTool.on) setFillDraw(true);
    };
  }
  syncFillCount();
}
