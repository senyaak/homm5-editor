// The window's own chrome: the toolbar, the left panels, the map picker and
// the banner an external change raises.
//
// What is here is the shell a map is opened into — the parts that exist with
// no map loaded and decide what the rest of the UI is allowed to show.

import { ALL } from '#features/selection.ts';

/** px; movement under this is a click, not a drag. */
export const CLICK_SLOP = 5;
import { ask } from '#core/dialog.ts';
import { isDirty, markDirty, whenEdited } from '#core/dirty.ts';
import { $, $button, $input, setChild } from '#core/dom.ts';
import { api } from '#core/ipc.ts';
import { saveUiPrefs, uiPrefs } from '#core/prefs.ts';
import { state } from '#core/state.ts';
import { updateHistoryUI } from '#features/history.ts';
import { closeMapProps } from '#features/inspector/map-props.ts';
import { closeMapTree, mapTreeOpen } from '#features/inspector/tree.ts';
import { loc } from '#features/localization.ts';
import { loadMapPath, session } from '#features/map-session.ts';
import { armObject, armed } from '#features/palettes.ts';
import { fillTool, setFillDraw } from '#features/fill.ts';
import { regionDraw, setRegionDraw } from '#features/regions.ts';
import { deselect, renderExList } from '#features/selection.ts';
import { forgetScriptContext } from '#features/text-editor/context.ts';
import { geomSkin, worldGeos } from '#viewport/geoms.ts';
import { idleMode, setIdleMode } from '#viewport/idle.ts';
import type { IdleMode } from '#viewport/idle.ts';
import { replaceInstances } from '#viewport/instancing.ts';
import { refreshLighting } from '#viewport/lighting.ts';
import { setShowBlocked, showBlocked } from '#viewport/overlays.ts';
import { clearReach, runReach } from '#features/reach.ts';
import { cliffsOn, setCliffAmount, setGroundScale } from '#viewport/splat.ts';
import { cam, isTyping, renderer, setTopView } from '#viewport/stage.ts';
import { sea } from '#viewport/terrain-mesh.ts';
import { clearWorld, setActiveFloor } from '#viewport/world.ts';
import * as THREE from 'three';
import type { ExternalChange, MapListEntry } from '#electron/ipc.ts';

type MapEntry = MapListEntry & { cat: string };
export const FLOOR_LABEL: Record<string, string> = { surface: 'Surface', underground: 'Underground' };
// Floor button: shown only for two-floor maps; label names the OTHER floor it
// switches to, and clicking cycles.
export function updateFloorUI(): void {
  const btn = $('floor');
  if (!state.world || state.world.floors.length < 2) { btn.style.display = 'none'; return; }
  btn.style.display = '';
  const next = state.world.floors[(state.world.active + 1) % state.world.floors.length];
  const cur = state.world.floors[state.world.active];
  btn.textContent = `${FLOOR_LABEL[cur.name] || cur.name} → ${FLOOR_LABEL[next.name] || next.name}`;
}

// Explorer show/hide + search wiring.
export let explorerOpen = uiPrefs.explorerOpen;
export function setExplorer(open: boolean): void {
  explorerOpen = open;
  $('explorer').style.display = open ? 'flex' : 'none';
  $('hud').style.left = open ? '296px' : '12px';
  $('objects').classList.toggle('on', open);
  saveUiPrefs({ explorerOpen: open });
}

// Hide/show all placed objects — terrain work needs an unobstructed ground view.
export function setShowObjects(on: boolean): void {
  state.showObjects = on;
  if (state.world) for (const fl of state.world.floors) fl.objGroup.visible = on;
  if (!on) deselect();
  $('showobj').classList.toggle('on', on);
  $('showobj').textContent = on ? 'Objects: on' : 'Objects: off';
  saveUiPrefs({ showObjects: on });
}

