// Skeletons and animations, read out of the Granny files in bin/animations.
//
// Where the pieces live is worth stating once, because it is not where the
// folder names suggest: `bin/Skeletons/*` is not read at all. An animation file
// carries its OWN copy of the skeleton it animates, so one file gives bones,
// rest pose and curves together — and the bulk of them are stored uncompressed,
// while every standalone skeleton is Oodle1-packed (src/oodle.ts decodes most,
// but not all, of that).
//
// The link from a map object to this data runs through XML: an object's Model
// holds an inline <Skeleton> with a uid, and an .(AnimSet).xdb lists animations
// by Kind ("idle00") pointing at a <BasicSkelAnim> whose uid names the file
// under bin/animations. See docs/ANIMATION_FORMAT.md.

import { GrannyFile } from '../format/gr2.ts';
import type { GR2Ref, GrannyTransform, TypeMember } from '../format/gr2.ts';
import type { SkinBinding } from './geometry.ts';

/** One bone: its rest transform, and its parent's index (-1 for the root). */
export interface Bone {
  name: string;
  parentIndex: number;
  rest: GrannyTransform;
  /** The file's own inverse bind matrix, row-major, 16 floats. */
  inverseWorld: number[];
}

export interface Skeleton {
  name: string;
  bones: Bone[];
}

/**
 * An animation curve: `knots` are times in seconds, `controls` holds `dim`
 * values per knot (3 for a position, 4 for a quaternion, 9 for scale-shear).
 */
export interface Curve {
  degree: number;
  knots: Float32Array;
  controls: Float32Array;
  /** Values per knot; 0 when the curve is empty. */
  dim: number;
}

/** One bone's channels within a track group. */
export interface TransformTrack {
  name: string;
  position: Curve;
  orientation: Curve;
  scaleShear: Curve;
}

export interface TrackGroup {
  name: string;
  tracks: TransformTrack[];
}

export interface Animation {
  name: string;
  /** Seconds. */
  duration: number;
  /** Seconds between the frames the clip was authored at. */
  timeStep: number;
  groups: TrackGroup[];
}

const EMPTY_CURVE: Curve = { degree: 0, knots: new Float32Array(0), controls: new Float32Array(0), dim: 0 };

/** Read a `ReferenceToArray` of Real32 as a flat array of floats. */
function realArray(file: GrannyFile, ref: GR2Ref | null): Float32Array {
  const d = ref && file.data(ref);
  if (!d) return new Float32Array(0);
  const count = d.readInt32LE(ref!.off);
  const first = file.pointer({ sec: ref!.sec, off: ref!.off + 4 });
  if (!first || count <= 0) return new Float32Array(0);
  const src = file.data(first);
  if (!src) return new Float32Array(0);
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) out[i] = src.readFloatLE(first.off + i * 4);
  return out;
}

/** The skeletons a Granny file carries (an animation file holds exactly one). */
export function readSkeletons(file: GrannyFile): Skeleton[] {
  const rootType = file.type(file.rootType);
  const member = file.member(rootType, 'Skeletons');
  if (!member) return [];
  const out: Skeleton[] = [];
  for (const skelRef of file.refArray(file.field(rootType, file.rootObject, 'Skeletons'))) {
    const skelType = file.type(member.refType);
    const bonesMember = file.member(skelType, 'Bones');
    if (!bonesMember) continue;
    const boneType = file.type(bonesMember.refType);
    const bones: Bone[] = [];
    for (const boneRef of file.array(file.field(skelType, skelRef, 'Bones'), bonesMember.refType)) {
      bones.push({
        name: file.string(file.field(boneType, boneRef, 'Name')) ?? '',
        parentIndex: file.int32(file.field(boneType, boneRef, 'ParentIndex')) ?? -1,
        // A bone with no readable Transform stands at the origin rather than
        // taking the whole skeleton down with it.
        rest: file.transform(file.field(boneType, boneRef, 'Transform'))
          ?? { flags: 0, position: [0, 0, 0], orientation: [0, 0, 0, 1], scaleShear: [1, 0, 0, 0, 1, 0, 0, 0, 1] },
        inverseWorld: file.reals(file.field(boneType, boneRef, 'InverseWorldTransform'), 16) ?? [],
      });
    }
    out.push({ name: file.string(file.field(skelType, skelRef, 'Name')) ?? '', bones });
  }
  return out;
}

