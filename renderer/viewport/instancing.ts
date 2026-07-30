// Instanced drawing: every copy of one model on one floor in a single call.
//
// A map draws the same few models over and over: 2258 placed objects on one
// shipped map resolve to 120 distinct models, the commonest of which appears
// 363 times. Drawn one mesh each that is 2729 draw calls, which is what made
// the view stutter. Batched by model it is 229.
//
// Merging submeshes that share a material was measured first and is not worth
// doing on its own: it takes 2729 to 2630.
//
// Each object keeps a THREE.Mesh as its handle, but that mesh is NOT added to
// the scene — it exists to be picked, dragged and boxed, and the drawing is
// done by the InstancedMesh. The raycaster is handed the handles explicitly, so
// it still finds them; their world matrices just have to be kept current.

import * as THREE from 'three';

import { heightOn, tileCenter } from '#core/coords.ts';
import type { Floor3D, GeomBatch } from '#core/state.ts';
import type { Instance } from '#src/scene.ts';
import { worldGeos, worldMats } from '#viewport/geoms.ts';
import { addIdle, clearIdle } from '#viewport/idle.ts';
import { syncFootprints } from '#viewport/overlays.ts';
import { markLightsDirty } from '#viewport/point-lights.ts';

/** Spare slots kept so placing a few objects does not reallocate every time. */
const BATCH_HEADROOM = 8;

/** Write an object's transform into its slot of the instance buffer. */
export function syncInstance(fl: Floor3D, inst: Instance): void {
  const batch = fl.batches.get(inst.g);
  const mesh = inst.id === null ? null : fl.meshes.get(inst.id);
  // If the object carries designer point lights, its pool follows it (rebaked
  // by the render loop, throttled, so a drag doesn't bake per mousemove).
  markLightsDirty(fl, inst);
  // An animated object is drawn by its own skinned mesh rather than a slot in
  // the batch, so a drag has to move that instead — and it may be the only
  // thing to move, since an animated instance is not in the batch at all.
  if (mesh) {
    const idle = fl.idle.find((a) => a.mesh.userData.inst === inst);
    if (idle) {
      mesh.updateMatrixWorld();
      idle.mesh.position.copy(mesh.position);
      idle.mesh.rotation.copy(mesh.rotation);
      idle.mesh.scale.copy(mesh.scale);
      idle.mesh.updateMatrixWorld();
    }
  }
  // The object's effects ride along wherever it goes.
  if (mesh && fl.fx.length) {
    mesh.updateMatrixWorld();
    for (const s of fl.fx) if (s.mesh.userData.inst === inst) s.setObjectMatrix(mesh.matrixWorld);
  }
  if (!batch || !mesh) return;
  const slot = batch.slot.get(inst);
  if (slot === undefined) return;
  mesh.updateMatrixWorld();
  batch.im.setMatrixAt(slot, mesh.matrixWorld);
  batch.im.instanceMatrix.needsUpdate = true;
}

/**
 * Free an object's slot.
 *
 * The last live instance is moved into the freed slot and the count drops by
 * one, so the buffer stays packed. Instances are unordered, so moving one costs
 * nothing; leaving a hole would mean either drawing a stale copy or carrying a
 * free list for no benefit.
 */
export function removeFromBatch(fl: Floor3D, inst: Instance): void {
  const batch = fl.batches.get(inst.g);
  if (!batch) return;
  const slot = batch.slot.get(inst);
  if (slot === undefined) return;
  const last = batch.im.count - 1;
  if (slot !== last) {
    const moved = batch.at[last];
    const m = new THREE.Matrix4();
    batch.im.getMatrixAt(last, m);
    batch.im.setMatrixAt(slot, m);
    batch.at[slot] = moved ?? null;
    if (moved) batch.slot.set(moved, slot);
  }
  batch.at[last] = null;
  batch.slot.delete(inst);
  batch.im.count = last;
  batch.im.instanceMatrix.needsUpdate = true;
}

/**
 * Give a newly placed object a slot, growing the batch when it is full.
 *
 * A batch that has to grow is rebuilt at double capacity rather than one bigger,
 * so placing a run of the same object does not reallocate on every click.
 */
