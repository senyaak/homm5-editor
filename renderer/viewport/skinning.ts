// Turning a scene's skin payload into a three.js skinned mesh, and posing it.
//
// Its own module so the app is not the only thing that can build one: the test
// (tools/test-idle.ts) drives THESE functions rather than a copy of them, and
// checks the result against three.js's own skinning maths. A copy would happily
// pass a test the renderer then fails.
//
// The maths, since three.js does not spell it out and reasoning about it in the
// abstract wastes an afternoon. The vertex shader computes
//
//   transformed = bindMatrixInverse * Σ w (bone.matrixWorld * boneInverse) * bindMatrix * p
//
// and the renderer then applies modelViewMatrix = view * mesh.matrixWorld on
// top. Our inverse binds are in MODEL space and the bones are children of the
// mesh, so bone.matrixWorld already carries the object's placement — which
// means bindMatrix must be the IDENTITY, or the placement is applied twice and
// a creature ends up at twice its distance from the origin. bindMode stays
// attached, so bindMatrixInverse is recomputed from matrixWorld every frame and
// dragging an animated object keeps working.

import * as THREE from 'three';
import type { Instance, SkinnedGeom } from '#src/scene/payload.ts';

/** One animated object: its own skeleton, its own place in the loop. */
export interface IdleObject {
  mesh: THREE.SkinnedMesh;
  bones: THREE.Bone[];
  skin: SkinnedGeom;
  /** Playback head in seconds, wrapped into the clip's duration. */
  time: number;
}

/**
 * Build a skinned mesh for one object out of a scene geom's skin payload.
 *
 * The geometry and materials are the shared ones — a model's binding is the
 * same for every copy of it, and only the skeleton is per object, because two
 * gremlins on the same map are at different points of the same loop.
 */
export function makeIdle(
  skin: SkinnedGeom, geometry: THREE.BufferGeometry, material: THREE.Material[],
): IdleObject | null {
  if (!skin.clip || !skin.bones.length) return null;
  const bones = skin.bones.map((b) => {
    const bone = new THREE.Bone();
    bone.name = b.name;
    bone.position.set(b.pos[0]!, b.pos[1]!, b.pos[2]!);
    bone.quaternion.set(b.quat[0]!, b.quat[1]!, b.quat[2]!, b.quat[3]!);
    return bone;
  });
  const mesh = new THREE.SkinnedMesh(geometry, material);
  skin.bones.forEach((b, i) => {
    const parent = b.parent >= 0 ? bones[b.parent] : null;
    (parent ?? mesh).add(bones[i]!);
  });
  mesh.bind(
    new THREE.Skeleton(bones, skin.bind.map((m) => new THREE.Matrix4().fromArray(m))),
    new THREE.Matrix4(),
  );
  // The bones carry vertices well outside the geometry's own bounds, and three
  // culls against those bounds, so a leaning creature would blink out. What is
  // on screen is decided by hand instead (see advanceIdle in app.ts).
  mesh.frustumCulled = false;
  return { mesh, bones, skin, time: 0 };
}

const _a = new THREE.Quaternion();
const _b = new THREE.Quaternion();

/**
 * Put an object's bones where its clip says they are at `time`.
 *
 * The clip is already sampled onto an even grid (src/animation.ts bakes the
 * B-splines away), so this is a lookup and a blend — linear between
 * neighbouring samples, spherical for the rotations. `loop` is what an idle
 * does; a clip a scene plays once holds its last frame instead.
 */
