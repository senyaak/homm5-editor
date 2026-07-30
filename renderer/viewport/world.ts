// Building the scene for a map, and taking it down again.
//
// A map has one or two floors; each is its own terrain and object set, built
// into its own group so exactly one can be shown. Mixing them would drop
// underground objects onto the surface at the wrong heights.

import { updateFloorUI } from '#features/shell.ts';
import { tileCenter } from '#core/coords.ts';
import { $ } from '#core/dom.ts';
import { activeFloor, state } from '#core/state.ts';
import type { Floor3D } from '#core/state.ts';
import { drawRegionOverlay, renderRegionList } from '#features/regions.ts';
import { deselect, renderExplorer, updatePanel } from '#features/selection.ts';
import { RIVER_DEPTH } from '#features/terrain-brush/sculpt.ts';
import { loadFx } from '#viewport/fx.ts';
import { buildGeos, geomScale } from '#viewport/geoms.ts';
import { addIdle } from '#viewport/idle.ts';
import { buildBatches } from '#viewport/instancing.ts';
import { applyAmbient, refreshLighting } from '#viewport/lighting.ts';
import { bakeLightMap, makeLightMap } from '#viewport/point-lights.ts';
import type { IdleObject } from '#viewport/skinning.ts';
import { disposeSplats, upgradeToSplat } from '#viewport/splat.ts';
import { cam, camera, controls, scene, syncTopCamera } from '#viewport/stage.ts';
import { asTileSpace, makeWaterMesh, terrainGeometry } from '#viewport/terrain-mesh.ts';
import type { Floor, Scene } from '#src/scene.ts';
import * as THREE from 'three';
import { UNITS_PER_TILE as U } from '#src/units.ts';
export function clearWorld(): void {
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

export function buildFloor(floor: Floor, geos: THREE.BufferGeometry[], mats: THREE.Material[][]): Floor3D {
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

export function buildWorld(S: Scene): void {
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
export function setActiveFloor(i: number): void {
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
