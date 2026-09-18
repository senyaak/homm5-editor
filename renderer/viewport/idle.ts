// Idle stance: which objects animate, and when they are stepped.
//
// Creatures on the adventure map have one clip, an idle loop, and playing it is
// off by default (Settings.idleAnimation). An animated object cannot ride the
// ordinary instanced batches — those are plain meshes, and a skinned body is
// posed by a bone texture — so it leaves its batch and joins its KIND: one
// skinned, instanced draw per creature kind per floor (skinning.ts,
// `SkinnedInstances`), posed by one table skeleton per kind (`bakeBoneTable`,
// `TableSkeleton`). Every copy of a creature plays the one loop at the one
// time, so nothing is computed per body per frame, and a hundred gremlins are
// one call. The scene player, whose actors play clips of their own, keeps
// real bones (`makeIdle`).

import * as THREE from 'three';

import { state } from '#core/state.ts';
import type { Floor3D } from '#core/state.ts';
import type { Instance, SkinnedGeom } from '#src/scene/payload.ts';
import { worldGeos, worldMats, geomSkin } from '#viewport/geoms.ts';
import { markShadowRoles, markShadowsDirty } from '#viewport/shadows.ts';
import { bakeIdle } from '#viewport/bakery.ts';
import { boneAtlasTexture, restTable, skinnedGeometry, SkinnedInstances, TableSkeleton } from '#viewport/skinning.ts';
import type { IdleBody, IdleKind } from '#viewport/skinning.ts';
import { cam } from '#viewport/stage.ts';

export type IdleMode = 'off' | 'visible' | 'all';

/** Which mode the CURRENT scene was built for; `off` means it has no bones. */
let mode: IdleMode = 'off';

/** What the scene is set to, and how the toolbar and a load switch it. */
export const idleMode = (): IdleMode => mode;
export const setIdleMode = (m: IdleMode): void => { mode = m; };
const idleFrustum = new THREE.Frustum();
const idleViewProjection = new THREE.Matrix4();
const _idlePoint = new THREE.Vector3();
/** Spare slots a kind is born with, so placing a few more does not rebuild its draw. */
const KIND_HEADROOM = 8;
/** What a hidden body's slot holds: nothing, drawn nowhere. */
const NOWHERE = new THREE.Matrix4().makeScale(0, 0, 0);

/**
 * The table skeletons, one per creature kind, shared by every floor's kind
 * of it and reference-counted: the last kind of a creature takes its skeleton
 * — and the bone texture — down. Keyed by the skin payload, which is one
 * object per geom for the life of a world.
 */
const skeletons = new Map<SkinnedGeom, { skel: TableSkeleton; refs: number }>();

function skeletonFor(skin: SkinnedGeom): TableSkeleton | null {
  const have = skeletons.get(skin);
  if (have) { have.refs++; return have.skel; }
  // Over the rest pose now, over the baked idle when the bakery hands it
  // back — unless every kind of the creature is gone by then.
  const rest = restTable(skin);
  if (!rest) return null;
  const skel = new TableSkeleton(rest);
  skeletons.set(skin, { skel, refs: 1 });
  void bakeIdle(skin).then((table) => {
    if (table && skeletons.get(skin)?.skel === skel) skel.setTable(table);
  });
  return skel;
}

function releaseSkeleton(skin: SkinnedGeom): void {
  const have = skeletons.get(skin);
  if (!have || --have.refs > 0) return;
  have.skel.dispose();
  skeletons.delete(skin);
}

/** What the tables hold right now — for view.perf(). */
export function idleTableStats(): { tables: number; bytes: number } {
  let bytes = 0;
  for (const { skel } of skeletons.values()) bytes += skel.table.offsets.byteLength + skel.table.bind.byteLength;
  return { tables: skeletons.size, bytes };
}

/**
 * Advance every animated object on the visible floor by `dt`.
 *
 * The clock is per creature kind, not per body — one skeleton poses them all,
 * and three updates it once a frame however many draw from it. In `visible`
 * mode a body whose origin is off screen is not drawn at all (its slot holds
 * an empty matrix): with the posing and the draw both shared, that is the
 * vertex work the middle mode saves. What counts as on screen is a point
 * test, so a creature straddling the edge can vanish while a sliver of it
 * still shows; that is the trade the middle mode is for, and `all` does not
 * make it.
 */
export function advanceIdle(dt: number): void {
  if (mode === 'off' || !state.world) return;
  const fl = state.world.floors[state.world.active];
  if (!fl?.idle.length || !fl.objGroup.visible) return;
  // Every skeleton's clock, and every one's row into the shared bone
  // texture — which then goes up once for all of them (skinning.ts).
  let moved = false;
  for (const { skel } of skeletons.values()) { skel.time += dt; if (skel.writeRow()) moved = true; }
  const tex = boneAtlasTexture();
  if (moved && tex) tex.needsUpdate = true;
  if (mode !== 'visible') {
    // Back from `visible`: whatever it hid is drawn again.
    if (hid) { for (const body of fl.idle) if (!body.shown) place(body, true); hid = false; }
    return;
  }
  idleViewProjection.multiplyMatrices(cam.active.projectionMatrix, cam.active.matrixWorldInverse);
  idleFrustum.setFromProjectionMatrix(idleViewProjection);
  for (const body of fl.idle) {
    _idlePoint.setFromMatrixPosition(body.matrix);
    const shown = idleFrustum.containsPoint(_idlePoint);
    // Only a change is written: a write is an instance-buffer upload and a
    // shadow-map redraw, and with a still camera nothing changes.
    if (shown !== body.shown) place(body, shown);
  }
  hid = true;
}
/** Whether `visible` mode has hidden bodies that a mode change must show again. */
let hid = false;

