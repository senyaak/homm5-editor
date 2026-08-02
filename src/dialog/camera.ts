// The scene camera: an orbit pose, and the shot that moves between two of them.
//
// WHERE THE CONVENTION COMES FROM. A `DSceneCamera` stores a point it looks at
// (`Anchor`), a distance (`Rod`) and two angles, and the file says nothing about
// how the angles are measured. `tools/camera-shape.ts` settles it against the
// 4578 shipped poses whose stage terrain is at hand:
//
//   * PITCH IS FROM THE HORIZON, and the stored value is negative when the
//     camera is ABOVE what it films. Read that way, the eye on a close-up sits
//     a median 2.3 world units over the ground — head height, which is what a
//     conversation is shot at. Read from the zenith instead and the median
//     jumps to 9.0, a drone looking at the tops of everyone's heads; read with
//     the other sign and a tenth of all cameras end up underground.
//   * YAW IS WEAKLY PINNED. The arenas are flat, so nothing in the data pushes
//     back on where its zero is; measuring "the eye stays on the stage" only
//     separates the candidates by half a percent. `YAW_ZERO` below is the best
//     of them and is meant to be confirmed against the game's own dialog
//     replay the first time a frame is drawn. [~]
//
// Everything else here is arithmetic, and the flags a shot carries are read
// from what the corpus uses: `Circles` is 0 in 1253 of 1259 sets (orbiting
// right around something is rare), `UniformCameraMovement` is off in 1063 of
// them — so an EASED move is the norm and a linear one is the exception.

import { childText, find, parse } from '../format/xml.ts';
import type { XmlElement } from '../format/xml.ts';

/** A point in world units. A tile is 2 of them; so is a unit of terrain height. */
export interface Point3 { x: number; y: number; z: number }

/** A camera as the file stores it: a point, a distance and two angles. */
export interface OrbitPose {
  /** Distance from the anchor to the eye. */
  rod: number;
  /** Elevation, from the horizon. Negative when the camera is above the anchor. */
  pitch: number;
  /** Heading. Not normalized in the data — values run past 2π, which is how a
   *  set spells "turn the long way round". */
  yaw: number;
  roll: number;
  /** Vertical field of view in degrees; 35 in all but a handful of poses. */
  fov: number;
  anchor: Point3;
}

/** A move between two poses — one shot's camera work. */
export interface CameraShot {
  start: OrbitPose;
  finish: OrbitPose;
  /** Offsets added to each end's anchor, as the set writes them. */
  startDiff: Point3;
  finishDiff: Point3;
  /** Extra heading at each end, in radians. */
  startCorrectionRot: number;
  finishCorrectionRot: number;
  /** Move at a constant rate. Off in most sets, so easing is the default. */
  uniform: boolean;
  /** Hold the start heading instead of turning towards the finish. */
  ignoreYawDiff: boolean;
  /** Which way round the heading travels. */
  direction: number;
  /** Whole extra turns to make on the way. Zero in all but six shipped sets. */
  circles: number;
}

/**
 * Where yaw has its zero and which way it grows.
 *
 * Settled the way the pitch was — by asking the corpus a question only the
 * right answer survives. A shot exists to show somebody, so the actor whose
 * line it is should be INSIDE the frame; under a wrong yaw the eye swings to
 * the far side of the anchor and films the empty field. Over the 657 shots
 * that are aimed at something OTHER than the speaker (the ones that had to be
 * pointed, rather than orbiting the speaker and framing them whichever way
 * they face), the speaker lands inside the 35° frame:
 *
 *     yaw from Y -   24.5%      <- this one
 *     yaw from X -   14.3%
 *     yaw from Y +   13.1%
 *     yaw from X +    9.7%
 *
 * So zero heading points along +Y and the angle grows clockwise. The absolute
 * share is low because most of those shots are wide by intent — what matters
 * is that one reading frames the speaker twice as often as any other.
 */
export const YAW_ZERO: 'x' | 'y' = 'y';
export const YAW_SIGN = -1;

/**
 * Which end of the rod the eye is on — settled by looking, not by counting.
 *
 * This is yaw plus HALF A TURN, so none of the four candidates above could see
 * it: they are mirrorings, and every one of them leaves the eye on the same
 * side. Nor could the in-frame score, for a reason worth remembering — most
 * shots anchor ON their speaker, and a camera orbiting a point keeps whatever
 * is at that point in frame from either side of it. Both readings scored 22%.
 *
 * What separates them is WHICH SIDE of the actor you end up on. Read the other
 * way round, C1M1's opening films the backs of everybody's heads: Isabell's
 * hood for twelve shots running, the knight from behind his horse, and the
 * speaker's counterpart instead of the speaker. Read this way the same shots
 * are the frames the game plays — the mounted Isabell with her banner-bearer,
 * Godrik face-on, the demon lord over his nightmares.
 *
 * `tools/view-dialog-scene.ts` renders all 73 shots onto one contact sheet,
 * which is what made a 180° error obvious in one glance after two rounds of
 * measurement had missed it.
 */
