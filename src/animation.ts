// Skeletons and animations, read out of the Granny files in bin/animations.
//
// Where the pieces live is worth stating once, because it is not where the
// folder names suggest. `bin/Skeletons/*` is compressed with Oodle1 — all 2247
// files — but we do not need it: an animation file carries its OWN copy of the
// skeleton it animates, and those are stored uncompressed for the bulk of the
// library. So the editor reads one file per animation and gets bones, rest pose
// and curves together.
//
// The link from a map object to this data runs through XML: an object's Model
// holds an inline <Skeleton> with a uid, and an .(AnimSet).xdb lists animations
// by Kind ("idle00") pointing at a <BasicSkelAnim> whose uid names the file
// under bin/animations. See docs/ANIMATION_FORMAT.md.

import { GrannyFile } from './gr2.ts';
import type { GR2Ref, GrannyTransform, TypeMember } from './gr2.ts';

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
    const skelType = file.type(member.refType!);
    const bonesMember = file.member(skelType, 'Bones');
    if (!bonesMember) continue;
    const boneType = file.type(bonesMember.refType!);
    const bones: Bone[] = [];
    for (const boneRef of file.array(file.field(skelType, skelRef, 'Bones'), bonesMember.refType)) {
      bones.push({
        name: file.string(file.field(boneType, boneRef, 'Name')!) ?? '',
        parentIndex: file.int32(file.field(boneType, boneRef, 'ParentIndex')) ?? -1,
        rest: file.transform(file.field(boneType, boneRef, 'Transform'))!,
        inverseWorld: file.reals(file.field(boneType, boneRef, 'InverseWorldTransform'), 16) ?? [],
      });
    }
    out.push({ name: file.string(file.field(skelType, skelRef, 'Name')!) ?? '', bones });
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
  const animType = file.type(animMember.refType!);
  const groupMember = file.member(animType, 'TrackGroups');
  const groupType = groupMember ? file.type(groupMember.refType!) : [];
  const trackMember = groupMember ? file.member(groupType, 'TransformTracks') : null;
  const trackType = trackMember ? file.type(trackMember.refType!) : [];
  const curveMember = trackMember ? file.member(trackType, 'PositionCurve') : null;
  const curveType = curveMember ? file.type(curveMember.refType!) : [];

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
          name: file.string(file.field(trackType, trackRef, 'Name')!) ?? '',
          position: curve('PositionCurve'),
          orientation: curve('OrientationCurve'),
          scaleShear: curve('ScaleShearCurve'),
        });
      }
      tracks.sort((a, b) => a.name.localeCompare(b.name));
      groups.push({ name: file.string(file.field(groupType, groupRef, 'Name')!) ?? '', tracks });
    }
    out.push({
      name: file.string(file.field(animType, animRef, 'Name')!) ?? '',
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