/** Write a body's placement — or nothing — into its slot. */
function place(body: IdleBody, shown: boolean): void {
  body.shown = shown;
  body.kind.mesh.setMatrixAt(body.slot, shown ? body.matrix : NOWHERE);
  body.kind.mesh.instanceMatrix.needsUpdate = true;
  markShadowsDirty();
}

/** The loop's playback head, seconds — the furthest along of any kind's. */
export function idleTime(): number {
  let t = 0;
  for (const { skel } of skeletons.values()) t = Math.max(t, skel.time);
  return t;
}

/** Drop a floor's animated objects, their kinds' draws and their skeletons. */
export function clearIdle(objGroup: THREE.Group, list: IdleBody[], kinds: Map<SkinnedGeom, IdleKind>): void {
  for (const kind of kinds.values()) {
    objGroup.remove(kind.mesh);
    kind.mesh.dispose();
    releaseSkeleton(kind.skin);
  }
  kinds.clear();
  list.length = 0;
}

/** Remove one object's animated body, if it had one; the last of a kind takes the kind's draw down. */
export function removeIdle(fl: Floor3D, inst: Instance): void {
  const i = fl.idle.findIndex((a) => a.inst === inst);
  if (i < 0) return;
  const [body] = fl.idle.splice(i, 1);
  if (!body) return;
  const kind = body.kind;
  // The kind's last slot moves into the hole so the used ones stay contiguous.
  const last = kind.bodies.length - 1;
  if (body.slot !== last) {
    const moved = kind.bodies[last]!;
    moved.slot = body.slot;
    kind.bodies[body.slot] = moved;
    place(moved, moved.shown);
  }
  kind.bodies.length = last;
  kind.mesh.count = last;
  markShadowsDirty();
  if (last) return;
  fl.objGroup.remove(kind.mesh);
  kind.mesh.dispose();
  releaseSkeleton(kind.skin);
  fl.idleKinds.delete(kind.skin);
}

/** An object moved or turned: its body goes with it. */
export function moveIdle(fl: Floor3D, inst: Instance, world: THREE.Matrix4): void {
  const body = fl.idle.find((a) => a.inst === inst);
  if (!body) return;
  body.matrix.copy(world);
  place(body, true);
}

/**
 * Give an instance its animated body, if it has one, and take it out of the
 * batched draw so the model is not rendered twice.
 *
 * The body joins its kind's draw on this floor, made on its first body. The
 * draw is born with headroom and rebuilt twice the size when that runs out —
 * an InstancedMesh's capacity is fixed when it is made.
 */
export function addIdle(objGroup: THREE.Group, list: IdleBody[], kinds: Map<SkinnedGeom, IdleKind>, inst: Instance, handle: THREE.Mesh): boolean {
  if (mode === 'off') return false;
  const skin = geomSkin.get(inst.g);
  const geo = worldGeos[inst.g], mat = worldMats[inst.g];
  if (!skin || !geo || !mat) return false;
  let kind = kinds.get(skin);
  if (!kind) {
    const skel = skeletonFor(skin);
    if (!skel) return false;
    kind = { mesh: makeDraw(skinnedGeometry(geo, skel), mat, 1 + KIND_HEADROOM, skel), skel, skin, bodies: [], boneIndex: new Map() };
    kinds.set(skin, kind);
    objGroup.add(kind.mesh);
  } else if (kind.bodies.length === kind.mesh.instanceMatrix.count) {
    const bigger = makeDraw(kind.mesh.geometry, kind.mesh.material as THREE.Material[], kind.bodies.length * 2, kind.skel);
    bigger.instanceMatrix.array.set(kind.mesh.instanceMatrix.array);
    bigger.count = kind.bodies.length;
    objGroup.remove(kind.mesh);
    kind.mesh.dispose();
    kind.mesh = bigger;
    objGroup.add(bigger);
  }
  // The creature display scale rides the handle, so its world matrix is the
  // whole placement.
  handle.updateMatrixWorld();
  const body: IdleBody = { inst, kind, slot: kind.bodies.length, matrix: handle.matrixWorld.clone(), shown: true };
  kind.bodies.push(body);
  kind.mesh.count = kind.bodies.length;
  place(body, true);
  list.push(body);
  return true;
}

function makeDraw(geo: THREE.BufferGeometry, mat: THREE.Material[], capacity: number, skel: TableSkeleton): SkinnedInstances {
  const mesh = new SkinnedInstances(geo, mat, capacity, skel);
  // An animated body stands on the map like any other object, so it casts and
  // receives like one — said HERE rather than by the caller, because the pass
  // that hands the roles out runs once when a floor is built and two of the
  // three callers come later: the palette placing an object, and undo rebuilding
  // the floor. A body made by either of those was drawn in flat sun with nothing
  // falling on it, and stayed that way until the map was reopened.
  markShadowRoles(mesh);
  return mesh;
}
