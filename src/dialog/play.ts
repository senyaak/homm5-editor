// A scene, prepared for playing — the one place that turns documents into it.
//
// Two things want a scene ready to run: the editor's window and the standalone
// page `tools/view-dialog-scene.ts` builds for looking at one without a window.
// If they each assembled it, they would drift, and the page would stop being
// evidence about what the editor does. So the assembly is here and they differ
// only in what they draw with.
//
// What "prepared" means: the stage as the renderer's own scene payload, the
// shots as camera paths already walked through src/dialog/camera.ts, and the
// actors as arena rigs carrying the clips their scene names.

import type { Assets } from '../game/assets.ts';
import { buildScene } from '../scene/scene.ts';
import type { AmbientData, FxInstancePayload, GeomData, Scene } from '../scene/payload.ts';
import { loadAmbient } from '../scene/ambient.ts';
import { TEXTURE_CAP } from '../scene/materials.ts';
import { effectDuration, modelsOfEffect, particlesOfEffect } from '../scene/object-effects.ts';
import type { EffectModel } from '../scene/object-effects.ts';
import { UNITS_PER_TILE as U } from '../scene/units.ts';
import { dirOf, resolveHref } from '../scene/xdb.ts';
import { actorRigs } from './actors.ts';
import type { ActorRig } from './actors.ts';
import { cameraShot, eyeOf, loadCamera, loadCameraSet, poseAt, targetOf } from './camera.ts';
import type { OrbitPose } from './camera.ts';
import { loadDialogScene } from './dialog-scene.ts';
import type { DialogScene, Point2 } from './dialog-scene.ts';
import { stageObjects } from './stage.ts';
import { walkAt } from './walk.ts';
import type { WalkPath } from './walk.ts';

/** One sample of a shot's camera move: where the eye is and what it looks at. */
export interface CameraSample {
  eye: [number, number, number];
  at: [number, number, number];
  fov: number;
}

/** A shot, as the player needs it. */
export interface ShotView {
  index: number;
  /**
   * Seconds from the top of the scene at which this shot begins.
   *
   * A scene is ONE clock, not a row of islands. Its shots schedule things
   * outside their own window all the time — of the 7296 cues and effects the
   * shipped scenes schedule, 1034 start after their shot has ended and 870
   * before it begins — because a delay is measured from the shot's start and
   * nothing stops it running past the end. Shot 6 of C1M1's opening lasts three
   * seconds and tells a marksman to shoot at 6.7: read one shot at a time, he
   * never shoots at all.
   */
  start: number;
  /** Seconds. What the shot lasts when its sound does not decide it. */
  duration: number;
  /** Reference to the spoken line's text file, as written. */
  text: string;
  /** Reference to the voice recording, as written. */
  sound: string;
  /** Who speaks — the link, which is also the key into `actors`. */
  speaker: string;
  /** The camera move, sampled; empty when the shot names no camera. */
  camera: CameraSample[];
  /** What the shot tells its actors to do: `delay` from its start, `at` from the scene's. */
  cues: Cue[];
  /** The light this shot asks for, or null to keep the scene's. */
  ambient: ShotLight;
  /**
   * Effects the shot fires at a place on the stage — not on an actor.
   *
   * This is the spellwork a scene is made of: the Prayer that lights up
   * Isabell's line of soldiers, the Bloodlust that turns Agrael's army red, the
   * ice bolt that lands on it. `pos` is already in world units, as the file
   * writes it, and `delay` is seconds from the start of the shot (it can be
   * NEGATIVE — an effect that begins before its line does).
   */
  effects: ShotEffectView[];
}

/** One thing a shot tells one actor to do. */
export interface Cue {
  /** Who — the key `actorRef` gives, which is what the rigs are keyed by. */
  actor: string;
  kind: string;
  /** Seconds from the shot's start, as the file writes it. */
  delay: number;
  /** Seconds from the scene's start. This is when it happens. */
  at: number;
  /** Where the cue carries them, when it is a walk. */
  walk?: WalkPath;
}

/** One firing of an effect inside a shot, resolved to what the renderer plays. */
export interface ShotEffectView {
  /** Seconds from the shot's start, as the file writes it — often negative. */
  delay: number;
  /** Seconds from the scene's start. This is when it actually goes off. */
  at: number;
  pos: [number, number, number];
  rot: number;
  /** Reference as written, for the inspector. */
  href: string;
  /** The effect's particle systems; empty when the chain does not resolve. */
  fx: FxInstancePayload[];
  /**
   * The effect's own geometry, placed and animated in its local frame.
   *
   * An effect is not only sparks: nine of the twelve C1M1's opening fires carry
   * `<Models>` — the glowing column a hero casts inside, the meteors of a
   * meteor shower (nineteen of them). Left out, the spells were the smoke
   * without the fire.
   */
  models: EffectModel[];
  /** Seconds a model of this effect stays up when it names no length of its own. */
  duration: number;
  /** True when the scene did not fire this — an actor's own clip did. */
  fromClip?: boolean;
}

