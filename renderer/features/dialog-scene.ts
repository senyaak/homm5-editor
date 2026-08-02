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
import { makeIdle, poseIdle } from '#viewport/skinning.ts';
import type { IdleObject } from '#viewport/skinning.ts';
import { camera, controls, fitViewport, renderer, scene as stage } from '#viewport/stage.ts';
import { UNITS_PER_TILE as U } from '#src/scene/units.ts';

/** One actor on stage: their skinned body and the clips this scene can play. */
interface Player {
  actor: ActorView;
  idle: IdleObject;
  /** What they are playing now, and when it started relative to the shot. */
  kind: string;
  from: number;
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
  const loader = new THREE.TextureLoader();
  const material = (g.parts ?? []).map((part) => {
    if (!part.tex) return new THREE.MeshLambertMaterial({ color: 0x8a8f98, side: THREE.DoubleSide });
    const map = loader.load(part.tex);
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.flipY = false;
    const m = new THREE.MeshLambertMaterial({ map, side: THREE.DoubleSide });
    if (part.alphaMode === 'AM_ALPHA_TEST') m.alphaTest = 0.5;
    else if (part.alphaMode && part.alphaMode !== 'AM_OPAQUE') m.transparent = true;
    return m as THREE.Material;
  });
  (g.parts ?? []).forEach((part, i) => geometry.addGroup(part.start, part.count, i));
  const body = { geometry, material };
  bodies.set(g, body);
  return body;
}

/** Take the actors off the stage — called before another scene, and on close. */
function clearActors(): void {
  for (const p of playing.players) p.idle.mesh.removeFromParent();
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
/** Systems belonging to the shot on screen, with when each starts. */
let shotFx: Array<{ system: FxSystem; from: number }> = [];

function clearShotFx(): void {
  for (const s of shotFx) { s.system.mesh.removeFromParent(); s.system.dispose(); }
  shotFx = [];
}

/** Build the systems for a shot; they play from their own delay. */
function cueShotFx(shot: ShotView): void {
  clearShotFx();
  const m4 = new THREE.Matrix4();
  let at = 0;
  for (const fired of shot.effects) {
    m4.makeRotationZ(fired.rot).setPosition(fired.pos[0], fired.pos[1], fired.pos[2]);
    for (const fx of fired.fx) {
      const baked = fxBank[fx.uid];
      if (!baked?.particles.length) continue;
      // No phase spread: eight copies of one spell over a line of soldiers are
      // meant to go off together, unlike thirty campfires on a map.
      const { system } = createFxSystem(fx, baked, m4, 0, uFxTint);
      stage.add(system.mesh);
      shotFx.push({ system, from: fired.delay });
      at++;
    }
  }
  if (at) advanceShotFx();
}

/**
 * What each actor is playing at this instant, for the inspector and the tests.
 *
 * Not simply the cue: a cue has a delay, and until it is up the actor is idling.
 */
export const actorKinds = (): Array<{ href: string; kind: string }> => playing.players.map((p) => ({
  href: p.actor.href, kind: playing.at >= p.from ? p.kind : 'idle00',
}));

/** How many effect systems the shot on screen is playing — for tests. */
export const shotFxCount = (): number => shotFx.length;

/** Put every live system where its own clock says it is. */
function advanceShotFx(): void {
  for (const s of shotFx) {
    // An effect that has not gone off yet is not drawn at all. Held at time
    // zero it shows the recording's first frame — for a spell that is the flash
    // at the caster's hands, sitting on the field for three seconds before the
    // spell is cast.
    const at = playing.at - s.from;
    s.system.mesh.visible = at >= 0;
    if (at >= 0) s.system.update(at);
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
  const { stage: payload, shots, actors, info } = await api.openScene({ inner });
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
    playing.players.push({ actor, idle, kind: 'idle00', from: 0 });
  }

  // The scene's light came down on the floors (src/dialog/play.ts); remember it
  // as what a shot without one of its own falls back to.
  sceneLight = state.world ? activeFloor().ambient : null;

  // Every effect any shot can fire, baked, in one round trip — a shot cues in
  // the middle of playback and cannot wait for IPC.
  const uids = [...new Set(shots.flatMap((s) => s.effects.flatMap((e) => e.fx.map((f) => f.uid))))];
  fxBank = uids.length ? await api.fx(uids) : {};

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
 * decide how far into that clip they are.
 */
export function show(index: number, at = 0): void {
  const shots = playing.shots;
  if (!shots.length) return;
  playing.shot = ((index % shots.length) + shots.length) % shots.length;
  playing.at = at;
  const shot = shots[playing.shot]!;
  for (const p of playing.players) { p.kind = 'idle00'; p.from = 0; }
  for (const cue of shot.cues) {
    const p = playing.players.find((x) => x.actor.href === cue.actor);
    if (p && p.actor.clips[cue.kind]) { p.kind = cue.kind; p.from = cue.delay || 0; }
  }
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

/** Put every actor where their clip says they are, at the current moment. */
function poseAll(): void {
  for (const p of playing.players) {
    // Until the cue's delay is up the actor is still idling. Held at time zero
    // of the clip instead, they stand in its FIRST FRAME — three seconds of a
    // swordsman frozen mid-swing before he swings, which reads as a broken
    // model rather than as a cue that has not come yet.
    const cued = playing.at >= p.from;
    const clip = (cued ? p.actor.clips[p.kind] : null) ?? p.actor.clips['idle00'];
    if (!clip) continue;
    p.idle.skin.clip = clip;
    const time = cued ? playing.at - p.from : playing.at;
    // A named clip plays once and holds its last frame; the idle loops. Letting
    // `death` loop would have the fallen stand back up every few seconds.
    poseIdle(p.idle, !cued || p.kind === 'idle00' ? time : Math.min(time, clip.duration));
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
