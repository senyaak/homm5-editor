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
import { requireFilled } from '#core/form-gate.ts';
import { uiPrefs, saveUiPrefs } from '#core/prefs.ts';
import { ask, modDialog, openOnTop } from '#core/dialog.ts';
import { state, activeFloor } from '#core/state.ts';
import { tileCenter, heightOn, heightAt } from '#core/coords.ts';
import { renderer, scene, camera, controls, topCamera, cam, keys, isTyping, raycaster, ptr, syncTopCamera, setTopView, keyPan, DEFAULT_BG } from '#viewport/stage.ts';
import { worldGeos, worldMats, geomParts, geomScale, geomFootprint, geomSkin, geomFx, registerGeom, buildGeos } from '#viewport/geoms.ts';
import { materialFor, partTexture } from '#viewport/materials.ts';
import { terrainColor, asTileSpace, terrainGeometry, waterCells, waterGeometry, makeWaterMesh, WATER_ORDER, remeshFloor, sea } from '#viewport/terrain-mesh.ts';
import { refreshBlocked, refreshFootprints, syncFootprints, setShowBlocked, showBlocked } from '#viewport/overlays.ts';
import { advanceIdle, clearIdle, removeIdle, addIdle, idleMode, setIdleMode } from '#viewport/idle.ts';
import { actorKinds, advanceScene, closeScene, initDialogScenes, openScene, playing, setPlaying, shotFxCount, shotModelCount, show } from '#features/dialog-scene.ts';
import type { SceneInfo } from '#electron/ipc.ts';
import { roster, objectsOfClass, canCreateClass, mapNames, forgetClass } from '#core/rosters.ts';
import { openRecolor, initRecolor } from '#features/mods/recolor.ts';
import { pickPreset, initPresetPicker } from '#features/mods/preset.ts';
import { modRow, NL } from '#features/mods/shared.ts';
import { initHeroesMod } from '#features/mods/heroes.ts';
import { initUnitsMod } from '#features/mods/units.ts';
import { initBuildingsMod } from '#features/mods/buildings.ts';
import { initArtifactsMod } from '#features/mods/artifacts.ts';
import { initArtifactSets } from '#features/mods/artifact-sets.ts';
import { openCampaignList, initCampaigns } from '#features/campaigns.ts';
import { initPropertyPanel } from '#features/inspector/controls.ts';
import { initRefs } from '#features/inspector/refs.ts';
import { initTextEditor } from '#features/text-editor/document.ts';
import { initLocalization } from '#features/localization.ts';
import type { IdleMode } from '#viewport/idle.ts';
import { syncInstance, removeFromBatch, addToBatch, buildBatches, replaceInstances } from '#viewport/instancing.ts';
import { loadFx, advanceFx, spawnFx, removeFx } from '#viewport/fx.ts';
import { makeLightMap, bakeLightMap, markLightsDirty } from '#viewport/point-lights.ts';
import { upgradeToSplat, projectBatch, applyProjectedMaterials, setGroundScale, setCliffAmount, cliffsOn, disposeSplats } from '#viewport/splat.ts';
import { applyAmbient, refreshLighting, sun, uSunDir, uSunCol, uAmbCol, uLmGain, uFxTint } from '#viewport/lighting.ts';
import type { Floor3D, World, Selection, GeomBatch } from '#core/state.ts';
import { UNITS_PER_TILE as U } from '#src/scene/units.ts';
import { tierOf, RAMP_BIT, TIER_STEP } from '#src/terrain/terrain.ts';
import type { Scene, Floor, Instance, SplatData, TileInfo, GeomData, GeomPart, Footprint, SkinnedGeom, AmbientData, FxInstancePayload } from '#src/scene/payload.ts';
import { createFxSystem } from '#viewport/particles.ts';
import type { FxSystem } from '#viewport/particles.ts';
import type { MapListEntry, ExternalChange, ModListEntry, PlaceableObject, RosterEntryDTO, LocResult, CampaignDoc, CampaignListEntry, CampaignMissionDto, CreatureStats, PaletteEntry, RecolorOps } from '#electron/ipc.ts';
import { recolorPixels } from '#src/format/recolor.ts';
import { addInstanceToScene, armObject, armed, placeAt, initPalettes, initObjectFilters } from '#features/palettes.ts';
import { loadMapPath, session } from '#features/map-session.ts';
import type { OpenedMap } from '#features/map-session.ts';
import { addRegion, drawRegionOverlay, region, regionDraw, regionList, regionOverlay, renderRegionList, initRegions } from '#features/regions.ts';
import { brush, freeTileAtClient, stroke, strokeVerts, tileAtClient, tileUnderCursor, updateBrushCursor, updateHoverCursor, vertexAtClient } from '#features/terrain-brush/brush.ts';
import { BRUSH_SAYS, RIVER_DEPTH, applyBrush, applyRect, commitBrush, currentRect, paintedVerts, sentVerts, refusedStrokes, pendingCommits, riverCellAtClient, riverHeights, riverSide, setBrush, syncBrushPanel, initBrushPanel } from '#features/terrain-brush/sculpt.ts';
import { closeMap, initPicker, openViaDialog, renderMapList, CLICK_SLOP, initShell } from '#features/shell.ts';
import { clearWorld, setActiveFloor } from '#viewport/world.ts';
import { setRegionDraw } from '#features/regions.ts';