/**
 * The light a shot is lit by, when it names one of its own.
 *
 * A scene names an ambient preset and 41 of C1M1's 73 shots override it — this
 * is how the picture changes with the story: the arena's daylight for Isabell's
 * army, `InfernoArena` for the demons, and the sky with them. Under the stage
 * map's own preset alone every shot of a scene looks the same.
 */
export type ShotLight = AmbientData | null;

/** An actor, placed and rigged. */
export interface ActorView extends ActorRig {
  /** Tile position, as the file stores it. */
  x: number;
  y: number;
  /**
   * World height to stand at.
   *
   * NOT from the file: an actor's stored z is 0, and the ground under their
   * tile is what the stage build worked out for the still copy of them. Placed
   * at the stored value they stand buried to the waist.
   */
  z: number;
  /** Facing, radians about Z. */
  rot: number;
  /**
   * The effect their IDLE clip carries — the fire an inferno soldier burns with.
   *
   * Always on, like the map's: a creature's flames do not wait to be cued, and
   * `clipEffectParticles` shows them on a frozen dragon too. A scene needs its
   * own copy because the actor's still adventure body — which is what carries
   * this on a map — is taken off the stage to make room for the arena rig, and
   * the fire went off the field with it.
   */
  idleFx: FxInstancePayload[];
}

export interface ScenePlay {
  scene: DialogScene;
  /** The stage, as the renderer's payload — stage map plus the scene's objects. */
  stage: Scene;
  shots: ShotView[];
  actors: ActorView[];
  /** Objects the stage builder could not mesh, by href. */
  skipped: string[];
}

export interface PlayOptions {
  /** Samples per camera move. 24 is smooth at any shot length worth watching. */
  samples?: number;
  texSize?: number;
  /** Samples per second for the baked clips. */
  fps?: number;
}

/** Follow a camera-set href to the two poses at its ends. */
function endsOf(data: Assets, scenePath: string, setHref: string): { move: ReturnType<typeof cameraShot> } | null {
  const setPath = resolveHref(dirOf(scenePath), setHref);
  const setText = data.text(setPath);
  if (!setText) return null;
  const set = loadCameraSet(setText);
  const pose = (href: string): OrbitPose | null => {
    const text = href && data.text(resolveHref(dirOf(setPath), href));
    return text ? loadCamera(text) : null;
  };
  const start = pose(set.startCamera), finish = pose(set.finishCamera);
  return start && finish ? { move: cameraShot(set, start, finish) } : null;
}

/**
 * Read a scene and everything needed to play it.
 *
 * `scenePath` is data-root relative, as the game addresses it; `data` is the
 * mounted chain it resolves through, so a scene unpacked into a workspace and
 * one shipped in the data tree are read the same way.
 */
