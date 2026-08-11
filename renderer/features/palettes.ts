// The two content browsers: the objects to place, and the ground tiles to paint.
//
// Both are "arm a thing, then click the map" — the palette owns what is armed
// and the pointer asks it. A green dot on a tile means this map already has a
// layer for it, which is the only kind that can be painted without
// restructuring the .bin.

//
// The catalogue is 1466 entries with an icon each, so two things are lazy: the
// grid renders a page at a time, and an icon is fetched only when its tile is
// actually built. Pushing every icon up front would be ~24 MB across the bridge
// for a panel that shows two dozen at once.
//
// Placing is click-to-arm, then click on the map — and the armed object STAYS
// armed, so a row of ten gold piles is ten clicks. Dragging one tile per object
// was the first attempt and it was wrong twice over: HTML5 drag-and-drop over
// the WebGL canvas did not fire at all, and even working it would have made the
// common case (many copies of the same thing) the most tiring one.

import { ALL } from '#features/selection.ts';
import { setShowObjects } from '#features/shell.ts';
import { heightAt, tileCenter } from '#core/coords.ts';
import { markDirty } from '#core/dirty.ts';
import { $, $select } from '#core/dom.ts';
import { api } from '#core/ipc.ts';
import { saveUiPrefs, uiPrefs } from '#core/prefs.ts';
import { activeFloor, state } from '#core/state.ts';
import { fillOpen, setFillPanel } from '#features/fill.ts';
import { regionsOpen, setRegionsPanel } from '#features/regions.ts';
import { renderExplorer } from '#features/selection.ts';
import { brush, updateBrushCursor } from '#features/terrain-brush/brush.ts';
import { setBrush, syncBrushPanel } from '#features/terrain-brush/sculpt.ts';
import { spawnFx } from '#viewport/fx.ts';
import { geomParts, geomScale, registerGeom, worldGeos, worldMats } from '#viewport/geoms.ts';
import { addIdle } from '#viewport/idle.ts';
import { addToBatch } from '#viewport/instancing.ts';
import { syncFootprints } from '#viewport/overlays.ts';
import { projectBatch, upgradeToSplat } from '#viewport/splat.ts';
import { renderer } from '#viewport/stage.ts';
import type { PlaceableObject } from '#src/map/objects.ts';
import type { GeomData, Instance, TileInfo } from '#src/scene/payload.ts';
import { $input } from '#core/dom.ts';
import * as THREE from 'three';
let catalog: PlaceableObject[] = [];
let catGroups: { name: string; separator: boolean }[] = [];
export let objPalOpen = false;
export let objCat = ALL;
export let objSearch = '';
export let showHiddenObjects = uiPrefs.showHidden;
/** The catalogue entry armed for placing, or null. Stays set across placements. */
/** What is armed for placing, and the ground tile armed for painting. */
export const armed = { object: null as PlaceableObject | null, tile: null as TileInfo | null };
/** Icons already fetched, so scrolling back does not refetch. */
const iconCache = new Map<string, string | null>();

/** How many tiles to render before the "show more" row. */
export const OBJ_PAGE = 120;
export let objShown = OBJ_PAGE;

function objMatches(o: PlaceableObject): boolean {
  if (o.hidden && !showHiddenObjects) return false;
  if (objCat !== ALL && o.group !== objCat) return false;
  // Search both: the label is what is on screen, the file name is what someone
  // who knows the assets will type.
  if (objSearch && !(o.label + ' ' + o.name).toLowerCase().includes(objSearch)) return false;
  return true;
}

/**
 * In flight while the catalogue is being fetched.
 *
 * The scan reads the Editor folder and decodes the icon cache — a second or two
 * on disk — so it is kicked off in the background the moment a map opens, and
 * the panel simply awaits it. This handle is what makes both safe: a click that
 * arrives mid-scan waits on the same promise instead of starting a second scan,
 * and the preload does not care whether the panel is even open yet.
 */
let catalogLoad: Promise<void> | null = null;

