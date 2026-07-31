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
 * Where yaw has its zero and which way it grows. [~]
 *
 * The one thing the corpus could not settle — see the header. Kept as a pair of
 * constants rather than baked into the formula so that confirming it against a
 * rendered frame is a one-line change, not a hunt.
 */
export const YAW_ZERO: 'x' | 'y' = 'x';
export const YAW_SIGN = 1;

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
  return {
    x: pose.anchor.x + pose.rod * u.x * flat,
    y: pose.anchor.y + pose.rod * u.y * flat,
    z: pose.anchor.z + pose.rod * Math.sin(up),
  };
}

/**
 * The pose that puts the camera at `eye` looking at `anchor` — "use what I am
 * looking at", which is how a shot gets framed in the editor rather than typed.
 */
export function poseFrom(eye: Point3, anchor: Point3, fov = 35, roll = 0): OrbitPose {
  const dx = eye.x - anchor.x, dy = eye.y - anchor.y, dz = eye.z - anchor.z;
  const rod = Math.hypot(dx, dy, dz);
  const flat = Math.hypot(dx, dy);
  const up = Math.atan2(dz, flat);
  const a = YAW_ZERO === 'x' ? Math.atan2(dy, dx) : Math.atan2(dx, dy);
  return { rod, pitch: -up, yaw: YAW_SIGN * a, roll, fov, anchor: { ...anchor } };
}

/** Ease in and out — what a set does unless it asks for a constant rate. [~] */
const ease = (t: number): number => t * t * (3 - 2 * t);

const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const mixPoint = (a: Point3, b: Point3, t: number): Point3 =>
  ({ x: mix(a.x, b.x, t), y: mix(a.y, b.y, t), z: mix(a.z, b.z, t) });

/**
 * The pose partway through a shot, `t` running 0 to 1.
 *
 * Yaw is the only axis with a choice in it: the two ends can be any number of
 * turns apart, `IgnoreYawDiff` says to hold the start heading, `Direction`
 * picks the way round, and `Circles` adds whole turns on top.
 */
export function poseAt(shot: CameraShot, t: number): OrbitPose {
  const k = shot.uniform ? t : ease(Math.min(1, Math.max(0, t)));
  const from = shot.start, to = shot.finish;
  const startYaw = from.yaw + shot.startCorrectionRot;
  const finishYaw = to.yaw + shot.finishCorrectionRot;

  let yaw = startYaw;
  if (!shot.ignoreYawDiff) {
    let delta = finishYaw - startYaw;
    // Turn the short way unless the set asked for the other one.
    if (shot.direction) delta -= Math.sign(delta || 1) * 2 * Math.PI;
    yaw = startYaw + (delta + Math.sign(delta || 1) * 2 * Math.PI * shot.circles) * k;
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