// --- idle stance ------------------------------------------------------------
//
// Three states rather than a checkbox, because the two costs are different
// things: `off` decides what the scene is BUILT out of, while `visible` and
// `all` only decide how much of it keeps moving. A scene built with it off
// carries no bones anywhere — that is what makes `off` free — so leaving `off`
// tops the open scene up in place: the main process replays this map's models
// with animation on (map:idle-skins) and the payloads are grafted onto the
// geometries already on the GPU. No reopen, nothing else moves.

const IDLE_MODES: IdleMode[] = ['off', 'visible', 'all'];

export function updateIdleButton(): void {
  $('idlebtn').textContent = `Idle stance: ${idleMode()}`;
  $('idlebtn').classList.toggle('on', idleMode() !== 'off');
}

/** Fetch and graft the animation payloads a built-without-bones scene lacks. */
export async function loadIdleSkins(): Promise<void> {
  const skins = await api.idleSkins();
  for (const [key, skin] of Object.entries(skins)) {
    const g = Number(key);
    const geo = worldGeos[g];
    if (!geo || !skin.clip) continue;
    // The main process only sends payloads that line up, but a mismatched
    // binding would tear a model apart, so the vertex count is checked again
    // where the geometry actually lives.
    if (skin.index.length !== geo.getAttribute('position').count * 4) continue;
    if (!geo.getAttribute('skinIndex')) {
      geo.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint8Array(skin.index), 4));
      geo.setAttribute('skinWeight', new THREE.BufferAttribute(new Float32Array(skin.weight), 4));
    }
    geomSkin.set(g, skin);
  }
}


// --- effects & light toggles ------------------------------------------------
//
// Both are view choices, not scene choices — unlike the idle button's `off`,
// nothing is built differently, so flipping them costs nothing and they can
// sit in uiPrefs like the other view toggles. Effects off just stops drawing
// and advancing the systems (they keep arriving and keep following their
// objects); Light `flat` swaps the floor's preset for the neutral built-in
// look AND zeroes the point-light pools, because the reason to want it is
// "let me actually see this dark underground while I edit".

export function setShowFx(on: boolean): void {
  state.showFx = on;
  if (state.world) for (const fl of state.world.floors) for (const s of fl.fx) s.mesh.visible = on;
  $('fxbtn').textContent = on ? 'Effects: on' : 'Effects: off';
  $('fxbtn').classList.toggle('on', on);
  saveUiPrefs({ showFx: on });
}
setShowFx(state.showFx); // reflect the persisted choice in the label

export function setMapLight(on: boolean): void {
  state.mapLight = on;
  refreshLighting();
  $('lightbtn').textContent = on ? 'Light: map' : 'Light: flat';
  $('lightbtn').classList.toggle('on', on);
  saveUiPrefs({ mapLight: on });
}

// Right-click gives the armed object up — the hand is already on the mouse, so
// this is the exit that costs nothing.
//
// A right DRAG still moves the camera, so this waits for pointerup and only
// acts if the button did not travel. Registered separately from the left-button
// handler, which returns early on any button but 0.
let rdown: { sx: number; sy: number } | null = null;

// Esc gives the armed object up. Without it the only way out is finding the
// same tile in the palette again, which is a poor exit from a sticky mode.


// Cliff shading on/off, so the rock blend can be compared against the raw
// stretched-ground look it replaces.
export function setCliffs(on: boolean): void {
  setCliffAmount(on);
  $('cliffbtn').classList.toggle('on', on);
  saveUiPrefs({ cliffs: on });
}

// Sea level. The bed is dug to 0 and ordinary ground sits at 2.0, but the fill
// level isn't recorded anywhere, so it's tuned by eye. The sheet is flat, so
// moving the mesh is enough — no rebuild.

// Ground texture tiling density. The format doesn't record it, so it's tuned by
// eye against the game's own look and applied live to every splat material.

// --- external changes ---------------------------------------------------
//
// The original editor can be open on the same map folder. When it saves, the
// main process notices and pushes here; we offer to take its version rather
// than reloading behind the user's back, because reloading throws away whatever
// they have done on our side since the last save.

