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
import type { SceneInfo } from '#electron/ipc.ts';
import { api } from '#core/ipc.ts';
import { $, $button, $input } from '#core/dom.ts';
import { buildWorld } from '#viewport/world.ts';
import { makeIdle, poseIdle } from '#viewport/skinning.ts';
import type { IdleObject } from '#viewport/skinning.ts';
import { camera, controls, scene as stage } from '#viewport/stage.ts';
import { UNITS_PER_TILE as U } from '#src/scene/units.ts';

/** One actor on stage: their skinned body and the clips this scene can play. */
interface Player {
  actor: ActorView;
  idle: IdleObject;
  /** What they are playing now, and when it started relative to the shot. */
  kind: string;
  from: number;
}

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

/** Geometry and materials for one actor, built the way the world builds its own. */
function bodyOf(actor: ActorView): { geometry: THREE.BufferGeometry; material: THREE.Material[] } | null {
  const g = actor.geom;
  if (!g.skin) return null;
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
  return { geometry, material };
}

/** Take the actors off the stage — called before another scene, and on close. */
function clearActors(): void {
  for (const p of playing.players) {
    p.idle.mesh.removeFromParent();
    p.idle.mesh.geometry.dispose();
  }
  playing.players = [];
}

/** Open a scene by its folder, e.g. `DialogScenes/C1/M1/D1`. */
export async function openScene(inner: string): Promise<SceneInfo> {
  const { stage: payload, shots, actors, info } = await api.openScene({ inner });
  clearActors();
  buildWorld(payload);

  for (const actor of actors) {
    const body = bodyOf(actor);
    const idle = body && actor.geom.skin ? makeIdle(actor.geom.skin, body.geometry, body.material) : null;
    if (!idle) continue;
    idle.mesh.position.set((actor.x + 0.5) * U, (actor.y + 0.5) * U, actor.z);
    idle.mesh.rotation.z = actor.rot;
    idle.mesh.scale.setScalar(actor.geom.scale ?? 1);
    stage.add(idle.mesh);
    playing.players.push({ actor, idle, kind: 'idle00', from: 0 });
  }

  playing.info = info;
  playing.shots = shots;
  playing.running = false;
  // The shot owns the camera while a scene is up.
  controls.enabled = false;
  show(0, 0);
  return info;
}

/** Put the scene down and give the camera back to the map tools. */
export function closeScene(): void {
  clearActors();
  playing.info = null;
  playing.shots = [];
  playing.running = false;
  controls.enabled = true;
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
  aim(shot, at / (shot.duration || 1));
}

/** Put every actor where their clip says they are, at the current moment. */
function poseAll(): void {
  for (const p of playing.players) {
    const clip = p.actor.clips[p.kind] ?? p.actor.clips['idle00'];
    if (!clip) continue;
    p.idle.skin.clip = clip;
    const time = Math.max(0, playing.at - p.from);
    // A named clip plays once and holds its last frame; the idle loops. Letting
    // `death` loop would have the fallen stand back up every few seconds.
    poseIdle(p.idle, p.kind === 'idle00' ? time : Math.min(time, clip.duration));
  }
}

/** Advance the scene by `dt` seconds. Called from the render loop. */
export function advanceScene(dt: number): void {
  if (!playing.info || !playing.running) return;
  const shot = playing.shots[playing.shot];
  if (!shot) return;
  const next = playing.at + dt;
  if (next >= (shot.duration || 3)) show(playing.shot + 1, 0);
  else { playing.at = next; poseAll(); aim(shot, next / (shot.duration || 1)); }
}

/** Start or stop playback. */
export function setPlaying(on: boolean): void {
  playing.running = on && !!playing.info;
}

// --- the panel ---------------------------------------------------------------
//
// A scene IS its list of shots, so the panel is that list: one row per line of
// dialogue, the current one lit, and clicking a row puts its camera on screen.
// Everything else is two buttons, because everything else a scene needs — the
// stage, the actors, the camera — is already on screen behind it.

/** Show or hide the panel. */
export function setScenePanel(on: boolean): void {
  $('scenes').style.display = on ? 'flex' : 'none';
  $button('scenesbtn').classList.toggle('on', on);
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
      // line's own text is loaded — the text is a reference to a .txt beside
      // the scene, and reading 73 of them to fill a list is not worth a frame.
      const who = (shot.speaker.split('#')[0] ?? '').split('/').pop() || '(nobody)';
      row.innerHTML = `<span class="n">${shot.index + 1}</span>`
        + `<span class="who">${who.replace(/\.xdb$/, '')}</span>`
        + (shot.cues.length ? `<span class="cued" title="${shot.cues.length} animation(s)">●</span>` : '')
        + `<span class="dur">${shot.duration.toFixed(1)}s</span>`;
      row.onclick = () => { show(shot.index, 0); renderPanel(); };
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

/** Wire the panel. Called once from app boot, like every other feature. */
export function initDialogScenes(): void {
  $button('scenesbtn').onclick = () => { setScenePanel($('scenes').style.display === 'none'); };
  $button('sc-close').onclick = () => { closeScene(); renderPanel(); setScenePanel(false); };
  $button('sc-load').onclick = async () => {
    const path = $input('sc-path').value.trim();
    if (!path) return;
    $('sc-info').textContent = 'opening…';
    try {
      await openScene(path);
    } catch (e) {
      $('sc-info').textContent = e instanceof Error ? e.message : String(e);
      return;
    }
    renderPanel();
  };
  $button('sc-play').onclick = () => { setPlaying(!playing.running); renderPanel(); };
}

/** Keep the list in step while a scene runs — called from the render loop. */
export function syncScenePanel(): void {
  if (!playing.info || !playing.running) return;
  const list = $('sc-list');
  const lit = [...list.children].findIndex((row) => row.classList.contains('on'));
  if (lit !== playing.shot) renderPanel();
}
