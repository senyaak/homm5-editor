// Renderer — live 3D map view with pick-and-move editing.
//
// Talks to the main process only through `api` (see preload.cjs):
// loadMap returns scene data (terrain + decoded object meshes + placed
// instances); moving an object sends the new tile position back so the map
// model — the source of truth — records the edit.
//
// Interaction:
//   * left-drag empty space  -> orbit (OrbitControls)
//   * left-click an object   -> select (shows info panel + bounding box)
//   * left-drag an object    -> move it across the terrain, snapped to tiles
//   * wheel / right-drag      -> zoom / pan
//
// The game is Z-up; object positions are tile coordinates, Rot is about Z.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { $, $select, $button, $input, setChild, fillSelect } from '#core/dom.ts';
import { api } from '#core/ipc.ts';
import { uiPrefs, saveUiPrefs } from '#core/prefs.ts';
import { ask, modDialog, openOnTop } from '#core/dialog.ts';
import { state, activeFloor } from '#core/state.ts';
import { tileCenter, heightOn, heightAt } from '#core/coords.ts';
import { renderer, scene, camera, controls, topCamera, cam, keys, isTyping, raycaster, ptr,
  syncTopCamera, setTopView, keyPan, DEFAULT_BG } from '#viewport/stage.ts';
import { worldGeos, worldMats, geomParts, geomScale, geomFootprint, geomSkin, geomFx,
  registerGeom, buildGeos } from '#viewport/geoms.ts';
import { materialFor, partTexture } from '#viewport/materials.ts';
import { terrainColor, asTileSpace, terrainGeometry, waterCells, waterGeometry, makeWaterMesh,
  WATER_ORDER, remeshFloor, sea } from '#viewport/terrain-mesh.ts';
import { refreshBlocked, refreshFootprints, syncFootprints, setShowBlocked, showBlocked } from '#viewport/overlays.ts';
import { advanceIdle, clearIdle, removeIdle, addIdle, idleMode, setIdleMode } from '#viewport/idle.ts';
import { roster, objectsOfClass, canCreateClass, mapNames, forgetClass } from '#core/rosters.ts';
import { openRecolor, initRecolor } from '#features/mods/recolor.ts';
import { pickPreset, initPresetPicker } from '#features/mods/preset.ts';
import { modRow, NL } from '#features/mods/shared.ts';
import { initHeroesMod } from '#features/mods/heroes.ts';
import { initUnitsMod } from '#features/mods/units.ts';
import { openCampaignList, initCampaigns } from '#features/campaigns.ts';
import { initPropertyPanel } from '#features/inspector/controls.ts';
import { initRefs } from '#features/inspector/refs.ts';
import { initTextEditor } from '#features/text-editor/document.ts';
import { initLocalization } from '#features/localization.ts';
import type { IdleMode } from '#viewport/idle.ts';
import { syncInstance, removeFromBatch, addToBatch, buildBatches, replaceInstances } from '#viewport/instancing.ts';
import { loadFx, advanceFx, spawnFx, removeFx } from '#viewport/fx.ts';
import { makeLightMap, bakeLightMap, markLightsDirty } from '#viewport/point-lights.ts';
import { upgradeToSplat, projectBatch, applyProjectedMaterials, setGroundScale, setCliffAmount,
  cliffsOn, disposeSplats } from '#viewport/splat.ts';
import { applyAmbient, refreshLighting, sun, uSunDir, uSunCol, uAmbCol, uLmGain, uFxTint } from '#viewport/lighting.ts';
import type { Floor3D, World, Selection, GeomBatch } from '#core/state.ts';
import { UNITS_PER_TILE as U } from '#src/units.ts';
import { tierOf, RAMP_BIT, TIER_STEP } from '#src/terrain.ts';
import type { Scene, Floor, Instance, SplatData, TileInfo, GeomData, GeomPart, Footprint, SkinnedGeom, AmbientData, FxInstancePayload } from '#src/scene.ts';
import { createFxSystem } from '#viewport/particles.ts';
import type { FxSystem } from '#viewport/particles.ts';
import type { MapListEntry, ExternalChange, ModListEntry, PlaceableObject, RosterEntryDTO, LocResult,
  CampaignDoc, CampaignListEntry, CampaignMissionDto, CreatureStats, PaletteEntry, RecolorOps } from '#electron/ipc.ts';
import { recolorPixels } from '#src/recolor.ts';
import { artLabels } from '#src/heroes.ts';
import type { ObjectProp } from '#src/map.ts';
import { objectProps, deref, controlOf, objectSchema, mapSchema, resolveSchemaAtPath, classOf, schemaForClass } from '#src/schema.ts';
import type { FieldSchema, HasDefs } from '#src/schema.ts';
import { deselect, renderExList, renderExplorer, selectById, updatePanel } from '#features/selection.ts';
import { isDirty, markDirty } from '#core/dirty.ts';
import { stepHistory, updateHistoryUI } from '#features/history.ts';
import { closeMapProps } from '#features/inspector/map-props.ts';
import { loadProps } from '#features/inspector/panel.ts';
import { MAP_TREE, closeMapTree, dataAt, mapTreeOpen, mtOpen, showAdvanced, openMapTree, pathKey, refreshMapTree, treeTarget } from '#features/inspector/tree.ts';
import { loadLocState, loc } from '#features/localization.ts';
import { openTextEdit, refreshScriptContext } from '#features/text-editor/document.ts';
import { TOWN_BONUSES } from '#src/town-bonuses.ts';
import type { TreeData, Path as TreePath } from '#src/tree.ts';
import { makeIdle, poseIdle } from '#viewport/skinning.ts';
import type { IdleObject } from '#viewport/skinning.ts';
import { mountCodeEditor } from '#features/text-editor/code-editor.ts';
import { loadScriptContext, scriptContextNote, forgetScriptContext } from '#features/text-editor/context.ts';
import type { CodeEditor } from '#features/text-editor/code-editor.ts';
import type { LuaDiagnostic } from '#src/lua-lint.ts';

type MapEntry = MapListEntry & { cat: string };

declare global {
  interface Window {
    /** Plan-view geometry for click-driven tests — see "automation hook" below. */
    view: ViewApi;
    /**
     * Set once, by the last line of this module. Absent means the module never
     * reached its end — index.html's trap watches for that, since a boot that
     * hangs rather than throws raises no event to catch.
     */
    __booted?: true;
  }
}

const ALL = 'All'; // category chip meaning 'no filter', used as both label and key


function clearWorld(): void {
  disposeSplats();
  if (state.world) for (const fl of state.world.floors) {
    scene.remove(fl.group);
    // An InstancedMesh owns a GPU buffer of its own beyond the shared geometry;
    // without this it survives every map load.
    for (const b of fl.batches.values()) b.im.dispose();
    for (const s of fl.fx) s.dispose();
    fl.fx.length = 0;
    fl.lightMap.dispose();
    fl.group.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
  }
  if (state.boxHelper) { scene.remove(state.boxHelper); state.boxHelper = null; }
  state.world = null; state.selected = null; updatePanel();
  applyAmbient(null);
}



// Build one floor: its coloured terrain heightmap + its placed object meshes.

function buildFloor(floor: Floor, geos: THREE.BufferGeometry[], mats: THREE.Material[][]): Floor3D {
  const group = new THREE.Group();
  const V = floor.V, heights = floor.heights;

  const tg = terrainGeometry(V, heights, floor.flags, floor.colors);
  // Start on the flat MinimapColor blend; the textured splat material replaces
  // it as soon as its textures finish decoding (see upgradeToSplat).
  const terrainMesh = asTileSpace(new THREE.Mesh(tg, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })));
  group.add(terrainMesh);
  let waterMesh = null;

  // Water surface: a flat sheet over each dug basin at that body's own level.
  // The basin floor is often below it, so without this the map shows a dry pit
  // and anything sitting at water level looks like it hovers.
  // Sea: one flat sheet at sea level over every cell touching a water-flagged
  // vertex. The bed is dug to 0 and the shore climbs to 2.0, so the terrain
  // itself clips the sheet and produces the waterline — no feathering needed.
  const wat = floor.water;
  if (wat && wat.cells.length) {
    waterMesh = makeWaterMesh(V, wat.cells, wat.level, wat.tex);
    group.add(waterMesh);
  }

  // Objects live in their own subgroup so they can be hidden wholesale while
  // working on the terrain (which they otherwise cover almost completely).
  const objGroup = new THREE.Group();
  objGroup.visible = state.showObjects;
  group.add(objGroup);

  const meshes = new Map();
  for (const it of floor.instances) {
    const m = new THREE.Mesh(geos[it.g], mats[it.g]);
    // Tile index out to where the tile actually is; z is already a world height.
    m.position.set(tileCenter(it.x), tileCenter(it.y), it.z);
    m.rotation.z = it.r;
    m.scale.setScalar(geomScale.get(it.g) ?? 1);
    m.userData.inst = it;
    // NOT added to the scene: this mesh is the pick-and-edit handle, and the
    // drawing is done by the instanced meshes below. Its world matrix still has
    // to be current, because the raycaster and the selection box read it.
    m.updateMatrixWorld();
    meshes.set(it.id, m);
  }
  // Whatever takes an animated body drops out of the batched list: the two draw
  // the same model, and left in both an object would show its idle and its bind
  // pose at once, in the same place.
  const idle: IdleObject[] = [];
  const still = floor.instances.filter((it, i) => {
    const handle = it.id === null ? null : meshes.get(it.id);
    return !(handle && addIdle(objGroup, idle, it, handle, i * 0.37));
  });
  const batches = buildBatches(still, meshes, geos, mats, objGroup);
  const fl: Floor3D = {
    name: floor.name, V, heights, flags: floor.flags, colors: floor.colors,
    // A river already in the map is at full depth: never dig it again.
    riverDrop: new Map(floor.riverVerts.map((v) => [v, RIVER_DEPTH])),
    passable: floor.passable, river: new Set(floor.riverVerts), passMeshes: [], footMeshes: [],
    group, objGroup, meshes, batches, idle, fx: [], terrainMesh, waterMesh, waterTex: floor.water?.tex ?? null,
    splat: floor.splat, maskTex: null, ambient: floor.ambient, instances: floor.instances,
    lightMap: makeLightMap(V), lightsDirty: false,
  };
  bakeLightMap(fl); // cheap when nothing on the floor carries lights
  return fl;
}

function buildWorld(S: Scene): void {
  clearWorld();
  const { geos, mats } = buildGeos(S);
  const floors = S.floors.map((f) => buildFloor(f, geos, mats));
  for (const fl of floors) scene.add(fl.group);
  // Particle effects arrive over their own IPC (typed arrays, not scene JSON);
  // the map is fully usable while they stream in.
  loadFx(floors).catch((e: unknown) => console.error('effects failed', e));
  state.world = { floors, active: 0 };
  setActiveFloor(0); // frames the floor + builds its explorer list
  updateFloorUI();
  // Textured ground arrives asynchronously; the flat blend shows meanwhile.
  for (const fl of floors) {
    upgradeToSplat(fl).catch((e: unknown) => {
      console.error('splat failed', fl.name, e);
      $('hud').textContent = 'ground textures: ' + (e instanceof Error ? e.message : String(e));
    });
  }
}

// Switch which floor is shown; only its group is visible and pickable.
function setActiveFloor(i: number): void {
  if (!state.world) return;
  state.world.active = i;
  state.world.floors.forEach((fl, idx) => { fl.group.visible = idx === i; });
  // Each floor lights like its own preset says — surface day, underground dark
  // (unless the Light toggle asks for the flat editing look).
  refreshLighting();
  deselect();
  const { V, heights } = activeFloor();
  // Frame the camera on this floor (its terrain sits at its own height range).
  let sum = 0; for (const h of heights) sum += h;
  const midZ = sum / heights.length, c = (V / 2) * U;
  controls.target.set(c, c, midZ);
  camera.position.set(c, -V * 0.5 * U, midZ + V * 0.7 * U);
  controls.update();
  // Fit the whole floor in the plan view too (a touch of margin past the edge).
  cam.half = V * 0.55 * U;
  syncTopCamera();
  updateFloorUI();
  if (state.world) renderExplorer(); // floor switch -> its own object list
  // Regions belong to a floor too: the outlines and the list's dimming both
  // follow which one is shown.
  renderRegionList();
  drawRegionOverlay();
}

// --- pointer: orbit / select / move ---
//
// The map is densely covered with objects, so we must NOT hijack every drag for
// object-moving or the camera could never orbit. Rules:
//   * A plain click (no drag) selects the object under the cursor (or clears).
//   * The camera orbits on any drag EXCEPT when the drag starts on the object
//     that is already selected — that drag moves it. So: click to select, then
//     drag it to move. Orbiting stays available everywhere else.
const CLICK_SLOP = 5; // px; movement under this = a click, not a drag
let down: { sx: number; sy: number; hitId: string | null } | null = null; // { sx, sy, hitId }
let dragging = false, moved = false;
// [perf] The plain hover marker needs a full-terrain raycast, which is the most
// expensive thing a pointermove can do (≈6ms on a 256² map — brute force, three
// has no BVH). A high-poll mouse fires many moves per frame, so the raycast is
// deferred: the latest move is stashed here and resolved once, in the render
// loop, right before drawing. Many moves between frames now cost one raycast.
let hoverEv: PointerEvent | null = null;