/** Fetch the catalogue once, whoever asks first. Idempotent and re-entrant. */
export function initObjectPalette(): Promise<void> {
  if (catalog.length) return Promise.resolve();
  if (catalogLoad) return catalogLoad;
  // Only speaks if the panel is already showing; a background preload leaves it
  // blank until the data lands.
  if (objPalOpen) $('obj-grid').innerHTML = '<div style="color:#8b949e;font-size:11px;padding:8px">loading objects…</div>';
  catalogLoad = (async () => {
    try {
      const r = await api.listObjects();
      catalog = r.objects;
      catGroups = r.groups;
      if (!r.hasEditor) {
        $('hud').textContent = 'no Editor folder found — objects are ungrouped and have no icons';
      }
      renderObjCats();
      renderObjGrid();
    } catch (e) {
      catalogLoad = null; // let a later open retry a scan that failed
      $('obj-grid').innerHTML = `<div style="color:#f85149;font-size:11px">${
        e instanceof Error ? e.message : String(e)}</div>`;
    }
  })();
  return catalogLoad;
}

function renderObjCats(): void {
  const sel = $select('obj-cat');
  sel.innerHTML = '';
  const all = document.createElement('option');
  all.value = ALL;
  all.textContent = `All (${catalog.length})`;
  sel.appendChild(all);
  const counts = new Map<string, number>();
  for (const o of catalog) counts.set(o.group, (counts.get(o.group) || 0) + 1);
  for (const g of catGroups) {
    const opt = document.createElement('option');
    if (g.separator) {
      // Kept, and kept unselectable: the original shows these headings in the
      // same list, and dropping them would lose the grouping they carry.
      opt.textContent = g.name;
      opt.disabled = true;
    } else {
      opt.value = g.name;
      opt.textContent = `${g.name} (${counts.get(g.name) || 0})`;
    }
    sel.appendChild(opt);
  }
  // Groups of ours, not the original's, listed after its own: "Other" for
  // entries no filter covers (a mod's folder lands there rather than
  // vanishing), and the "Shared: …" groups for definitions no object link
  // points at — 559 of them, including every named hero.
  const ours = [...counts.keys()]
    .filter((g) => g === 'Other' || g.startsWith('Shared: '))
    .filter((g) => !catGroups.some((c) => c.name === g))
    .sort();
  for (const g of ours) {
    const opt = document.createElement('option');
    opt.value = g;
    opt.textContent = `${g} (${counts.get(g)})`;
    sel.appendChild(opt);
  }
  sel.value = objCat;
}

export function renderObjGrid(): void {
  const grid = $('obj-grid');
  grid.innerHTML = '';
  const list = catalog.filter(objMatches);
  for (const o of list.slice(0, objShown)) {
    const el = document.createElement('div');
    el.className = 'obj' + (armed.object?.path === o.path ? ' on' : '');
    // The original's tooltip is the object's own description. The file name is
    // kept beside it because that is what the map and the assets are keyed on,
    // and it is the only handle when something needs looking up on disk.
    el.title = [o.label, o.description, `${o.name} · ${o.type || 'unknown type'} · ${o.group}`]
      .filter(Boolean).join('\n\n');
    // The entry's own path, so a swatch can be addressed by the one thing that
    // is unique about it. Labels collide ("Chest" is a treasure and a static),
    // and so do NAMES as substrings: `Disease_Zombie` ends in `Zombie`, which
    // is how a tooltip-matching selector armed the alt-upgrade when the plain
    // zombie was asked for, and the map then carried the wrong monster.
    el.dataset.path = o.path;
    const img = document.createElement('img');
    img.className = 'ic';
    el.appendChild(img);
    void setIcon(img, o.path);
    if (o.random) { const b = document.createElement('span'); b.className = 'rnd'; b.textContent = 'rnd'; el.appendChild(b); }
    if (o.hidden) { const b = document.createElement('span'); b.className = 'hid'; b.textContent = 'hid'; el.appendChild(b); }
    const nm = document.createElement('div');
    nm.className = 'nm';
    nm.textContent = o.label;
    el.appendChild(nm);
    // Clicking the armed one again disarms, so the palette is its own off switch.
    el.onclick = () => armObject(armed.object?.path === o.path ? null : o);
    grid.appendChild(el);
  }
  if (list.length > objShown) {
    const more = document.createElement('div');
    more.className = 'more';
    more.textContent = `+${list.length - objShown} more — click to show`;
    more.onclick = () => { objShown += OBJ_PAGE; renderObjGrid(); };
    grid.appendChild(more);
  }
  if (!list.length) {
    grid.innerHTML = '<div class="more">nothing matches</div>';
  }
}

