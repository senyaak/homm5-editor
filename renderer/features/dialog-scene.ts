// Playing a dialog scene in the editor's own viewport.
//
// The stage goes through `buildWorld`, the same call a map goes through, and
// the actors through `makeIdle`/`poseIdle`, the same skinning the map's idles
// use. What is new here is only what a scene has that a map does not: shots
// with their own cameras, and actors with more than one clip.
//
// While a scene is on screen the orbit controls are off and the camera is
// driven from the shot; putting it down gives them back.

import * as THREE from 'three';
import type { ActorView, ShotView } from '#src/dialog/play.ts';
import { walkAt } from '#src/dialog/walk.ts';
import type { WalkPath } from '#src/dialog/walk.ts';
import type { FxTransfer } from '#src/scene/effects.ts';
import { createFxSystem } from '#viewport/particles.ts';
import type { FxSystem } from '#viewport/particles.ts';
import { refreshLighting, uFxTint } from '#viewport/lighting.ts';
import { activeFloor, state } from '#core/state.ts';
import type { AmbientData, GeomData } from '#src/scene/payload.ts';
import type { SceneInfo } from '#electron/ipc.ts';
import { api } from '#core/ipc.ts';
import { $, $button, $input } from '#core/dom.ts';
import { buildWorld, clearWorld } from '#viewport/world.ts';
import { idleMode, setIdleMode } from '#viewport/idle.ts';
import type { IdleMode } from '#viewport/idle.ts';
import { unpackTextures } from '#src/scene/tex-table.ts';
import { materialFor } from '#viewport/materials.ts';
import { makeIdle, poseIdle } from '#viewport/skinning.ts';
import type { IdleObject } from '#viewport/skinning.ts';
import { camera, controls, fitViewport, renderer, scene as stage } from '#viewport/stage.ts';
import { UNITS_PER_TILE as U } from '#src/scene/units.ts';

/** One actor on stage: their skinned body and the clips this scene can play. */
interface Player {
  actor: ActorView;
  idle: IdleObject;
  /** The last clip the scene cued on them. */
  kind: string;
  /** Scene time that clip started at, or null when nobody has cued them yet. */
  at: number | null;
  /** The walk they are on or have finished, and when it began. */
  walk: WalkPath | null;
  walkAt: number;
  /** Their idle clip's effect, burning wherever they are. */
  fire: Array<{ system: FxSystem; local: THREE.Matrix4 }>;
  /**
   * Clips whose last frame leaves the body somewhere the idle does not have it,
   * so letting one end would TELEPORT them. Measured, not named — see holdsAt.
   */
  holds: Set<string>;
  /**
   * What is actually on screen — the cued clip while it runs, `idle00` once it
   * is out. Written by `poseAll`, so the inspector and the tests read the pose
   * that is being drawn rather than the intention behind it.
   */
  showing: string;
}

/**
 * Clips that a body does not get up from.
 *
 * A clip runs once and the actor goes back to idling — except this: a scene
 * kills people, and the swordsmen cut down in one shot are still lying there
 * ten shots later. Anything else held would freeze a hero in the last frame of
 * `happy` for the rest of the scene, and anyone cued again later (shot 23
 * resurrects a paladin killed in shot 15) gets up, because only the most recent
 * cue counts.
 *
 * A name is not the whole of it — see `holdsAt`, which measures the same thing
 * and catches the clips nobody would think to list.
 */
const TERMINAL = /^(death|defeat)/;

/** Where the scene's one clock stands: seconds from the top of shot 0. */
function now(): number {
  return (playing.shots[playing.shot]?.start ?? 0) + playing.at;
}

/** The idle-stance setting a scene borrowed, to be given back when it closes. */
let modeBefore: IdleMode | null = null;

/** The scene on screen, or null when the window is back to maps. */
export const playing = {
  info: null as SceneInfo | null,
  shots: [] as ShotView[],
  players: [] as Player[],
  /** Index of the shot being shown. */
  shot: 0,
  /** Seconds into that shot. */
  at: 0,
  running: false,
};