const ROD_SIGN = -1;

const ZERO: Point3 = { x: 0, y: 0, z: 0 };

const num = (el: XmlElement | null, name: string): number => (el ? Number(childText(el, name)) || 0 : 0);
const point = (el: XmlElement | null): Point3 =>
  (el ? { x: num(el, 'x'), y: num(el, 'y'), z: num(el, 'z') } : { ...ZERO });

/** A camera document, read: the pose plus the two fields around it. */
export interface CameraDoc extends OrbitPose {
  /**
   * Whether the anchor is a place on the stage or an offset from whatever the
   * shot is about. False in 162 of 1209 shipped cameras, so the relative form
   * is real and rarer; nothing reads it yet.
   */
  absolute: boolean;
  /** A heading added to the pose. Non-zero in 156 cameras. */
  rot: number;
  /** Reference to the camera's name text, as written. */
  nameFileRef: string;
}

/** Parse a `<DSceneCamera>`. Throws when the text is not one. */
export function loadCamera(xmlText: string): CameraDoc {
  const root = find(parse(xmlText), 'DSceneCamera');
  if (!root) throw new Error('not a DSceneCamera document');
  const pos = find(root, 'Pos');
  return {
    rod: num(pos, 'Rod'),
    pitch: num(pos, 'Pitch'),
    yaw: num(pos, 'Yaw'),
    roll: num(pos, 'Roll'),
    fov: num(pos, 'FOV'),
    anchor: point(pos && find(pos, 'Anchor')),
    absolute: childText(root, 'Absolute').trim() === 'true',
    rot: num(root, 'Rot'),
    nameFileRef: find(root, 'NameFileRef')?.attrs.href ?? '',
  };
}

/** A camera set, read — the two ends as hrefs, plus how to travel between them. */
export interface CameraSetDoc {
  startCamera: string;
  finishCamera: string;
  startDiff: Point3;
  finishDiff: Point3;
  startCorrectionRot: number;
  finishCorrectionRot: number;
  uniform: boolean;
  ignoreYawDiff: boolean;
  direction: number;
  circles: number;
  nameFileRef: string;
}

/** Parse a `<DSceneCameraSet>`. Throws when the text is not one. */
export function loadCameraSet(xmlText: string): CameraSetDoc {
  const root = find(parse(xmlText), 'DSceneCameraSet');
  if (!root) throw new Error('not a DSceneCameraSet document');
  return {
    startCamera: find(root, 'StartCamera')?.attrs.href ?? '',
    finishCamera: find(root, 'FinishCamera')?.attrs.href ?? '',
    startDiff: point(find(root, 'StartCameraDiff')),
    finishDiff: point(find(root, 'FinishCameraDiff')),
    startCorrectionRot: num(root, 'StartCorrectionRot'),
    finishCorrectionRot: num(root, 'FinishCorrectionRot'),
    uniform: num(root, 'UniformCameraMovement') !== 0,
    ignoreYawDiff: num(root, 'IgnoreYawDiff') !== 0,
    direction: num(root, 'Direction'),
    circles: num(root, 'Circles'),
    nameFileRef: find(root, 'NameFileRef')?.attrs.href ?? '',
  };
}

/** A shot from a set and its two resolved ends. */
export function cameraShot(set: CameraSetDoc, start: OrbitPose, finish: OrbitPose): CameraShot {
  return {
    start,
    finish,
    startDiff: set.startDiff,
    finishDiff: set.finishDiff,
    startCorrectionRot: set.startCorrectionRot,
    finishCorrectionRot: set.finishCorrectionRot,
    uniform: set.uniform,
    ignoreYawDiff: set.ignoreYawDiff,
    direction: set.direction,
    circles: set.circles,
  };
}

/** The horizontal direction a heading points in. */
function heading(yaw: number): { x: number; y: number } {
  const a = YAW_SIGN * yaw;
  return YAW_ZERO === 'x'
    ? { x: Math.cos(a), y: Math.sin(a) }
    : { x: Math.sin(a), y: Math.cos(a) };
}

/** Where the camera itself sits, in world units. */
export function eyeOf(pose: OrbitPose): Point3 {
  const u = heading(pose.yaw);
  // Negative pitch means the eye is above the anchor — see the header.
  const up = -pose.pitch;
  const flat = Math.cos(up);
  const rod = pose.rod * ROD_SIGN;
  return {
    x: pose.anchor.x + rod * u.x * flat,
    y: pose.anchor.y + rod * u.y * flat,
    z: pose.anchor.z + pose.rod * Math.sin(up),
  };
}

/**
 * The point the camera looks at — the anchor, except when it is standing on it.
 *
 * Four of C1M1's shots have a rod of exactly zero: the eye IS the anchor, and
 * "look at the anchor" is then a direction of zero length, which leaves the
 * camera pointing wherever it last pointed. The angles still say which way it
 * faces, so the target is taken a unit along them instead.
 */
