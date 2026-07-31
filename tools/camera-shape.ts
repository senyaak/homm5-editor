// Which convention a scene camera is written in — measured, not assumed.
//
//   node tools/camera-shape.ts
//
// A DSceneCamera is an orbit pose: a point it looks at (`Anchor`), a distance
// (`Rod`) and two angles. Placing it in the viewport needs three things the
// file never says: whether `Pitch` is measured from the horizon or from
// straight up, which way it grows, and where `Yaw` has its zero.
//
// So try every combination against the 3000-odd shipped cameras and score them
// on facts that hold for a real camera and not for a wrong one:
//
//   * ABOVE GROUND — the eye is not buried in the terrain of its own stage.
//     This is what pins the pitch: the arenas are near-flat, so pitch alone
//     decides how high the eye sits.
//   * ON STAGE — the eye is inside the map it films. This is what yaw affects
//     at all, and on a flat 72-tile arena it is a weak signal by nature; the
//     first rendered frame, compared against the game's own dialog replay, is
//     what settles yaw for good.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { childText, find, parse } from '../src/format/xml.ts';
import { parseTerrain, readHeights } from '../src/terrain/terrain.ts';
import { resolveHref, dirOf } from '../src/scene/xdb.ts';
import { loadDialogScene } from '../src/dialog/dialog-scene.ts';
import { readEntries } from '../src/format/pak.ts';

const DATA = process.env.HOMM5_DATA ?? join(import.meta.dirname, '..', 'data-unpacked');
const GAME = process.env.HOMM5_ROOT ?? resolve(DATA, '..', '..');

// ---------------------------------------------------------------------------
// The corpus: scenes, the cameras they point at, and the stages they film on
// ---------------------------------------------------------------------------

const texts = new Map<string, string>();

function addDisk(rel: string): void {
  const walk = (dir: string): void => {
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.xdb')) {
        const path = p.slice(DATA.length + 1).replaceAll('\\', '/');
        if (!texts.has(path)) texts.set(path, readFileSync(p, 'utf8'));
      }
    }
  };
  walk(join(DATA, rel));
}