export function addToBatch(fl: Floor3D, inst: Instance, mesh: THREE.Mesh): void {
  let batch = fl.batches.get(inst.g);
  const geo = worldGeos[inst.g], mat = worldMats[inst.g];
  if (!geo || !mat) return;
  if (!batch) {
    const im = new THREE.InstancedMesh(geo, mat, 1 + BATCH_HEADROOM);
    im.count = 0;
    im.frustumCulled = false;
    batch = { im, slot: new Map(), at: [] };
    fl.objGroup.add(im);
    fl.batches.set(inst.g, batch);
  }
  if (batch.im.count >= batch.im.instanceMatrix.count) {
    const bigger = new THREE.InstancedMesh(geo, mat, Math.max(4, batch.im.count * 2));
    const m = new THREE.Matrix4();
    for (let i = 0; i < batch.im.count; i++) { batch.im.getMatrixAt(i, m); bigger.setMatrixAt(i, m); }
    bigger.count = batch.im.count;
    bigger.frustumCulled = false;
    fl.objGroup.remove(batch.im);
    batch.im.dispose();
    fl.objGroup.add(bigger);
    batch.im = bigger;
  }
  const slot = batch.im.count;
  mesh.updateMatrixWorld();
  batch.im.setMatrixAt(slot, mesh.matrixWorld);
  batch.slot.set(inst, slot);
  batch.at[slot] = inst;
  batch.im.count = slot + 1;
  batch.im.instanceMatrix.needsUpdate = true;
}

/** Group a floor's objects by model and draw each group in one call. */
export function buildBatches(
  instances: Instance[],
  meshes: Map<string, THREE.Mesh>,
  geos: THREE.BufferGeometry[],
  mats: THREE.Material[][],
  objGroup: THREE.Group,
): Map<number, GeomBatch> {
  const byGeom = new Map<number, Instance[]>();
  for (const it of instances) {
    const list = byGeom.get(it.g);
    if (list) list.push(it); else byGeom.set(it.g, [it]);
  }
  const batches = new Map<number, GeomBatch>();
  for (const [g, list] of byGeom) {
    const geo = geos[g], mat = mats[g];
    if (!geo || !mat) continue;
    const im = new THREE.InstancedMesh(geo, mat, list.length + BATCH_HEADROOM);
    im.count = list.length;
    // Objects sit where the map puts them, which is nowhere near the origin the
    // shared geometry is centred on, so let three.js work the bounds out.
    im.frustumCulled = false;
    const batch: GeomBatch = { im, slot: new Map(), at: [] };
    list.forEach((it, i) => {
      batch.slot.set(it, i);
      batch.at[i] = it;
      const mesh = it.id === null ? null : meshes.get(it.id);
      if (mesh) im.setMatrixAt(i, mesh.matrixWorld);
    });
    im.instanceMatrix.needsUpdate = true;
    objGroup.add(im);
    batches.set(g, batch);
  }
  return batches;
}

/**
 * Replace a floor's objects wholesale.
 *
 * Undo re-parses the map, so the instances that come back are a fresh list
 * rather than the ones already on screen. Reconciling them by id would mean
 * three cases (gone, new, moved) and a bug in any of them leaves the view
 * disagreeing with the model — the one thing undo must never do. Rebuilding is
 * a handful of milliseconds and cannot drift.
 */
export function replaceInstances(fl: Floor3D, instances: Instance[]): void {
  for (const b of fl.batches.values()) { fl.objGroup.remove(b.im); b.im.dispose(); }
  fl.batches.clear();
  fl.meshes.clear();
  clearIdle(fl.objGroup, fl.idle);
  fl.instances = instances;
  for (const it of instances) {
    if (it.id === null) continue;
    const geo = worldGeos[it.g], mat = worldMats[it.g];
    if (!geo || !mat) continue;
    // The map stores no height, so an object lands on whatever ground is under
    // it — the same rule object:add follows.
    it.z = heightOn(fl, it.x, it.y);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(tileCenter(it.x), tileCenter(it.y), it.z);
    m.rotation.z = it.r;
    m.userData.inst = it;
    m.updateMatrixWorld();
    fl.meshes.set(it.id, m);
  }
  const still = instances.filter((it, i) => {
    const handle = it.id === null ? null : fl.meshes.get(it.id);
    return !(handle && addIdle(fl.objGroup, fl.idle, it, handle, i * 0.37));
  });
  const batches = buildBatches(still, fl.meshes, worldGeos, worldMats, fl.objGroup);
  for (const [g, b] of batches) fl.batches.set(g, b);
  syncFootprints(fl);
}