export function poseIdle(idle: IdleObject, time: number, loop = true): void {
  const clip = idle.skin.clip;
  if (!clip) return;
  const n = clip.times.length;
  if (!n) return;
  const span = clip.duration || 1;
  // A one-shot HOLDS its last frame. Wrapped like a loop it does not merely
  // repeat: `time` clamped to the duration is exactly `span`, and `span % span`
  // is zero — so a clip played to its end lands on its FIRST frame, and the
  // creatures cut down in a scene stood straight back up.
  const at = loop ? ((time % span) + span) % span : Math.min(Math.max(0, time), span);
  // Even spacing is what makes this a division rather than a search.
  const f = Math.min(n - 1, Math.max(0, at / span * (n - 1)));
  const i0 = Math.min(n - 1, Math.floor(f));
  const i1 = Math.min(n - 1, i0 + 1);
  const t = f - i0;
  idle.bones.forEach((bone, b) => {
    const rot = clip.rotations[b], pos = clip.positions[b], scl = clip.scales?.[b];
    if (rot) {
      _a.set(rot[i0 * 4]!, rot[i0 * 4 + 1]!, rot[i0 * 4 + 2]!, rot[i0 * 4 + 3]!);
      _b.set(rot[i1 * 4]!, rot[i1 * 4 + 1]!, rot[i1 * 4 + 2]!, rot[i1 * 4 + 3]!);
      bone.quaternion.slerpQuaternions(_a, _b, t);
    }
    if (pos) {
      bone.position.set(
        pos[i0 * 3]! + (pos[i1 * 3]! - pos[i0 * 3]!) * t,
        pos[i0 * 3 + 1]! + (pos[i1 * 3 + 1]! - pos[i0 * 3 + 1]!) * t,
        pos[i0 * 3 + 2]! + (pos[i1 * 3 + 2]! - pos[i0 * 3 + 2]!) * t,
      );
    }
    // Only present when the clip actually leaves unit scale (BakedClip.scales),
    // and for a whole family of effects it is the whole animation: a meteor's
    // impact ring swelling ×78, a gating vortex opening around the caster.
    if (scl) {
      bone.scale.set(
        scl[i0 * 3]! + (scl[i1 * 3]! - scl[i0 * 3]!) * t,
        scl[i0 * 3 + 1]! + (scl[i1 * 3 + 1]! - scl[i0 * 3 + 1]!) * t,
        scl[i0 * 3 + 2]! + (scl[i1 * 3 + 2]! - scl[i0 * 3 + 2]!) * t,
      );
    }
  });
}

// --- the map's bodies: a clip baked to a table, no bones at run time ---------
//
// Everything above builds bones and poses them — the scene player needs that,
// its actors play clips of their own on their own clocks. A map's creatures do
// not: every copy of a creature plays the one idle loop at the one time (the
// phase spread was ours and is gone), and the loop never changes. So the clip
// is posed ONCE, at 30 Hz, and what three's Skeleton.update() would compute
// each frame — bone.matrixWorld × boneInverse, per bone — is kept per frame in
// a table. At run time a body is a SkinnedMesh over a skeleton that has no
// bones at all: its boneMatrices are the table's current row, copied in when
// the frame changes, and the bone texture goes up as it always did. One such
// skeleton per skinned geom, shared by every body of it, so the copy and the
// upload happen once per creature kind per frame, and nothing per body.
// (SLICE_fx_performance.md §7: 69 bodies were 9.4 ms of a 14.6 ms frame.)

/** Frames a second the table is baked at — the effects' rate; the clip's own samples are 15/s. */
export const TABLE_RATE = 30;

/**
 * A skeleton whose pose comes out of a baked table, not out of bones.
 *
 * Three calls `update()` once per frame per skeleton it draws; this one copies
 * the frame's row of offset matrices in when the frame moved and lets the bone
 * texture upload as usual. `time` is the loop's playback head, shared by every
 * body on it.
 */
export class TableSkeleton extends THREE.Skeleton {
  /** Seconds into the loop, wrapped by `advanceIdle`. */
  time = 0;
  /** The row `boneMatrices` currently holds; -1 before the first update. */
  private row = -1;
  readonly table: BoneTable;
  constructor(table: BoneTable) {
    super([], []);
    this.table = table;
    // Three's own layout (Skeleton.computeBoneTexture): a matrix is four RGBA
    // texels, in a square texture sized for the bone count — which it would
    // read off `bones`, and this skeleton has none.
    let size = Math.sqrt(table.bones * 4);
    size = Math.max(4, Math.ceil(size / 4) * 4);
    this.boneMatrices = new Float32Array(size * size * 4);
    this.boneTexture = new THREE.DataTexture(this.boneMatrices, size, size, THREE.RGBAFormat, THREE.FloatType);
    this.boneTexture.needsUpdate = true;
  }
  /** The frame `time` falls on — the table is a loop, so it wraps. */
  frameAt(): number {
    const span = this.table.duration || 1;
    const at = ((this.time % span) + span) % span;
    return Math.min(this.table.frames - 1, Math.floor(at * TABLE_RATE));
  }
  override update(): void {
    const f = this.frameAt();
    if (f === this.row) return;
    this.row = f;
    const n = this.table.bones * 16;
    this.boneMatrices!.set(this.table.offsets.subarray(f * n, (f + 1) * n));
    if (this.boneTexture) this.boneTexture.needsUpdate = true;
  }
  /**
   * Where bone `b` stands at the current frame, in the body's own (model)
   * space: the row holds `world × boneInverse`, so `row × bind` — a multiply
   * per ask rather than a second table; only glued effects ask. Every body
   * of the kind asks for the same bone at the same frame, so the answer is
   * kept until the frame moves.
   */
  boneWorld(b: number, out: THREE.Matrix4): THREE.Matrix4 {
    const f = this.frameAt();
    let hit = this.worldCache.get(b);
    if (!hit) { hit = { frame: -1, m: new THREE.Matrix4() }; this.worldCache.set(b, hit); }
    if (hit.frame !== f) {
      hit.frame = f;
      hit.m.fromArray(this.table.offsets, (f * this.table.bones + b) * 16);
      hit.m.multiply(_bind.fromArray(this.table.bind, b * 16));
    }
    return out.copy(hit.m);
  }
  private readonly worldCache = new Map<number, { frame: number; m: THREE.Matrix4 }>();
}