/** The change we are currently offering to take, or null when the banner is down. */
let pendingChange: ExternalChange | null = null;

export function describeChange(c: ExternalChange): string {
  const parts: string[] = [];
  if (c.terrain) parts.push('terrain');
  if (c.map) parts.push('objects');
  const n = c.changed.length + c.added.length + c.removed.length;
  const what = parts.length ? parts.join(' and ') : `${n} file${n === 1 ? '' : 's'}`;
  return isDirty
    ? `Another editor rewrote ${what}. Reloading discards your unsaved changes.`
    : `Another editor rewrote ${what}.`;
}

export function showExternalChange(c: ExternalChange): void {
  pendingChange = c;
  $('extchange-what').textContent = describeChange(c);
  $('extchange').style.display = 'flex';
}

export function hideExternalChange(): void {
  pendingChange = null;
  $('extchange').style.display = 'none';
}


// Dismissing only hides the banner: the main process has already advanced its
// baseline, so the next external save raises it again.

/**
 * Open whatever the user picked: an unpacked folder's map.xdb, or a packed
 * archive — which is unpacked beside itself first, so what gets edited is always
 * a working folder and the archive stays as the game got it.
 */
export async function openAny(path: string | null, inner?: string, stock?: boolean): Promise<void> {
  if (!path) return;
  if (!stock && !/\.(mod|h5m|h5c|h5u|pak)$/i.test(path)) { await loadMapPath(path); return; }
  $('loading').classList.add('on');
  $('loadmsg').textContent = 'unpacking…';
  try {
    const { mapPath, mapDir, files } = await api.openArchive(path, inner, stock);
    // The game's own maps are opened as a copy to start from, so nothing here
    // belongs to that archive — `archive` stays null and Save writes the copy.
    await loadMapPath(mapPath, stock ? null : path);
    $('hud').textContent = `unpacked ${files} files → ${mapDir}`;
    // The folder that just appeared belongs in the picker's list.
    void initPicker();
  } catch (e) {
    $('hud').textContent = 'error: ' + (e instanceof Error ? e.message : String(e));
    console.error(e);
  } finally {
    $('loading').classList.remove('on');
  }
}

/**
 * Which of the two bars is on screen — and, through the stylesheet, whether the
 * working panels are shown at all.
 *
 * A class rather than a run of `style.display`: the panels' own open/closed
 * flags are the user's choice and must survive a map being put away, so closing
 * one must not go through their setters (several of those persist). The class
 * hides what is open without telling anything it was closed, and taking the
 * class off brings the same panels back exactly as they were left.
 */
export function setMapOpen(on: boolean): void {
  document.body.classList.toggle('nomap', !on);
  $button('closemapbtn').disabled = !on;
}

/**
 * Put the map away and come back to the list.
 *
 * The map is the window's whole state — a scene on the GPU here, a session with
 * a file watcher on it in the main process — so this is a real teardown, not a
 * screen swap: without the watcher going down, a closed map's folder would keep
 * pushing "changed on disk" banners at a window that no longer has it open, and
 * on Windows the open handle alone is enough to stop the folder being replaced.
 */
export async function closeMap(): Promise<void> {
  if (!session.openedMap) return;
  if (isDirty && !await ask('This map has changes that were never saved. Close it anyway?', 'Close')) return;
  // Both of these are filled from the map that is going away, and neither
  // notices on its own that it is gone.
  if (mapTreeOpen()) closeMapTree();
  closeMapProps();
  if (armed.object) armObject(null);
  clearWorld();
  await api.closeMap();
  session.openedMap = null;
  hideExternalChange();
  forgetScriptContext();
  loc.active = '';
  setMapOpen(false);
  $('title').textContent = 'homm5-editor';
  $button('pack').disabled = true;
  markDirty(false);
  updateHistoryUI(false, false, null, null);
  $('empty').style.display = '';
  $('hud').textContent = '';
  // A map made or packed during this session belongs in the list the user is
  // being handed back to.
  void initPicker();
}

