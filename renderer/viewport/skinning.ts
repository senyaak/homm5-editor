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

export { makeIdle, poseIdle, restTable, bakeBoneTable, TABLE_RATE } from '#src/scene/bone-table.ts';
export type { IdleObject, BoneTable } from '#src/scene/bone-table.ts';
import { TABLE_RATE } from '#src/scene/bone-table.ts';
import type { BoneTable } from '#src/scene/bone-table.ts';

const _bind = new THREE.Matrix4();

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


/**
 * ONE bone texture for every table skeleton there is.
 *
 * Three uploads a skeleton's bone texture whenever its pose changed, and a
 * table skeleton's changes thirty times a second — which for 183 creature
 * kinds on one map was ninety texture uploads a frame, more of the frame
 * than their draws. So every skeleton's bone matrices are a stretch of one
 * shared array behind one texture, written before the frame is drawn
 * (advanceIdle), and the texture goes up once. Three's shader reads bone
 * `i` at texel `i * 4` of whatever width the texture has, so a kind's bones
 * are addressed by their place in the stretch: its geometry carries skin
 * indices offset by where the stretch starts (`skinnedGeometry`).
 *
 * The stretches are handed out first-fit and given back on dispose; the
 * texture doubles when a new kind does not fit, and every skeleton on it is
 * re-pointed at the new array.
 */
const ATLAS_WIDTH = 1024; // texels: 256 bones a row
const atlas = {
  bones: 0,
  data: new Float32Array(0),
  texture: null as THREE.DataTexture | null,
  free: [] as { at: number; n: number }[],
  users: new Set<TableSkeleton>(),
};

/** A stretch of `n` bones in the atlas; the offset of its first bone. */
function allocBones(n: number): number {
  const i = atlas.free.findIndex((f) => f.n >= n);
  if (i >= 0) {
    const f = atlas.free[i]!;
    const at = f.at;
    if (f.n === n) atlas.free.splice(i, 1); else { f.at += n; f.n -= n; }
    return at;
  }
  // Nothing free that fits: the stretch goes at the end, growing the atlas
  // to hold it if it must.
  const at = atlas.bones;
  atlas.bones += n;
  const texels = atlas.bones * 4;
  const rows = Math.ceil(texels / ATLAS_WIDTH);
  if (!atlas.texture || atlas.texture.image.height < rows) {
    const newRows = Math.max(rows, (atlas.texture?.image.height ?? 0) * 2, 4);
    const data = new Float32Array(ATLAS_WIDTH * newRows * 4);
    data.set(atlas.data.subarray(0, Math.min(atlas.data.length, data.length)));
    atlas.data = data;
    atlas.texture?.dispose();
    atlas.texture = new THREE.DataTexture(data, ATLAS_WIDTH, newRows, THREE.RGBAFormat, THREE.FloatType);
    atlas.texture.needsUpdate = true;
    for (const s of atlas.users) s.rebind();
  }
  return at;
}

function freeBones(at: number, n: number): void {
  atlas.free.push({ at, n });
  // Neighbours join up, so a run of released kinds is one stretch again.
  atlas.free.sort((a, b) => a.at - b.at);
  for (let i = 0; i + 1 < atlas.free.length;) {
    const a = atlas.free[i]!, b = atlas.free[i + 1]!;
    if (a.at + a.n === b.at) { a.n += b.n; atlas.free.splice(i + 1, 1); } else i++;
  }
}

/** The bone texture every table skeleton draws from — for the upload once a frame (advanceIdle). */
export function boneAtlasTexture(): THREE.DataTexture | null { return atlas.texture; }

/**
 * A skeleton whose pose comes out of a baked table, not out of bones.
 *
 * Its bone matrices are its stretch of the shared atlas (above): `writeRow`
 * copies the frame's row of offset matrices in when the frame moved, and
 * says so, so the caller uploads the atlas once for every skeleton that
 * moved. `time` is the loop's playback head, shared by every body on it.
 */