import { artLabels } from '#src/mods/heroes.ts';
import type { ObjectProp } from '#src/map/map.ts';
import { objectProps, deref, controlOf, objectSchema, mapSchema, resolveSchemaAtPath, classOf, schemaForClass } from '#src/schema/schema.ts';
import type { FieldSchema, HasDefs } from '#src/schema/schema.ts';
import { deselect, renderExList, renderExplorer, selectById, updatePanel } from '#features/selection.ts';
import { isDirty, markDirty } from '#core/dirty.ts';
import { stepHistory, updateHistoryUI } from '#features/history.ts';
import { closeMapProps } from '#features/inspector/map-props.ts';
import { loadProps } from '#features/inspector/panel.ts';
import { MAP_TREE, closeMapTree, dataAt, mapTreeOpen, mtOpen, showAdvanced, openMapTree, pathKey, refreshMapTree, treeTarget } from '#features/inspector/tree.ts';
import { loadLocState, loc } from '#features/localization.ts';
import { openTextEdit, refreshScriptContext } from '#features/text-editor/document.ts';
import { TOWN_BONUSES } from '#src/schema/town-bonuses.ts';
import type { TreeData, Path as TreePath } from '#src/schema/tree.ts';
import { makeIdle, poseIdle } from '#viewport/skinning.ts';
import type { IdleObject } from '#viewport/skinning.ts';
import { mountCodeEditor } from '#features/text-editor/code-editor.ts';
import { loadScriptContext, scriptContextNote, forgetScriptContext } from '#features/text-editor/context.ts';
import type { CodeEditor } from '#features/text-editor/code-editor.ts';
import type { LuaDiagnostic } from '#src/script/lua-lint.ts';

type MapEntry = MapListEntry & { cat: string };

declare global {
  interface Window {
    /** Plan-view geometry for click-driven tests — see "automation hook" below. */
    view: ViewApi;
    /**
     * Set once, by the last line of this module. Absent means the module never
     * reached its end — the trap in renderer/parts/fatal.html watches for that, since a boot that
     * hangs rather than throws raises no event to catch.
     */
    __booted?: true;
  }
}

const ALL = 'All'; // category chip meaning 'no filter', used as both label and key


