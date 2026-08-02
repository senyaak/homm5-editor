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
import { modelsOfEffect, particlesOfEffect } from '../scene/object-effects.ts';
import { dirOf, resolveHref } from '../scene/xdb.ts';
import { actorRigs } from './actors.ts';
import type { ActorRig } from './actors.ts';
import { cameraShot, eyeOf, loadCamera, loadCameraSet, poseAt, targetOf } from './camera.ts';
import type { OrbitPose } from './camera.ts';
import { loadDialogScene } from './dialog-scene.ts';
import type { DialogScene } from './dialog-scene.ts';
import { stageObjects } from './stage.ts';

/** One sample of a shot's camera move: where the eye is and what it looks at. */
export interface CameraSample {
  eye: [number, number, number];
  at: [number, number, number];
  fov: number;
}

/** A shot, as the player needs it. */
export interface ShotView {
  index: number;
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
  /** What each actor does during the shot, offset from its start. */
  cues: Array<{ actor: string; kind: string; delay: number }>;
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

/** One firing of an effect inside a shot, resolved to what the renderer plays. */
export interface ShotEffectView {
  delay: number;
  pos: [number, number, number];
  rot: number;
  /** Reference as written, for the inspector. */
  href: string;
  /** The effect's particle systems; empty when the chain does not resolve. */
  fx: FxInstancePayload[];
  /**
   * The effect's own geometry, placed in its local frame.
   *
   * An effect is not only sparks: nine of the twelve C1M1's opening fires carry
   * `<Models>` — the glowing column a hero casts inside, the meteors of a
   * meteor shower (nineteen of them). Left out, the spells were the smoke
   * without the fire.
   */
  models: GeomData[];
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
    const placed = objects.find((o) => o.href === rig.href)?.object;
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
    return { ...rig, x: pos.x, y: pos.y, z, rot: placed?.rot ?? 0 };
  });

  // A cue names its actor either by the same href the sentence used or by the
  // element id — `#xpointer(id(item_48F7…)/AdvMapHero)` — which is the only way
  // to tell two inline actors apart, since their hrefs are identical. Both
  // spellings are folded onto the actor's href, the key everything else uses.
  const byId = new Map<string, string>();
  for (const actor of actors) if (actor.id) byId.set(actor.id, actor.href);
  const actorKey = (link: string): string => {
    const id = /#xpointer\(id\(([^)]+)\)/.exec(link)?.[1];
    return (id && byId.get(id)) || link;
  };

  // A cue says WHICH clip either by name or by position in the actor's own
  // AnimSet, and the armies are cued by position only. The name wins where both
  // are written — an index beside a name is usually left over from an edit.
  const byHref = new Map(actors.map((a) => [a.href, a]));
  const clipOf = (key: string, name: string, index: number): string => {
    if (name) return name;
    const rig = byHref.get(key);
    return (index >= 0 && rig?.available[index]) || '';
  };

  // One effect is fired by many shots — eight copies of Prayer over a line of
  // soldiers, four of a succubus hit — and each is the same chain of documents
  // down to the same baked keys. Read once per href.
  const texSize = options.texSize ?? 128;
  const readXdb = (href: string): string | null => data.text(href.split('#')[0]!.replace(/^\//, ''));
  const fxCache = new Map<string, { fx: FxInstancePayload[]; models: GeomData[] }>();
  const effectOf = (href: string): { fx: FxInstancePayload[]; models: GeomData[] } => {
    if (!href) return { fx: [], models: [] };
    const known = fxCache.get(href);
    if (known) return known;
    const rel = resolveHref(dirOf(scenePath), href);
    const xml = data.text(rel);
    const doc = xml ? { xml, dir: dirOf(rel) } : null;
    const built = doc
      ? { fx: particlesOfEffect(doc, data, texSize), models: modelsOfEffect(doc, data, readXdb, texSize) }
      : { fx: [], models: [] };
    fxCache.set(href, built);
    return built;
  };

  // The scene's own light replaces the arena's on every floor: the stage is
  // borrowed scenery and the preset is part of the scene, not of the map.
  const lightCache = new Map<string, ShotLight>();
  const lightOf = (href: string): ShotLight => {
    if (!href) return null;
    if (!lightCache.has(href)) lightCache.set(href, loadAmbient(data, href.split('#')[0]!));
    return lightCache.get(href) ?? null;
  };
  const sceneLight = lightOf(scene.ambientLight);
  if (sceneLight) for (const floor of built.scene.floors) floor.ambient = sceneLight;

  const shots: ShotView[] = scene.shots.map((shot) => {
    const speaker = shot.heroLink || shot.monsterLink;
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
    const cue = (link: string, name: string, index: number, delay: number): void => {
      const actor = actorKey(link);
      const kind = clipOf(actor, name, index);
      if (kind) cues.push({ actor, kind, delay });
    };
    cue(speaker, shot.animName, shot.actorAnimationIndex, shot.animationDelay);
    for (const anim of shot.animations) {
      cue(anim.heroLink || anim.monsterLink || speaker, anim.animName, anim.animationIndex, anim.animationDelay);
    }
    return {
      index: shot.index,
      duration: shot.duration || 3,
      text: shot.text,
      sound: shot.sound,
      speaker,
      camera,
      cues,
      ambient: lightOf(shot.customAmbientLight),
      effects: shot.effects.map((e) => ({
        delay: e.delay,
        pos: [e.pos.x, e.pos.y, e.pos.z] as [number, number, number],
        rot: e.rot,
        href: e.effect,
        ...effectOf(e.effect),
      })),
    };
  });

  const skipped = objects
    .filter((o) => !o.object.shared || built.resolver.resolve(o.object.shared) < 0)
    .map((o) => o.href);

  return { scene, stage: built.scene, shots, actors, skipped };
}