/** Fill an icon, fetching it once per catalogue entry. */
async function setIcon(img: HTMLImageElement, path: string): Promise<void> {
  if (iconCache.has(path)) {
    const uri = iconCache.get(path);
    if (uri) img.src = uri;
    return;
  }
  try {
    const uri = await api.objectIcon(path);
    iconCache.set(path, uri);
    if (uri) img.src = uri;
  } catch { iconCache.set(path, null); }
}

export function setObjPalette(open: boolean): void {
  objPalOpen = open;
  // Closing the panel puts the armed object down. The palette is the only place
  // that shows what is armed, so leaving it live behind a closed panel means a
  // click on the map plants something you can no longer see the name of.
  if (!open && armed.object) armObject(null);
  $('objpal').style.display = open ? 'flex' : 'none';
  $('objpalbtn').classList.toggle('on', open);
  // Only one right-hand panel at a time; they occupy the same strip.
  if (open && paletteOpen) setPalette(false);
  if (open && regionsOpen) setRegionsPanel(false);
  if (open && fillOpen) setFillPanel(false);
  $('help').style.right = open ? '262px' : '12px';
  $('panel').style.right = open ? '262px' : '12px';
  if (open) void initObjectPalette();
}

/**
 * Arm (or disarm) a catalogue entry for placing.
 *
 * Arming takes the terrain brush down: both want the left button on the
 * terrain, and leaving both live would mean painting ground every time you
 * placed a tree.
 */
export function armObject(o: PlaceableObject | null): void {
  armed.object = o;
  if (o) {
    if (brush.on) setBrush(false);
    $('obj-sel').textContent = `placing: ${o.label} · ${o.type || '?'}`;
    $('hud').textContent = o.type
      ? `click the map to place ${o.name} — Esc or click it again to stop`
      : `${o.name} has no object type we recognise, so it cannot be placed`;
    renderer.domElement.style.cursor = 'none';
  } else {
    $('obj-sel').textContent = 'no object selected';
    renderer.domElement.style.cursor = '';
    updateBrushCursor(null);
  }
  renderObjGrid();
}

/**
 * Place the armed object at a tile.
 *
 * Stays armed afterwards, and does NOT select what it just placed: selecting
 * would fight the next click, which is meant to be the next copy. The explorer
 * list is refreshed so the new object is findable there straight away.
 */
export async function placeAt(tile: { x: number; y: number }): Promise<void> {
  const o = armed.object;
  if (!o || !state.world) return;
  if (!o.type) { $('hud').textContent = `${o.name}: unknown object type, not placed`; return; }
  try {
    const res = await api.addObject({
      type: o.type, shared: o.shared, x: tile.x, y: tile.y, floor: state.world.active,
    });
    addInstanceToScene(res.instance, res.geom);
    markDirty(true);
    renderExplorer();
    $('hud').textContent = res.complete
      ? `placed ${o.label} at ${tile.x}, ${tile.y}`
      // Said out loud rather than silently: with no object of this type on the
      // map to copy, only the shared fields were written.
      : `placed ${o.label} at ${tile.x}, ${tile.y} — no ${o.type} to copy from this map or the game's, so type-specific fields are missing`;
  } catch (e) {
    $('hud').textContent = 'could not place: ' + (e instanceof Error ? e.message : String(e));
  }
}