// --- pointer: orbit / select / move ---
//
// The map is densely covered with objects, so we must NOT hijack every drag for
// object-moving or the camera could never orbit. Rules:
//   * A plain click (no drag) selects the object under the cursor (or clears).
//   * The camera orbits on any drag EXCEPT when the drag starts on the object
//     that is already selected — that drag moves it. So: click to select, then
//     drag it to move. Orbiting stays available everywhere else.
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
    region.anchor = tileUnderCursor(ev);
    controls.enabled = false;
    updateBrushCursor(region.anchor);
    return;
  }
  // With the brush armed, left-drag paints instead of orbiting. Middle and
  // right still move the camera, so the view stays reachable mid-stroke.
  if (brush.on) {
    stroke.painting = true;
    controls.enabled = false;
    strokeVerts.clear();
    riverHeights.clear();
    stroke.lastTile = -1; stroke.lastTick = 0;   // a new stroke always applies its first tick
    stroke.rectAnchor = brush.rect ? tileUnderCursor(ev) : null;
    applyBrush(ev);
    return;
  }
  // With an object armed, a click places it — but a DRAG still orbits, so the
  // camera stays usable without disarming. Which it was is only known on
  // pointerup, so nothing is decided here beyond remembering where it started.
  if (armed.object) {
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
  if (ev.buttons !== 0 && !stroke.painting && !dragging) {
    updateBrushCursor(null); updateHoverCursor(null); hoverEv = null;
    return;
  }
  // Track the footprint on every move, painting or not -- the point of the
  // gizmo is to show where a stroke WOULD land before committing to one.
  if (brush.on) updateBrushCursor(tileUnderCursor(ev));
  // The armed object borrows the brush's footprint gizmo, so where it will land
  // is visible before committing — the same feedback painting gets.
  else if (armed.object) updateBrushCursor(tileUnderCursor(ev));
  // Otherwise show the plain one-tile marker, but not mid-drag: the object being
  // dragged already says where it is, and a second square trailing it is noise.
  // The raycast for it is deferred to the frame loop (see hoverEv) so a burst of
  // moves between two frames resolves to a single pick.
  if (!brush.on && !armed.object && !dragging) hoverEv = ev;
  else { updateHoverCursor(null); hoverEv = null; }
  // A move with no button held cannot belong to a stroke. If `painting` survived
  // one, the pointerup was lost — the window took focus elsewhere, or the event
  // was swallowed — and the brush would go on painting under a released button.
  // For a person that is a brush stuck on; while rebuilding C1M1 it showed up as
  // a handful of vertices out of 9409 carrying a stroke twice, a different
  // handful each run. End the stroke here instead, and flush what it did.
  if (stroke.painting && ev.buttons === 0) {
    stroke.painting = false;
    controls.enabled = true;
    void commitBrush();
    return;
  }
  if (stroke.painting) { applyBrush(ev); return; }
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
  if (region.anchor) {
    const a = region.anchor, b = tileUnderCursor(ev) ?? a;
    region.anchor = null;
    controls.enabled = true;
    await addRegion({
      x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y),
      x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y),
    });
    return;
  }
  if (stroke.painting) {
    stroke.painting = false;
    controls.enabled = true;
    // Rect did nothing while dragging: this is where the rectangle lands.
    if (brush.rect && stroke.rectAnchor) {
      const r = currentRect(ev);
      if (r) applyRect(r);
      stroke.rectAnchor = null;
    }
    await commitBrush();
    return;
  }
  if (!state.world || !down) return;
  const wasClick = Math.abs(ev.clientX - down.sx) < CLICK_SLOP && Math.abs(ev.clientY - down.sy) < CLICK_SLOP;

  if (armed.object) {
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
  /**
   * Open a dialog scene in this viewport, by its folder
   * (`DialogScenes/C1/M1/D1`). The map tools stay where they are; the scene
   * takes the camera until closeScene().
   */
  openScene(inner: string): Promise<SceneInfo>;
  closeScene(): void;
  /** Show one shot, optionally partway into it (seconds). */
  showShot(index: number, at?: number): void;
  /** Run the scene from where it stands, or stop it. */
  playScene(on: boolean): void;
  /** What is on screen: the scene, which shot, and what each actor is playing. */
  scene(): (SceneInfo & {
    shot: number; at: number; running: boolean;
    actors: Array<{ href: string; kind: string; /** Height of the highest bone above their feet, world units. */ top: number }>;
    /** Particle systems the current shot is firing (see cueShotFx). */
    fx: number;
    /** Pieces of effect geometry it is drawing alongside them. */
    fxModels: number;
    /** Where the camera is — the shot owns it while a scene is up. */
    eye: [number, number, number];
  }) | null;
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
   * The batched draws on the visible floor: how many slots they hold, and how
   * many of those draw their object somewhere other than where the payload puts
   * it.
   *
   * Nothing else can see this. A slot nobody writes keeps the identity matrix
   * three.js seeds the buffer with, so the object is not missing — it is drawn
   * at the world origin, in a heap with every other unplaced one, while its own
   * tile stands empty. Counted as placed, geometry resolved, on screen, wrong.
   */
  batched(): { slots: number; misplaced: number };
  /**
   * The frame as it stands, as a PNG data URL.
   *
   * The only way to LOOK at what the app draws. An Electron window screenshot
   * comes back without the WebGL layer, and reading the canvas after the fact
   * comes back blank — the drawing buffer is cleared on present. So the frame is
   * drawn again here and read in the same task, which is the one moment it is
   * still there.
   */
  snapshot(): string;
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
    return !armed.tile || fl.splat.paths.includes(armed.tile.path);
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
  batched() {
    const fl = state.world ? activeFloor() : null;
    if (!fl) return { slots: 0, misplaced: 0 };
    const m = new THREE.Matrix4(), at = new THREE.Vector3();
    let slots = 0, misplaced = 0;
    for (const b of fl.batches.values()) {
      for (let i = 0; i < b.im.count; i++) {
        const inst = b.at[i];
        if (!inst) continue;
        slots++;
        b.im.getMatrixAt(i, m);
        at.setFromMatrixPosition(m);
        const dx = at.x - tileCenter(inst.x), dy = at.y - tileCenter(inst.y), dz = at.z - inst.z;
        if (Math.hypot(dx, dy, dz) > 1e-3) misplaced++;
      }
    }
    return { slots, misplaced };
  },
  snapshot() {
    renderer.render(scene, cam.active);
    return renderer.domElement.toDataURL('image/png');
  },
  pending() { return pendingCommits; },
  opened() { return session.openedMap; },
  open(path) { return loadMapPath(path); },
  editText(href) { return openTextEdit(href, href); },
  // --- dialog scenes --------------------------------------------------------
  // A scene is played in this same viewport, so the handful of calls that drive
  // one ride on the same test surface as the rest of the view.
  openScene(inner) { return openScene(inner); },
  closeScene() { closeScene(); },
  showShot(index, at) { show(index, at ?? 0); },
  playScene(on) { setPlaying(on); },
  scene() {
    return playing.info ? {
      ...playing.info,
      shot: playing.shot,
      at: playing.at,
      running: playing.running,
      actors: actorKinds(),
      fx: shotFxCount(),
      fxModels: shotModelCount(),
      eye: cam.active.position.toArray() as [number, number, number],
    } : null;
  },
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

// A map with no name is refused by main ("the map needs a name"); the box says
// so first, like every other form that makes something.
requireFilled({ ok: 'nm-ok', missing: 'nm-missing', fields: { name: 'nm-name' } });

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
  // Not while a scene is up: the SHOT owns the camera then. `enabled = false`
  // stops the controls reading input but not `update()` re-deriving the camera
  // from its own orbit state, which put the camera back a frame after every
  // shot that was not actively playing — step through a scene and every frame
  // was the map's viewpoint, however carefully the shot had been aimed.
  if (!playing.info) controls.update();
  if (cam.top) syncTopCamera(); // follow pan/zoom + the orbit target each frame
  advanceIdle(dt);
  // A scene drives the camera and its actors' clips; does nothing while the
  // window is showing a map.
  advanceScene(dt);
  advanceFx(dt);
  bakePendingLights(now);
  renderer.render(scene, cam.active);
})();


// Each feature binds itself to its own markup, and says so here rather than
// doing it as a side effect of being imported: a module pulled in only for a
// type would then be wired, and one whose last export stopped being used would
// silently stop being.
initShell();
initPalettes();
initObjectFilters();
initRegions();
initDialogScenes();
initBrushPanel();
initPropertyPanel();
initRefs();
initTextEditor();
initLocalization();
initCampaigns();
initPresetPicker();
initRecolor();
initHeroesMod();
initUnitsMod();
  initBuildingsMod();
  initArtifactsMod();
  initArtifactSets();

// The finish line. Everything above ran, so the window is wired and the render
// loop is turning; the page's watchdog stands down. Keep this last — moved
// earlier, it would vouch for handlers that had not been attached yet.
window.__booted = true;