/**
 * Geometry and materials for one actor, built the way the world builds its own.
 *
 * Cached on the PAYLOAD's geom, which the six swordsmen of one kind share (see
 * src/dialog/actors.ts) — one upload each rather than one per figure. Kept in a
 * plain map so closing a scene can dispose what it built.
 */
const bodies = new Map<GeomData, { geometry: THREE.BufferGeometry; material: THREE.Material[] }>();

function bodyOf(actor: ActorView): { geometry: THREE.BufferGeometry; material: THREE.Material[] } | null {
  const g = actor.geom;
  if (!g.skin) return null;
  const known = bodies.get(g);
  if (known) return known;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(g.pos), 3));
  if (g.uv) geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.uv), 2));
  if (g.nrm) geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(g.nrm), 3));
  geometry.setIndex(g.idx);
  if (!g.nrm) geometry.computeVertexNormals();
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(g.skin.index, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(g.skin.weight, 4));
  // Through the same `materialFor` the stage's props go through, rather than a
  // second reading of the same fields: an actor stands ON that stage, and a
  // scene where the hero is shaded by three.js's lighting and the grass under
  // her by the game's is a scene where she does not belong to it.
  const material = (g.parts ?? []).map((p) => materialFor(p));
  (g.parts ?? []).forEach((part, i) => geometry.addGroup(part.start, part.count, i));
  const body = { geometry, material };
  bodies.set(g, body);
  return body;
}

/** Highest and lowest bone of an actor as posed now, relative to their feet. */
function bodySpan(p: Player): [number, number] {
  p.idle.mesh.updateMatrixWorld(true);
  let lo = Infinity, hi = -Infinity;
  for (const b of p.idle.bones) {
    _bone.setFromMatrixPosition(b.matrixWorld);
    lo = Math.min(lo, _bone.z);
    hi = Math.max(hi, _bone.z);
  }
  const base = p.idle.mesh.position.z;
  return [lo - base, hi - base];
}

/**
 * Which of an actor's clips END somewhere the idle cannot follow.
 *
 * A royal griffin's `specability1` is the FIRST HALF of a dive: it takes off
 * and leaves him three units up, and `specability2` brings him down. An arch
 * devil's `moveStart` sinks him into the ground he gates out of. Letting either
 * hand back to the idle at the end of its run does not blend, it TELEPORTS —
 * the griffin springs into the air and reappears standing.
 *
 * So it is measured, once per character when the scene opens: pose the clip at
 * its last frame, pose the idle at its first, and compare where the body is.
 * Half a unit apart is a jump you can see; a `happy` or an `attack` ends
 * exactly where it started and reads as 0.
 */
function holdsAt(p: Player): Set<string> {
  const out = new Set<string>();
  const idle = p.actor.clips['idle00'];
  if (!idle) return out;
  const was = p.idle.skin.clip;
  p.idle.skin.clip = idle;
  poseIdle(p.idle, 0, true);
  const [lo0, hi0] = bodySpan(p);
  for (const [kind, clip] of Object.entries(p.actor.clips)) {
    if (kind === 'idle00') continue;
    p.idle.skin.clip = clip;
    poseIdle(p.idle, clip.duration, false);
    const [lo, hi] = bodySpan(p);
    if (Math.max(Math.abs(lo - lo0), Math.abs(hi - hi0)) > 0.5) out.add(kind);
  }
  p.idle.skin.clip = was;
  return out;
}

/** Take the actors off the stage — called before another scene, and on close. */
function clearActors(): void {
  for (const p of playing.players) {
    p.idle.mesh.removeFromParent();
    for (const f of p.fire) { f.system.mesh.removeFromParent(); f.system.dispose(); }
  }
  // The geometry belongs to the bank, not to the mesh: several figures share
  // one, and disposing it per mesh would free it out from under its twins.
  for (const body of bodies.values()) {
    body.geometry.dispose();
    for (const m of body.material) m.dispose();
  }
  bodies.clear();
  playing.players = [];
}

// --- what a shot fires ---------------------------------------------------------
//
// A shot's effects are not the objects' effects: they belong to the MOMENT, at
// a place on the stage and a delay from the line — the Prayer over Isabell's
// soldiers, the Bloodlust that turns Agrael's army red, the ice bolt that lands
// on it. They live only as long as their shot, so they are built when one is
// cued and taken down when it changes, rather than riding the floor like an
// object's campfire does.