/** Add a freshly placed object to the live scene. */
export function addInstanceToScene(inst: Instance, geom: { index: number; data: GeomData } | null): void {
  if (!state.world) return;
  const fl = state.world.floors[state.world.active];
  if (!fl) return;
  // Every path that selects, moves, rotates or deletes an object finds it by
  // id, so an object without one would be on screen and unreachable.
  if (!inst.id) { $('hud').textContent = 'placed, but it came back without an id — reload'; return; }
  // A model this scene has never drawn arrives with the instance; build its
  // geometry and material now and park them at the index the main process used,
  // so `inst.g` means the same thing on both sides.
  // Same registration a load does — geometry, materials, and everything else
  // keyed by geom index (the skin, the footprint, the parts a projected
  // material is rebuilt from). This was a second copy of buildGeos once, and
  // what the copy forgot is what a placed object then lacked.
  if (geom) registerGeom(geom.index, geom.data);
  const g = worldGeos[inst.g], m = worldMats[inst.g];
  if (!g || !m) { $('hud').textContent = 'placed, but its mesh is missing — reload to see it'; return; }
  // Stand it on the ground: the main process does not have the height plane the
  // renderer is drawing.
  inst.z = heightAt(inst.x, inst.y);
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set(tileCenter(inst.x), tileCenter(inst.y), inst.z);
  mesh.rotation.z = inst.r;
  mesh.scale.setScalar(geomScale.get(inst.g) ?? 1);
  mesh.userData.inst = inst;
  // The handle stays out of the scene, as in buildFloor; the batch draws it.
  mesh.updateMatrixWorld();
  fl.meshes.set(inst, mesh);
  // An object placed now animates as readily as one loaded with the map, and
  // only joins the batch when it does not.
  if (!addIdle(fl.objGroup, fl.idle, inst, mesh, fl.idle.length * 0.37)) addToBatch(fl, inst, mesh);
  // If this model takes the ground it stands on, give the batch its projection
  // material now that it exists — the load path does this via upgradeToSplat.
  if (geomParts.get(inst.g)?.some((p) => p.terrainProjected)) projectBatch(fl, inst.g);
  fl.instances.push(inst);
  // Its effects light up on the spot — the campfire burns where it lands,
  // not after a save and reopen. Async: the baked keys may need fetching.
  void spawnFx(fl, inst);
  syncFootprints(fl);
}

// --- terrain palette (content browser) -------------------------------------
// The ground tiles the game ships, grouped by their folder the way the original
// editor's "Terra skin" list is. Selecting one arms it as the paint tile.
// A green dot marks tiles this map's terrain already has a layer for — only
// those can be painted, since a new one means restructuring the .bin.
export let allTiles: TileInfo[] = [];
export const tiles = { inMap: new Set<string>() };
let palCat: string | null = null;

export let paletteOpen = false;

/**
 * Give this map a layer for `t`, so it can be painted with.
 *
 * This is the one terrain edit that changes the file's structure rather than
 * overwriting bytes in place, so it is an explicit action on the tile rather
 * than something a brush stroke does silently. The mask starts empty, so the
 * map looks unchanged until the first stroke.
 */
async function addTileLayer(t: TileInfo): Promise<void> {
  if (!state.world) return;
  const fl = activeFloor();
  $('hud').textContent = `adding ${t.name} to this map…`;
  try {
    const r = await api.addLayer({ floor: state.world.active, tile: t.path });
    // One more layer means a different shader, not a texture we can patch.
    if (r.splat) { fl.splat = r.splat; await upgradeToSplat(fl); }
    tiles.inMap = new Set(r.inMap);
    markDirty(true);
    renderPalette();
    $('hud').textContent = `${t.name} added — paint away`;
  } catch (e) {
    $('hud').textContent = 'could not add the tile: ' + (e instanceof Error ? e.message : String(e));
  }
}

export function renderPalette(): void {
  const grid = $('pal-grid');
  grid.innerHTML = '';
  const shown = allTiles.filter((t) => t.category === palCat);
  if (!shown.length) { grid.innerHTML = '<div style="color:#6e7681;font-size:11px">empty</div>'; return; }
  for (const t of shown) {
    const used = tiles.inMap.has(t.path);
    const el = document.createElement('div');
    el.className = 'tile' + (armed.tile?.path === t.path ? ' on' : '');
    el.title = `${t.name}\n${t.type || '—'} · priority ${t.priority} (higher paints on top)`;
    const img = document.createElement('img'); img.src = t.thumb; img.alt = t.name;
    const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = t.name;
    el.append(img, nm);
    if (used) {
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.title = 'This map already carries a layer for this tile. Tiles without a dot get one added when picked.';
      el.appendChild(dot);
    }
    el.onclick = () => {
      armed.tile = t;
      // Tiles with no layer in this map cannot be painted yet — adding one means
      // inserting an array into the .bin. Say so at selection time rather than
      // letting the brush no-op silently.
      $('pal-sel').textContent = `${t.name} · priority ${t.priority}`;
      // Choosing a tile is the intent to paint with it: switch to paint mode
      // and arm, so the click leads somewhere instead of highlighting a swatch.
      brush.mode = 'paint'; brush.dir = 0;
      $select('brushmode').value = 'paint';
      syncBrushPanel();
      setBrush(true);
      renderPalette();
      // A tile this map has no layer for gets one now, on the spot.
      if (!used) addTileLayer(t);
    };
    grid.appendChild(el);
  }
}