function pickObject(ev: PointerEvent): THREE.Mesh | null {
  if (!state.showObjects) return null; // hidden objects must not swallow clicks
  ptr.x = (ev.clientX / innerWidth) * 2 - 1;
  ptr.y = -(ev.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(ptr, cam.active);
  const hits = raycaster.intersectObjects<THREE.Mesh>([...activeFloor().meshes.values()], false);
  return hits.length ? hits[0]!.object : null;
}

renderer.domElement.addEventListener('pointerleave', () => { updateBrushCursor(null); updateHoverCursor(null); hoverEv = null; });

renderer.domElement.addEventListener('pointerdown', (ev) => {
  if (!state.world || ev.button !== 0) return;
  // The region tool drags out a rectangle: the press is one corner, the release
  // the other. Like the brush it takes the left button off the camera, which
  // middle and right still move.
  if (regionDraw) {
    regionAnchor = tileUnderCursor(ev);
    controls.enabled = false;
    updateBrushCursor(regionAnchor);
    return;
  }
  // With the brush armed, left-drag paints instead of orbiting. Middle and
  // right still move the camera, so the view stays reachable mid-stroke.
  if (brushOn) {
    painting = true;
    controls.enabled = false;
    strokeVerts.clear();
    riverHeights.clear();
    lastTile = -1; lastTick = 0;   // a new stroke always applies its first tick
    rectAnchor = rectMode ? tileUnderCursor(ev) : null;
    applyBrush(ev);
    return;
  }
  // With an object armed, a click places it — but a DRAG still orbits, so the
  // camera stays usable without disarming. Which it was is only known on
  // pointerup, so nothing is decided here beyond remembering where it started.
  if (placeObject) {
    down = { sx: ev.clientX, sy: ev.clientY, hitId: null };
    return;
  }
  const hit = pickObject(ev);
  down = { sx: ev.clientX, sy: ev.clientY, hitId: hit ? hit.userData.inst.id : null };
  // Grab-to-move only when pressing on the already-selected object.
  if (state.selected && hit && hit.userData.inst.id === state.selected.id) {
    dragging = true; moved = false;
    controls.enabled = false;
  }
  // Otherwise leave controls enabled so this drag orbits the camera.
});

renderer.domElement.addEventListener('pointermove', (ev) => {
  // Ahead of the held-button bail below: dragging out a region IS a gesture with
  // the button down, and its whole feedback is the footprint growing under it.
  if (regionDraw) { updateBrushCursor(tileUnderCursor(ev)); return; }
  // [perf] While a mouse button is held and we are neither painting nor moving
  // an object, the user is orbiting or panning the camera. That gesture wants no
  // cursor gizmo, and running a terrain raycast on every one of its many moves is
  // exactly what made dragging the map crawl. Bail before any raycast.
  if (ev.buttons !== 0 && !painting && !dragging) {
    updateBrushCursor(null); updateHoverCursor(null); hoverEv = null;
    return;
  }
  // Track the footprint on every move, painting or not -- the point of the
  // gizmo is to show where a stroke WOULD land before committing to one.
  if (brushOn) updateBrushCursor(tileUnderCursor(ev));
  // The armed object borrows the brush's footprint gizmo, so where it will land
  // is visible before committing — the same feedback painting gets.
  else if (placeObject) updateBrushCursor(tileUnderCursor(ev));
  // Otherwise show the plain one-tile marker, but not mid-drag: the object being
  // dragged already says where it is, and a second square trailing it is noise.
  // The raycast for it is deferred to the frame loop (see hoverEv) so a burst of
  // moves between two frames resolves to a single pick.
  if (!brushOn && !placeObject && !dragging) hoverEv = ev;
  else { updateHoverCursor(null); hoverEv = null; }
  // A move with no button held cannot belong to a stroke. If `painting` survived
  // one, the pointerup was lost — the window took focus elsewhere, or the event
  // was swallowed — and the brush would go on painting under a released button.
  // For a person that is a brush stuck on; while rebuilding C1M1 it showed up as
  // a handful of vertices out of 9409 carrying a stroke twice, a different
  // handful each run. End the stroke here instead, and flush what it did.
  if (painting && ev.buttons === 0) {
    painting = false;
    controls.enabled = true;
    void commitBrush();
    return;
  }
  if (painting) { applyBrush(ev); return; }
  if (!dragging || !state.selected) return;
  // Project the cursor onto a horizontal plane at the object's height and snap
  // the resulting world position to the tile grid.
  ptr.x = (ev.clientX / innerWidth) * 2 - 1;
  ptr.y = -(ev.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(ptr, cam.active);
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -state.selected.mesh.position.z);
  const hit = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(plane, hit)) return;
  // The ray lands in world units; the object's position is a CELL index, the
  // same floor() convention placement uses, so a drag lands on the same square a
  // fresh placement would rather than snapping half a tile across to the corner.
  // Alt drops the grid: shipped maps place decoration at a fraction of a tile,
  // and a snapped drag cannot put it back.
  const free = ev.altKey;
  const nx = free ? +(hit.x / U).toFixed(3) : Math.floor(hit.x / U);
  const ny = free ? +(hit.y / U).toFixed(3) : Math.floor(hit.y / U);
  if (nx === state.selected.inst.x && ny === state.selected.inst.y) return;
  state.selected.inst.x = nx; state.selected.inst.y = ny;
  state.selected.mesh.position.set(tileCenter(nx), tileCenter(ny), heightAt(Math.floor(nx), Math.floor(ny)));
  syncInstance(activeFloor(), state.selected.inst);
  syncFootprints();
  state.boxHelper?.setFromObject(state.selected.mesh);
  moved = true;
  updatePanel();
});

addEventListener('pointerup', async (ev) => {
  // A region lands on release, from the two corners of the drag. A press that
  // never moved is a one-tile region, which is a real thing — C1M1 has several.
  if (regionAnchor) {
    const a = regionAnchor, b = tileUnderCursor(ev) ?? a;
    regionAnchor = null;
    controls.enabled = true;
    await addRegion({
      x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y),
      x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y),
    });
    return;
  }
  if (painting) {
    painting = false;
    controls.enabled = true;
    // Rect did nothing while dragging: this is where the rectangle lands.
    if (rectMode && rectAnchor) {
      const r = currentRect(ev);
      if (r) applyRect(r);
      rectAnchor = null;
    }
    await commitBrush();
    return;
  }
  if (!state.world || !down) return;
  const wasClick = Math.abs(ev.clientX - down.sx) < CLICK_SLOP && Math.abs(ev.clientY - down.sy) < CLICK_SLOP;

  if (placeObject) {
    down = null;
    if (!wasClick) return; // that was an orbit
    // Alt places where the cursor actually is instead of on the tile it is over.
    const tile = ev.altKey ? freeTileAtClient(ev.clientX, ev.clientY) : tileUnderCursor(ev);
    if (!tile) { $('hud').textContent = 'click on the terrain to place'; return; }
    await placeAt(tile);
    return;
  }

  if (dragging) {
    dragging = false; controls.enabled = true;
    if (moved && state.selected) {
      await api.moveObject(state.selected.id, state.selected.inst.x, state.selected.inst.y);
      markDirty(true);
    }
  } else if (wasClick) {
    // A click that didn't move the camera: (de)select.
    if (down.hitId) selectById(down.hitId); else deselect();
  }
  down = null;
});

// --- terrain brush ---------------------------------------------------------
//
// Painting is applied twice: into the mask texture on the GPU, so the stroke
// appears under the cursor with no round trip, and — on pointer-up — into the
// main process, which owns the bytes that get saved. The two use the same rule
// (target layer to full strength, every other layer cleared at that vertex),
// because the shader composites by priority: raising the target alone would
// leave any higher-priority layer sitting on top of the new paint.
//
// The renderer's copy is never read back. A reload always takes what the main
// process wrote, so the GPU copy drifting would show up immediately rather than
// corrupting anything.

let brushOn = false;
let brushSize = 1;         // in tiles: 1, 3, 5, 7
let painting = false;
/** Vertices touched by the stroke in progress, deduped. */
const strokeVerts = new Set<number>();


/** Paint or erase the mask under the brush. */
function maskAt(tiles: number[], walkable: boolean): void {
  const fl = activeFloor();
  // A map made by New Map has no mask plane yet: the format leaves the slot
  // empty and the main process fills it in on the first stroke. Start one here
  // too, all walkable, or the brush would do nothing on a fresh map.
  if (!fl.passable) fl.passable = new Array<number>(fl.V * fl.V).fill(1);
  const fresh = tiles.filter((v) => !strokeVerts.has(v));
  if (!fresh.length) return;
  for (const v of fresh) {
    strokeVerts.add(v);
    fl.passable[v] = walkable ? 1 : 0;
  }
  // The overlay is the only feedback this brush has, so force it on: masking
  // blind would be indistinguishable from the tool not working.
  if (!showBlocked) setShowBlocked(true); else refreshBlocked(fl);
}

/** Send the finished mask stroke. */
async function commitMask(walkable: boolean): Promise<void> {
  if (!strokeVerts.size || !state.world) { strokeVerts.clear(); return; }
  const verts = [...strokeVerts];
  strokeVerts.clear();
  try {
    await committing(api.setMask({ floor: state.world.active, verts, walkable }));
    markDirty(true);
  } catch (e) {
    $('hud').textContent = 'mask failed (reload to resync): '
      + (e instanceof Error ? e.message : String(e));
  }
}

// --- brush cursor ----------------------------------------------------------
//
// The system cursor says nothing about what a stroke will cover: the brush is
// square, sized in tiles, and lands on the grid, none of which an arrow conveys.
// So the arrow is hidden while the brush is armed and replaced by the footprint
// drawn on the ground — every cell it will touch, following the terrain.
//
// Drawn with depthTest off so it stays readable inside a pit or behind a hill.
// A gizmo that disappears exactly where the ground is interesting is worse than
// none, and a depth offset large enough to survive a cliff would float visibly
// over flat ground.

let brushCursor: THREE.LineSegments | null = null;

function ensureBrushCursor(): THREE.LineSegments {
  if (brushCursor) return brushCursor;
  const mat = new THREE.LineBasicMaterial({
    color: 0xffd23f, transparent: true, opacity: 0.9, depthTest: false,
  });
  brushCursor = asTileSpace(new THREE.LineSegments(new THREE.BufferGeometry(), mat));
  brushCursor.renderOrder = 999;
  brushCursor.visible = false;
  scene.add(brushCursor);
  return brushCursor;
}

/** Redraw the footprint outline over tile (cx, cy), or hide it when off-map. */
function updateBrushCursor(at: { x: number; y: number } | null): void {
  const c = ensureBrushCursor();
  if (!at || !state.world) { c.visible = false; return; }
  const fl = activeFloor();
  // Mid-drag in Rect mode the footprint is the rectangle so far, not a square
  // under the cursor — otherwise the one size whose shape you choose yourself is
  // the one size you cannot see before committing to it.
  // The region tool drags out a rectangle the same way, and wants the same
  // preview: which tiles the region will cover, before it exists.
  const anchor = regionDraw ? regionAnchor : rectMode ? rectAnchor : null;
  const r = anchor
    ? { x0: Math.min(anchor.x, at.x), y0: Math.min(anchor.y, at.y),
        x1: Math.max(anchor.x, at.x), y1: Math.max(anchor.y, at.y) }
    : squareRect(at.x, at.y, rectMode || regionDraw ? 1 : brushSize);
  const LIFT = 0.05; // just clear of the surface, so it reads as lying on it
  const z = (x: number, y: number): number => {
    const cx = Math.min(fl.V - 1, Math.max(0, x)), cy = Math.min(fl.V - 1, Math.max(0, y));
    return fl.heights[cy * fl.V + cx]! + LIFT;
  };
  const pts: number[] = [];
  const seg = (x0: number, y0: number, x1: number, y1: number): void => {
    pts.push(x0, y0, z(x0, y0), x1, y1, z(x1, y1));
  };
  // Every cell edge in the footprint, so the grid reads as tiles rather than
  // one box — the brush works per tile and should look like it.
  for (let y = r.y0; y <= r.y1 + 1; y++) {
    for (let x = r.x0; x <= r.x1; x++) {
      if (y < 0 || y >= fl.V || x < 0 || x + 1 >= fl.V) continue;
      seg(x, y, x + 1, y);
    }
  }
  for (let x = r.x0; x <= r.x1 + 1; x++) {
    for (let y = r.y0; y <= r.y1; y++) {
      if (x < 0 || x >= fl.V || y < 0 || y + 1 >= fl.V) continue;
      seg(x, y, x, y + 1);
    }
  }
  const g = c.geometry;
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
  g.computeBoundingSphere();
  c.visible = pts.length > 0;
}

// A quiet one-tile marker that follows the mouse whenever no brush or object is
// armed, so it is always clear which square a click would act on — the same job
// the brush gizmo does while armed, kept up the rest of the time.
let hoverCursor: THREE.LineSegments | null = null;

function ensureHoverCursor(): THREE.LineSegments {
  if (hoverCursor) return hoverCursor;
  const mat = new THREE.LineBasicMaterial({
    color: 0x66ccff, transparent: true, opacity: 0.7, depthTest: false,
  });
  hoverCursor = asTileSpace(new THREE.LineSegments(new THREE.BufferGeometry(), mat));
  hoverCursor.renderOrder = 998; // just under the brush gizmo's 999
  hoverCursor.visible = false;
  scene.add(hoverCursor);
  return hoverCursor;
}

/** Outline the single cell under the cursor, or hide it when off-map. */
function updateHoverCursor(at: { x: number; y: number } | null): void {
  const c = ensureHoverCursor();
  const fl = state.world ? activeFloor() : null;
  // A cell (x, y) needs its far corner (x+1, y+1) to exist, so stop one short.
  if (!at || !fl || at.x < 0 || at.y < 0 || at.x + 1 >= fl.V || at.y + 1 >= fl.V) {
    c.visible = false; return;
  }
  const LIFT = 0.05;
  const z = (x: number, y: number): number => fl.heights[y * fl.V + x]! + LIFT;
  const x = at.x, y = at.y;
  const p: number[] = [];
  const seg = (x0: number, y0: number, x1: number, y1: number): void => {
    p.push(x0, y0, z(x0, y0), x1, y1, z(x1, y1));
  };
  seg(x, y, x + 1, y); seg(x + 1, y, x + 1, y + 1);
  seg(x + 1, y + 1, x, y + 1); seg(x, y + 1, x, y);
  const g = c.geometry;
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(p), 3));
  g.computeBoundingSphere();
  c.visible = true;
}

/** Tile under the cursor, from a ray against the terrain itself (so it follows hills). */
function tileUnderCursor(ev: PointerEvent): { x: number; y: number } | null {
  return tileAtClient(ev.clientX, ev.clientY);
}

/**
 * The VERTEX nearest the cursor — the grid corner, not the tile.
 *
 * Heights live on vertices, and a map has one more of them per side than it has
 * tiles, so the outermost row and column can only be addressed this way. It
 * rounds where the tile pick floors, off the same ray.
 */