/** Read one inline curve (Degree + Knots + Controls) at `ref`. */
function readCurve(file: GrannyFile, curveType: TypeMember[], ref: GR2Ref): Curve {
  const degree = file.int32(file.field(curveType, ref, 'Degree')) ?? 0;
  const knots = realArray(file, file.field(curveType, ref, 'Knots'));
  const controls = realArray(file, file.field(curveType, ref, 'Controls'));
  if (!knots.length || !controls.length) return EMPTY_CURVE;
  return { degree, knots, controls, dim: Math.floor(controls.length / knots.length) };
}

/** The animations a Granny file carries. */
export function readAnimations(file: GrannyFile): Animation[] {
  const rootType = file.type(file.rootType);
  const animMember = file.member(rootType, 'Animations');
  if (!animMember) return [];
  const animType = file.type(animMember.refType);
  const groupMember = file.member(animType, 'TrackGroups');
  const groupType = groupMember ? file.type(groupMember.refType) : [];
  const trackMember = groupMember ? file.member(groupType, 'TransformTracks') : null;
  const trackType = trackMember ? file.type(trackMember.refType) : [];
  const curveMember = trackMember ? file.member(trackType, 'PositionCurve') : null;
  const curveType = curveMember ? file.type(curveMember.refType) : [];

  const out: Animation[] = [];
  for (const animRef of file.refArray(file.field(rootType, file.rootObject, 'Animations'))) {
    const groups: TrackGroup[] = [];
    for (const groupRef of file.refArray(file.field(animType, animRef, 'TrackGroups'))) {
      const tracks: TransformTrack[] = [];
      for (const trackRef of file.array(file.field(groupType, groupRef, 'TransformTracks'), trackMember!.refType)) {
        const curve = (name: string): Curve => {
          const at = file.field(trackType, trackRef, name);
          return at ? readCurve(file, curveType, at) : EMPTY_CURVE;
        };
        tracks.push({
          name: file.string(file.field(trackType, trackRef, 'Name')) ?? '',
          position: curve('PositionCurve'),
          orientation: curve('OrientationCurve'),
          scaleShear: curve('ScaleShearCurve'),
        });
      }
      tracks.sort((a, b) => a.name.localeCompare(b.name));
      groups.push({ name: file.string(file.field(groupType, groupRef, 'Name')) ?? '', tracks });
    }
    out.push({
      name: file.string(file.field(animType, animRef, 'Name')) ?? '',
      duration: file.real32(file.field(animType, animRef, 'Duration')) ?? 0,
      timeStep: file.real32(file.field(animType, animRef, 'TimeStep')) ?? 0,
      groups,
    });
  }
  return out;
}

// --- sampling ----------------------------------------------------------------

/**
 * The value of a curve at time `t`, written into `out`.
 *
 * Degree 0 (a channel that never moves) and degree 1 (straight lines between
 * keys) are exact. Degree 2 is a quadratic B-spline: the controls are NOT
 * points the curve passes through, so it is evaluated with de Boor over a knot
 * vector clamped at both ends. Rotations are what use it, and a quaternion
 * blended this way needs renormalizing afterwards — see `sampleQuaternion`.
 */
export function sampleCurve(curve: Curve, t: number, out: number[]): number[] {
  const { knots, controls, dim, degree } = curve;
  if (!dim) return out;
  const n = knots.length;
  if (n === 1 || degree === 0) {
    for (let c = 0; c < dim; c++) out[c] = controls[c]!;
    return out;
  }
  // Clamp outside the authored range rather than extrapolating: a curve whose
  // last knot falls short of the clip's duration should hold, not drift.
  if (t <= knots[0]!) {
    for (let c = 0; c < dim; c++) out[c] = controls[c]!;
    return out;
  }
  if (t >= knots[n - 1]!) {
    for (let c = 0; c < dim; c++) out[c] = controls[(n - 1) * dim + c]!;
    return out;
  }
  let i = 1;
  while (i < n - 1 && knots[i]! <= t) i++;
  const t0 = knots[i - 1]!, t1 = knots[i]!;
  const u = t1 > t0 ? (t - t0) / (t1 - t0) : 0;

  if (degree <= 1) {
    for (let c = 0; c < dim; c++) {
      const a = controls[(i - 1) * dim + c]!, b = controls[i * dim + c]!;
      out[c] = a + (b - a) * u;
    }
    return out;
  }

  // Quadratic (and up): de Boor on the span, with the ends clamped by repeating
  // the first and last control point, which is what a knot count equal to the
  // control count implies.
  const at = (k: number, c: number): number =>
    controls[Math.min(Math.max(k, 0), n - 1) * dim + c]!;
  for (let c = 0; c < dim; c++) {
    const p0 = at(i - 2, c), p1 = at(i - 1, c), p2 = at(i, c);
    // Quadratic B-spline basis over the span, in Bernstein form.
    const a = (p0 + p1) / 2, b = p1, d = (p1 + p2) / 2;
    const inv = 1 - u;
    out[c] = inv * inv * a + 2 * inv * u * b + u * u * d;
  }
  return out;
}

