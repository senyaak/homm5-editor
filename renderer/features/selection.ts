// What is picked, what the left list shows, and the two edits that act on the
// picked object directly (rotate, delete).
//
// The property panel's own fields live in features/inspector; what is here is
// the selection itself: the outline, the explorer row that follows it, and the
// readout the pointer keeps current while an object is dragged.

import * as THREE from 'three';

import { markDirty } from '#core/dirty.ts';
import { $, $input, setChild } from '#core/dom.ts';
import { api } from '#core/ipc.ts';
import { activeFloor, state } from '#core/state.ts';
import { loadProps } from '#features/inspector/panel.ts';
import { removeFx } from '#viewport/fx.ts';
import { removeIdle } from '#viewport/idle.ts';
import { removeFromBatch, syncInstance } from '#viewport/instancing.ts';
import { syncFootprints } from '#viewport/overlays.ts';
import { markLightsDirty } from '#viewport/point-lights.ts';
import { camera, controls, scene } from '#viewport/stage.ts';
import type { Instance } from '#src/scene.ts';
import { UNITS_PER_TILE as U } from '#src/units.ts';

/** Category chip meaning 'no filter', used as both label and key. */
export const ALL = 'All';
export function selectById(id: string): void {
  const mesh = activeFloor().meshes.get(id);
  if (!mesh) return;
  state.selected = { id, mesh, inst: mesh.userData.inst };
  if (!state.boxHelper) { state.boxHelper = new THREE.BoxHelper(mesh, 0x4fd1c5); scene.add(state.boxHelper); }
  else { state.boxHelper.setFromObject(mesh); state.boxHelper.visible = true; }
  updatePanel();
  void loadProps();
  syncExplorerSel();
}
export function deselect(): void {
  state.selected = null;
  if (state.boxHelper) state.boxHelper.visible = false;
  updatePanel();
  void loadProps();
  syncExplorerSel();
}

// Frame the camera on a mesh: keep the current view direction but recenter and
// back off to a distance that fits the object — so clicking a list row actually
// brings the (often tiny, often hidden) object into view.
export function frameObject(mesh: THREE.Object3D): void {
  const box = new THREE.Box3().setFromObject(mesh);
  if (box.isEmpty()) return;
  const c = box.getCenter(new THREE.Vector3());
  const dist = Math.max(box.getSize(new THREE.Vector3()).length() * 2.0, 8 * U);
  let dir = new THREE.Vector3().subVectors(camera.position, controls.target);
  if (dir.lengthSq() < 1e-4) dir.set(0, -1, 0.7);
  dir.normalize();
  controls.target.copy(c);
  camera.position.copy(c).addScaledVector(dir, dist);
  controls.update();
}

// --- object explorer (left sidebar) ---------------------------------------
// Lists the loaded map's objects by category so you can find and select an
// object you can't see in the 3D view. Gameplay objects (towns, monsters,
// mines…) group by a friendly type name; decorative statics group by their
// MapObjects/ folder (Grass, Dirt, Subterra…). Click a row -> select + frame.
const TYPE_LABEL: Record<string, string> = {
  AdvMapStatic: 'Decor', AdvMapTreasure: 'Treasure', AdvMapMonster: 'Monsters',
  AdvMapBuilding: 'Buildings', AdvMapMine: 'Mines', AdvMapArtifact: 'Artifacts',
  AdvMapDwelling: 'Dwellings', AdvMapShrine: 'Shrines', AdvMapHero: 'Heroes',
  AdvMapTown: 'Towns', AdvMapGarrison: 'Garrisons', AdvMapAbanMine: 'Abandoned mines',
  AdvMapShipyard: 'Shipyards', AdvMapSign: 'Signs', AdvMapTent: 'Tents',
  AdvMapHillFort: 'Hill forts', AdvMapDwarvenWarren: 'Warrens', AdvMapSeerHut: 'Seer huts',
  AdvMapPrison: 'Prisons', AdvMapCartographer: 'Cartographers', AdvMapSphinx: 'Sphinxes',
};