function vertexAtClient(clientX: number, clientY: number): { x: number; y: number } | null {
  const p = groundPointAtClient(clientX, clientY);
  if (!p) return null;
  const V = activeFloor().V;
  const x = Math.round(p.x / U), y = Math.round(p.y / U);
  if (x < 0 || y < 0 || x >= V || y >= V) return null;
  return { x, y };
}

/**
 * The position under the cursor WITHOUT rounding it to a tile, in tiles.
 *
 * What Alt-placement and Alt-drag use. A shipped mission is not laid out on the
 * grid alone: C1M1 puts 218 of its 2645 objects at an arbitrary fraction of a
 * tile — not halves, so no finer grid would catch them either.
 */
function freeTileAtClient(clientX: number, clientY: number): { x: number; y: number } | null {
  const p = groundPointAtClient(clientX, clientY);
  if (!p) return null;
  const T = activeFloor().V - 1;
  const x = p.x / U, y = p.y / U;
  if (x < 0 || y < 0 || x >= T || y >= T) return null;
  return { x: +x.toFixed(3), y: +y.toFixed(3) };
}

/** Same, from bare client coordinates — what the automation hook picks with. */
function tileAtClient(clientX: number, clientY: number): { x: number; y: number } | null {
  const p = groundPointAtClient(clientX, clientY);
  if (!p) return null;
  const T = activeFloor().V - 1;
  const x = Math.floor(p.x / U), y = Math.floor(p.y / U);
  if (x < 0 || y < 0 || x >= T || y >= T) return null;
  return { x, y };
}

/**
 * The ground position under the pointer, in world units.
 *
 * In the plan view the ray is vertical, so where it lands on the ground plane
 * follows from the camera alone — and taking it from the camera is not just
 * cheaper but MORE correct than asking what the ray hit. A cut face between two
 * tiers stands vertical, edge-on to this camera, and a ray grazing one reports a
 * hit sitting exactly on the grid line between two vertices; rounding that
 * lands on the neighbour. Rebuilding C1M1 that way put 18 of 9409 vertices on
 * the wrong side of a steep step, every one of them beside a tall spike.
 *
 * The 3D view has no such shortcut: there the ray is oblique and the ground's
 * height is what decides where it meets, so it still asks the geometry.
 */
function groundPointAtClient(clientX: number, clientY: number): { x: number; y: number } | null {
  if (!state.world) return null;
  if (cam.top) {
    syncTopCamera();
    const aspect = innerWidth / innerHeight;
    const ndcX = (clientX / innerWidth) * 2 - 1, ndcY = -(clientY / innerHeight) * 2 + 1;
    return {
      x: topCamera.position.x + ndcX * cam.half * aspect,
      y: topCamera.position.y + ndcY * cam.half,
    };
  }
  const p = hitPointAtClient(clientX, clientY);
  return p ? { x: p.x, y: p.y } : null;
}

/** Where a ray through these client coordinates meets the ground, in world units. */
function hitPointAtClient(clientX: number, clientY: number): THREE.Vector3 | null {
  if (!state.world) return null;
  ptr.x = (clientX / innerWidth) * 2 - 1;
  ptr.y = -(clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(ptr, cam.active);
  const ground = activeFloor().terrainMesh;
  // The raycaster tests against matrixWorld, and three.js only refreshes that
  // while rendering. The ground carries a real transform now — it is built in
  // grid space and stretched to tile spacing — so a stale matrix is no longer
  // harmlessly the identity: it aims the ray at a map half the size and every
  // pick misses. Cheap to make certain, and it removes the dependency on a
  // frame having been drawn between the mesh appearing and the first click.
  ground.updateMatrixWorld();
  const hit = raycaster.intersectObject(ground, false)[0];
  // intersectObject reports the hit in world units, whatever the mesh's own
  // transform; the callers divide by U to get grid coordinates.
  return hit ? hit.point : null;
}

// --- automation hook: where to click for a tile ------------------------------
//
// Rebuilding a shipped mission means driving this editor the way a person does —
// real clicks on real tiles (docs/E2E_RECONSTRUCTION.md) — and a click needs a
// pixel. Under the plan camera that mapping is exact and height-independent (see
// the top-down camera above), so it is published here, next to the camera it
// depends on, rather than reimplemented inside the tests: if the view changes,
// one function moves and every test follows.
//
// This is deliberately only about WHERE to click. Which tool is armed, what is
// painted and what gets saved all go through the ordinary UI, because that is
// what the reconstruction is meant to prove.

/** Screen position of a tile, and whether it is actually in the viewport. */
interface TilePoint { x: number; y: number; onScreen: boolean }

/** What is open, as paths — see `opened()`. */
interface OpenedMap {
  /** The `map.xdb` being edited. */
  mapPath: string;
  /** The folder holding it — a workspace, or wherever HOMM5_UNPACK_TO put it. */
  mapDir: string;
  /** The archive it belongs to, when the app knows which: `<game>/H5E/<name>.h5m`. */
  archive: string | null;
}

interface ViewApi {
  /**
   * Where the open map actually is.
   *
   * Neither path is guessable from outside: the working folder is a workspace
   * named by a hash unless `HOMM5_UNPACK_TO` says otherwise, and the archive is
   * chosen by the app. A test that needs them used to read them out of the
   * status line, which any later message overwrites — on a machine without an
   * `Editor` folder the very next warning won that race.
   */
  opened(): OpenedMap | null;
  /** Switch the plan (2D) view on or off — the same call the toolbar makes. */
  plan(on: boolean): void;
  /** Fit the whole active floor in the plan view. */
  fit(): void;
  /** Centre the plan view on a tile, so tiles near it are clickable. */
  focus(x: number, y: number): void;
  /** Plan-view zoom, as the number of tiles spanned from the centre to the top edge. */
  zoom(halfTiles: number): void;
  /** Where to click for the centre of tile (x, y), in CSS pixels. */
  tileToScreen(x: number, y: number): TilePoint;
  /** Which tile a click at these CSS pixels lands on — the app's own picking. */
  tileAt(clientX: number, clientY: number): { x: number; y: number } | null;
  /** Where to click for grid VERTEX (x, y) — what the vertex brush addresses. */
  vertexToScreen(x: number, y: number): TilePoint;
  /** Which vertex a click at these CSS pixels lands on — the app's own picking. */
  vertexAt(clientX: number, clientY: number): { x: number; y: number } | null;
  /** Where to click for river-plane cell (x, y) — the half-tile grid. */
  cellToScreen(x: number, y: number): TilePoint;
  /** Which river cell a click at these CSS pixels lands on. */
  cellAt(clientX: number, clientY: number): { x: number; y: number } | null;
  /** Cells per side of the river plane, or 0 when no map is open. */
  cells(): number;
  /** The active floor's live heights and ground kinds — what the app believes. */
  heights(): number[];
  kinds(): number[];
  /**
   * What the idle stance is doing: the mode the open scene was BUILT for, how
   * many objects on the visible floor have their own animated body, and how far
   * the furthest of them has run. The clock is what says the loop is turning —
   * a skeleton that is built but never stepped looks identical from outside.
   */
  idle(): { mode: IdleMode; animated: number; time: number; geoms: number[]; skinned: number[]; fx: number };
  /**
   * The lighting actually applied to the scene right now — preset or fallback,
   * and whether the background is the map's sky. Lighting has no other
   * observable surface: a preset that fails to load just leaves the fallback
   * look, which a screenshot alone cannot tell apart from a dim preset.
   */
  ambientState(): { preset: boolean; sun: number[]; sunPos: number[]; terrain: { amb: number[]; sun: number[] } };
  /**
   * The active floor's designer point lights: how many the floor carries and
   * how many lightmap texels their bake actually lit. A wrong offset/radius
   * reading would still light SOMETHING, so tests assert on both together
   * with where the pools land (the texel count scales with radius²).
   */
  pointLights(): { count: number; litTexels: number };
  /** Per-system particle state on the active floor — which effects are actually alive. */
  fxSystems(): {
    uid: string; shared: string; at: number[];
    /** The system's own world position this frame — a glued one rides its bone. */
    pos: number[];
    /** The bone it is glued to, when it is. */
    glue: string;
    alive: number; visible: boolean; tint: number[];
  }[];
  /**
   * Place an object through the renderer's own palette path — the one that
   * grafts the new instance onto the LIVE scene (idle, effects, batch).
   * `api.addObject` alone is only the main-process half; a test
   * driving it directly would assert on a scene the placement never touched.
   */
  place(o: { type: string; shared: string; x: number; y: number }): Promise<void>;
  /** True once the ground textures are decoded and a stroke would land. */
  paintReady(): boolean;
  /** Edits sent to the main process and not yet acknowledged. */
  pending(): number;
  /**
   * What the paint brush has done since the app started.
   *
   * `painted` counts vertices written into the GPU masks, `sent` the ones
   * handed to the main process, and `refused` the strokes that reached the
   * brush and did nothing (no tile, no layer, masks not ready). A stage that
   * clicks N times and sees fewer than N here knows the loss is on this side of
   * the IPC before it reads a single byte of the file.
   */
  strokes(): { painted: number; sent: number; refused: number };
  /**
   * Open a map by path, the way the Open dialog does.
   *
   * `api.loadMap` is only the main-process half; the scene, the title
   * and the toolbar all come from the renderer's own open path, which the file
   * dialog normally drives and a test cannot.
   */
  open(path: string): Promise<void>;
  /** Open a text/script file in the doc editor, the way an Edit button does. */
  editText(href: string): Promise<void>;
  /** Tiles per side of the active floor, or 0 when no map is open. */
  size(): number;
  /**
   * Every object on the active floor: what it is and where it stands.
   *
   * Placement is a click on the map, but "which of the 373 bushes did that
   * click create" has no answer on screen — they overlap, and picking one by
   * raycast is exactly the ambiguity this avoids. So the harness places, then
   * reads, then addresses by id.
   */
  objects(): { id: string; type: string; shared: string; x: number; y: number; r: number }[];
  /** Select an object by id — what clicking its row in the object list does. */
  select(id: string): void;
  /**
   * The regions the panel is showing.
   *
   * Drawn ones cannot be addressed any other way: a rectangle dragged on the map
   * has no id, and which item of `<regions>` it became is only knowable from the
   * list the panel keeps.
   */
  regions(): { i: number; name: string; floor: number; x1: number; y1: number; x2: number; y2: number }[];
  /**
   * Line segments the region outlines are drawn with, or 0 when nothing is
   * drawn.
   *
   * The outline is the only thing on screen that says where a region is, and
   * every other check would pass with it silently drawing nothing: the data is
   * in the file either way.
   */
  regionOutline(): number;
}

/** A world point under the plan camera, in CSS pixels. */
function worldToScreen(wx: number, wy: number): TilePoint {
  // The camera is re-synced first: its frustum follows the orbit target and the
  // viewport, and both can have moved since the last frame was drawn.
  syncTopCamera();
  const aspect = innerWidth / innerHeight;
  const ndcX = (wx - topCamera.position.x) / (cam.half * aspect);
  const ndcY = (wy - topCamera.position.y) / cam.half;
  const px = ((ndcX + 1) / 2) * innerWidth, py = ((1 - ndcY) / 2) * innerHeight;
  return { x: px, y: py, onScreen: px >= 0 && py >= 0 && px < innerWidth && py < innerHeight };
}

const view: ViewApi = {
  plan(on) { setTopView(on); },
  fit() {
    if (!state.world) return;
    const V = activeFloor().V, c = (V / 2) * U;
    controls.target.set(c, c, controls.target.z);
    cam.half = V * 0.55 * U;
    syncTopCamera();
  },
  focus(x, y) {
    if (!state.world) return;
    controls.target.set((x + 0.5) * U, (y + 0.5) * U, controls.target.z);
    syncTopCamera();
  },
  zoom(halfTiles) {
    cam.half = Math.max(2 * U, Math.min(400 * U, halfTiles * U));
    syncTopCamera();
  },
  objects() {
    if (!state.world) return [];
    return [...activeFloor().meshes.values()]
      .map((m) => m.userData.inst as Instance)
      .filter((i) => i && i.id)
      .map((i) => ({ id: i.id!, type: i.type, shared: i.shared, x: i.x, y: i.y, r: i.r }));
  },
  select(id) { selectById(id); },
  regions() {
    return regionList.map((r) => ({
      i: r.i, name: r.name, floor: r.floor, x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2,
    }));
  },
  regionOutline() {
    const o = regionOverlay;
    if (!o || !o.visible) return 0;
    return (o.geometry.getAttribute('position')?.count ?? 0) / 2;
  },
  tileToScreen(x, y) { return worldToScreen((x + 0.5) * U, (y + 0.5) * U); },
  tileAt(clientX, clientY) { return tileAtClient(clientX, clientY); },
  // A vertex sits ON the grid line, at a whole multiple of the tile spacing —
  // which is why the outermost row and column exist at all.
  //
  // A vertex on the map's edge sits exactly on the boundary of the terrain
  // mesh, and a ray aimed there is as likely to pass beside it as to hit it, so
  // the point is pulled a quarter tile inwards. The pick rounds to the nearest
  // vertex, so it still resolves to the same one — but it now lands on ground.
  // Without this, every click along the outer ring silently does nothing.
  vertexToScreen(x, y) {
    const last = state.world ? activeFloor().V - 1 : 0;
    const inset = (v: number): number => (v === 0 ? 0.25 : v === last ? -0.25 : 0);
    return worldToScreen((x + inset(x)) * U, (y + inset(y)) * U);
  },
  vertexAt(clientX, clientY) { return vertexAtClient(clientX, clientY); },
  // Cells sit every half tile, and the outermost ring gets the same inward nudge
  // as the vertices: on the boundary a ray can pass beside the mesh entirely.
  cellToScreen(x, y) {
    const last = state.world ? riverSide(activeFloor().V) - 1 : 0;
    const inset = (v: number): number => (v === 0 ? 0.5 : v === last ? -0.5 : 0);
    return worldToScreen((x + inset(x)) * (U / 2), (y + inset(y)) * (U / 2));
  },
  cellAt(clientX, clientY) { return riverCellAtClient(clientX, clientY); },
  cells() { return state.world ? riverSide(activeFloor().V) : 0; },
  // Reading the live planes separates "the stroke never landed" from "it landed
  // and did not reach the file", which otherwise look identical in the diff.
  // Painting refuses until the splat textures are decoded, and a refused stroke
  // looks exactly like a brush that did nothing — so the state is published.
  paintReady() {
    const fl = state.world ? activeFloor() : null;
    if (!fl || !fl.splat || !fl.maskTex) return false;
    // The armed tile's own layer, not just "some splat is decoded". Picking a
    // tile this map has no layer for adds one in the background, and until that
    // lands a stroke has nowhere to go — see brushAt.
    return !paintTile || fl.splat.paths.includes(paintTile.path);
  },
  strokes() { return { painted: paintedVerts, sent: sentVerts, refused: refusedStrokes }; },
  idle() {
    const fl = state.world ? activeFloor() : null;
    return {
      mode: idleMode(),
      animated: fl?.idle.length ?? 0,
      time: fl?.idle.reduce((a, o) => Math.max(a, o.time), 0) ?? 0,
      // Which geoms took an animated body, and which stayed batched despite
      // having a skin on record — the two lists that localize "this creature
      // stands still" to a geom without reaching into the scene.
      geoms: [...new Set(fl?.idle.map((o) => (o.mesh.userData.inst as Instance).g) ?? [])].sort((a, b) => a - b),
      skinned: [...geomSkin.keys()].sort((a, b) => a - b),
      fx: fl?.fx.length ?? 0,
    };
  },
  ambientState() {
    return {
      preset: !!(state.world && state.world.floors[state.world.active]?.ambient),
      sun: [+sun.color.r.toFixed(3), +sun.color.g.toFixed(3), +sun.color.b.toFixed(3)],
      sunPos: [+sun.position.x.toFixed(3), +sun.position.y.toFixed(3), +sun.position.z.toFixed(3)],
      terrain: {
        amb: uAmbCol.value.toArray().map((v) => +v.toFixed(3)),
        sun: uSunCol.value.toArray().map((v) => +v.toFixed(3)),
      },
    };
  },
  fxSystems() {
    const fl = state.world ? activeFloor() : null;
    if (!fl) return [];
    return fl.fx.map((s) => {
      const g = (s.mesh as unknown as { geometry: THREE.InstancedBufferGeometry }).geometry;
      const inst = s.mesh.userData.inst as Instance;
      const tint = ((s.mesh.material as THREE.ShaderMaterial).uniforms.uTint?.value ?? null) as THREE.Color | null;
      // Where the system actually SITS this frame, not where its object stands:
      // a glued instance rides an animated bone, and "did the eye glow follow
      // the head" is a question only this answers.
      const p = new THREE.Vector3().setFromMatrixPosition(s.mesh.matrix);
      return {
        uid: String(s.mesh.userData.uid ?? ''),
        shared: inst?.shared ?? '',
        at: [inst?.x ?? -1, inst?.y ?? -1],
        pos: [p.x, p.y, p.z],
        glue: s.glue ?? '',
        alive: g.instanceCount,
        visible: s.mesh.visible,
        tint: tint ? [tint.r, tint.g, tint.b] : [1, 1, 1],
      };
    });
  },
  async place(o) {
    if (!state.world) throw new Error('no map open');
    const res = await api.addObject({
      type: o.type, shared: o.shared, x: o.x, y: o.y, floor: state.world.active,
    });
    addInstanceToScene(res.instance, res.geom);
    markDirty(true);
    renderExplorer();
  },
  pointLights() {
    const fl = state.world ? activeFloor() : null;
    if (!fl) return { count: 0, litTexels: 0 };
    if (fl.lightsDirty) bakeLightMap(fl); // a test asks right after an edit
    const count = fl.instances.reduce((a, i) => a + (i.lights?.length ?? 0), 0);
    const data = (fl.lightMap.image as unknown as { data: Uint8Array }).data;
    let lit = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i]! | data[i + 1]! | data[i + 2]!) lit++;
    return { count, litTexels: lit };
  },
  pending() { return pendingCommits; },
  opened() { return openedMap; },
  open(path) { return loadMapPath(path); },
  editText(href) { return openTextEdit(href, href); },
  heights() { return state.world ? Array.from(activeFloor().heights) : []; },
  kinds() { return state.world && activeFloor().flags ? Array.from(activeFloor().flags!) : []; },
  size() { return state.world ? activeFloor().V - 1 : 0; },
};
window.view = view;