/** One creature kind's idle, posed frame by frame. */
export interface BoneTable {
  bones: number;
  frames: number;
  /** The clip's length, seconds — the loop. */
  duration: number;
  /** Per frame, per bone: `bone.matrixWorld × boneInverse` (what the skinning shader wants), 16 floats. */
  offsets: Float32Array;
  /** Per bone: the bind matrix (the inverse of `boneInverse`), 16 floats — what turns a row back into the bone's place. */
  bind: Float32Array;
}
const _bind = new THREE.Matrix4();

/**
 * Bake a skin's idle to a table.
 *
 * Done the honest way: a real skeleton is built and posed at each frame with
 * `poseIdle` — the same lerp and slerp the scene player runs — and three's own
 * `Skeleton.update()` produces the row. The table is therefore what the
 * per-frame path drew, sampled at TABLE_RATE.
 */
export function bakeBoneTable(skin: SkinnedGeom, geometry: THREE.BufferGeometry, material: THREE.Material[]): BoneTable | null {
  const idle = makeIdle(skin, geometry, material);
  if (!idle) return null;
  const bones = idle.bones.length;
  const duration = idle.skin.clip?.duration ?? 0;
  const frames = Math.max(1, Math.round(duration * TABLE_RATE));
  const offsets = new Float32Array(frames * bones * 16);
  const skeleton = idle.mesh.skeleton;
  const bind = new Float32Array(bones * 16);
  skeleton.boneInverses.forEach((inv, i) => _bind.copy(inv).invert().toArray(bind, i * 16));
  for (let f = 0; f < frames; f++) {
    poseIdle(idle, f / TABLE_RATE);
    idle.mesh.updateMatrixWorld(true);
    skeleton.update();
    offsets.set(skeleton.boneMatrices!, f * bones * 16);
  }
  skeleton.dispose();
  return { bones, frames, duration, offsets, bind };
}

/**
 * Every body of one creature kind on a floor, drawn in ONE call.
 *
 * An InstancedMesh that three also takes for a skinned one: `isSkinnedMesh`
 * puts the skinning chunks in its shaders and the skeleton's bone texture in
 * its uniforms, `isInstancedMesh` (inherited) draws it instanced — and three's
 * vertex shader applies them in that order, skinning in model space and the
 * instance matrix after, which is exactly what a table posed at the origin
 * and a placement per body want. The shadow pass picks its depth material
 * by the same two flags. Detached bind mode with an identity bind, as
 * `makeIdle` and the table both assume.
 *
 * Bodies are slots (`IdleBody.slot`), placed by `setMatrixAt`; a hidden body
 * (idle stance `visible`, off screen) has a zero matrix in its slot.
 */
export class SkinnedInstances extends THREE.InstancedMesh {
  readonly isSkinnedMesh = true;
  readonly bindMode = THREE.DetachedBindMode;
  readonly bindMatrix = new THREE.Matrix4();
  readonly bindMatrixInverse = new THREE.Matrix4();
  readonly skeleton: TableSkeleton;
  constructor(geometry: THREE.BufferGeometry, material: THREE.Material[], capacity: number, skeleton: TableSkeleton) {
    super(geometry, material, capacity);
    this.skeleton = skeleton;
    this.count = 0;
    // The bones carry vertices outside the geometry's own bounds, and the
    // bodies stand all over the map: what is on screen is decided by hand
    // (advanceIdle), not by three's culling.
    this.frustumCulled = false;
  }
}

/** One creature kind on one floor: its draw, its skeleton, and its bodies in slot order. */
export interface IdleKind {
  mesh: SkinnedInstances;
  skel: TableSkeleton;
  skin: SkinnedGeom;
  bodies: IdleBody[];
}

/** A map creature: which kind draws it, in which slot, and where it stands. */
export interface IdleBody {
  inst: Instance;
  kind: IdleKind;
  slot: number;
  /** The body's placement — the object's world matrix (display scale included). */
  matrix: THREE.Matrix4;
}