/** The scene's own light, to fall back on when a shot names none. */
let sceneLight: AmbientData | null = null;

/** Baked keys for every effect the open scene can fire, by uid. */
let fxBank: Record<string, FxTransfer> = {};
/** Systems alive around the shot on screen, with the scene time each starts at. */
let shotFx: Array<{ system: FxSystem; at: number }> = [];
/**
 * An effect's own geometry, which appears and goes with the sparks.
 *
 * `until` is what stops it. A particle train dies out on its own — the bake
 * knows how long a copy lives and how many there are — but a model has no such
 * clock, and the praying hands of a Prayer stood inside the soldier they were
 * cast on for the rest of the scene until this was here.
 */
let shotModels: Array<{ mesh: THREE.Mesh; idle: IdleObject | null; at: number; until: number }> = [];

function clearShotFx(): void {
  for (const s of shotFx) { s.system.mesh.removeFromParent(); s.system.dispose(); }
  shotFx = [];
  for (const m of shotModels) {
    m.mesh.removeFromParent();
    m.mesh.geometry.dispose();
    for (const mat of m.mesh.material as THREE.Material[]) mat.dispose();
  }
  shotModels = [];
}

/**
 * One `<Models>` entry of an effect as a mesh.
 *
 * These are the parts of a spell that are geometry rather than sparks — the
 * column of light a caster stands in, a falling meteor — and they are drawn
 * unlit and usually additive, which is what `selfIllum` and `additive` on a
 * part are saying. Read as ordinary scenery they come out as grey solids in the
 * middle of the effect.
 */
function effectMesh(g: GeomData): { mesh: THREE.Mesh; idle: IdleObject | null } | null {
  if (!g.pos.length || !g.idx.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(g.pos), 3));
  if (g.uv) geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.uv), 2));
  if (g.nrm) geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(g.nrm), 3));
  geometry.setIndex(g.idx);
  if (!g.nrm) geometry.computeVertexNormals();
  // An effect model is animated as often as not — the meteor falls, the ice
  // bolt drops, the Prayer's hands rise out of the ground they start under.
  if (g.skin?.clip) {
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(g.skin.index, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(g.skin.weight, 4));
  }
  const material = (g.parts ?? []).map((p) => materialFor(p));
  (g.parts ?? []).forEach((part, i) => geometry.addGroup(part.start, part.count, i));
  const idle = g.skin?.clip ? makeIdle({ ...g.skin }, geometry, material) : null;
  return { mesh: idle?.mesh ?? new THREE.Mesh(geometry, material), idle };
}

/** How long one firing of an effect can be on screen — its longest part. */
function effectSpan(fired: ShotView['effects'][number]): number {
  let span = fired.duration;
  for (const m of fired.models) span = Math.max(span, m.life || fired.duration);
  return span;
}

const _frame = new THREE.Matrix4();
const _one = new THREE.Vector3(1, 1, 1);
const _q = new THREE.Quaternion();
const _axis = new THREE.Vector3(0, 0, 1);
const _v = new THREE.Vector3();

/**
 * Build every effect that can be seen while this shot is on screen.
 *
 * Not only the shot's own: a delay is measured from the shot that WRITES the
 * effect, and it runs past the end as happily as it starts before the
 * beginning — the gating flash of shot 14 is written at -0.3 seconds, which is
 * in shot 13. So the window is what decides, and what a shot fires is scanned
 * for across the whole scene.
 */