export function objName(it: Instance): string {
  const base = (it.shared || '').split('/').pop() || it.type;
  return base.replace(/\.\(AdvMap\w+Shared\)\.xdb$/i, '').replace(/\.xdb$/i, '') || it.type;
}
export function objCategory(it: Instance): string {
  if (it.type !== 'AdvMapStatic') return TYPE_LABEL[it.type] || it.type;
  const m = (it.shared || '').match(/\/MapObjects\/([^/]+)\//i);
  return m ? m[1] : 'Decor';
}

let exCat = ALL;
const exInstances = () => (state.world ? activeFloor().instances : []);

export function renderExplorer(): void { renderExCats(); renderExList(); }

function renderExCats(): void {
  const insts = exInstances();
  const counts = new Map();
  for (const it of insts) { const c = objCategory(it); counts.set(c, (counts.get(c) || 0) + 1); }
  if (!counts.has(exCat) && exCat !== ALL) exCat = ALL;
  const el = $('ex-cats'); el.innerHTML = '';
  const chip = (label: string, n: number, key: string): void => {
    const c = document.createElement('span');
    c.className = 'chip' + (key === exCat ? ' on' : '');
    c.textContent = `${label} (${n})`;
    c.onclick = () => { exCat = key; renderExCats(); renderExList(); };
    el.appendChild(c);
  };
  chip(ALL, insts.length, ALL);
  for (const [c, n] of [...counts].sort((a, b) => b[1] - a[1])) chip(c, n, c);
}

export function renderExList(): void {
  const list = $('ex-list');
  const f = $input('ex-search').value.trim().toLowerCase();
  let shown = exInstances();
  if (exCat !== ALL) shown = shown.filter((it) => objCategory(it) === exCat);
  if (f) shown = shown.filter((it) => (objName(it) + ' ' + it.type + ' ' + it.x + ',' + it.y).toLowerCase().includes(f));
  $('ex-count').textContent = `${shown.length} / ${exInstances().length}`;
  shown = shown.slice().sort((a, b) => objName(a).localeCompare(objName(b)) || a.x - b.x || a.y - b.y);
  list.innerHTML = '';
  if (!shown.length) { list.innerHTML = '<div class="empty">no objects</div>'; return; }
  const frag = document.createDocumentFragment();
  for (const it of shown.slice(0, 2000)) {
    const div = document.createElement('div');
    div.className = 'exrow' + (state.selected && state.selected.id === it.id ? ' sel' : '');
    div.dataset.id = it.id ?? undefined;
    div.innerHTML = `<span class="nm"></span><span class="co"></span>`;
    setChild(div, '.nm', objName(it));
    setChild(div, '.co', `${it.x},${it.y}`);
    div.onclick = () => {
      const id = it.id;
      if (!id) return;
      selectById(id);
      const m = activeFloor().meshes.get(id);
      if (m) frameObject(m);
    };
    frag.appendChild(div);
  }
  list.appendChild(frag);
  if (shown.length > 2000) list.insertAdjacentHTML('beforeend', '<div class="empty">…first 2000 shown</div>');
}

// Highlight the selected object's row (and scroll it into view when off-screen).
export function syncExplorerSel(): void {
  const list = $('ex-list'); if (!list) return;
  let selRow = null;
  for (const r of list.querySelectorAll<HTMLElement>('.exrow')) {
    const on = state.selected !== null && r.dataset.id === state.selected.id;
    r.classList.toggle('sel', on);
    if (on) selRow = r;
  }
  if (selRow) selRow.scrollIntoView({ block: 'nearest' });
}

export function updatePanel(): void {
  const p = $('panel');
  if (!state.selected) { p.style.display = 'none'; return; }
  p.style.display = 'block';
  const it = state.selected.inst;
  $('p-type').textContent = it.type;
  $('p-id').textContent = it.id ? it.id.replace('item_', '').slice(0, 8) : '—';
  // Not while the box is being typed into: writing the field back on every
  // pointermove would fight the caret.
  if (document.activeElement !== $('p-x')) $input('p-x').value = String(+it.x.toFixed(3));
  if (document.activeElement !== $('p-y')) $input('p-y').value = String(+it.y.toFixed(3));
  // Degrees on screen, radians in the file. Nobody thinks about placement in
  // radians, and 3.142 tells you far less than 180°.
  if (document.activeElement !== $('p-rot')) $input('p-rot').value = String(+degOf(it.r).toFixed(3));
  $input('p-rotslider').value = String(Math.round(degOf(it.r)));
  $('p-shared').textContent = '—';
  // Deliberately NOT loading properties here: updatePanel runs on every
  // pointermove of an object drag, and refetching a field list per mouse move
  // would both flood the bridge and yank focus out of an input mid-edit.
  // Properties follow the SELECTION, so they load in selectById.
}

// --- rotate and delete ------------------------------------------------------
//
// Both write straight through: the mesh turns or disappears at once and the
// main process is told afterwards, where the edit is recorded so Ctrl+Z brings
// it back. Deletion does not prompt — undo is the safety net, the way Del works
// in every editor — and nothing touches disk until Save regardless.

/** An angle in radians as degrees in [0, 360). */
export const degOf = (r: number): number => ((r * 180 / Math.PI) % 360 + 360) % 360;

/**
 * Nearest quarter turn, in degrees [0, 360). The game only turns objects in 90°
 * steps about their anchor tile, so every user-driven rotation lands on the
 * grid. Applied on the rotate action only — a shipped object sitting at an odd
 * angle keeps it until it is actually turned.
 */
export const snap90 = (deg: number): number => (Math.round(deg / 90) * 90 % 360 + 360) % 360;

/**
 * Turn the selected object to an absolute angle in degrees.
 *
 * @param commit false while a slider is still being dragged — the mesh turns
 *   live, but the map is written once on release rather than once per pixel.
 */
export async function rotateSelected(deg: number, commit = true): Promise<void> {
  if (!state.selected) return;
  // Not snapped here. The quarter-turn buttons snap their own argument, which
  // is where "the game turns objects in 90° steps" belongs; the file does not
  // agree with it anyway — C1M1 alone holds 80 distinct angles across 368
  // objects, and a reconstruction that could only turn by 90° would lose them.
  const r = ((deg % 360) + 360) % 360 * Math.PI / 180;
  state.selected.inst.r = r;
  state.selected.mesh.rotation.z = r;
  syncInstance(activeFloor(), state.selected.inst);
  syncFootprints();
  state.boxHelper?.setFromObject(state.selected.mesh);
  $input('p-rot').value = String(+degOf(r).toFixed(3));
  // Skipped while the slider itself is the source, or dragging it would fight
  // its own value being written back mid-gesture.
  if (commit) $input('p-rotslider').value = String(Math.round(degOf(r)));
  if (!commit) return;
  try {
    await api.rotateObject(state.selected.id, r);
    markDirty(true);
  } catch (e) {
    $('hud').textContent = 'rotate failed: ' + (e instanceof Error ? e.message : String(e));
  }
}

/** Delete the selected object, from the scene and from the map. */
export async function deleteSelected(): Promise<void> {
  if (!state.selected) return;
  const { id, mesh, inst } = state.selected;
  try {
    await api.removeObject(id);
  } catch (e) {
    $('hud').textContent = 'delete failed: ' + (e instanceof Error ? e.message : String(e));
    return;
  }
  // Only take it off screen once the map has accepted it, so a failure leaves
  // the two copies agreeing rather than showing a deletion that did not happen.
  const fl = activeFloor();
  fl.group.remove(mesh);
  fl.meshes.delete(id);
  removeFromBatch(fl, inst);
  removeIdle(fl, inst);
  removeFx(fl, inst);
  markLightsDirty(fl, inst); // its pools die with it, on the next bake
  // The geometry is shared between every instance of this model, so it is the
  // scene's to dispose, not ours.
  const i = fl.instances.indexOf(inst);
  if (i >= 0) fl.instances.splice(i, 1);
  syncFootprints(fl);
  deselect();
  renderExplorer();
  markDirty(true);
  $('hud').textContent = `deleted ${objName(inst)}`;
}