export async function openViaDialog() {
  await openAny(await api.openMapDialog());
}

// In-window map picker: list openable maps under the game-data root, grouped by
// category (top folder under Maps) with search. Combat arenas / duel / test maps
// are the bulk of the list but rarely what you want to edit, so real scenarios
// (Single, Multiplayer, Campaign) sort first and get their own filter chips.
let allMaps: MapEntry[] = [];
let activeCat = ALL;

const CATEGORY = (m: MapListEntry): string => (m.stock ? 'The game\'s' : 'Ours');
const CAT_ORDER = ['Ours', 'The game\'s'];
const catRank = (c: string): number => { const i = CAT_ORDER.indexOf(c); return i === -1 ? 99 : i; };

export function renderMapList() {
  const list = $('maplist');
  const f = $input('search').value.trim().toLowerCase();
  let shown = allMaps.filter((m) => activeCat === ALL || m.cat === activeCat);
  if (f) shown = shown.filter((m) => (m.rel + ' ' + m.name).toLowerCase().includes(f));
  shown.sort((a, b) => catRank(a.cat) - catRank(b.cat) || a.rel.localeCompare(b.rel));
  if (!shown.length) { list.innerHTML = `<div class="empty">${allMaps.length ? 'nothing found' : 'no maps found'}</div>`; return; }
  list.innerHTML = '';
  for (const m of shown.slice(0, 500)) {
    const div = document.createElement('div');
    div.className = 'm';
    div.innerHTML = `<span class="name"></span><span class="rel"></span>`;
    setChild(div, '.name', m.name);
    // Every map lives in an archive now, and opening one unpacks a copy to work
    // in. For the game's own that is the whole point, so it is worth saying.
    setChild(div, '.rel', m.stock ? `${m.rel} · a copy to start from` : m.rel);
    div.onclick = () => { void openAny(m.path, m.inner, m.stock); };
    list.appendChild(div);
  }
}

export function renderCats() {
  const cats = [ALL, ...CAT_ORDER.filter((c) => allMaps.some((m) => m.cat === c))];
  const el = $('cats');
  el.innerHTML = '';
  for (const c of cats) {
    const n = c === ALL ? allMaps.length : allMaps.filter((m) => m.cat === c).length;
    const chip = document.createElement('span');
    chip.className = 'chip' + (c === activeCat ? ' on' : '');
    chip.textContent = `${c} (${n})`;
    chip.onclick = () => { activeCat = c; renderCats(); renderMapList(); };
    el.appendChild(chip);
  }
}

export async function initPicker() {
  try {
    const { root, maps } = await api.listMaps();
    allMaps = maps.map((m) => ({ ...m, cat: CATEGORY(m) }));
    // Ours first — the game's own are there to start from, not to browse.
    activeCat = allMaps.some((m) => m.cat === 'Ours') ? 'Ours' : ALL;
    $('picker-foot').textContent = `${maps.length} maps · ${root}`;
    renderCats();
    renderMapList();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    $('maplist').innerHTML = `<div class="empty">could not load the list: ${msg}</div>`;
  }
}