function addMods(): void {
  const mods = join(GAME, 'UserMODs');
  if (!existsSync(mods)) return;
  for (const file of readdirSync(mods)) {
    if (!/\.h5u$/i.test(file)) continue;
    for (const entry of readEntries(readFileSync(join(mods, file)))) {
      if (!entry.name.endsWith('.xdb')) continue;
      if (!/^(DialogScenes|Dialogs)\//.test(entry.name)) continue;
      if (!texts.has(entry.name)) texts.set(entry.name, entry.data.toString('utf8'));
    }
  }
}

for (const rel of ['DialogScenes', 'Dialogs']) addDisk(rel);
addMods();

/** Terrain of a stage, by the folder its map lives in — read once each. */
const stages = new Map<string, { V: number; h: Float32Array } | null>();
function stageAt(dir: string): { V: number; h: Float32Array } | null {
  if (!stages.has(dir)) {
    const bin = join(DATA, dir, 'GroundTerrain.bin');
    if (!existsSync(bin)) stages.set(dir, null);
    else {
      const t = parseTerrain(readFileSync(bin));
      stages.set(dir, { V: t.V, h: readHeights(t) });
    }
  }
  return stages.get(dir) ?? null;
}

interface Pose { rod: number; pitch: number; yaw: number; ax: number; ay: number; az: number; stage: string }

const poses: Pose[] = [];
for (const [path, text] of texts) {
  if (!text.includes('<DialogScene>') && !text.includes('<DialogScene ')) continue;
  const scene = loadDialogScene(text);
  const stage = dirOf(resolveHref(dirOf(path), scene.stage));
  for (const shot of scene.shots) {
    const setPath = shot.newCameraSet && resolveHref(dirOf(path), shot.newCameraSet);
    const setText = setPath && texts.get(setPath);
    if (!setText) continue;
    const set = find(parse(setText), 'DSceneCameraSet');
    for (const end of ['StartCamera', 'FinishCamera']) {
      const ref = set && find(set, end)?.attrs.href;
      const camText = ref && texts.get(resolveHref(dirOf(setPath as string), ref));
      const cam = camText ? find(parse(camText), 'DSceneCamera') : null;
      const pos = cam && find(cam, 'Pos');
      const anchor = pos && find(pos, 'Anchor');
      if (!pos || !anchor) continue;
      poses.push({
        rod: Number(childText(pos, 'Rod')),
        pitch: Number(childText(pos, 'Pitch')),
        yaw: Number(childText(pos, 'Yaw')),
        ax: Number(childText(anchor, 'x')),
        ay: Number(childText(anchor, 'y')),
        az: Number(childText(anchor, 'z')),
        stage,
      });
    }
  }
}

console.log(`${poses.length} camera poses from ${texts.size} documents`);
const usable = poses.filter((p) => stageAt(p.stage) && Math.abs(p.rod) > 0.01);
console.log(`${usable.length} of them on a stage whose terrain is unpacked here\n`);

// ---------------------------------------------------------------------------
// Score every convention
// ---------------------------------------------------------------------------

/** Ground height under a world-unit point — tiles are 2 units, heights are world. */
function ground(stage: { V: number; h: Float32Array }, wx: number, wy: number): number | null {
  const x = Math.round(wx / 2), y = Math.round(wy / 2);
  if (x < 0 || y < 0 || x >= stage.V || y >= stage.V) return null;
  return stage.h[y * stage.V + x] ?? null;
}

interface Convention { frame: 'horizon' | 'zenith'; pitchSign: 1 | -1; yawZero: 'x' | 'y'; yawSign: 1 | -1 }

function eyeOf(p: Pose, c: Convention): [number, number, number] {
  const a = c.yawSign * p.yaw;
  const [ux, uy] = c.yawZero === 'x' ? [Math.cos(a), Math.sin(a)] : [Math.sin(a), Math.cos(a)];
  const pitch = c.pitchSign * p.pitch;
  const [flat, up] = c.frame === 'horizon'
    ? [Math.cos(pitch), Math.sin(pitch)]
    : [Math.sin(pitch), Math.cos(pitch)];
  return [p.ax + p.rod * ux * flat, p.ay + p.rod * uy * flat, p.az + p.rod * up];
}

const results: Array<{ c: Convention; above: number; onStage: number }> = [];
for (const frame of ['horizon', 'zenith'] as const) {
  for (const pitchSign of [1, -1] as const) {
    for (const yawZero of ['x', 'y'] as const) {
      for (const yawSign of [1, -1] as const) {
        const c: Convention = { frame, pitchSign, yawZero, yawSign };
        let above = 0, onStage = 0;
        for (const p of usable) {
          const stage = stageAt(p.stage)!;
          const [ex, ey, ez] = eyeOf(p, c);
          const g = ground(stage, ex, ey);
          if (g !== null) onStage++;
          if (g !== null && ez > g) above++;
        }
        results.push({ c, above, onStage });
      }
    }
  }
}

const label = (c: Convention): string =>
  `pitch from ${c.frame === 'horizon' ? 'horizon' : 'zenith '} ${c.pitchSign > 0 ? '+' : '-'}, yaw from ${c.yawZero.toUpperCase()} ${c.yawSign > 0 ? '+' : '-'}`;

console.log('  convention                              eye above ground     eye on stage');
for (const r of [...results].sort((a, b) => b.above - a.above)) {
  const pc = (n: number) => `${((n / usable.length) * 100).toFixed(1)}%`.padStart(6);
  console.log(`  ${label(r.c).padEnd(40)} ${pc(r.above)}  ${String(r.above).padStart(5)}   ${pc(r.onStage)}  ${String(r.onStage).padStart(5)}`);
}

// ---------------------------------------------------------------------------
// The above-ground score is biased, so read it with the one below
// ---------------------------------------------------------------------------
//
// "Not buried" rewards a camera for being HIGH, and reading the pitch from the
// zenith makes every camera high: the median pitch is 0.09 radians, which under
// that reading means all but straight down, so the eye sits a whole rod above
// the anchor and clears the ground trivially. That is why all eight zenith rows
// score alike — the test cannot see the difference between framing and
// hovering.
//
// What separates them is HOW FAR above the ground the eye ends up on a
// close-up. The scenes are conversations: 2386 lines of two people talking, and
// the shots that frame them sit within a few tiles. A reading that puts those
// eyes at head height is a camera; one that puts them ten units overhead is a
// map view of the tops of their heads.

// ---------------------------------------------------------------------------
// Yaw, from whether the speaker is in shot
// ---------------------------------------------------------------------------
//
// Pitch decides how high the eye is; YAW decides where around the anchor it
// stands, and the terrain cannot see that on a flat arena. What can is the
// scene itself: a shot exists to show somebody, so the actor whose line it is
// should be INSIDE THE FRAME. Under a wrong yaw the eye swings to the far side
// and the camera films the empty field with the actor behind it.
//
// Only shots whose anchor is NOT already on the actor can say anything — when
// the camera orbits the speaker they are in frame whichever way it faces — so
// those are dropped, and what is left is the shots that had to be aimed.

interface Aimed { pose: Pose; actor: { x: number; y: number; z: number } }
const aimed: Aimed[] = [];
for (const [path, text] of texts) {
  if (!text.includes('<DialogScene>') && !text.includes('<DialogScene ')) continue;
  const scene = loadDialogScene(text);
  const stage = dirOf(resolveHref(dirOf(path), scene.stage));
  const sentences = find(parse(text), 'sentences');
  const itemsOf = sentences ? sentences.children.filter((c) => c.type === 'element') : [];
  scene.shots.forEach((shot, i) => {
    const link = shot.heroLink || shot.monsterLink;
    const setPath = shot.newCameraSet && resolveHref(dirOf(path), shot.newCameraSet);
    const setText = setPath && texts.get(setPath);
    if (!link || !setText) return;
    // The actor: written inside the sentence, or in a file beside the scene.
    let body = null;
    if (link.startsWith('#n:inline')) {
      const item = itemsOf[i];
      const el = item && (find(item, 'heroLink') ?? find(item, 'monsterLink'));
      body = el ? el.children.find((c) => c.type === 'element') ?? null : null;
    } else if (!link.startsWith('#')) {
      const t = texts.get(resolveHref(dirOf(path), link));
      body = t ? parse(t).children.find((c) => c.type === 'element' && c.name.startsWith('AdvMap')) ?? null : null;
    }
    const pos = body && body.type === 'element' ? find(body, 'Pos') : null;
    if (!pos) return;
    const set = find(parse(setText), 'DSceneCameraSet');
    const ref = set && find(set, 'StartCamera')?.attrs.href;
    const camText = ref && texts.get(resolveHref(dirOf(setPath as string), ref));
    const cam = camText ? find(parse(camText), 'DSceneCamera') : null;
    const cpos = cam && find(cam, 'Pos');
    const anchor = cpos && find(cpos, 'Anchor');
    if (!anchor) return;
    aimed.push({
      pose: {
        rod: Number(childText(cpos, 'Rod')), pitch: Number(childText(cpos, 'Pitch')),
        yaw: Number(childText(cpos, 'Yaw')),
        ax: Number(childText(anchor, 'x')), ay: Number(childText(anchor, 'y')), az: Number(childText(anchor, 'z')),
        stage,
      },
      // Tile index to the centre of its cell, in world units; a head is about a
      // unit up, which is what a shot is aimed at rather than the feet.
      actor: {
        x: (Number(childText(pos, 'x')) + 0.5) * 2,
        y: (Number(childText(pos, 'y')) + 0.5) * 2,
        z: Number(childText(pos, 'z')) + 1,
      },
    });
  });
}

const offActor = aimed.filter((a) => Math.hypot(a.pose.ax - a.actor.x, a.pose.ay - a.actor.y) > 6);
console.log(`\n  ${aimed.length} shots resolve to an actor and a camera; ${offActor.length} of them are aimed somewhere other than at the speaker`);
console.log('  is the speaker inside the 35° frame?');
for (const yawZero of ['x', 'y'] as const) {
  for (const yawSign of [1, -1] as const) {
    let inFrame = 0;
    for (const a of offActor) {
      const [ex, ey, ez] = eyeOf(a.pose, { frame: 'horizon', pitchSign: -1, yawZero, yawSign });
      const look = [a.pose.ax - ex, a.pose.ay - ey, a.pose.az - ez];
      const to = [a.actor.x - ex, a.actor.y - ey, a.actor.z - ez];
      const dot = look[0] * to[0] + look[1] * to[1] + look[2] * to[2];
      const cos = dot / (Math.hypot(...look) * Math.hypot(...to) || 1);
      if (Math.acos(Math.min(1, Math.max(-1, cos))) < (35 / 2) * Math.PI / 180) inFrame++;
    }
    const pc = ((inFrame / (offActor.length || 1)) * 100).toFixed(1);
    console.log(`    yaw from ${yawZero.toUpperCase()} ${yawSign > 0 ? '+' : '-'}   ${pc.padStart(5)}%  ${inFrame}`);
  }
}

const closeUps = usable.filter((p) => Math.abs(p.rod) < 20);
console.log(`\n  height of the eye above the ground, over the ${closeUps.length} close-ups (rod under 20):`);
for (const frame of ['horizon', 'zenith'] as const) {
  for (const pitchSign of [1, -1] as const) {
    const heights: number[] = [];
    for (const p of closeUps) {
      const stage = stageAt(p.stage)!;
      const [ex, ey, ez] = eyeOf(p, { frame, pitchSign, yawZero: 'x', yawSign: 1 });
      const g = ground(stage, ex, ey);
      if (g !== null) heights.push(ez - g);
    }
    heights.sort((a, b) => a - b);
    const at = (q: number) => heights[Math.floor((heights.length - 1) * q)]!.toFixed(1).padStart(7);
    console.log(`    pitch from ${frame.padEnd(8)} ${pitchSign > 0 ? '+' : '-'}   p10 ${at(0.1)}  median ${at(0.5)}  p90 ${at(0.9)}`);
  }
}