/**
 * Tiles a square brush of `size` covers, as indices into a vertex-sized plane.
 *
 * Separate from brushVerts because the two address different things: textures
 * and heights are per vertex, so their brush takes the corners and spans one
 * more than the tile count. Passability is per tile, so its brush must take the
 * tiles themselves or a 1x1 stroke lands on 3x3.
 */
/**
 * A tile rectangle, inclusive, clamped to the map.
 *
 * Every brush works from one of these. A square brush is the rectangle around
 * the cursor; the Rect size is the rectangle dragged out between two corners.
 * Keeping "which cells" in one place is what let Rect be added withouteach brush
 * growing its own copy of the geometry.
 */
export interface TileRect { x0: number; y0: number; x1: number; y1: number }

/** The rectangle a square brush of `size` covers, centred on tile (cx, cy). */
function squareRect(cx: number, cy: number, size: number): TileRect {
  const k = Math.floor(Math.max(1, size) / 2);
  return { x0: cx - k, y0: cy - k, x1: cx + k, y1: cy + k };
}

/** Tiles in a rectangle, as indices into a vertex-sized plane. */
function rectTiles(V: number, r: TileRect): number[] {
  const out: number[] = [];
  for (let y = Math.max(0, r.y0); y <= Math.min(V - 2, r.y1); y++) {
    for (let x = Math.max(0, r.x0); x <= Math.min(V - 2, r.x1); x++) out.push(y * V + x);
  }
  return out;
}

/** Corner vertices of every tile in a rectangle — one more along each axis. */
function rectVerts(V: number, r: TileRect): number[] {
  const out: number[] = [];
  for (let y = Math.max(0, r.y0); y <= Math.min(V - 1, r.y1 + 1); y++) {
    for (let x = Math.max(0, r.x0); x <= Math.min(V - 1, r.x1 + 1); x++) out.push(y * V + x);
  }
  return out;
}

function brushTiles(V: number, cx: number, cy: number, size: number): number[] {
  const k = Math.floor(Math.max(1, size) / 2);
  const out: number[] = [];
  for (let y = cy - k; y <= cy + k; y++) {
    if (y < 0 || y >= V - 1) continue;
    for (let x = cx - k; x <= cx + k; x++) {
      if (x < 0 || x >= V - 1) continue;
      out.push(y * V + x);
    }
  }
  return out;
}

/** Vertices of a square brush of `size` tiles centred on tile (cx, cy). */
function brushVerts(V: number, cx: number, cy: number, size: number): number[] {
  const r = Math.floor(Math.max(1, size) / 2);
  const out: number[] = [];
  for (let y = cy - r; y <= cy + r + 1; y++) {
    if (y < 0 || y >= V) continue;
    for (let x = cx - r; x <= cx + r + 1; x++) {
      if (x < 0 || x >= V) continue;
      out.push(y * V + x);
    }
  }
  return out;
}

/** Write the stroke into the GPU masks. Layer i lives in group i/3, channel i%3. */
function paintMaskTexture(fl: Floor3D, layerIdx: number, verts: number[], strength = 255, exclusive = true): void {
  const tex = fl.maskTex, s = fl.splat;
  if (!tex || !s) return;
  const data = tex.image.data;
  if (!data) return; // the texture always carries its data; three's type says maybe
  const n = fl.V * fl.V;
  const at = (i: number, v: number): number => ((i / 3 | 0) * n + v) * 4 + (i % 3);
  for (const v of verts) {
    if (!exclusive) { data[at(layerIdx, v)] = strength; continue; }
    for (let i = 0; i < s.layerCount; i++) data[at(i, v)] = i === layerIdx ? strength : 0;
  }
  tex.needsUpdate = true;
}

// --- river brushes ---------------------------------------------------------
//
// Water, Bog and LavaFlow are not ordinary ground tiles. They are the original
// editor's "river" brushes, and painting one sinks the bed below its banks —
// measured against every shipped map, the painted bed sits below the
// surrounding high ground 90% of the time for LavaFlow, 74% for Bog, 65% for
// Water. Senya's map 12 shows the profile plainly: bank 2.0, one vertex at 1.8,
// bed at 1.6.
//
// They also write the half-tile river plane, which is what actually makes a
// river a river to the game. Painting one as a plain tile produced something
// that looked like a river and was not one.

/** Tiles that behave as river brushes. They live under the Water folder. */
const isRiverTile = (path: string): boolean => /\/_\(AdvMapTile\)\/Water\//.test(path);

const RIVER_DEPTH = 0.4;   // how far the bed drops below the bank
const RIVER_FEATHER = 0.2; // the single rim vertex between bank and bed

/** Height changes accumulated over the stroke, keyed by vertex. */
const riverHeights = new Map<number, number>();

/**
 * Sink the bed under `verts` and feather its rim.
 *
 * Idempotent per vertex: a river is a fixed depth below its banks, not a hole
 * that deepens the longer you hold the mouse down. Dragging back over the same
 * bed must leave it where it is.
 */
function sinkRiver(fl: Floor3D, verts: number[]): void {
  const drop = fl.riverDrop;
  // Sea is not a river. Flag 0 means navigable water and it sits at exactly 0.0
  // in 100% of the 62,788 flagged vertices across 60 shipped maps, so digging it
  // another 0.4 because someone painted the water texture over it would break an
  // invariant the engine relies on. What makes water swimmable is that flag, not
  // its depth: Bog and LavaFlow never carry it, Water only where a basin was dug.
  const isSea = (v: number): boolean => fl.flags ? fl.flags[v] === 0 : false;

  /**
   * Lower `v` until it sits `want` below where the ground started.
   *
   * Expressed as a target depth rather than a step, so applying it twice is a
   * no-op and promoting a rim vertex to bed digs only the remaining 0.2. Never
   * raises: a vertex already deeper belongs to someone else's terrain.
   */
  const sink = (v: number, want: number): void => {
    if (isSea(v)) return;
    const had = drop.get(v) ?? 0;
    if (want <= had) return;
    const target = fl.heights[v]! - (want - had);
    fl.heights[v] = target;
    drop.set(v, want);
    riverHeights.set(v, target);
  };

  for (const v of verts) { sink(v, RIVER_DEPTH); fl.river.add(v); }
  // One ring of rim vertices, dropped half as far, so the bank does not fall
  // away from the bed as a sheer step.
  const bed = new Set(verts);
  for (const v of verts) {
    const x = v % fl.V, y = (v / fl.V) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= fl.V || ny < 0 || ny >= fl.V) continue;
      const n = ny * fl.V + nx;
      if (!bed.has(n)) sink(n, RIVER_FEATHER);
    }
  }
  remeshFloor(fl);
}

/**
 * Commits sent to the main process and not yet acknowledged.
 *
 * A stroke hands its edit over and does not wait — that is what keeps painting
 * responsive. It also means the file can lag behind the screen, and at
 * reconstruction scale (a hundred thousand vertex writes) the backlog outlives
 * a Save: the save runs, then the queue drains and marks the map dirty again.
 * Publishing the count lets a caller wait for quiet; nothing else depends on it.
 */
let pendingCommits = 0;
async function committing<T>(work: Promise<T>): Promise<T> {
  pendingCommits++;
  try { return await work; } finally { pendingCommits--; }
}

/** Weight the tile brush writes, from the toolbar. */
const tileStrength = (): number => Math.max(0, Math.min(255, +$input('tilestrength').value || 0));
/** Blend mode: write this layer only, leaving the others under it alone. */
const tileBlend = (): boolean => ($('tilesolo') as HTMLInputElement).checked;
/** Whether painting water also sinks the bed under it. */
const riverCarve = (): boolean => ($('rivercarve') as HTMLInputElement).checked;

/** Vertices painted into the masks, handed over, and strokes that did nothing. */
let paintedVerts = 0, sentVerts = 0, refusedStrokes = 0;

/** Paint at the cursor, if the brush is armed and the tile is paintable. */
function brushAt(verts: number[]): void {
  const fl = activeFloor();
  const tile = paintTile;
  if (!tile || !fl.splat) { refusedStrokes++; return; }
  // Before upgradeToSplat finishes there is nothing to paint into. Refusing here
  // matters: the stroke would otherwise reach the file but never the screen.
  if (!fl.maskTex) { refusedStrokes++; $('hud').textContent = 'ground textures still loading…'; return; }
  const layerIdx = fl.splat.paths.indexOf(tile.path);
  if (layerIdx < 0) {
    // Picking a tile this map has no layer for adds one in the background, and
    // a stroke that arrives first has nowhere to land. It used to be dropped in
    // silence, which is how a reconstruction lost three whole layers without
    // anything on screen or in the file saying so.
    refusedStrokes++;
    $('hud').textContent = `${tile.name} has no layer in this map yet — one moment`;
    return;
  }
  const fresh = verts.filter((v) => !strokeVerts.has(v));
  if (!fresh.length) { refusedStrokes++; return; }
  for (const v of fresh) strokeVerts.add(v);
  paintedVerts += fresh.length;
  const strength = tileStrength();
  paintMaskTexture(fl, layerIdx, fresh, strength, !tileBlend());
  // Water carves its bed — unless there is no water being painted (strength 0
  // erases) or carving is off because the ground is already at its final shape.
  if (isRiverTile(tile.path) && strength > 0 && riverCarve()) sinkRiver(fl, fresh);
}