function cueShotFx(shot: ShotView): void {
  clearShotFx();
  const from = shot.start, to = shot.start + shot.duration;
  const m4 = new THREE.Matrix4();
  for (const s of playing.shots) {
    for (const fired of s.effects) {
      if (fired.at >= to || fired.at + effectSpan(fired) <= from) continue;
      m4.makeRotationZ(fired.rot).setPosition(fired.pos[0], fired.pos[1], fired.pos[2]);
      for (const fx of fired.fx) {
        const baked = fxBank[fx.uid];
        if (!baked?.particles.length) continue;
        // No phase spread: eight copies of one spell over a line of soldiers are
        // meant to go off together, unlike thirty campfires on a map.
        const { system } = createFxSystem(fx, baked, m4, 0, uFxTint);
        stage.add(system.mesh);
        shotFx.push({ system, at: fired.at });
      }
      _q.setFromAxisAngle(_axis, fired.rot);
      for (const model of fired.models) {
        const built = effectMesh(model.geom);
        if (!built) continue;
        // The model's place INSIDE the effect, then the effect's on the stage.
        _v.set(model.pos[0], model.pos[1], model.pos[2]).applyQuaternion(_q);
        built.mesh.position.set(fired.pos[0] + _v.x, fired.pos[1] + _v.y, fired.pos[2] + _v.z);
        built.mesh.quaternion.copy(_q)
          .multiply(new THREE.Quaternion(model.quat[0], model.quat[1], model.quat[2], model.quat[3]));
        built.mesh.scale.setScalar(model.scale * (model.geom.scale ?? 1));
        stage.add(built.mesh);
        shotModels.push({
          ...built, at: fired.at, until: fired.at + (model.life || fired.duration),
        });
      }
    }
  }
  if (shotFx.length || shotModels.length) advanceShotFx();
}

/**
 * What each actor is playing at this instant, for the inspector and the tests.
 *
 * Not simply the cue: a cue has a delay, and until it is up the actor is idling.
 */
const _bone = new THREE.Vector3();

export const actorKinds = (): Array<{
  href: string; key: string; kind: string; top: number; pos: [number, number, number];
  fire: number; fireOff: number;
}> => playing.players.map((p) => {
  // How tall they are standing right now, in world units above their own feet.
  // The clip NAME does not say whether the pose is being held or replayed, and
  // that is the whole of the bug where a body played its death and then stood
  // up on the next loop — a corpse is about a unit high, a man about four.
  p.idle.mesh.updateMatrixWorld(true);
  let top = 0;
  for (const b of p.idle.bones) {
    _bone.setFromMatrixPosition(b.matrixWorld);
    top = Math.max(top, _bone.z - p.idle.mesh.position.z);
  }
  return {
    href: p.actor.href, key: p.actor.key, kind: p.showing, top,
    // Where they are STANDING, which a walk moves and nothing else does. Read
    // off the mesh rather than off the actor: the actor is where the file put
    // them, the mesh is where the scene has walked them to.
    pos: p.idle.mesh.position.toArray() as [number, number, number],
    fire: p.fire.length,
    // …and how far their own fire is from them, which is the only way to see
    // that it FOLLOWS: a count says a system exists, not that it is on the man.
    fireOff: p.fire.reduce((worst, f) => {
      _bone.setFromMatrixPosition(f.system.mesh.matrix);
      return Math.max(worst, _bone.distanceTo(p.idle.mesh.position));
    }, 0),
  };
});

// Both counts are of what is ON SCREEN, not of what has been built: an effect
// is built for the whole window a shot can see it in and drawn only for the
// moment it is up, and "built" would report a spell that has already gone out.

/** How many effect systems are being drawn right now — for tests. */
export const shotFxCount = (): number => shotFx.reduce((n, s) => n + (s.system.mesh.visible ? 1 : 0), 0);

/** How many pieces of effect GEOMETRY are — likewise. */
export const shotModelCount = (): number => shotModels.reduce((n, m) => n + (m.mesh.visible ? 1 : 0), 0);

/** Put every live system where its own clock says it is. */
function advanceShotFx(): void {
  const T = now();
  for (const s of shotFx) {
    // An effect that has not gone off yet is not drawn at all. Held at time
    // zero it shows the recording's first frame — for a spell that is the flash
    // at the caster's hands, sitting on the field for three seconds before the
    // spell is cast.
    const at = T - s.at;
    s.system.mesh.visible = at >= 0;
    if (at >= 0) s.system.update(at);
  }
  for (const m of shotModels) {
    m.mesh.visible = T >= m.at && T < m.until;
    if (m.mesh.visible && m.idle) poseIdle(m.idle, T - m.at, false);
  }
}

