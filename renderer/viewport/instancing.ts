// Batched drawing: every part of every object that wears one material, on one
// floor, in a single call.
//
// A map draws the same few models over and over — 2258 placed objects on one
// shipped map resolve to 120 distinct models — and the models wear the same
// few textures over and over again: the mix stress map's 469 kinds of static
// object draw with 148 materials between them. Drawn one InstancedMesh per
// model, with a group per material, that was 775 calls; drawn one
// BatchedMesh per MATERIAL, with every part of every model that wears it as a
// geometry in the batch and every placement as an instance, it is 148. Three
// issues one multi-draw per batch, and the card sorts the rest out.
//
// So a floor keeps two maps. `materialBatches`, by material key: the draws.
// `batches`, by model: what the rest of the editor addresses an object by —
// its slot, and per part of the model which material batch draws it and as
// which instance. An object with three parts of two materials is two
// instances in two batches; move it and both move.
//
// Each object also keeps a THREE.Mesh as its handle, but that mesh is NOT
// added to the scene — it exists to be picked, dragged and boxed, and the
// drawing is done by the batches. The raycaster is handed the handles
// explicitly, so it still finds them; their world matrices just have to be
// kept current.

import * as THREE from 'three';

import { groundOn, tileCenter } from '#core/coords.ts';
import { state } from '#core/state.ts';
import type { Floor3D, GeomBatch, MaterialBatch } from '#core/state.ts';
import type { GeomPart, Instance } from '#src/scene/payload.ts';
import { geomParts, geomScale, worldGeos, worldMats } from '#viewport/geoms.ts';
import { moveFx, reloadFx } from '#viewport/fx.ts';
import { addIdle, clearIdle, moveIdle } from '#viewport/idle.ts';
import { materialFor, materialKey } from '#viewport/materials.ts';
import { syncFootprints } from '#viewport/overlays.ts';
import { bakeLightMap, markLightsDirty } from '#viewport/point-lights.ts';
import { markShadowRoles, markShadowsDirty } from '#viewport/shadows.ts';
import { applyProjectedMaterials, projectBatch } from '#viewport/splat.ts';

/** A batch is born with room for this many instances and grows by doubling. */
const INSTANCE_HEADROOM = 64;
/** …and this many vertices; a model's part that does not fit grows it. */
const VERTEX_HEADROOM = 4096;

/**
 * One material group of one model as a geometry of its own: the vertices the
 * group's indices reach, compacted, with the attributes every batch carries.
 * Every batch carries the same set (a BatchedMesh's geometries must agree on
 * theirs): position, normal, uv and the drape flag, a zero where the model
 * has none.
 */