export function buildScenePlay(data: Assets, scenePath: string, options: PlayOptions = {}): ScenePlay {
  const samples = options.samples ?? 24;
  const text = data.text(scenePath);
  if (!text) throw new Error(`no scene at ${scenePath}`);
  const scene = loadDialogScene(text);

  const objects = stageObjects(data, scenePath, scene);
  const built = buildScene(data, data.path(resolveHref(dirOf(scenePath), scene.stage)), {
    extraObjects: objects.map((o) => o.object),
    // A map animates its creatures only if the setting asks — it is an editing
    // surface and one draw call per creature is a real cost. A scene is a film:
    // the armies watching the two heroes argue are half of what is on screen,
    // and unanimated they stand in the bind pose with their arms straight out.
    animate: true,
    ...(options.fps ? { animationFps: options.fps } : {}),
    ...(options.texSize ? { texSize: options.texSize } : {}),
  });

  // An actor is on the stage twice at this point: the scene builder placed
  // their ADVENTURE model along with the props, and the rig below is the arena
  // one that can act. Only the second is wanted, so the still copy is taken out
  // of the payload here rather than left for each consumer to hide — its
  // height, which the builder worked out and the file does not carry, is kept.
  const rigs = actorRigs(data, scene, objects, {
    ...(options.fps ? { fps: options.fps } : {}),
    ...(options.texSize ? { texSize: options.texSize } : {}),
  });
  const actors: ActorView[] = rigs.map((rig) => {
    const placed = objects.find((o) => o.key === rig.key)?.object;
    const pos = placed?.pos ?? { x: 0, y: 0, z: 0 };
    // Matched on the model as well as the tile: an actor stands among the set
    // dressing, and by tile alone the first thing found on their square is as
    // likely to be the bush beside them — which would then be the thing taken
    // off the stage, leaving the still hero standing inside the rigged one.
    const model = placed?.shared?.split('#')[0] ?? null;
    let z = 0;
    for (const floor of built.scene.floors) {
      const at = floor.instances.findIndex((i) => i.x === pos.x && i.y === pos.y && i.shared === model);
      if (at < 0) continue;
      z = floor.instances[at]!.z;
      floor.instances.splice(at, 1);
      break;
    }
    // idleFx once the effect reader below exists — it needs the same cache the
    // shots' effects go through, so one fire is read once however many soldiers
    // are burning with it.
    return { ...rig, x: pos.x, y: pos.y, z, rot: placed?.rot ?? 0, idleFx: [] };
  });

  // A cue says WHICH clip either by name or by position in the actor's own
  // AnimSet, and the armies are cued by position only. The name wins where both
  // are written — an index beside a name is usually left over from an edit.
  const byKey = new Map(actors.map((a) => [a.key, a]));
  const clipOf = (key: string, name: string, index: number): string => {
    if (name) return name;
    const rig = byKey.get(key);
    return (index >= 0 && rig?.available[index]) || '';
  };

  // One effect is fired by many shots — eight copies of Prayer over a line of
  // soldiers, four of a succubus hit — and each is the same chain of documents
  // down to the same baked keys. Read once per href.
  const texSize = options.texSize ?? TEXTURE_CAP;
  const readXdb = (href: string): string | null => data.text(href.split('#')[0]!.replace(/^\//, ''));
  interface BuiltEffect { fx: FxInstancePayload[]; models: EffectModel[]; duration: number }
  const none: BuiltEffect = { fx: [], models: [], duration: 0 };
  const fxCache = new Map<string, BuiltEffect>();
  const effectOf = (href: string): BuiltEffect => {
    if (!href) return none;
    const known = fxCache.get(href);
    if (known) return known;
    const rel = resolveHref(dirOf(scenePath), href);
    const xml = data.text(rel);
    const doc = xml ? { xml, dir: dirOf(rel) } : null;
    const built = doc
      ? {
        fx: particlesOfEffect(doc, data, texSize),
        models: modelsOfEffect(doc, data, readXdb, texSize,
          { animate: true, ...(options.fps ? { fps: options.fps } : {}) }),
        duration: effectDuration(doc.xml),
      }
      : none;
    fxCache.set(href, built);
    return built;
  };

  for (const actor of actors) actor.idleFx = effectOf(actor.clipEffects['idle00'] ?? '').fx;

  // The scene's own light replaces the arena's on every floor: the stage is
  // borrowed scenery and the preset is part of the scene, not of the map.
  const lightCache = new Map<string, ShotLight>();
  const lightOf = (href: string): ShotLight => {
    if (!href) return null;
    if (!lightCache.has(href)) lightCache.set(href, loadAmbient(data, href.split('#')[0]!, { readXdb, texSize }));
    return lightCache.get(href) ?? null;
  };
  const sceneLight = lightOf(scene.ambientLight);
  if (sceneLight) for (const floor of built.scene.floors) floor.ambient = sceneLight;

  // Where each actor stands, for the effects their own clips bring with them.
  const standing = new Map(actors.map((a) => [a.key, a]));

  /** A walk as the file writes it, waiting for a start point and a clock. */
  interface Walk { tiles: Point2[]; angle: number }
  const pending: Array<{ cue: Cue; tiles: Point2[]; angle: number }> = [];

  let clock = 0;
  const shots: ShotView[] = scene.shots.map((shot) => {
    const start = clock;
    clock += shot.duration || 3;
    const ends = shot.newCameraSet ? endsOf(data, scenePath, shot.newCameraSet) : null;
    const camera: CameraSample[] = [];
    if (ends) {
      for (let i = 0; i <= samples; i++) {
        const pose = poseAt(ends.move, i / samples);
        const eye = eyeOf(pose);
        const at = targetOf(pose);
        camera.push({
          eye: [eye.x, eye.y, eye.z],
          at: [at.x, at.y, at.z],
          fov: pose.fov || 35,
        });
      }
    }
    const cues: ShotView['cues'] = [];
    const effects: ShotEffectView[] = shot.effects.map((e) => ({
      delay: e.delay,
      at: start + e.delay,
      pos: [e.pos.x, e.pos.y, e.pos.z] as [number, number, number],
      rot: e.rot,
      href: e.effect,
      ...effectOf(e.effect),
    }));
    const cue = (actor: string, name: string, index: number, delay: number, walk?: Walk): void => {
      const kind = clipOf(actor, name, index);
      if (!kind) return;
      const entry: Cue = { actor, kind, delay, at: start + delay };
      cues.push(entry);
      if (walk?.tiles.length) pending.push({ cue: entry, ...walk });
    };
    cue(shot.actor, shot.animName, shot.actorAnimationIndex, shot.animationDelay);
    for (const anim of shot.animations) {
      cue(anim.actor || shot.actor, anim.animName, anim.animationIndex, anim.animationDelay,
        { tiles: anim.movePoints, angle: anim.finalAngle });
    }
    return {
      index: shot.index,
      start,
      duration: shot.duration || 3,
      text: shot.text,
      sound: shot.sound,
      speaker: shot.actor,
      camera,
      cues,
      ambient: lightOf(shot.customAmbientLight),
      effects,
    };
  });

  // --- walks -----------------------------------------------------------------
  //
  // Resolved in TIME order and once: a walk starts wherever the actor is when
  // it begins, which is where the walk before it left them.

  const floor = built.scene.floors[0];
  /** The ground under a tile, sampled the way the scene builder samples it. */
  const groundAt = (x: number, y: number): number => {
    if (!floor) return 0;
    const V = floor.V;
    const ix = Math.max(0, Math.min(V - 1, Math.round(x)));
    const iy = Math.max(0, Math.min(V - 1, Math.round(y)));
    return floor.heights[iy * V + ix] ?? 0;
  };
  const world = (x: number, y: number): [number, number, number] =>
    [(x + 0.5) * U, (y + 0.5) * U, groundAt(x, y)];

  const here = new Map(actors.map((a) => [a.key, { x: a.x, y: a.y, rot: a.rot }]));
  for (const { cue, tiles, angle } of [...pending].sort((a, b) => a.cue.at - b.cue.at)) {
    const from = here.get(cue.actor);
    const rig = standing.get(cue.actor);
    if (!from || !rig) continue;
    const steps = [{ x: from.x, y: from.y }, ...tiles];
    const path = steps.map((p) => world(p.x, p.y));
    // The clip's own pace. Nothing else declares one, so a clip that does not
    // either (a `move` authored in place) walks at the corpus median instead of
    // teleporting: WRONG is visible and fixable, instant is neither.
    const speed = rig.clipSpeed[cue.kind] || 6;
    const times = [0];
    const headings: number[] = [];
    for (let i = 1; i < path.length; i++) {
      const dx = path[i]![0] - path[i - 1]![0], dy = path[i]![1] - path[i - 1]![1];
      times.push(times[i - 1]! + Math.hypot(dx, dy) / speed);
      // Facing, in the convention `<Rot>` uses: zero along +y, growing toward
      // +x. Measured off C1M1's two armies, which face each other across the
      // field — the Haven line at the low x end is written at 1.571 (+x) and
      // the Inferno line at 4.712 (−x).
      headings.push(Math.hypot(dx, dy) < 1e-6 ? (headings[i - 2] ?? from.rot) : Math.atan2(dx, dy));
    }
    // FinalAngle is DEGREES in the same convention: over the 157 walks whose
    // actor and cue both name a non-zero angle, the difference between the two
    // read that way piles up at zero (69 of them inside 15°) — the actor was
    // already placed facing where the walk leaves them.
    cue.walk = {
      path, times, headings,
      rot: angle ? angle * Math.PI / 180 : headings.at(-1) ?? from.rot,
    };
    const last = steps.at(-1)!;
    here.set(cue.actor, { x: last.x, y: last.y, rot: cue.walk.rot });
  }

  // --- the effects an actor's own clip brings ---------------------------------
  //
  // After the walks, because a caster who has walked casts from where they
  // ended up. Fired at the actor and at the cue's moment, through the same path
  // the scene's own CustomEffects take: one machine playing both is one machine
  // to get right.
  const placeAt = (key: string, t: number): { pos: [number, number, number]; rot: number } | null => {
    const rig = standing.get(key);
    if (!rig) return null;
    let out = { pos: world(rig.x, rig.y), rot: rig.rot };
    let last = -Infinity;
    for (const shot of shots) {
      for (const c of shot.cues) {
        if (c.actor !== key || !c.walk || c.at > t || c.at < last) continue;
        last = c.at;
        out = walkAt(c.walk, t - c.at);
      }
    }
    return out;
  };
  for (const shot of shots) {
    for (const c of shot.cues) {
      const href = standing.get(c.actor)?.clipEffects[c.kind];
      const on = href ? placeAt(c.actor, c.at) : null;
      if (!href || !on) continue;
      shot.effects.push({
        delay: c.delay, at: c.at, pos: on.pos, rot: on.rot, href, fromClip: true, ...effectOf(href),
      });
    }
  }

  const skipped = objects
    .filter((o) => !o.object.shared || built.resolver.resolve(o.object.shared) < 0)
    .map((o) => o.href);

  return { scene, stage: built.scene, shots, actors, skipped };
}