/** Hand the finished stroke to the main process in one message. */
async function commitStroke(): Promise<void> {
  const tile = paintTile;
  if (!tile || !strokeVerts.size || !state.world) { strokeVerts.clear(); return; }
  const verts = [...strokeVerts];
  strokeVerts.clear();
  sentVerts += verts.length;
  const heightEdits = [...riverHeights];
  riverHeights.clear();
  try {
    // Water is a river only if it carries the plane and a bed; "carve" says
    // whether this stroke does that physical part or is paint alone. Off, the
    // stroke is an ordinary tile — which is what you want when the plane is
    // already authored and the ground is at its final height.
    if (isRiverTile(tile.path) && riverCarve()) {
      // Mask, river plane and heights travel together: a river missing any one
      // of the three is not a river, and a half-applied stroke would be worse
      // than a rejected one.
      await committing(api.paintRiver({
        floor: state.world.active, tile: tile.path, verts,
        heightVerts: heightEdits.map(([v]) => v),
        heights: heightEdits.map(([, h]) => h),
      }));
    } else {
      await committing(api.paintTile({
        floor: state.world.active, tile: tile.path, verts,
        strength: tileStrength(), exclusive: !tileBlend(),
      }));
    }
    markDirty(true);
  } catch (e) {
    // The GPU already shows the stroke, so a failure here means the two copies
    // disagree. Say so plainly rather than leaving a lie on screen.
    $('hud').textContent = 'paint failed (reload to resync): '
      + (e instanceof Error ? e.message : String(e));
  }
}

// --- height brush ----------------------------------------------------------
//
// Raise and lower, with a linear falloff from the brush centre so a stroke
// leaves a rounded mound rather than a stack of boxes.
//
// Heights and flags move together, because the format ties them. Ground sits at
// the 2.0 default and a bed dug by `lower` is always exactly 0.0 and flagged
// water. So: lower a vertex to 0 and it floods; raise a flooded vertex off 0 and
// it drains back to ordinary ground. Flags matter beyond the water sheet — the
// mesher cuts a cell wherever the ground KIND changes, so getting them wrong
// puts cliffs in the middle of a hillside.
//
// Unlike the tile brush, this sends absolute values rather than an operation.
// The falloff maths only runs here, so the main process cannot compute a
// different answer and drift.

const GROUND_LEVEL = 2.0;   // the format's default ground height
const WATER_LEVEL = 0.0;    // what `lower` digs a bed to, exactly
const STEP = 0.35;          // default height change per brush tick at full strength
const TICK_MS = 70;         // how often a held brush reapplies

/**
 * How much one Bulk/Dig tick moves the ground at the centre of the brush, and
 * how sharply that movement tapers towards the rim.
 *
 * Both were constants, and that made most of a real map unreachable: a fixed
 * 0.35 per tick with a fixed taper puts every height the brush can produce on
 * one lattice, and C1M1's field — 7420 distinct values, 87.7% of them off any
 * step grid — is nowhere near it (docs/E2E_RECONSTRUCTION.md). With a force you
 * can set, a stroke can land on a chosen value exactly; with a tension you can
 * choose between a sharp spike and a flat lift, which is the difference between
 * carving a gully and raising a field.
 */
let brushForce = uiPrefs.brushForce;
/** 1 = taper to a third at the rim (what it always did); 0 = flat stamp. */
let brushTension = uiPrefs.brushTension;
/**
 * Vertex mode: Bulk/Dig moves the single grid corner nearest the cursor.
 *
 * The smallest square brush is still four vertices — a tile's corners — and
 * four vertices moved together cannot express a surface whose corners differ,
 * which every real map's does. It is also the only way to reach the outermost
 * row and column, of which there is one more than there are tiles.
 */
let vertexMode = false;

/**
 * Does this flag record a deliberate ground kind that sculpting must not undo?
 *
 * Plateau tiers and ramps are authored, so a height change leaves them alone.
 * The test used to be `flag & 32`, which is only true for tiers 2 and 3: tier 4
 * (64) has no bit in common with it, so sculpting anywhere on a tier-4 plateau
 * silently reset it to ordinary ground — and C1M1 has 623 such vertices.
 */
const keepsGroundKind = (flag: number): boolean => tierOf(flag) >= 2 || (flag & RAMP_BIT) !== 0;

/** What a left-drag does. Mirrors the mode selector in the brush panel. */
type BrushMode = 'paint' | 'bulk' | 'dig' | 'raise' | 'lower' | 'ramp' | 'level' | 'kind' | 'river' | 'mask' | 'erase';
let brushMode: BrushMode = 'paint';

/** What the armed tool does, said in full — for the hud and the panel. */
const BRUSH_SAYS: Record<BrushMode, string> = {
  paint: 'painting',
  bulk: 'bulk: smooth raise', dig: 'dig: smooth lower',
  raise: 'raise: a plateau 2.0 up, with cut edges',
  lower: 'lower: a pit dug to 0, which floods',
  ramp: 'ramp: half a step up, walkable instead of a wall',
  level: 'plateau: pull everything to the level you start on',
  kind: 'ground kind: paints the tier (and ramp) without moving the ground',
  river: 'river plane: half-tile cells at the chosen strength; carve is optional',
  mask: 'masking: left-drag blocks movement', erase: 'erasing the movement mask',
};

/** The same in two words, for the bar button while the panel is closed. */
const BRUSH_LABEL: Record<BrushMode, string> = {
  paint: 'paint', bulk: 'bulk', dig: 'dig', raise: 'raise', lower: 'lower', ramp: 'ramp',
  level: 'plateau', kind: 'kind', river: 'river', mask: 'mask', erase: 'erase',
};

/**
 * Which settings each mode actually has.
 *
 * All of them used to be in the toolbar at once, so the tier picker sat there
 * while you painted textures and the river strength never went away. A mode
 * whose row list is empty has nothing to set beyond its size — Raise steps a
 * fixed 2.0, and a mask stroke is on or off.
 */
const BRUSH_ROWS: Record<BrushMode, readonly string[]> = {
  // Carve belongs to a water stroke wherever it comes from, and painting a
  // Water tile is one — hence the carve row on the tile brush as well.
  paint: ['bp-weight', 'bp-carve'],
  bulk: ['bp-force', 'bp-tension'], dig: ['bp-force', 'bp-tension'],
  raise: [], lower: [], ramp: [], level: [],
  kind: ['bp-tier'],
  river: ['bp-river', 'bp-carve'],
  mask: [], erase: [],
};
const BRUSH_ROW_IDS = ['bp-force', 'bp-tension', 'bp-tier', 'bp-weight', 'bp-river', 'bp-carve'] as const;

/** Show the rows the current mode uses, and say what it does. */
function syncBrushPanel(): void {
  const rows = BRUSH_ROWS[brushMode];
  for (const id of BRUSH_ROW_IDS) $(id).style.display = rows.includes(id) ? 'flex' : 'none';
  $('bp-note').textContent = BRUSH_SAYS[brushMode];
}
/** Height direction for the sculpt modes; 0 for the rest. */
let sculptDir = 0;
let lastTick = 0;
let lastTile = -1;


// --- the river plane, painted directly --------------------------------------
//
// The plane lives on a (2V-1)² grid — twice the resolution of the vertices — and
// its values are graded. The tile-driven river brush above writes full strength
// at vertex positions, which draws a river fine and cannot reproduce one: of
// C1M1's 2317 wet cells, 1815 sit between vertices and they hold 134 distinct
// values. This mode addresses the plane on its own terms.

/** Cells painted in the current stroke, as indices into the (2V-1)² plane. */
const strokeCells = new Set<number>();

/** Cells per side of the river plane for a V-vertex map. */
const riverSide = (V: number): number => 2 * V - 1;

/** The river cell nearest these client coordinates, or null when off the map. */
function riverCellAtClient(clientX: number, clientY: number): { x: number; y: number } | null {
  const p = groundPointAtClient(clientX, clientY);
  if (!p) return null;
  const W = riverSide(activeFloor().V);
  // Cells sit every half tile, so the grid step is U/2.
  const x = Math.round(p.x / (U / 2)), y = Math.round(p.y / (U / 2));
  if (x < 0 || y < 0 || x >= W || y >= W) return null;
  return { x, y };
}

/** Paint the river plane under the cursor at the chosen strength. */
function riverAt(cells: { x: number; y: number }[]): void {
  const fl = activeFloor();
  const W = riverSide(fl.V);
  const value = Math.max(0, Math.min(255, +$input('riverstrength').value || 0));
  const carve = riverCarve();
  const bed: number[] = [];
  for (const c of cells) {
    const idx = c.y * W + c.x;
    if (strokeCells.has(idx)) continue;
    strokeCells.add(idx);
    // A cell that lands on a vertex is the only one with ground under it to
    // sink; the ones between vertices have no height of their own.
    if (carve && value > 0 && c.x % 2 === 0 && c.y % 2 === 0) bed.push((c.y / 2) * fl.V + (c.x / 2));
  }
  if (bed.length) {
    sinkRiver(fl, bed);
    for (const v of bed) strokeVerts.add(v);
  }
}

/** Send the finished river stroke. */
async function commitRiver(): Promise<void> {
  const fl = activeFloor();
  if (!strokeCells.size || !state.world) { strokeCells.clear(); strokeVerts.clear(); return; }
  const cells = [...strokeCells];
  strokeCells.clear();
  const value = Math.max(0, Math.min(255, +$input('riverstrength').value || 0));
  try {
    await committing(api.setRiverCells({ floor: state.world.active, cells, value }));
    // Carving moved ground, and those heights travel by the sculpt path.
    if (strokeVerts.size) await commitSculpt(); else strokeVerts.clear();
    markDirty(true);
  } catch (e) {
    strokeVerts.clear();
    $('hud').textContent = 'river failed (reload to resync): '
      + (e instanceof Error ? e.message : String(e));
  }
  void fl;
}

/**
 * The ground kind the Tier brush paints: `16 × tier`, plus 8 for a ramp.
 * Read from the toolbar at the moment of the stroke.
 */
function selectedKind(): number {
  const tier = +$select('kindtier').value;
  return tier * TIER_STEP + (($('kindramp') as HTMLInputElement).checked ? RAMP_BIT : 0);
}

/**
 * Paint the ground kind, leaving the height exactly where it is.
 *
 * Every other tool changes a tier by MOVING the ground: Raise adds a step and
 * takes the tier with it, Lower digs to 0 and calls it water. That is right for
 * sculpting and useless once the surface is already at its final height — which
 * is exactly the state a reconstruction is in when it comes to set the tiers
 * (docs/E2E_RECONSTRUCTION.md), and the state you are in whenever a hill is
 * shaped the way you want but reads as the wrong kind of ground.
 *
 * @returns the vertices it changed, or null if they already held that kind.
 */
function kindAt(verts: number[], vertexOnly = false): number[] | null {
  const fl = activeFloor();
  if (!fl.flags) return null;
  const kind = selectedKind();
  const moved: number[] = [];
  for (const v of verts) {
    if (!vertexOnly && strokeVerts.has(v)) continue;
    if (fl.flags[v] === kind) continue;
    fl.flags[v] = kind;
    moved.push(v);
  }
  if (!moved.length) return null;
  // The mesher reads flags: tier boundaries become cut walls, ramps are smoothed
  // and flag 0 is where the sea sheet goes, so the view is stale until it runs.
  remeshFloor(fl);
  return moved;
}

/**
 * Move one vertex by the brush force. Nothing tapers, nothing else moves.
 * @returns the vertex it moved, or null if the force changed nothing.
 */
function sculptVertex(fl: Floor3D, x: number, y: number): number[] | null {
  const i = y * fl.V + x;
  const next = Math.max(WATER_LEVEL, fl.heights[i]! + sculptDir * brushForce);
  if (next === fl.heights[i]) return null;
  fl.heights[i] = next;
  if (fl.flags) {
    const f = fl.flags[i]!;
    if (!keepsGroundKind(f)) fl.flags[i] = next <= WATER_LEVEL ? 0 : 16;
  }
  return [i];
}

/**
 * Apply one tick of the height brush at tile (cx, cy).
 * @returns the vertices it moved, or null if nothing changed.
 */
function sculptAt(fl: Floor3D, cx: number, cy: number): number[] | null {
  // Footprint: the same vertex box the tile brush paints, so both brushes cover
  // what the cursor visibly highlights. A size-N brush spans tiles cx-k..cx+k,
  // whose corners are vertices cx-k..cx+k+1.
  //
  // Distance is Chebyshev (square), not Euclidean. A radial test fails outright
  // at size 1: the tile centre is 0.707 from each of its four corners, so a
  // radius of 0.5 excludes every vertex and the brush silently does nothing.
  const k = Math.floor(Math.max(1, brushSize) / 2);
  const rad = k + 0.5;              // half-width in tiles, centre to outer vertices
  const ox = cx + 0.5, oy = cy + 0.5;
  const touched: number[] = [];
  for (let y = cy - k; y <= cy + k + 1; y++) for (let x = cx - k; x <= cx + k + 1; x++) {
    if (x < 0 || x >= fl.V || y < 0 || y >= fl.V) continue;
    const d = Math.max(Math.abs(x - ox), Math.abs(y - oy));
    if (d > rad) continue;
    // The innermost ring sits at 0.5, so subtracting it puts full strength
    // there and tapers towards the rim. Size 1 is a flat 2x2 stamp. Tension
    // scales how much of that taper applies: at 0 the whole footprint moves
    // together, at 1 the rim gets a third of the centre, as it always did.
    const falloff = k === 0 ? 1 : 1 - brushTension * ((d - 0.5) / rad);
    const i = y * fl.V + x;
    const next = Math.max(WATER_LEVEL, fl.heights[i]! + sculptDir * brushForce * falloff);
    if (next === fl.heights[i]) continue;
    fl.heights[i] = next;
    if (fl.flags) {
      // A vertex at exactly 0 is a dug bed, which is what water is. Anything
      // above it is ordinary ground. Plateau (32) and ramp (8) bits are
      // deliberate authoring, so leave those vertices' kind alone.
      const f = fl.flags[i]!;
      if (!keepsGroundKind(f)) fl.flags[i] = next <= WATER_LEVEL ? 0 : 16;
    }
    touched.push(i);
  }
  return touched.length ? touched : null;
}

/**
 * The step a plateau stands above the ground it sits on.
 *
 * Measured across every shipped map: of 23,539 plateau edges, 45% are exactly
 * 2.00 and both the median and the lower quartile are 2.00 — which is also the
 * format's default ground level. Nothing else comes close.
 */
const PLATEAU_STEP = 2.0;

/**
 * How far from the stroke's starting level a vertex may sit and still count as
 * the same tier.
 *
 * Half the step: tiers are 2.0 apart, so anything within 1.0 is the level you
 * started on and anything beyond is a different one. It cannot be an exact
 * match — only 25.6% of plateau vertices sit level with their neighbours, since
 * a plateau keeps the relief of the ground it was raised from.
 */