/**
 * Open a scene by its folder, e.g. `DialogScenes/C1/M1/D1`.
 *
 * The stage REPLACES whatever world is on the GPU — it goes through the same
 * `buildWorld` a map does, and there is one world. That is why the way in is a
 * launcher button (hidden while a map is open) rather than something reachable
 * mid-edit: a scene is watched instead of a map, not on top of one.
 */
export async function openScene(inner: string): Promise<SceneInfo> {
  const { stage: payload, shots, actors, info, textures } = await api.openScene({ inner });
  // The textures travelled once each and the payload holds handles into that
  // table; nothing below this line should ever meet one. See
  // src/scene/tex-table.ts.
  unpackTextures([payload, shots, actors], textures);
  clearActors();
  // The stage arrives with its creatures' bones (src/dialog/play.ts asks for
  // them unconditionally), and the mode is what decides whether buildWorld
  // gives them an animated body. `all` rather than `visible`: a shot cuts to
  // wherever it likes, and a stack that stopped being posed off screen would be
  // caught mid-nothing the moment the camera lands on it.
  if (!modeBefore) modeBefore = idleMode();
  setIdleMode('all');
  buildWorld(payload);

  for (const actor of actors) {
    const body = bodyOf(actor);
    // A COPY of the skin: the clip lives on it and `poseAll` swaps that clip
    // per figure, while the payload's skin is shared by every figure of the
    // same character — one swordsman drawing his sword would swing all six.
    const skin = actor.geom.skin ? { ...actor.geom.skin } : null;
    const idle = body && skin ? makeIdle(skin, body.geometry, body.material) : null;
    if (!idle) continue;
    idle.mesh.position.set((actor.x + 0.5) * U, (actor.y + 0.5) * U, actor.z);
    idle.mesh.rotation.z = actor.rot;
    idle.mesh.scale.setScalar(actor.geom.scale ?? 1);
    stage.add(idle.mesh);
    playing.players.push({
      actor, idle, kind: 'idle00', at: null, walk: null, walkAt: 0, showing: 'idle00',
      fire: [], holds: new Set<string>(),
    });
  }
  // One measurement per CHARACTER — the six swordsmen of a kind share a clip
  // set, and posing a skeleton 45 times to learn the same thing is waste.
  const measured = new Map<ActorView['clips'], Set<string>>();
  for (const p of playing.players) {
    let known = measured.get(p.actor.clips);
    if (!known) { known = holdsAt(p); measured.set(p.actor.clips, known); }
    p.holds = known;
  }

  // The scene's light came down on the floors (src/dialog/play.ts); remember it
  // as what a shot without one of its own falls back to.
  sceneLight = state.world ? activeFloor().ambient : null;

  // Every effect the scene can show, baked, in one round trip — a shot cues in
  // the middle of playback and cannot wait for IPC. The actors' own fires are
  // in here too: they are alight from the moment the scene opens.
  const uids = [...new Set([
    ...shots.flatMap((s) => s.effects.flatMap((e) => e.fx.map((f) => f.uid))),
    ...actors.flatMap((a) => a.idleFx.map((f) => f.uid)),
  ])];
  fxBank = uids.length ? await api.fx(uids) : {};

  // …and lit. An actor's idle effect is not a moment in the scene, it is what
  // that creature IS — the fire an inferno soldier stands in burns through
  // every shot, and follows them when they march.
  playing.players.forEach((p, i) => {
    for (const fx of p.actor.idleFx) {
      const baked = fxBank[fx.uid];
      if (!baked?.particles.length) continue;
      // Spread, unlike a spell: forty demons whose flames flicker in lockstep
      // read as one animation played forty times, which is what they are.
      const { system } = createFxSystem(fx, baked, new THREE.Matrix4(), i * 0.37, uFxTint);
      stage.add(system.mesh);
      p.fire.push({ system, local: system.mesh.matrix.clone() });
    }
  });

  playing.info = info;
  playing.shots = shots;
  playing.running = false;
  // The shot owns the camera while a scene is up.
  controls.enabled = false;
  show(0, 0);
  return info;
}