function partGeometry(geo: THREE.BufferGeometry, group: { start: number; count: number }): THREE.BufferGeometry {
  const index = geo.getIndex()!;
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const nrm = geo.getAttribute('normal') as THREE.BufferAttribute | undefined;
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute | undefined;
  const drape = geo.getAttribute('aDrape') as THREE.BufferAttribute | undefined;
  const remap = new Map<number, number>();
  const idx = new Uint32Array(group.count);
  for (let k = 0; k < group.count; k++) {
    const v = index.getX(group.start + k);
    let to = remap.get(v);
    if (to === undefined) { to = remap.size; remap.set(v, to); }
    idx[k] = to;
  }
  const n = remap.size;
  const p = new Float32Array(n * 3), nr = new Float32Array(n * 3), t = new Float32Array(n * 2), d = new Float32Array(n);
  for (const [from, to] of remap) {
    p[to * 3] = pos.getX(from); p[to * 3 + 1] = pos.getY(from); p[to * 3 + 2] = pos.getZ(from);
    if (nrm) { nr[to * 3] = nrm.getX(from); nr[to * 3 + 1] = nrm.getY(from); nr[to * 3 + 2] = nrm.getZ(from); }
    if (uv) { t[to * 2] = uv.getX(from); t[to * 2 + 1] = uv.getY(from); }
    if (drape) d[to] = drape.getX(from);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(p, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nr, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(t, 2));
  out.setAttribute('aDrape', new THREE.BufferAttribute(d, 1));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

/** The floor's batch for a material — made on the first part that wears it. */
function materialBatchFor(fl: Floor3D, part: GeomPart, material: THREE.Material): MaterialBatch {
  const key = materialKey(part);
  const have = fl.materialBatches.get(key);
  if (have) return have;
  const mesh = new THREE.BatchedMesh(INSTANCE_HEADROOM, VERTEX_HEADROOM, VERTEX_HEADROOM * 2, material);
  // Objects stand all over the map, so the batch as a whole is never culled —
  // and neither are its instances, one by one: three would walk every one
  // of them every frame (a sphere per instance against the frustum, 3000 of
  // them on A2C1M1 — more CPU than the draws it saved), and the instanced
  // draws this replaces never culled per object either. Nor are they depth
  // sorted, for the same reason and with the same picture as before: a
  // batch left alone does no per-frame work at all.
  mesh.frustumCulled = false;
  mesh.perObjectFrustumCulled = false;
  mesh.sortObjects = false;
  // A stand-in card under a particle effect is drawn on request only
  // (geoms.ts setFxCardsVisible); its batch answers the toggle whole.
  mesh.visible = !part.card || state.showFxCards;
  // A batch made after the floor was built misses the pass that hands out the
  // shadow roles, and a mesh that neither casts nor receives is the first
  // object of its model standing in flat light with no shadow under it.
  markShadowRoles(mesh);
  const batch: MaterialBatch = { key, mesh, part, material, card: !!part.card, vertices: VERTEX_HEADROOM, indices: VERTEX_HEADROOM * 2 };
  fl.objGroup.add(mesh);
  fl.materialBatches.set(key, batch);
  return batch;
}

/** Room in a batch for one more geometry of this size, growing it (by doubling) when there is none. */
function fitGeometry(mb: MaterialBatch, geo: THREE.BufferGeometry): void {
  const bm = mb.mesh;
  const verts = geo.getAttribute('position').count, idx = geo.getIndex()!.count;
  if (bm.unusedVertexCount >= verts && bm.unusedIndexCount >= idx) return;
  const grow = (have: number, need: number): number => { let n = have; while (n < need) n *= 2; return n; };
  mb.vertices = grow(mb.vertices, mb.vertices - bm.unusedVertexCount + verts);
  mb.indices = grow(mb.indices, mb.indices - bm.unusedIndexCount + idx);
  bm.setGeometrySize(mb.vertices, mb.indices);
}

/** Room in a batch for one more instance, growing it when there is none. */
function fitInstance(bm: THREE.BatchedMesh): void {
  if (bm.instanceCount < bm.maxInstanceCount) return;
  bm.setInstanceCount(bm.maxInstanceCount * 2);
}

/**
 * The floor's record of a model — made on its first object: each material
 * group of the model becomes a geometry of that material's batch.
 */
function geomBatchFor(fl: Floor3D, g: number): GeomBatch | null {
  const have = fl.batches.get(g);
  if (have) return have;
  const geo = worldGeos[g], parts = geomParts.get(g);
  if (!geo || !worldMats[g] || !parts) return null;
  const batch: GeomBatch = { parts: [], slot: new Map(), at: [], ids: [] };
  for (const group of geo.groups) {
    const mi = group.materialIndex ?? 0;
    const part = parts[mi];
    if (!part) continue;
    // The part's own material (cached by key, so the same object for every
    // part of every model that wears it) — not the registry's slot, which
    // holds the undrawn stand-in for a hidden effect card; a card's batch is
    // hidden whole instead (materialBatchFor).
    const mb = materialBatchFor(fl, part, materialFor(part));
    const sub = partGeometry(geo, group);
    fitGeometry(mb, sub);
    const geometryId = mb.mesh.addGeometry(sub);
    sub.dispose(); // copied into the batch; the compacted copy has done its job
    batch.parts.push({ batch: mb, geometryId, mi });
  }
  fl.batches.set(g, batch);
  // A model with a ground-projected part draws it with the floor's ground
  // material once the splat is up — the batch that was just made needs that
  // too, or a mine dropped from the palette kept the transparent overlay and
  // its earth hood vanished.
  projectBatch(fl, g);
  return batch;
}

/** Write an object's transform into its instances. */
export function syncInstance(fl: Floor3D, inst: Instance): void {
  const batch = fl.batches.get(inst.g);
  const mesh = fl.meshes.get(inst);
  markShadowsDirty();
  // If the object carries designer point lights, its pool follows it (rebaked
  // by the render loop, throttled, so a drag doesn't bake per mousemove).
  markLightsDirty(fl, inst);
  // An animated object is drawn by its kind's skinned draw rather than by the
  // batches, so a drag has to move that instead — and it may be the only
  // thing to move, since an animated instance is not in the batches at all.
  if (mesh) {
    mesh.updateMatrixWorld();
    moveIdle(fl, inst, mesh.matrixWorld);
  }
  // The object's effects ride along wherever it goes.
  if (mesh && fl.fx.length) {
    mesh.updateMatrixWorld();
    moveFx(fl, inst, mesh.matrixWorld);
  }
  if (!batch || !mesh) return;
  const slot = batch.slot.get(inst);
  if (slot === undefined) return;
  mesh.updateMatrixWorld();
  const ids = batch.ids[slot]!;
  batch.parts.forEach((p, i) => p.batch.mesh.setMatrixAt(ids[i]!, mesh.matrixWorld));
}

/** Free an object's instances. Its slot stays, empty: instances are addressed by id, not by position. */
export function removeFromBatch(fl: Floor3D, inst: Instance): void {
  markShadowsDirty();
  const batch = fl.batches.get(inst.g);
  if (!batch) return;
  const slot = batch.slot.get(inst);
  if (slot === undefined) return;
  const ids = batch.ids[slot]!;
  batch.parts.forEach((p, i) => p.batch.mesh.deleteInstance(ids[i]!));
  batch.at[slot] = null;
  batch.ids[slot] = null;
  batch.slot.delete(inst);
}

/** Give a newly placed object its instances, one per material its model wears. */
export function addToBatch(fl: Floor3D, inst: Instance, mesh: THREE.Mesh): void {
  markShadowsDirty();
  const batch = geomBatchFor(fl, inst.g);
  if (!batch) return;
  mesh.updateMatrixWorld();
  const ids = batch.parts.map((p) => {
    fitInstance(p.batch.mesh);
    const id = p.batch.mesh.addInstance(p.geometryId);
    p.batch.mesh.setMatrixAt(id, mesh.matrixWorld);
    return id;
  });
  const slot = batch.at.length;
  batch.slot.set(inst, slot);
  batch.at[slot] = inst;
  batch.ids[slot] = ids;
}

/** Draw a floor's objects: every part of every one, by material. */
export function buildBatches(fl: Floor3D, instances: Instance[]): void {
  for (const it of instances) {
    const mesh = fl.meshes.get(it);
    // An object without a handle has no placement to draw at; it is not drawn
    // rather than drawn at the origin.
    if (mesh) addToBatch(fl, it, mesh);
  }
}

/** Take a floor's draws down: every batch, and the records that pointed into them. */
export function disposeBatches(fl: Floor3D): void {
  for (const b of fl.materialBatches.values()) {
    fl.objGroup.remove(b.mesh);
    b.mesh.dispose();
  }
  fl.materialBatches.clear();
  fl.batches.clear();
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
  markShadowsDirty();
  disposeBatches(fl);
  fl.meshes.clear();
  clearIdle(fl.objGroup, fl.idle, fl.idleKinds);
  fl.instances = instances;
  for (const it of instances) {
    const geo = worldGeos[it.g], mat = worldMats[it.g];
    if (!geo || !mat) continue;
    // The map stores no height, so an object lands on whatever ground is under
    // it — the same rule object:add follows.
    it.z = groundOn(fl, it.x, it.y);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(tileCenter(it.x), tileCenter(it.y), it.z);
    m.rotation.z = it.r;
    // The creature display scale rides the handle, as it does in buildFloor and
    // in the palette's placement — left off, an undo shrank every creature on
    // the map back to authoring size.
    m.scale.setScalar(geomScale.get(it.g) ?? 1);
    m.userData.inst = it;
    m.updateMatrixWorld();
    fl.meshes.set(it, m);
  }
  const still = instances.filter((it) => {
    const handle = fl.meshes.get(it);
    return !(handle && addIdle(fl.objGroup, fl.idle, fl.idleKinds, it, handle));
  });
  buildBatches(fl, still);
  // Everything buildFloor does to a floor's objects AFTER the batches exist has
  // to happen here too, or an undo quietly returns a poorer picture than the one
  // it took away — and it stays poorer, because nothing re-runs until the map is
  // reopened. (The batches take their shadow roles as they are made; the
  // animated bodies mark themselves, in addIdle.)
  //
  // A model that takes the ground it stands on (the abandoned mine's mound) is
  // drawn with a material built from the floor's splat, and the batch it lived
  // on has just been thrown away with it.
  applyProjectedMaterials(fl);
  // The designer lights the objects carry, re-accumulated the way buildFloor
  // does it — cheap when nothing on the floor has any.
  bakeLightMap(fl);
  syncFootprints(fl);
  // And the effects, which are bound to the instance objects that no longer
  // exist. Async, like the palette's own placement: the baked keys may need
  // fetching, and the map is usable while they come.
  void reloadFx(fl);
}