const PLATEAU_TOL = PLATEAU_STEP / 2;

/** The level a height stroke started on; NaN between strokes. */
let plateauBase = NaN;
/** The tier flag that goes with it, for the levelling tool. */
let plateauBaseFlag = 16;
/** True while the size selector is on Rect: drag out a rectangle, apply on release. */
let rectMode = false;
/** Where a Rect drag started. */
let rectAnchor: { x: number; y: number } | null = null;

/**
 * Raise a plateau, or dig a pit — the original editor's Raise and Lower, as
 * opposed to the smooth Bulk and Dig.
 *
 * Raise ADDS the step rather than levelling to it: only 25.6% of plateau
 * vertices have all their plateau neighbours at the same height, so a plateau
 * is not a flat table. It carries the relief of the ground it was raised from,
 * which is why its cut edge flows with the terrain instead of sitting level.
 *
 * Marking the kind is the whole point. A cut is a change of ground KIND, not of
 * steepness, so without flag 32 the mesher would blend the new step into a
 * smooth ramp however tall it is. Lower digs to exactly 0.0 and flags water,
 * which is what makes the pit flood.
 */
function plateauAt(verts: number[], up: boolean, start: number): void {
  const fl = activeFloor();
  // The first tick of a stroke fixes the tier being worked on. Dragging off it
  // onto a step above or below must leave that ground alone: otherwise tracing
  // along the rim of a tier quietly raises the one beneath it too, and one pass
  // leaves a staircase of mixed heights. Lower is bound the same way — a pit
  // traced along a plateau's edge should not swallow the plateau.
  if (!strokeVerts.size) plateauBase = fl.heights[start]!;
  let touched = false;
  for (const v of verts) {
    if (strokeVerts.has(v)) continue;
    if (Math.abs(fl.heights[v]! - plateauBase) > PLATEAU_TOL) continue;
    strokeVerts.add(v);
    fl.heights[v] = up ? fl.heights[v]! + PLATEAU_STEP : 0;
    if (fl.flags) {
      // Step to the NEXT tier, keeping the count rather than pinning everything
      // to 32: tier 3 stacked on tier 2 must be a different kind or the mesher
      // blends the wall between them into a slope. The ramp bit is dropped —
      // this makes a wall, not an incline.
      fl.flags[v] = up ? Math.min(240, (fl.flags[v]! & 0xf0) + 16) : 0;
    }
    touched = true;
  }
  if (touched) remeshFloor(fl);
}

/**
 * Cut a walkable ramp into a tier boundary.
 *
 * A ramp is not a gentle slope the tool draws freehand: the format has exactly
 * one intermediate value, bit 3, and a ramp vertex sits precisely half a tier
 * up. Measured across every shipped map, 16->24 and 24->32 each step 1.00 —
 * half of the 2.00 between tiers. So this raises the vertices it touches by half
 * a step and flags them, turning one wall into two half-height steps that the
 * mesher smooths, because it smooths any cell holding a ramp vertex.
 *
 * Bound to its starting level like Raise and Lower: a ramp traced along a rim
 * must not chew into the tier above or below it.
 */
function rampAt(verts: number[], start: number): void {
  const fl = activeFloor();
  const flags = fl.flags;
  if (!flags) return;
  if (!strokeVerts.size) plateauBase = fl.heights[start]!;

  /** A ramp only exists where a cut does — and it is cut INTO the low side. */
  const onLowSideOfCut = (v: number): boolean => {
    const x = v % fl.V, y = (v / fl.V) | 0;
    const me = flags[v]! >> 4;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= fl.V || ny < 0 || ny >= fl.V) continue;
      if ((flags[ny * fl.V + nx]! >> 4) > me) return true;
    }
    return false;
  };

  let touched = false, blocked = false;
  for (const v of verts) {
    if (strokeVerts.has(v)) continue;
    if (Math.abs(fl.heights[v]! - plateauBase) > PLATEAU_TOL) continue;
    // Already a ramp: leave it. It still sits on the low tier and still borders
    // the high one, so without this a second pass raises it another half step
    // and a few clicks push it clean through the tier it was meant to reach.
    if (flags[v]! & 8) continue;
    // Nowhere but a cut. Every one of the 3,718 ramp vertices across the shipped
    // maps has a neighbour on a different tier — 100.0%, not merely most — so a
    // ramp in open ground is not a thing the format expresses. Refusing beats
    // leaving half a step stranded in a field.
    if (!onLowSideOfCut(v)) { blocked = true; continue; }
    strokeVerts.add(v);
    fl.heights[v] = fl.heights[v]! + PLATEAU_STEP / 2;
    flags[v] = (flags[v]! & 0xf0) | 8;
    touched = true;
  }
  if (touched) remeshFloor(fl);
  // Say so rather than appearing broken: the brush is armed and nothing happens.
  else if (blocked) $('hud').textContent = 'ramps go at the foot of a cut — aim at the low side of a step';
}

/** Sculpt at the cursor, rate-limited so holding still is controllable. */
function sculptTick(ev: PointerEvent): void {
  const fl = activeFloor();
  const at = vertexMode ? vertexAtClient(ev.clientX, ev.clientY) : tileUnderCursor(ev);
  if (!at) return;
  const tile = at.y * fl.V + at.x;
  const now = performance.now();
  // Reapply when the cursor moves to a new tile, or on a timer while held —
  // otherwise a stroke that pauses would silently stop sculpting.
  if (tile === lastTile && now - lastTick < TICK_MS) return;
  lastTile = tile; lastTick = now;
  const idx = at.y * fl.V + at.x;
  if (brushMode === 'paint') { brushAt([idx]); return; }
  const moved = brushMode === 'kind'
    ? kindAt([idx], true)
    : vertexMode ? sculptVertex(fl, at.x, at.y) : sculptAt(fl, at.x, at.y);
  if (!moved) return;
  for (const v of moved) strokeVerts.add(v);
  remeshFloor(fl);
}

/** Hand the finished sculpt to the main process as absolute values. */
async function commitSculpt(): Promise<void> {
  const fl = activeFloor();
  if (!strokeVerts.size || !state.world) { strokeVerts.clear(); return; }
  const verts = [...strokeVerts];
  strokeVerts.clear();
  try {
    await committing(api.sculpt({
      floor: state.world.active,
      verts,
      heights: verts.map((v) => fl.heights[v]!),
      flags: fl.flags ? verts.map((v) => fl.flags![v]!) : null,
    }));
    markDirty(true);
  } catch (e) {
    $('hud').textContent = 'sculpt failed (reload to resync): '
      + (e instanceof Error ? e.message : String(e));
  }
}

/**
 * Level everything under the brush to the tier the stroke started on.
 *
 * The plateau tool: drag on an upper tier and the ground around is pulled up to
 * it, drag on a lower one and what stands above is cut down. Unlike Raise it
 * sets an absolute height and tier rather than adding a step, which is the whole
 * point — it is how you get a flat table at a chosen level out of uneven ground.
 */
function levelAt(verts: number[], start: number): void {
  const fl = activeFloor();
  if (!strokeVerts.size) {
    plateauBase = fl.heights[start]!;
    plateauBaseFlag = fl.flags ? fl.flags[start]! : 16;
  }
  let touched = false;
  for (const v of verts) {
    if (strokeVerts.has(v)) continue;
    strokeVerts.add(v);
    if (fl.heights[v] === plateauBase && (!fl.flags || fl.flags[v] === plateauBaseFlag)) continue;
    fl.heights[v] = plateauBase;
    // The tier travels with the height. Levelling the ground without it leaves
    // a tier boundary with no step across it, which the mesher then cuts into a
    // wall of zero height — a seam through the middle of a flat plateau.
    if (fl.flags) fl.flags[v] = plateauBaseFlag;
    touched = true;
  }
  if (touched) remeshFloor(fl);
}

/**
 * The tiles a stroke acts on right now.
 *
 * Rect defers: while the button is down it only previews, and the whole
 * rectangle is applied once on release. Every other size acts under the cursor
 * as you move.
 */
function currentRect(ev: PointerEvent): TileRect | null {
  const at = tileUnderCursor(ev);
  if (!at) return null;
  if (!rectMode) return squareRect(at.x, at.y, brushSize);
  if (!rectAnchor) return squareRect(at.x, at.y, 1);
  return {
    x0: Math.min(rectAnchor.x, at.x), y0: Math.min(rectAnchor.y, at.y),
    x1: Math.max(rectAnchor.x, at.x), y1: Math.max(rectAnchor.y, at.y),
  };
}

/** One tick of whichever brush is armed, over `r`. */
function applyRect(r: TileRect): void {
  const fl = activeFloor();
  const verts = rectVerts(fl.V, r);
  const start = Math.max(0, Math.min(fl.V * fl.V - 1, r.y0 * fl.V + r.x0));
  switch (brushMode) {
    case 'paint': brushAt(verts); break;
    case 'bulk': case 'dig': sculptRect(verts); break;
    case 'raise': plateauAt(verts, true, start); break;
    case 'lower': plateauAt(verts, false, start); break;
    case 'ramp': rampAt(verts, start); break;
    case 'level': levelAt(verts, start); break;
    case 'kind': { const moved = kindAt(verts); if (moved) for (const v of moved) strokeVerts.add(v); break; }
    case 'mask': maskAt(rectTiles(fl.V, r), false); break;
    case 'erase': maskAt(rectTiles(fl.V, r), true); break;
  }
}

/**
 * Bulk and Dig over a rectangle: one step at full strength, no falloff.
 *
 * The radial falloff exists to round a mound made by dragging. A rectangle is
 * an explicit shape, so tapering its edges would fight what was asked for.
 */
function sculptRect(verts: number[]): void {
  const fl = activeFloor();
  let touched = false;
  for (const v of verts) {
    if (strokeVerts.has(v)) continue;
    strokeVerts.add(v);
    const next = Math.max(WATER_LEVEL, fl.heights[v]! + sculptDir * brushForce);
    if (next === fl.heights[v]) continue;
    fl.heights[v] = next;
    if (fl.flags) {
      const f = fl.flags[v]!;
      if (!keepsGroundKind(f)) fl.flags[v] = next <= WATER_LEVEL ? 0 : 16;
    }
    touched = true;
  }
  if (touched) remeshFloor(fl);
}

/** One tick of whichever brush is armed. */
function applyBrush(ev: PointerEvent): void {
  // Rect only previews while dragging; the work happens on release.
  if (rectMode) { updateBrushCursor(tileUnderCursor(ev)); return; }
  // Bulk and Dig keep their own rate limiting and radial falloff; the kind
  // brush borrows that path when it is painting one vertex at a time.
  if (brushMode === 'bulk' || brushMode === 'dig'
      || (vertexMode && (brushMode === 'kind' || brushMode === 'paint'))) { sculptTick(ev); return; }
  if (brushMode === 'river') {
    const c = riverCellAtClient(ev.clientX, ev.clientY);
    if (c) riverAt([c]);
    return;
  }
  const r = currentRect(ev);
  if (r) applyRect(r);
}

/** Hand the finished stroke to the main process. */
async function commitBrush(): Promise<void> {
  switch (brushMode) {
    case 'paint': await commitStroke(); break;
    case 'bulk': case 'dig': case 'raise': case 'lower': case 'ramp': case 'level': case 'kind':
      await commitSculpt(); break;
    case 'river': await commitRiver(); break;
    case 'mask': await commitMask(false); break;
    case 'erase': await commitMask(true); break;
  }
}

function setBrush(on: boolean): void {
  brushOn = on;
  // The two are mutually exclusive, both being left-click on the terrain.
  // armObject() disarms the brush; this is the same rule the other way round,
  // and it must not call back into armObject or the two would bounce.
  if (on && placeObject) {
    placeObject = null;
    $('obj-sel').textContent = 'no object selected';
    renderObjGrid();
  }
  // The region tool is a third claimant on the same left-drag; arming the brush
  // puts it down. setRegionDraw does not call back here, so this cannot bounce.
  if (on && regionDraw) setRegionDraw(false);
  const b = $button('brushbtn');
  b.classList.toggle('on', on);
  // The label says the state rather than the action: with the mode selector
  // beside it, "Brush" alone gave no way to tell armed from not.
  b.textContent = on ? 'on' : 'off';
  // The panel can be closed while the brush is live, so the bar button carries
  // the armed state — otherwise a left-drag edits the terrain with nothing on
  // screen saying why. Open/closed needs no light of its own: a 268px strip
  // either occupies the right edge or it does not.
  $('palbtn').classList.toggle('on', on);
  $('palbtn').textContent = on ? `Terrain: ${BRUSH_LABEL[brushMode]}` : 'Terrain';
  // The arrow is hidden, not restyled: the footprint gizmo IS the cursor, and
  // an arrow on top of it only obscures the tile under the tip.
  renderer.domElement.style.cursor = on ? 'none' : '';
  if (!on) updateBrushCursor(null);
  if (!on && painting) { painting = false; controls.enabled = true; }
}

// --- toolbar ---
const FLOOR_LABEL: Record<string, string> = { surface: 'Surface', underground: 'Underground' };
// Floor button: shown only for two-floor maps; label names the OTHER floor it
// switches to, and clicking cycles.
function updateFloorUI(): void {
  const btn = $('floor');
  if (!state.world || state.world.floors.length < 2) { btn.style.display = 'none'; return; }
  btn.style.display = '';
  const next = state.world.floors[(state.world.active + 1) % state.world.floors.length];
  const cur = state.world.floors[state.world.active];
  btn.textContent = `${FLOOR_LABEL[cur.name] || cur.name} → ${FLOOR_LABEL[next.name] || next.name}`;
}
$('floor').onclick = () => { if (state.world) setActiveFloor((state.world.active + 1) % state.world.floors.length); };

// Explorer show/hide + search wiring.
let explorerOpen = uiPrefs.explorerOpen;
function setExplorer(open: boolean): void {
  explorerOpen = open;
  $('explorer').style.display = open ? 'flex' : 'none';
  $('hud').style.left = open ? '296px' : '12px';
  $('objects').classList.toggle('on', open);
  saveUiPrefs({ explorerOpen: open });
}
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