/**
 * Put the scene down and give the camera back to the map tools.
 *
 * The WORLD goes with it. It has to: the launcher behind this is a page with
 * nothing open, and a scene left on the GPU keeps drawing its arena behind that
 * — grass and trees under the "pick a map" card, which reads as a broken
 * background rather than as a scene nobody closed.
 */
export function closeScene(): void {
  clearActors();
  clearShotFx();
  fxBank = {};
  sceneLight = null;
  clearWorld();
  playing.info = null;
  playing.shots = [];
  playing.running = false;
  controls.enabled = true;
  // The idle mode is the map editor's setting, borrowed for as long as a scene
  // is up; a map opened after one must find it as its owner left it.
  if (modeBefore) { setIdleMode(modeBefore); modeBefore = null; }
}

/** Point the camera where the shot says, `t` running 0 to 1 through the move. */
function aim(shot: ShotView, t: number): void {
  if (!shot.camera.length) return;
  const k = Math.min(0.999, Math.max(0, t)) * (shot.camera.length - 1);
  const i = Math.floor(k), f = k - i;
  const a = shot.camera[i]!, b = shot.camera[Math.min(shot.camera.length - 1, i + 1)]!;
  const mix = (u: number, v: number): number => u + (v - u) * f;
  camera.position.set(mix(a.eye[0], b.eye[0]), mix(a.eye[1], b.eye[1]), mix(a.eye[2], b.eye[2]));
  camera.lookAt(mix(a.at[0], b.at[0]), mix(a.at[1], b.at[1]), mix(a.at[2], b.at[2]));
  const fov = mix(a.fov, b.fov);
  if (Math.abs(camera.fov - fov) > 1e-3) { camera.fov = fov; camera.updateProjectionMatrix(); }
}

/**
 * Show a shot at a moment in it.
 *
 * Cueing is per shot, not per frame: entering one hands every actor their clip
 * for it (idle for anyone the shot says nothing about), and the seconds since
 * decide how far into that clip they are. A shot is also shown from a standing
 * start — clicking row 40 does not replay the 40 before it — so what earlier
 * shots left behind is worked out here rather than accumulated as they run.
 */
export function show(index: number, at = 0): void {
  const shots = playing.shots;
  if (!shots.length) return;
  playing.shot = ((index % shots.length) + shots.length) % shots.length;
  playing.at = at;
  const shot = shots[playing.shot]!;
  poseAll();
  cueShotFx(shot);
  // The shot's own light, or the scene's. Set on the floor rather than applied
  // directly so everything that reads it agrees — the terrain shader's sun and
  // ambient, the point-light gain and the tint the particles are drawn with.
  if (state.world) {
    activeFloor().ambient = shot.ambient ?? sceneLight;
    refreshLighting();
  }
  aim(shot, at / (shot.duration || 1));
  // The list of shots IS the open scene — which row is lit says which shot is
  // on screen, so it is redrawn from here rather than by whoever happened to
  // call. Once per shot, not per frame: the row click, the API and playback's
  // own step all come through here.
  renderPanel();
}

/**
 * Hand every actor the last thing the scene told them to do.
 *
 * Every cue in the scene is a moment on one clock, so this is a scan for the
 * latest one at or before now rather than a per-shot handout. That is what
 * makes an actor's timing right at all: a cue can be written into a shot it
 * does not fit in, and reading only the current shot's dropped every one of
 * those on the floor.
 */
function cueAll(T: number): void {
  for (const p of playing.players) { p.kind = 'idle00'; p.at = null; p.walk = null; p.walkAt = 0; }
  const of = new Map(playing.players.map((p) => [p.actor.key, p]));
  for (const shot of playing.shots) {
    for (const cue of shot.cues) {
      if (cue.at > T) continue;
      const p = of.get(cue.actor);
      if (!p) continue;
      // A walk is remembered even when its clip is not playable: where the
      // scene left an actor is where they are for the rest of it, and losing
      // that would snap them back to their first tile the moment they arrive.
      if (cue.walk && (!p.walk || cue.at >= p.walkAt)) { p.walk = cue.walk; p.walkAt = cue.at; }
      if (!p.actor.clips[cue.kind]) continue;
      if (p.at !== null && cue.at < p.at) continue;
      p.kind = cue.kind;
      p.at = cue.at;
    }
  }
}