function renderPalCats(): void {
  const cats = [...new Set(allTiles.map((t) => t.category))].sort();
  const sel = $select('pal-cat');
  sel.innerHTML = '';
  for (const c of cats) {
    const o = document.createElement('option');
    o.value = c;
    o.textContent = `${c} (${allTiles.filter((t) => t.category === c).length})`;
    sel.appendChild(o);
  }
  if (palCat === null || !cats.includes(palCat)) palCat = cats.includes('Grass') ? 'Grass' : (cats[0] ?? null);
  if (palCat !== null) sel.value = palCat;
}

async function initPalette() {
  if (allTiles.length) return;
  try {
    const listed = await api.listTiles();
    allTiles = listed.tiles;
    tiles.inMap = new Set(listed.inMap);
    renderPalCats();
    renderPalette();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    $('pal-grid').innerHTML = `<div style="color:#f85149;font-size:11px">${msg}</div>`;
  }
}

export function setPalette(open: boolean): void {
  paletteOpen = open;
  // The two palettes occupy the same strip, so opening this one closes the
  // object panel — which also puts down whatever it had armed.
  if (open && objPalOpen) setObjPalette(false);
  if (open && regionsOpen) setRegionsPanel(false);
  if (open && fillOpen) setFillPanel(false);
  $('palette').style.display = open ? 'flex' : 'none';
  $('help').style.right = open ? '280px' : '12px';
  $('panel').style.right = open ? '280px' : '12px'; // keep the object panel clear of it
  // The panel holds the terrain tools now, so whether it is open is worth
  // remembering across sessions — a session spent shaping ground wants it open.
  saveUiPrefs({ terrainPanel: open });
  if (open) initPalette();
}

/** Bind the object palette's own category, search and hidden filters. */
export function initObjectFilters(): void {
  $select('obj-cat').addEventListener('change', (e) => {
    objCat = (e.currentTarget as HTMLSelectElement).value;
    objShown = OBJ_PAGE;
    renderObjGrid();
  });
  $input('obj-search').addEventListener('input', (e) => {
    objSearch = (e.currentTarget as HTMLInputElement).value.trim().toLowerCase();
    objShown = OBJ_PAGE;
    renderObjGrid();
  });
  $input('obj-hidden').checked = showHiddenObjects; // match the restored pref
  $input('obj-hidden').addEventListener('change', (e) => {
    showHiddenObjects = (e.currentTarget as HTMLInputElement).checked;
    saveUiPrefs({ showHidden: showHiddenObjects });
    objShown = OBJ_PAGE;
    renderObjGrid();
  });
}

/** Bind both content browsers to their markup. */
export function initPalettes(): void {
  $select('pal-cat').addEventListener('change', (e) => {
    palCat = (e.currentTarget as HTMLSelectElement).value;
    renderPalette();
  });
  $('palbtn').onclick = () => setPalette(!paletteOpen);
  $('pal-close').onclick = () => setPalette(false);
  $('objpalbtn').onclick = () => {
    const open = !objPalOpen;
    // Same reason as the object list: this panel exists to put objects ON the
    // map, and placing one while objects are hidden drops it somewhere invisible.
    // Worse here than in the list, because the object really was added — it just
    // cannot be seen, so it reads as the placement having failed.
    if (open && state.world && !state.showObjects) setShowObjects(true);
    setObjPalette(open);
  };
}