/** Sample a 4-wide curve as a unit quaternion (x, y, z, w). */
export function sampleQuaternion(curve: Curve, t: number, out: number[]): number[] {
  sampleCurve(curve, t, out);
  const l = Math.hypot(out[0]!, out[1]!, out[2]!, out[3]!);
  if (l > 1e-8) for (let c = 0; c < 4; c++) out[c]! /= l;
  else { out[0] = 0; out[1] = 0; out[2] = 0; out[3] = 1; }
  return out;
}

// --- matrices ----------------------------------------------------------------
//
// Granny stores 4x4s row-major with the translation in the LAST ROW, i.e. the
// row-vector convention (v' = v * M) rather than the column-vector one graphics
// code usually assumes. Composition therefore runs child-first: a bone's world
// matrix is its own local matrix times its parent's, not the other way round.
// `checkSkeleton` below is what pins this down — it is a numeric check against
// the file's own InverseWorldTransform, so the convention is measured, not
// assumed.

/** A bone's local matrix from its transform, row-major, translation in row 3. */
export function transformToMatrix(t: GrannyTransform): number[] {
  const [x, y, z, w] = t.orientation;
  // Row-vector rotation matrix (the transpose of the column-vector form).
  const r = [
    1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w),
    2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w),
    2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y),
  ];
  const s = t.scaleShear;
  // 3x3 = scaleShear * rotation, so scale and shear apply before the rotation.
  const m: number[] = new Array(16).fill(0);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      m[row * 4 + col] = s[row * 3]! * r[col]! + s[row * 3 + 1]! * r[3 + col]! + s[row * 3 + 2]! * r[6 + col]!;
    }
  }
  m[12] = t.position[0]; m[13] = t.position[1]; m[14] = t.position[2]; m[15] = 1;
  return m;
}

/** Row-vector product: apply `a`, then `b`. */
export function multiplyMatrix(a: number[], b: number[]): number[] {
  const out = new Array<number>(16).fill(0);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[r * 4 + k]! * b[k * 4 + c]!;
      out[r * 4 + c] = sum;
    }
  }
  return out;
}

/** General 4x4 inverse; null when the matrix is singular. */
export function invertMatrix(m: number[]): number[] | null {
  // Gauss-Jordan on [m | I]; a bone matrix is small and this runs once per bone.
  const a = m.slice();
  const inv = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (let col = 0; col < 4; col++) {
    let pivot = col;
    for (let r = col + 1; r < 4; r++) if (Math.abs(a[r * 4 + col]!) > Math.abs(a[pivot * 4 + col]!)) pivot = r;
    if (Math.abs(a[pivot * 4 + col]!) < 1e-12) return null;
    if (pivot !== col) {
      for (let k = 0; k < 4; k++) {
        [a[col * 4 + k], a[pivot * 4 + k]] = [a[pivot * 4 + k]!, a[col * 4 + k]!];
        [inv[col * 4 + k], inv[pivot * 4 + k]] = [inv[pivot * 4 + k]!, inv[col * 4 + k]!];
      }
    }
    const d = a[col * 4 + col]!;
    for (let k = 0; k < 4; k++) { a[col * 4 + k]! /= d; inv[col * 4 + k]! /= d; }
    for (let r = 0; r < 4; r++) {
      if (r === col) continue;
      const f = a[r * 4 + col]!;
      if (!f) continue;
      for (let k = 0; k < 4; k++) { a[r * 4 + k]! -= f * a[col * 4 + k]!; inv[r * 4 + k]! -= f * inv[col * 4 + k]!; }
    }
  }
  return inv;
}

/** Each bone's rest world matrix, parents composed in. */
export function restWorldMatrices(skeleton: Skeleton): number[][] {
  const world: number[][] = [];
  skeleton.bones.forEach((bone, i) => {
    const local = transformToMatrix(bone.rest);
    const parent = bone.parentIndex >= 0 && bone.parentIndex < i ? world[bone.parentIndex] : null;
    world.push(parent ? multiplyMatrix(local, parent) : local);
  });
  return world;
}