/**
 * Stand an actor where the scene has walked them to by now.
 *
 * Where they stand is not a property of a shot — a walk in shot 5 leaves them
 * somewhere, and that is where they are in shot 40. So the position comes off
 * the same clock the clips do rather than being set once when the scene opens.
 */
function place(p: Player, T: number): void {
  const mesh = p.idle.mesh;
  if (!p.walk) {
    mesh.position.set((p.actor.x + 0.5) * U, (p.actor.y + 0.5) * U, p.actor.z);
    mesh.rotation.z = p.actor.rot;
  } else {
    const now = walkAt(p.walk, T - p.walkAt);
    mesh.position.set(now.pos[0], now.pos[1], now.pos[2]);
    mesh.rotation.z = now.rot;
  }
  if (!p.fire.length) return;
  // Their own fire goes where they go. Built against an identity frame, so what
  // the system holds after `createFxSystem` is the instance's own offset and
  // this is the actor's frame applied on top of it, once per frame.
  // Position and facing only: the actor's DISPLAY SCALE is not the effect's.
  // The phoenix's flames are baked full size around a 0.37 bird and that is
  // the game's picture — small bird, towering fire (see clipEffectParticles).
  _frame.compose(mesh.position, mesh.quaternion, _one);
  for (const f of p.fire) {
    f.system.mesh.matrix.multiplyMatrices(_frame, f.local);
    f.system.update(T);
  }
}

/** Put every actor where their clip says they are, at the current moment. */
function poseAll(): void {
  const T = now();
  cueAll(T);
  for (const p of playing.players) {
    // A clip runs once from the moment it was cued and then the actor goes back
    // to idling — unless it is one nobody gets up from (TERMINAL), which holds
    // its last frame for the rest of the scene. An actor nobody has cued yet
    // idles too; held at frame zero of a clip that has not started they would
    // stand mid-swing waiting for it.
    const cued = p.at === null ? null : p.actor.clips[p.kind];
    const idle = p.actor.clips['idle00'];
    // A walk LOOPS for as long as it lasts: `move` is ONE stride and the actor
    // takes as many as the distance needs, so it is the one cued clip that does
    // not run out after a single pass.
    const walking = cued !== null && p.walk !== null
      && T - p.walkAt < p.walk.times[p.walk.times.length - 1]!;
    // A cue OF the idle is idling — played as a one-shot it would run its cycle
    // from the cue and then hand over to the looping copy, a visible hitch.
    const held = TERMINAL.test(p.kind) || p.holds.has(p.kind);
    const over = !walking && (!cued || p.kind === 'idle00'
      || (T - p.at! >= cued.duration && !held));
    const play = over && idle ? { clip: idle, time: T, loop: true } : null;
    const clip = play?.clip ?? cued;
    if (!clip) continue;
    p.showing = play ? 'idle00' : p.kind;
    p.idle.skin.clip = clip;
    if (walking) poseIdle(p.idle, T - p.at!, true);
    else poseIdle(p.idle, play ? play.time : Math.min(T - p.at!, clip.duration), !!play);
    place(p, T);
  }
}

/** Advance the scene by `dt` seconds. Called from the render loop. */
export function advanceScene(dt: number): void {
  if (!playing.info || !playing.running) return;
  const shot = playing.shots[playing.shot];
  if (!shot) return;
  const next = playing.at + dt;
  if (next >= (shot.duration || 3)) show(playing.shot + 1, 0);
  else { playing.at = next; poseAll(); advanceShotFx(); aim(shot, next / (shot.duration || 1)); }
}

/** Start or stop playback. */
export function setPlaying(on: boolean): void {
  playing.running = on && !!playing.info;
}