export function targetOf(pose: OrbitPose): Point3 {
  const eye = eyeOf(pose);
  if (Math.abs(pose.rod) > 1e-4) return { ...pose.anchor };
  // The same direction the rod runs in, a unit along: with the eye at the
  // anchor there is no rod to take it from, but the angles still say which way
  // the camera faces.
  const u = heading(pose.yaw);
  const up = -pose.pitch;
  const flat = Math.cos(up);
  return {
    x: eye.x - ROD_SIGN * u.x * flat,
    y: eye.y - ROD_SIGN * u.y * flat,
    z: eye.z - Math.sin(up),
  };
}

// WHAT `Absolute` TURNED OUT TO BE. Half of C1M1's second act is written with
// `Absolute=false` and an anchor of (0, 0, z), which reads as "somewhere near
// the origin" and looks like a bug waiting to be fixed. It is not: the SET that
// points at such a camera carries the placement, and carries it as the subject's
// own tile and facing —
//
//     C1M1D1Ga1  StartCameraDiff 83, 65   StartCorrectionRot 3.1811   (Godrik)
//     C1M1D1BA1  StartCameraDiff 81, 77   StartCorrectionRot 6.2043   (the demon)
//
// — so the pose is a framing ("this high, this far, at this angle to them") and
// the set says who it is of. `poseAt` already adds both. Placing the camera on
// the speaker HERE as well moves it twice and throws it off the map, which is
// what trying it did.

/**
 * The pose that puts the camera at `eye` looking at `anchor` — "use what I am
 * looking at", which is how a shot gets framed in the editor rather than typed.
 */
export function poseFrom(eye: Point3, anchor: Point3, fov = 35, roll = 0): OrbitPose {
  const dx = eye.x - anchor.x, dy = eye.y - anchor.y, dz = eye.z - anchor.z;
  const rod = Math.hypot(dx, dy, dz);
  const flat = Math.hypot(dx, dy);
  const up = Math.atan2(dz, flat);
  // The heading runs the way the rod does, which is back towards the anchor.
  const hx = ROD_SIGN * dx, hy = ROD_SIGN * dy;
  const a = YAW_ZERO === 'x' ? Math.atan2(hy, hx) : Math.atan2(hx, hy);
  return { rod, pitch: -up, yaw: YAW_SIGN * a, roll, fov, anchor: { ...anchor } };
}

/** Ease in and out — what a set does unless it asks for a constant rate. [~] */
const ease = (t: number): number => t * t * (3 - 2 * t);

const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const mixPoint = (a: Point3, b: Point3, t: number): Point3 =>
  ({ x: mix(a.x, b.x, t), y: mix(a.y, b.y, t), z: mix(a.z, b.z, t) });

/** The same angle, brought into (-π, π]. */
function shortest(a: number): number {
  const t = (a + Math.PI) % (2 * Math.PI);
  return (t <= 0 ? t + 2 * Math.PI : t) - Math.PI;
}

/**
 * The pose partway through a shot, `t` running 0 to 1.
 *
 * Yaw is the only axis with a choice in it: the two ends can be any number of
 * turns apart, `IgnoreYawDiff` says to hold the start heading, `Direction`
 * picks the way round, and `Circles` adds whole turns on top.
 *
 * `Direction` is the WAY THE YAW GOES, not "take the long way round": 1 means
 * the heading increases, 0 that it decreases. Measured over the 346 sets whose
 * two ends face differently at all, it agrees with the short way round in 290
 * of them — so most of the time it is only saying out loud what the two angles
 * already imply, and the 56 that disagree are the shots that really do swing
 * behind somebody. Read as a "go the other way" flag instead, all 150 sets with
 * Direction 1 and a heading that grows swung 330° the wrong way round: Agrael's
 * first cast, which in the game is a straight pull-back, orbited the demon.
 */
export function poseAt(shot: CameraShot, t: number): OrbitPose {
  const k = shot.uniform ? t : ease(Math.min(1, Math.max(0, t)));
  const from = shot.start, to = shot.finish;
  const startYaw = from.yaw + shot.startCorrectionRot;
  const finishYaw = to.yaw + shot.finishCorrectionRot;

  let yaw = startYaw;
  if (!shot.ignoreYawDiff) {
    let delta = shortest(finishYaw - startYaw);
    // Ends that face the same way do not turn, whatever the flag says.
    if (Math.abs(delta) > 1e-9) {
      if (shot.direction && delta < 0) delta += 2 * Math.PI;
      if (!shot.direction && delta > 0) delta -= 2 * Math.PI;
    }
    const way = shot.direction ? 1 : -1;
    yaw = startYaw + (delta + way * 2 * Math.PI * shot.circles) * k;
  }

  return {
    rod: mix(from.rod, to.rod, k),
    pitch: mix(from.pitch, to.pitch, k),
    yaw,
    roll: mix(from.roll, to.roll, k),
    fov: mix(from.fov, to.fov, k),
    anchor: mixPoint(
      addPoint(from.anchor, shot.startDiff),
      addPoint(to.anchor, shot.finishDiff),
      k,
    ),
  };
}

function addPoint(a: Point3, b: Point3 = ZERO): Point3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