// Hide/show all placed objects — terrain work needs an unobstructed ground view.
function setShowObjects(on: boolean): void {
  state.showObjects = on;
  if (state.world) for (const fl of state.world.floors) fl.objGroup.visible = on;
  if (!on) deselect();
  $('showobj').classList.toggle('on', on);
  $('showobj').textContent = on ? 'Objects: on' : 'Objects: off';
  saveUiPrefs({ showObjects: on });
}
$('showobj').onclick = () => setShowObjects(!state.showObjects);
$('viewbtn').onclick = () => setTopView(!cam.top);

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

function updateIdleButton(): void {
  $('idlebtn').textContent = `Idle stance: ${idleMode()}`;
  $('idlebtn').classList.toggle('on', idleMode() !== 'off');
}

/** Fetch and graft the animation payloads a built-without-bones scene lacks. */
async function loadIdleSkins(): Promise<void> {
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

// --- effects & light toggles ------------------------------------------------
//
// Both are view choices, not scene choices — unlike the idle button's `off`,
// nothing is built differently, so flipping them costs nothing and they can
// sit in uiPrefs like the other view toggles. Effects off just stops drawing
// and advancing the systems (they keep arriving and keep following their
// objects); Light `flat` swaps the floor's preset for the neutral built-in
// look AND zeroes the point-light pools, because the reason to want it is
// "let me actually see this dark underground while I edit".

function setShowFx(on: boolean): void {
  state.showFx = on;
  if (state.world) for (const fl of state.world.floors) for (const s of fl.fx) s.mesh.visible = on;
  $('fxbtn').textContent = on ? 'Effects: on' : 'Effects: off';
  $('fxbtn').classList.toggle('on', on);
  saveUiPrefs({ showFx: on });
}
$('fxbtn').onclick = () => setShowFx(!state.showFx);
setShowFx(state.showFx); // reflect the persisted choice in the label

function setMapLight(on: boolean): void {
  state.mapLight = on;
  refreshLighting();
  $('lightbtn').textContent = on ? 'Light: map' : 'Light: flat';
  $('lightbtn').classList.toggle('on', on);
  saveUiPrefs({ mapLight: on });
}
$('lightbtn').onclick = () => setMapLight(!state.mapLight);
setMapLight(state.mapLight);

// --- object palette (the original editor's Objects tab) --------------------
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

let catalog: PlaceableObject[] = [];
let catGroups: { name: string; separator: boolean }[] = [];
let objPalOpen = false;
let objCat = ALL;
let objSearch = '';
let showHiddenObjects = uiPrefs.showHidden;
/** The catalogue entry armed for placing, or null. Stays set across placements. */
let placeObject: PlaceableObject | null = null;
/** Icons already fetched, so scrolling back does not refetch. */
const iconCache = new Map<string, string | null>();

/** How many tiles to render before the "show more" row. */
const OBJ_PAGE = 120;
let objShown = OBJ_PAGE;

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
function initObjectPalette(): Promise<void> {
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

function renderObjGrid(): void {
  const grid = $('obj-grid');
  grid.innerHTML = '';
  const list = catalog.filter(objMatches);
  for (const o of list.slice(0, objShown)) {
    const el = document.createElement('div');
    el.className = 'obj' + (placeObject?.path === o.path ? ' on' : '');
    // The original's tooltip is the object's own description. The file name is
    // kept beside it because that is what the map and the assets are keyed on,
    // and it is the only handle when something needs looking up on disk.
    el.title = [o.label, o.description, `${o.name} · ${o.type || 'unknown type'} · ${o.group}`]
      .filter(Boolean).join('\n\n');
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
    el.onclick = () => armObject(placeObject?.path === o.path ? null : o);
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

function setObjPalette(open: boolean): void {
  objPalOpen = open;
  // Closing the panel puts the armed object down. The palette is the only place
  // that shows what is armed, so leaving it live behind a closed panel means a
  // click on the map plants something you can no longer see the name of.
  if (!open && placeObject) armObject(null);
  $('objpal').style.display = open ? 'flex' : 'none';
  $('objpalbtn').classList.toggle('on', open);
  // Only one right-hand panel at a time; they occupy the same strip.
  if (open && paletteOpen) setPalette(false);
  if (open && regionsOpen) setRegionsPanel(false);
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
function armObject(o: PlaceableObject | null): void {
  placeObject = o;
  if (o) {
    if (brushOn) setBrush(false);
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
async function placeAt(tile: { x: number; y: number }): Promise<void> {
  const o = placeObject;
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
function addInstanceToScene(inst: Instance, geom: { index: number; data: GeomData } | null): void {
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
  fl.meshes.set(inst.id, mesh);
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
let allTiles: TileInfo[] = [];
let tilesInMap = new Set();
let palCat: string | null = null;
let paintTile: TileInfo | null = null;
let paletteOpen = false;

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
    tilesInMap = new Set(r.inMap);
    markDirty(true);
    renderPalette();
    $('hud').textContent = `${t.name} added — paint away`;
  } catch (e) {
    $('hud').textContent = 'could not add the tile: ' + (e instanceof Error ? e.message : String(e));
  }
}

function renderPalette(): void {
  const grid = $('pal-grid');
  grid.innerHTML = '';
  const shown = allTiles.filter((t) => t.category === palCat);
  if (!shown.length) { grid.innerHTML = '<div style="color:#6e7681;font-size:11px">empty</div>'; return; }
  for (const t of shown) {
    const used = tilesInMap.has(t.path);
    const el = document.createElement('div');
    el.className = 'tile' + (paintTile?.path === t.path ? ' on' : '');
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
      paintTile = t;
      // Tiles with no layer in this map cannot be painted yet — adding one means
      // inserting an array into the .bin. Say so at selection time rather than
      // letting the brush no-op silently.
      $('pal-sel').textContent = `${t.name} · priority ${t.priority}`;
      // Choosing a tile is the intent to paint with it: switch to paint mode
      // and arm, so the click leads somewhere instead of highlighting a swatch.
      brushMode = 'paint'; sculptDir = 0;
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
$select('pal-cat').addEventListener('change', (e) => {
  palCat = (e.currentTarget as HTMLSelectElement).value;
  renderPalette();
});

async function initPalette() {
  if (allTiles.length) return;
  try {
    const { tiles, inMap } = await api.listTiles();
    allTiles = tiles;
    tilesInMap = new Set(inMap);
    renderPalCats();
    renderPalette();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    $('pal-grid').innerHTML = `<div style="color:#f85149;font-size:11px">${msg}</div>`;
  }
}

function setPalette(open: boolean): void {
  paletteOpen = open;
  // The two palettes occupy the same strip, so opening this one closes the
  // object panel — which also puts down whatever it had armed.
  if (open && objPalOpen) setObjPalette(false);
  if (open && regionsOpen) setRegionsPanel(false);
  $('palette').style.display = open ? 'flex' : 'none';
  $('help').style.right = open ? '280px' : '12px';
  $('panel').style.right = open ? '280px' : '12px'; // keep the object panel clear of it
  // The panel holds the terrain tools now, so whether it is open is worth
  // remembering across sessions — a session spent shaping ground wants it open.
  saveUiPrefs({ terrainPanel: open });
  if (open) initPalette();
}
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
// --- regions ---------------------------------------------------------------
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

let regionList: RegionInfo[] = [];
let regionsOpen = false;
/** True while the region tool is armed: a left-drag draws a rectangle. */
let regionDraw = false;
/** Where the current region drag started. */
let regionAnchor: { x: number; y: number } | null = null;
let regionOverlay: THREE.LineSegments | null = null;

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
async function loadRegions(): Promise<void> {
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
async function addRegion(r: TileRect): Promise<void> {
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

function renderRegionList(): void {
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
function drawRegionOverlay(): void {
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

function setRegionsPanel(open: boolean): void {
  regionsOpen = open;
  // One right-hand panel at a time; they share the strip.
  if (open && paletteOpen) setPalette(false);
  if (open && objPalOpen) setObjPalette(false);
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

function setRegionDraw(on: boolean): void {
  regionDraw = on && regionsOpen;
  if (regionDraw) {
    if (brushOn) setBrush(false);
    if (placeObject) armObject(null);
    $('hud').textContent = 'drag out a rectangle on the map — it becomes a region';
    renderer.domElement.style.cursor = 'none';
  } else {
    regionAnchor = null;
    renderer.domElement.style.cursor = '';
    updateBrushCursor(null);
  }
  $('rg-draw').classList.toggle('on', regionDraw);
  $('rg-draw').textContent = regionDraw ? 'draw: on' : 'draw: off';
}

$('regionbtn').onclick = () => setRegionsPanel(!regionsOpen);
$('rg-close').onclick = () => setRegionsPanel(false);
$('rg-draw').onclick = () => setRegionDraw(!regionDraw);

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

// Right-click gives the armed object up — the hand is already on the mouse, so
// this is the exit that costs nothing.
//
// A right DRAG still moves the camera, so this waits for pointerup and only
// acts if the button did not travel. Registered separately from the left-button
// handler, which returns early on any button but 0.
let rdown: { sx: number; sy: number } | null = null;
renderer.domElement.addEventListener('pointerdown', (ev) => {
  if (ev.button === 2 && placeObject) rdown = { sx: ev.clientX, sy: ev.clientY };
});
addEventListener('pointerup', (ev) => {
  if (ev.button !== 2 || !rdown) return;
  const moved = Math.abs(ev.clientX - rdown.sx) >= CLICK_SLOP || Math.abs(ev.clientY - rdown.sy) >= CLICK_SLOP;
  rdown = null;
  if (moved || !placeObject) return; // that was a camera move
  armObject(null);
  $('hud').textContent = 'stopped placing';
});

// Esc gives the armed object up. Without it the only way out is finding the
// same tile in the palette again, which is a poor exit from a sticky mode.
addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && placeObject && !isTyping(e.target)) {
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
});

$('brushbtn').onclick = () => {
  // Arming the tile brush without a tile chosen would silently do nothing, so
  // open the palette instead and let the user pick one. Sculpting needs no tile.
  if (!brushOn && brushMode === 'paint' && !paintTile) {
    setPalette(true);
    $('hud').textContent = 'pick a ground tile to paint with';
    return;
  }
  setBrush(!brushOn);
};
$select('brushsizesel').addEventListener('change', (e) => {
  const v = (e.currentTarget as HTMLSelectElement).value;
  rectMode = v === 'rect';
  vertexMode = v === 'vertex';
  if (!rectMode && !vertexMode) brushSize = +v;
  if (rectMode) $('hud').textContent = 'rect: drag out a rectangle, it applies on release';
  if (vertexMode) $('hud').textContent = 'vertex: Bulk/Dig moves the single corner nearest the cursor';
});
$input('brushforce').addEventListener('input', (e) => {
  const v = +(e.currentTarget as HTMLInputElement).value;
  // A force of zero is a brush that does nothing; ignore rather than arm it.
  if (!Number.isFinite(v) || v <= 0) return;
  brushForce = v;
  saveUiPrefs({ brushForce });
});
$input('brushtension').addEventListener('input', (e) => {
  brushTension = +(e.currentTarget as HTMLInputElement).value;
  $('brushtensionval').textContent = brushTension.toFixed(2);
  saveUiPrefs({ brushTension });
});
$select('brushmode').addEventListener('change', (e) => {
  brushMode = (e.currentTarget as HTMLSelectElement).value as BrushMode;
  sculptDir = brushMode === 'bulk' ? 1 : brushMode === 'dig' ? -1 : 0;
  syncBrushPanel();
  // Picking a mode is the intent to use it, so arm right away. Only paint needs
  // something else chosen first, so that is the one case that redirects.
  if (brushMode === 'paint' && !paintTile) {
    setBrush(false); setPalette(true);
    $('hud').textContent = 'pick a ground tile to paint with';
    return;
  }
  setBrush(true);
  $('hud').textContent = BRUSH_SAYS[brushMode];
});
$('blockbtn').onclick = () => setShowBlocked(!showBlocked);

// Cliff shading on/off, so the rock blend can be compared against the raw
// stretched-ground look it replaces.
function setCliffs(on: boolean): void {
  setCliffAmount(on);
  $('cliffbtn').classList.toggle('on', on);
  saveUiPrefs({ cliffs: on });
}
$('cliffbtn').onclick = () => setCliffs(!cliffsOn());

// Sea level. The bed is dug to 0 and ordinary ground sits at 2.0, but the fill
// level isn't recorded anywhere, so it's tuned by eye. The sheet is flat, so
// moving the mesh is enough — no rebuild.
$input('sealevel').addEventListener('input', (e) => {
  const v = +(e.currentTarget as HTMLInputElement).value;
  $('sealevelval').textContent = v.toFixed(2);
  if (state.world) for (const fl of state.world.floors) if (fl.waterMesh) fl.waterMesh.position.z = v - sea.base;
});

// Ground texture tiling density. The format doesn't record it, so it's tuned by
// eye against the game's own look and applied live to every splat material.
$input('texscale').addEventListener('input', (e) => {
  const v = +(e.currentTarget as HTMLInputElement).value;
  setGroundScale(v);
  $('texscaleval').textContent = v.toFixed(2);
  saveUiPrefs({ texScale: v });
});
$input('ex-search').addEventListener('input', renderExList);

/**
 * What is open, as paths, for anything that has to know where the map went —
 * see `ViewApi.opened`. Written here, where a map actually becomes the open one.
 */
let openedMap: OpenedMap | null = null;

async function loadMapPath(path: string | null, archive: string | null = null): Promise<void> {
  if (!path) return;
  openedMap = { mapPath: path, mapDir: path.replace(/[\\/][^\\/]*$/, ''), archive };
  // Whatever the banner was offering is about to be on screen for real.
  hideExternalChange();
  const say = (m: string): Promise<void> => {
    $('loadmsg').textContent = m;
    // Two frames: one to run the style change, one to paint it — a single rAF
    // fires before paint, so the message would not show before the blocking
    // work that follows it.
    return new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  };
  $('loading').classList.add('on');
  await say('decoding map…');
  try {
    // The heavy lifting is in the main process (mesh/texture decode), so the
    // renderer's own thread is free to keep the spinner turning while it runs.
    const tReq = performance.now();
    const { scene: S, info, history, idleAnimation } = await api.loadMap(path);
    const tLoad = performance.now();
    // The scene says which mode it was BUILT for, and that is what the view
    // follows: a map built without bones cannot be animated by asking nicely.
    setIdleMode(idleAnimation);
    updateIdleButton();
    // buildWorld DOES block this thread, so let the new message paint first —
    // the GPU-composited spinner keeps moving through the freeze regardless.
    await say('building scene…');
    buildWorld(S);
    // [perf] The two halves of opening a map: the main-process decode (IPC) and
    // the renderer-blocking scene build. Grep "[perf]" while chasing a stall.
    console.log(`[perf] loadMap ${(tLoad - tReq) | 0}ms · buildWorld ${(performance.now() - tLoad) | 0}ms · ${S.geoms.length} geoms`);
    // A history kept from a previous run is adopted when the files still hash
    // the same, so opening a map is not always a blank slate.
    updateHistoryUI(history.canUndo, history.canRedo, history.undoLabel, history.redoLabel);
    $('empty').style.display = 'none';
    $('title').textContent = `homm5-editor — ${info.name} (${info.tileX}×${info.tileY})`;
    // One switch for the whole bar: the map tools come out, the launcher's
    // editors go away. What used to be a dozen `style.display` lines here — and
    // the same dozen again, inverted, on the way out — is a class the stylesheet
    // reads.
    setMapOpen(true);
    $button('pack').disabled = false;
    // Reflect the persisted ground-scale on the slider itself, or its thumb would
    // sit at the HTML default while the terrain uses the restored value.
    $input('texscale').value = String(uiPrefs.texScale);
    $('texscaleval').textContent = uiPrefs.texScale.toFixed(2);
    // Sea controls only matter on maps that actually have water-flagged ground.
    const hasSea = S.floors.some((f) => f.water && f.water.cells.length);
    $('seawrap').style.display = hasSea ? 'flex' : 'none';
    sea.base = S.floors.find((f) => f.water)?.water?.level ?? 1.5;
    // The map changed, so the names a script completes from did too.
    forgetScriptContext();
    void refreshScriptContext();
    // …and its localization state (which languages this map is authored in).
    loc.active = '';
    void loadLocState();
    // A map just opened has whatever regions it shipped with; the panel may
    // still be open from the last one, and it must not show those.
    void loadRegions();
    // Same reason as the ground-scale slider: show the restored force and
    // tension, not the HTML defaults the brush is not using.
    $input('brushforce').value = String(brushForce);
    $input('brushtension').value = String(brushTension);
    $('brushtensionval').textContent = brushTension.toFixed(2);
    syncBrushPanel();
    setBrush(false); // a fresh map starts in camera mode
    setCliffs(cliffsOn());
    setShowBlocked(showBlocked);
    $('help').style.display = '';
    // A newly loaded map has its own layer set; refresh the "used" markers.
    tilesInMap = new Set((await api.listTiles()).inMap);
    if (allTiles.length) renderPalette();
    // Restore the panels the way they were left rather than forcing them open —
    // that is the whole point of persisting the toggles.
    setExplorer(explorerOpen);
    setPalette(uiPrefs.terrainPanel);
    setShowObjects(state.showObjects);
    setTopView(uiPrefs.topView); // restore the plan/3D view choice
    markDirty(false);
    const total = Object.values(info.counts).reduce((a, b) => a + b, 0);
    const floorsTxt = info.floors.length > 1
      ? ' · floors: ' + info.floors.map((f) => `${FLOOR_LABEL[f.name] || f.name} ${f.objects}`).join(', ')
      : '';
    $('hud').textContent = `${total} objects · placed ${info.placed}, no model ${info.skipped} · ${S.geoms.length} meshes${floorsTxt}`;
    // The map's tile set is derived from the terrain's layers, and opening a map
    // whose list had fallen behind repairs it. That is a real change to the
    // document, so it counts as unsaved work rather than vanishing quietly.
    if (info.tilesNamed) {
      markDirty(true);
      $('hud').textContent += ` · named ${info.tilesNamed} ground tile(s) this map paints with but did not list`;
    }
    // Warm the object catalogue in the background, so opening the palette is
    // instant rather than a disk scan on the first click. Kicked off only once
    // the map itself is on screen and the loading overlay is down, so it never
    // competes with the work the user is actually waiting for. Not awaited.
    void initObjectPalette();
  } catch (e) {
    $('hud').textContent = 'error: ' + (e instanceof Error ? e.message : String(e));
    console.error(e);
  } finally {
    $('loading').classList.remove('on');
  }
}

// --- external changes ---------------------------------------------------
//
// The original editor can be open on the same map folder. When it saves, the
// main process notices and pushes here; we offer to take its version rather
// than reloading behind the user's back, because reloading throws away whatever
// they have done on our side since the last save.

/** The change we are currently offering to take, or null when the banner is down. */
let pendingChange: ExternalChange | null = null;

function describeChange(c: ExternalChange): string {
  const parts: string[] = [];
  if (c.terrain) parts.push('terrain');
  if (c.map) parts.push('objects');
  const n = c.changed.length + c.added.length + c.removed.length;
  const what = parts.length ? parts.join(' and ') : `${n} file${n === 1 ? '' : 's'}`;
  return isDirty
    ? `Another editor rewrote ${what}. Reloading discards your unsaved changes.`
    : `Another editor rewrote ${what}.`;
}

function showExternalChange(c: ExternalChange): void {
  pendingChange = c;
  $('extchange-what').textContent = describeChange(c);
  $('extchange').style.display = 'flex';
}

function hideExternalChange(): void {
  pendingChange = null;
  $('extchange').style.display = 'none';
}

api.onExternalChange((c) => { showExternalChange(c); });

$('extchange-reload').onclick = () => {
  const c = pendingChange;
  hideExternalChange();
  if (c) loadMapPath(c.mapPath);
};
// Dismissing only hides the banner: the main process has already advanced its
// baseline, so the next external save raises it again.
$('extchange-ignore').onclick = hideExternalChange;

/**
 * Open whatever the user picked: an unpacked folder's map.xdb, or a packed
 * archive — which is unpacked beside itself first, so what gets edited is always
 * a working folder and the archive stays as the game got it.
 */
async function openAny(path: string | null, inner?: string, stock?: boolean): Promise<void> {
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
function setMapOpen(on: boolean): void {
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
async function closeMap(): Promise<void> {
  if (!openedMap) return;
  if (isDirty && !await ask('This map has changes that were never saved. Close it anyway?', 'Close')) return;
  // Both of these are filled from the map that is going away, and neither
  // notices on its own that it is gone.
  if (mapTreeOpen()) closeMapTree();
  closeMapProps();
  if (placeObject) armObject(null);
  clearWorld();
  await api.closeMap();
  openedMap = null;
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

async function openViaDialog() {
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

function renderMapList() {
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

function renderCats() {
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

async function initPicker() {
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

// --- New Map -------------------------------------------------------------
//
// The original's startup dialog. Everything it asks for goes into the generated
// files; the map is written under the data root's Maps folder — where the
// original editor keeps its own maps, and where ours are told apart by the
// project manifest — and then opened
// like any other, so there is no separate "unsaved new map" state to get wrong.

function newMapDialog(): HTMLDialogElement {
  const el = $('newmap');
  if (!(el instanceof HTMLDialogElement)) throw new Error('#newmap is not a <dialog>');
  return el;
}

/** Show where the map will land, so neither the file nor the folder is a surprise. */
function updateNewMapWhere(): void {
  const name = $input('nm-name').value.trim() || 'New Map';
  const sub = $select('nm-type').value === 'multi' ? 'Maps/Multiplayer/' : 'Maps/SingleMissions/';
  $('nm-where').textContent = `→ <game>/H5E/${name}.h5m · working folder <game data>/${sub}${name}`;
}

function openNewMap(): void {
  $('nm-err').textContent = '';
  updateNewMapWhere();
  newMapDialog().showModal();
  $input('nm-name').select();
}

async function submitNewMap(): Promise<void> {
  const ok = $button('nm-ok');
  ok.disabled = true;
  $('nm-err').textContent = '';
  try {
    const { mapPath, mapDir, archive } = await api.newMap({
      name: $input('nm-name').value.trim(),
      tiles: Number($select('nm-size').value),
      twoLevel: $input('nm-two').checked,
      multiplayer: $select('nm-type').value === 'multi',
    });
    newMapDialog().close();
    await loadMapPath(mapPath, archive);
    // Where it went — a map is a file in the install now, and the folder it is
    // worked on in moves with HOMM5_UNPACK_TO, so neither is guessable.
    $('hud').textContent = `new map → ${archive} · working folder ${mapDir}`;
    // The picker's list is now one map out of date.
    void initPicker();
  } catch (e) {
    // Stay open on failure — a name clash is fixed by editing the name.
    $('nm-err').textContent = e instanceof Error ? e.message : String(e);
  } finally {
    ok.disabled = false;
  }
}

$('newmapbtn').onclick = openNewMap;
$('newmap2').onclick = openNewMap;
$('nm-close').onclick = () => newMapDialog().close();
$('nm-cancel').onclick = () => newMapDialog().close();
$('nm-ok').onclick = () => { void submitNewMap(); };
$input('nm-name').addEventListener('input', updateNewMapWhere);
$select('nm-type').addEventListener('change', updateNewMapWhere);
// Enter in the name field creates, matching the original's default button.
$input('nm-name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); void submitNewMap(); }
});

$('open').onclick = openViaDialog;
$('open2').onclick = openViaDialog;
$('closemapbtn').onclick = () => { void closeMap(); };
$input('search').addEventListener('input', renderMapList);
initPicker();

// --- the bar's menus ---------------------------------------------------------
//
// The popovers are the platform's: light-dismiss, Esc, the top layer and focus
// are all handled, and CSS anchors each menu to the button that opened it. Two
// manners are left to us, and both are what a menu bar has always done.

// A menu item is a command, so it takes its menu down with it. Only buttons: the
// sliders live in here too, and dragging one must not close the menu under the
// hand that is dragging.
for (const pop of document.querySelectorAll<HTMLElement>('#bar .menupop')) {
  pop.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('button')) pop.hidePopover();
  });
}
// Once one menu is down, sliding along the bar walks between them rather than
// asking for a click each time.
for (const btn of document.querySelectorAll<HTMLButtonElement>('#bar .menubtn')) {
  btn.addEventListener('pointerenter', () => {
    if (btn.disabled) return;
    const open = document.querySelector<HTMLElement>('#bar .menupop:popover-open');
    const mine = btn.nextElementSibling;
    if (!open || open === mine || !(mine instanceof HTMLElement)) return;
    open.hidePopover();
    mine.showPopover();
  });
}

// Say so while the editor is drawing in software, and offer the way back. The
// mode survives restarts, so without this a machine that had one bad driver day
// would keep paying for it silently — and the person who turned it on did so from
// a window that could not start, which is not where they will look to undo it.
void (async () => {
  if (!await api.gpuSoftware()) return;
  $('gpunote').hidden = false;
  $('gpunote-off').onclick = () => { void api.setGpuSoftware(false); };
})();
// Save puts the work back where the map came from. For a map opened from a
// .h5m that is the archive itself — the working folder is ours, not something
// the user picked, so writing only there would look like nothing happened.
$('save').onclick = async () => {
  const r = await api.save();
  markDirty(false);
  $('hud').textContent = r.output ? `saved → ${r.output}` : 'saved';
};
$('undobtn').onclick = () => { void stepHistory('undo'); };
$('redobtn').onclick = () => { void stepHistory('redo'); };
$('pack').onclick = async () => {
  const r = await api.pack();
  if ('canceled' in r) return;
  markDirty(false);
  $('hud').textContent = `packed → ${r.output} (${(r.bytes / 1024 | 0)} KB)`;
};

// Always enabled, map open or not: what the game shows is whatever is in the
// mod folder, which has nothing to do with what this window happens to have
// loaded. The button says what it starts and then gets out of the way — the game
// runs on its own and outlives the editor.
$('playbtn').onclick = async () => {
  $('hud').textContent = 'starting the game…';
  try {
    const r = await api.launchGame();
    $('hud').textContent = `started ${r.exe}`;
  } catch (e) {
    $('hud').textContent = `error: ${e instanceof Error ? e.message : String(e)}`;
  }
};

// --- render loop ---
// [perf] A frame longer than this means the main thread was blocked between two
// animation frames — the "поток забит" symptom. Logging each one with its
// duration turns an intermittent stall into something you can see and time
// against the phase logs above. 100ms ≈ six dropped frames, so ordinary work
// stays quiet and only real stalls speak up.
const JANK_MS = 100;
let lastT = performance.now();
let lastLightBake = 0;

// A moved/deleted light-carrier re-bakes its floor's lightmap here, at most
// four times a second — a full bake is a few ms, a drag fires per mousemove.
function bakePendingLights(now: number): void {
  if (!state.world) return;
  const fl = state.world.floors[state.world.active];
  if (fl?.lightsDirty && now - lastLightBake > 250) { lastLightBake = now; bakeLightMap(fl); }
}
(function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();
  const frame = now - lastT;
  if (frame > JANK_MS) console.warn(`[perf] jank: main thread blocked ${frame | 0}ms`);
  const dt = Math.min(frame / 1000, 0.1); // clamp so a stall can't teleport
  lastT = now;
  keyPan(dt);
  // Resolve at most one deferred hover pick per frame (see hoverEv).
  if (hoverEv) { updateHoverCursor(tileUnderCursor(hoverEv)); hoverEv = null; }
  controls.update();
  if (cam.top) syncTopCamera(); // follow pan/zoom + the orbit target each frame
  advanceIdle(dt);
  advanceFx(dt);
  bakePendingLights(now);
  renderer.render(scene, cam.active);
})();


// Each feature binds itself to its own markup, and says so here rather than
// doing it as a side effect of being imported: a module pulled in only for a
// type would then be wired, and one whose last export stopped being used would
// silently stop being.
initPropertyPanel();
initRefs();
initTextEditor();
initLocalization();
initCampaigns();
initPresetPicker();
initRecolor();
initHeroesMod();
initUnitsMod();

// The finish line. Everything above ran, so the window is wired and the render
// loop is turning; index.html's watchdog stands down. Keep this last — moved
// earlier, it would vouch for handlers that had not been attached yet.
window.__booted = true;