// --- the window --------------------------------------------------------------
//
// A scene gets a window of its own rather than a panel over the launcher: it is
// not a tool for the thing behind it, it is a film. There is only one WebGL
// context in the app, so the viewport MOVES into the dialog while it is open
// and goes back to the page when it closes — the scene is drawn by the same
// renderer, the same world, the same skinning as a map.
//
// Inside it, the scene IS its list of shots: a row per line of dialogue, the
// current one lit, clicking one puts its camera on screen.

/** Where the canvas lives when no scene is open. */
const pageHost = (): HTMLElement => $('app');

let watchSize: ResizeObserver | null = null;

/** Move the viewport into the dialog (or back), and fit it to its new box. */
function hostViewport(inDialog: boolean): void {
  const host = inDialog ? $('sc-view') : pageHost();
  if (renderer.domElement.parentElement !== host) host.append(renderer.domElement);
  watchSize?.disconnect();
  watchSize = null;
  if (inDialog) {
    // The dialog is sized in vw/vh, so the host changes with the window and
    // with nothing else — but it also has no size at all until it is shown,
    // which is why this observes rather than measures once.
    watchSize = new ResizeObserver(() => fitViewport());
    watchSize.observe(host);
  }
  fitViewport();
}

/** Redraw the shot list and the footer for whatever is open. */
function renderPanel(): void {
  const list = $('sc-list');
  const info = playing.info;
  if (!info) {
    list.innerHTML = '';
    $('sc-info').textContent = 'no scene open';
    return;
  }
  if (list.childElementCount !== playing.shots.length) {
    list.innerHTML = '';
    for (const shot of playing.shots) {
      const row = document.createElement('div');
      row.className = 'shot';
      // The speaker's file name is the only readable name a shot has until the
      // line itself is read — the text is a reference to a .txt beside the
      // scene, and reading 73 of them to fill a list is not worth a frame.
      const who = (shot.speaker.split('#')[0] ?? '').split('/').pop() || '(nobody)';
      row.innerHTML = `<span class="n">${shot.index + 1}</span>`
        + `<span class="who">${who.replace(/\.xdb$/, '')}</span>`
        + (shot.cues.length ? `<span class="cued" title="${shot.cues.length} animation(s)">●</span>` : '')
        + `<span class="dur">${shot.duration.toFixed(1)}s</span>`;
      row.onclick = () => show(shot.index, 0);
      list.append(row);
    }
  }
  [...list.children].forEach((row, i) => row.classList.toggle('on', i === playing.shot));
  list.children[playing.shot]?.scrollIntoView({ block: 'nearest' });
  $('sc-info').textContent = `${info.name} · ${info.shots} shots · ${info.placed} placed`
    + (info.skipped ? ` · ${info.skipped} skipped` : '');
  $button('sc-play').textContent = playing.running ? '❚❚ Pause' : '▶ Play';
  $button('sc-play').classList.toggle('on', playing.running);
}

/** Open the scene window. */
export function openSceneWindow(): void {
  const dlg = $('scene') as HTMLDialogElement;
  if (dlg.open) return;
  dlg.showModal();
  hostViewport(true);
  renderPanel();
}

/** Close it: the scene goes down and the viewport goes back to the page. */
export function closeSceneWindow(): void {
  const dlg = $('scene') as HTMLDialogElement;
  closeScene();
  renderPanel();
  hostViewport(false);
  if (dlg.open) dlg.close();
}

/** Wire the window. Called once from app boot, like every other feature. */
export function initDialogScenes(): void {
  const dlg = $('scene') as HTMLDialogElement;
  $button('scenesbtn').onclick = () => openSceneWindow();
  $button('sc-close').onclick = () => closeSceneWindow();
  // Esc closes a native dialog on its own; the scene has to come down with it.
  dlg.addEventListener('close', () => {
    if (playing.info) { closeScene(); renderPanel(); }
    hostViewport(false);
  });
  $button('sc-load').onclick = async () => {
    const path = $input('sc-path').value.trim();
    if (!path) return;
    $('sc-info').textContent = 'opening…';
    try {
      await openScene(path);
    } catch (e) {
      $('sc-info').textContent = e instanceof Error ? e.message : String(e);
    }
  };
  $button('sc-play').onclick = () => { setPlaying(!playing.running); renderPanel(); };
}