/** The inverse bind matrices to skin with, computed from the rest pose itself. */
export function inverseBindMatrices(skeleton: Skeleton): number[][] {
  return restWorldMatrices(skeleton).map((m) => invertMatrix(m) ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

/**
 * How consistently our composed rest pose reproduces the file's own inverse
 * bind matrices — the oracle for the whole skeleton read.
 *
 * A bone stores both its local transform and, redundantly, the inverse of its
 * world matrix, so composing the rest pose and inverting it should give the
 * stored matrix back. It usually does, exactly. But some files — a hero with
 * cloth and a tail was the first one caught — carry inverse binds that sit in a
 * frame rotated -90 degrees about X relative to the bone transforms: the
 * exporter's root correction, recorded in the bind matrices while the root
 * bone's own transform stays identity.
 *
 * That correction is a property of the FILE, not of our reading, and it cancels
 * out: the editor computes its own inverse binds from the same rest pose it
 * animates (`inverseBindMatrices`), so both sides live in the same frame and a
 * clip at rest is the identity either way. What must not vary is the correction
 * itself — one constant frame for the whole skeleton. So that is what this
 * measures: `frame` is the difference for the first bone, `worst` is how far
 * any other bone strays from it. A wrong parent order, quaternion convention or
 * row/column choice would make the bones disagree with EACH OTHER, and `worst`
 * would be of order 1 rather than float noise.
 */
export function checkSkeleton(skeleton: Skeleton): { worst: number; frame: number[] | null } {
  const world = restWorldMatrices(skeleton);
  let frame: number[] | null = null;
  let worst = 0;
  skeleton.bones.forEach((bone, i) => {
    if (bone.inverseWorld.length !== 16) return;
    const theirWorld = invertMatrix(bone.inverseWorld);
    const ourInverse = invertMatrix(world[i]!);
    if (!theirWorld || !ourInverse) { worst = Infinity; return; }
    // ourWorld⁻¹ · theirWorld — the frame their bind matrices are expressed in.
    const f = multiplyMatrix(ourInverse, theirWorld);
    if (!frame) { frame = f; return; }
    for (let k = 0; k < 16; k++) worst = Math.max(worst, Math.abs(f[k]! - frame[k]!));
  });
  return { worst, frame };
}

/**
 * Every bone's world matrix at `time`, animated.
 *
 * A track drives a bone BY NAME, and it does not have to drive all three
 * channels: an idle usually animates rotation only, and a bone with no track at
 * all (a prop, a weapon) still has to be placed. So each channel falls back to
 * the bone's own rest value rather than to an identity, which would collapse
 * the untracked half of the skeleton onto the origin.
 */
export function poseWorldMatrices(skeleton: Skeleton, animation: Animation | null, time: number): number[][] {
  const tracks = new Map<string, TransformTrack>();
  for (const group of animation?.groups ?? []) {
    for (const track of group.tracks) tracks.set(track.name, track);
  }
  const scratch: number[] = [];
  const world: number[][] = [];
  skeleton.bones.forEach((bone, i) => {
    const track = tracks.get(bone.name);
    const rest = bone.rest;
    const local = transformToMatrix(track
      ? {
        flags: rest.flags,
        position: track.position.dim === 3
          ? (sampleCurve(track.position, time, scratch).slice(0, 3) as [number, number, number])
          : rest.position,
        orientation: track.orientation.dim === 4
          ? (sampleQuaternion(track.orientation, time, scratch).slice(0, 4) as [number, number, number, number])
          : rest.orientation,
        scaleShear: track.scaleShear.dim === 9 ? sampleCurve(track.scaleShear, time, scratch).slice(0, 9) : rest.scaleShear,
      }
      : rest);
    // Parents come first in the bone list (checked across the library), so the
    // parent's world matrix is already built by the time a child needs it.
    const parent = bone.parentIndex >= 0 && bone.parentIndex < i ? world[bone.parentIndex] : null;
    world.push(parent ? multiplyMatrix(local, parent) : local);
  });
  return world;
}

/**
 * The matrices to skin with at `time`: each bone's inverse bind times its posed
 * world matrix. At the rest pose these are exactly the identity, which is the
 * property the skinning test leans on.
 */
export function skinMatrices(skeleton: Skeleton, animation: Animation | null, time: number): number[][] {
  const inverseBind = inverseBindMatrices(skeleton);
  const posed = poseWorldMatrices(skeleton, animation, time);
  return posed.map((world, i) => multiplyMatrix(inverseBind[i]!, world));
}

/**
 * Skin positions on the CPU: four weighted bone matrices per vertex.
 *
 * The renderer does this on the GPU; this exists for tests and for measuring,
 * because a skinned mesh that is subtly wrong still renders something.
 */
export function skinPositions(positions: Float32Array, skin: SkinBinding, matrices: number[][]): Float32Array {
  const out = new Float32Array(positions.length);
  const count = positions.length / 3;
  for (let v = 0; v < count; v++) {
    const x = positions[v * 3]!, y = positions[v * 3 + 1]!, z = positions[v * 3 + 2]!;
    let ox = 0, oy = 0, oz = 0;
    for (let k = 0; k < 4; k++) {
      const w = skin.weights[v * 4 + k]!;
      if (!w) continue;
      const m = matrices[skin.indices[v * 4 + k]!];
      if (!m) continue;
      // Row-vector convention: the point is a row, so translation is row 3.
      ox += w * (x * m[0]! + y * m[4]! + z * m[8]! + m[12]!);
      oy += w * (x * m[1]! + y * m[5]! + z * m[9]! + m[13]!);
      oz += w * (x * m[2]! + y * m[6]! + z * m[10]! + m[14]!);
    }
    out[v * 3] = ox; out[v * 3 + 1] = oy; out[v * 3 + 2] = oz;
  }
  return out;
}

/** A clip flattened to even samples, ready to hand a renderer as plain JSON. */
export interface BakedClip {
  /** Seconds. */
  duration: number;
  /** Sample times, evenly spaced, starting at 0. */
  times: number[];
  /** Per bone, in skeleton order: 4 floats per sample (x, y, z, w). */
  rotations: number[][];
  /** Per bone: 3 floats per sample. */
  positions: number[][];
}

/**
 * Sample an animation onto an even grid.
 *
 * The curves are B-splines with uneven knots, which no renderer wants to
 * evaluate; baking them here keeps that arithmetic in one place, next to the
 * format notes, and leaves the renderer with nothing but linear interpolation
 * between samples. 15 per second is deliberate and not the clip's own rate:
 * these are idle loops on a map seen from above, the curves carry ~25 keys a
 * second, and sampling at the authored 60 fps quadruples the payload for
 * motion nobody can see at that distance.
 *
 * Untracked bones are baked too, so the renderer can drive every bone from one
 * clip rather than special-casing the gaps. The value they hold comes from the
 * ANIMATION's own skeleton (`poseRest`) when one is given, not from `skeleton`:
 * a channel the clip does not drive holds the stance the clip was AUTHORED in,
 * which is what that skeleton records. The two rests differ on real assets —
 * the DemonLord path props (Cross01 and its five siblings) are meshed and
 * skinned LYING FLAT, their model skeleton's rest is the STANDING pose, and
 * their idle drives no channel at all: the engine shows them through the
 * inverse bind (flat) times the clip's own stance (identity) — upright. Baked
 * against the model's rest instead, inverse bind and pose cancelled and every
 * cross on the field lay invisible under the grass.
 */
export function bakeClip(skeleton: Skeleton, animation: Animation, fps = 15, poseRest?: Skeleton): BakedClip {
  const tracks = new Map<string, TransformTrack>();
  for (const group of animation.groups) {
    for (const track of group.tracks) tracks.set(track.name, track);
  }
  const stance = new Map<string, GrannyTransform>();
  for (const bone of poseRest?.bones ?? []) stance.set(bone.name, bone.rest);
  const count = Math.max(2, Math.ceil(animation.duration * fps) + 1);
  const times: number[] = [];
  for (let i = 0; i < count; i++) times.push(animation.duration * i / (count - 1));

  const scratch: number[] = [];
  const rotations: number[][] = [];
  const positions: number[][] = [];
  for (const bone of skeleton.bones) {
    const track = tracks.get(bone.name);
    const rest = stance.get(bone.name) ?? bone.rest;
    const rot: number[] = [];
    const pos: number[] = [];
    for (const t of times) {
      if (track && track.orientation.dim === 4) {
        sampleQuaternion(track.orientation, t, scratch);
        rot.push(scratch[0]!, scratch[1]!, scratch[2]!, scratch[3]!);
      } else rot.push(...rest.orientation);
      if (track && track.position.dim === 3) {
        sampleCurve(track.position, t, scratch);
        pos.push(scratch[0]!, scratch[1]!, scratch[2]!);
      } else pos.push(...rest.position);
    }
    rotations.push(rot);
    positions.push(pos);
  }
  return { duration: animation.duration, times, rotations, positions };
}

/** Whether a frame matrix is the identity, within float32 noise. */
export function isIdentityFrame(frame: number[] | null, tolerance = 1e-4): boolean {
  if (!frame) return true;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      if (Math.abs(frame[r * 4 + c]! - (r === c ? 1 : 0)) > tolerance) return false;
    }
  }
  return true;
}