export class TableSkeleton extends THREE.Skeleton {
  /** Seconds into the loop, wrapped by `advanceIdle`. */
  time = 0;
  /** The row `boneMatrices` currently holds; -1 before the first update. */
  private row = -1;
  table: BoneTable;
  /** Where the skeleton's bones start in the atlas — what its geometry's skin indices are offset by. */
  readonly offset: number;
  constructor(table: BoneTable) {
    super([], []);
    this.table = table;
    this.offset = allocBones(table.bones);
    atlas.users.add(this);
    this.rebind();
  }
  /** Point at the atlas as it is now — after it grew, or at birth. */
  rebind(): void {
    this.boneMatrices = atlas.data.subarray(this.offset * 16, (this.offset + this.table.bones) * 16);
    this.boneTexture = atlas.texture;
    this.row = -1;
  }
  override dispose(): void {
    atlas.users.delete(this);
    freeBones(this.offset, this.table.bones);
    // Not super.dispose(): the texture is everybody's.
  }
  /**
   * The baked table, arriving after the skeleton was made over the rest
   * table (`restTable`): the same bones, so the texture fits; the row and
   * the bone cache are forgotten so the next frame comes from it.
   */
  setTable(table: BoneTable): void {
    this.table = table;
    this.row = -1;
    this.worldCache.clear();
  }
  /** The frame `time` falls on — the table is a loop, so it wraps. */
  frameAt(): number {
    const span = this.table.duration || 1;
    const at = ((this.time % span) + span) % span;
    return Math.min(this.table.frames - 1, Math.floor(at * TABLE_RATE));
  }
  /** The frame's row into the atlas, when the frame moved; whether it did. */
  writeRow(): boolean {
    const f = this.frameAt();
    if (f === this.row) return false;
    this.row = f;
    const n = this.table.bones * 16;
    this.boneMatrices!.set(this.table.offsets.subarray(f * n, (f + 1) * n));
    return true;
  }
  /** Three's per-draw call: the row is written before the frame (advanceIdle); a skeleton drawn without that catches up here. */
  override update(): void {
    if (this.writeRow() && this.boneTexture) this.boneTexture.needsUpdate = true;
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
  /** `geometry` is the kind's own (skinnedGeometry): the model's, with its skin indices offset into the atlas. */
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

/**
 * The model's geometry as a kind draws it: every attribute shared with the
 * model's own, except the skin indices, which are the model's plus the
 * skeleton's offset in the bone atlas — 16-bit, since the atlas holds
 * thousands of bones where a model's own count fit in a byte.
 */
export function skinnedGeometry(geo: THREE.BufferGeometry, skeleton: TableSkeleton): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(geo.attributes)) if (name !== 'skinIndex') out.setAttribute(name, attr);
  out.setIndex(geo.getIndex());
  for (const g of geo.groups) out.addGroup(g.start, g.count, g.materialIndex);
  const own = geo.getAttribute('skinIndex') as THREE.BufferAttribute;
  const idx = new Uint16Array(own.count * 4);
  for (let i = 0; i < idx.length; i++) idx[i] = (own.array[i] as number) + skeleton.offset;
  out.setAttribute('skinIndex', new THREE.BufferAttribute(idx, 4));
  out.boundingSphere = geo.boundingSphere;
  out.boundingBox = geo.boundingBox;
  return out;
}

/** One creature kind on one floor: its draw, its skeleton, and its bodies in slot order. */
export interface IdleKind {
  mesh: SkinnedInstances;
  skel: TableSkeleton;
  skin: SkinnedGeom;
  bodies: IdleBody[];
  /** The bones the glued effects name, by name or index string, resolved once (fx.ts boneOf). */
  boneIndex: Map<string, number>;
}

/** A map creature: which kind draws it, in which slot, and where it stands. */
export interface IdleBody {
  inst: Instance;
  kind: IdleKind;
  slot: number;
  /** The body's placement — the object's world matrix (display scale included). */
  matrix: THREE.Matrix4;
  /** Whether its slot holds that placement (true) or nothing (`visible` mode, off screen). */
  shown: boolean;
}