/** Bind the toolbar, the panels and the map picker. */
export function initShell(): void {
  $('floor').onclick = () => { if (state.world) setActiveFloor((state.world.active + 1) % state.world.floors.length); };
  $('objects').onclick = () => {
    const open = !explorerOpen;
    // Opening the list while objects are hidden brings them back. The list exists
    // to find an object and click through to it, and every one of those clicks
    // would select something invisible — picking is disabled while they are
    // hidden, so the 3D view would not even answer.
    //
    // Only on this click, not inside setExplorer: loading a map opens the list
    // too, and doing it there would quietly undo a deliberate "objects off"
    // every time a map was opened.
    if (open && state.world && !state.showObjects) setShowObjects(true);
    setExplorer(open);
  };
  $('showobj').onclick = () => setShowObjects(!state.showObjects);
  $('viewbtn').onclick = () => setTopView(!cam.top);
  $('idlebtn').onclick = async () => {
    const next = IDLE_MODES[(IDLE_MODES.indexOf(idleMode()) + 1) % IDLE_MODES.length]!;
    await api.setIdleAnimation(next);
    if (next !== 'off' && !geomSkin.size && state.world) {
      $('hud').textContent = `idle stance: ${next} — loading animations…`;
      try {
        await loadIdleSkins();
      } catch (err) {
        console.error('idle skins', err);
        $('hud').textContent = 'idle stance: loading animations failed — open the map again';
        return;
      }
    }
    setIdleMode(next);
    updateIdleButton();
    if (state.world) {
      // Handles are rebuilt, so anything selected is about to point at a mesh
      // that no longer exists.
      deselect();
      for (const fl of state.world.floors) replaceInstances(fl, fl.instances);
    }
    $('hud').textContent = `idle stance: ${next}`;
  };
  $('fxbtn').onclick = () => setShowFx(!state.showFx);
  $('lightbtn').onclick = () => setMapLight(!state.mapLight);
  setMapLight(state.mapLight);
  renderer.domElement.addEventListener('pointerdown', (ev) => {
    if (ev.button === 2 && armed.object) rdown = { sx: ev.clientX, sy: ev.clientY };
  });
  addEventListener('pointerup', (ev) => {
    if (ev.button !== 2 || !rdown) return;
    const moved = Math.abs(ev.clientX - rdown.sx) >= CLICK_SLOP || Math.abs(ev.clientY - rdown.sy) >= CLICK_SLOP;
    rdown = null;
    if (moved || !armed.object) return; // that was a camera move
    armObject(null);
    $('hud').textContent = 'stopped placing';
  });
  addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && armed.object && !isTyping(e.target)) {
      armObject(null);
      $('hud').textContent = 'stopped placing';
      e.preventDefault();
    }
    // Same exit for the region tool, for the same reason: a sticky mode needs a
    // key that always ends it.
    if (e.code === 'Escape' && regionDraw && !isTyping(e.target)) {
      setRegionDraw(false);
      $('hud').textContent = 'stopped drawing regions';
      e.preventDefault();
    }
    // Same for the fill brush: Esc puts the tool down. What was painted stays,
    // because the paint is the work — it is the tool that is in the way.
    if (e.code === 'Escape' && fillTool.on && !isTyping(e.target)) {
      setFillDraw(false);
      $('hud').textContent = 'stopped painting the fill area';
      e.preventDefault();
    }
  });
  $('blockbtn').onclick = () => setShowBlocked(!showBlocked);
  $('reachbtn').onclick = () => { void runReach(); };
  // Any edit and the answer is about a map that no longer exists.
  whenEdited(clearReach);
  $('cliffbtn').onclick = () => setCliffs(!cliffsOn());
  $input('sealevel').addEventListener('input', (e) => {
    const v = +(e.currentTarget as HTMLInputElement).value;
    $('sealevelval').textContent = v.toFixed(2);
    if (state.world) for (const fl of state.world.floors) if (fl.waterMesh) fl.waterMesh.position.z = v - sea.base;
  });
  $input('texscale').addEventListener('input', (e) => {
    const v = +(e.currentTarget as HTMLInputElement).value;
    setGroundScale(v);
    $('texscaleval').textContent = v.toFixed(2);
    saveUiPrefs({ texScale: v });
  });
  $input('ex-search').addEventListener('input', renderExList);
  api.onExternalChange((c) => { showExternalChange(c); });
  $('extchange-reload').onclick = () => {
    const c = pendingChange;
    hideExternalChange();
    if (c) loadMapPath(c.mapPath);
  };
  $('extchange-ignore').onclick = hideExternalChange;
}
