// Dialog scenes: the shipped corpus survives our XML layer untouched.
//
// A scene is authored, not generated — 65 of them in the unpacked data and the
// campaign ones inside UserMODs archives, each a hand-made document full of
// inline actors, camera pairs and per-line animation lists. Before any editing
// UI sits on top of that, the floor has to be proven: parse every scene
// document we can find and serialize it back BYTE-FOR-BYTE. A scene the editor
// merely opened must not come out different.
//
// It also prints a census (what a sentence actually uses, how actors are
// stored, camera ranges), which is what docs/DIALOG_SCENES.md is written from —
// the UI should follow what the 250 shipped scenes do, not what the type
// declares.
//
// Needs the game data: HOMM5_DATA (or <repo>/data-unpacked) plus, for the
// original campaigns' scenes, the game root's UserMODs/*.h5u. Skips itself when
// neither is there.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { childText, children, find, parse, serialize } from '../src/format/xml.ts';
import type { XmlElement } from '../src/format/xml.ts';
import { readEntries } from '../src/format/pak.ts';
import { loadDialogScene, saveDialogScene } from '../src/dialog/dialog-scene.ts';
import { cameraShot, eyeOf, loadCamera, loadCameraSet, poseAt, poseFrom } from '../src/dialog/camera.ts';
import { dirOf, resolveHref } from '../src/scene/xdb.ts';
import { assets } from '../src/game/assets.ts';
import { buildScene } from '../src/scene/scene.ts';
import { extractMapFolder, gameArchives } from '../src/map/map-source.ts';
import { stageObjects } from '../src/dialog/stage.ts';
import { actorRigs } from '../src/dialog/actors.ts';
import { buildScenePlay } from '../src/dialog/play.ts';
import { PLAYER_COLOURS } from '../src/scene/colour-models.ts';
import { mkdirSync } from 'node:fs';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const DATA = process.env.HOMM5_DATA ?? join(import.meta.dirname, '..', 'data-unpacked');
const GAME = process.env.HOMM5_ROOT ?? resolve(DATA, '..', '..');

/** The document kinds a dialog scene is made of. */
const SCENE_ROOTS = new Set([
  'DialogScene', 'DSceneCamera', 'DSceneCameraSet', 'DialogScenesList',
  'DialogSceneCamera', 'DialogSceneCameraSet',
]);

/**
 * Where the parts of a scene live. `Dialogs/` is the shared camera library the
 * campaigns draw on — a scene's own folder holds the cameras made for it, and
 * every second shot points at a stock one over there instead.
 */
const SCENE_FOLDERS = ['DialogScenes', 'Dialogs', 'Maps/SmallSpecialArenas'];

/**
 * One document. `path` is where the GAME sees it — the data-root-relative path,
 * slashes forward — whether it came off disk or out of an archive, because a
 * scene's own references (`Agrael.xdb`, `A1camera.xdb`) are relative to that,
 * not to which file happens to carry it.
 */
interface Doc { name: string; path: string; text: string; root: string }

/** The root element's name, without parsing the whole document. */
function rootName(text: string): string | null {
  return /<([A-Za-z_][\w.-]*)[\s>]/.exec(text.replace(/<\?[\s\S]*?\?>/g, ''))?.[1] ?? null;
}

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.xdb')) out.push(p);
  }
  return out;
}

/** Every document on disk under the folders scenes live in — actors included. */
function fromDisk(): Doc[] {
  const docs: Doc[] = [];
  for (const rel of SCENE_FOLDERS) {
    for (const p of walk(join(DATA, rel))) {
      const text = readFileSync(p, 'utf8');
      const root = rootName(text);
      const path = p.slice(DATA.length + 1).replaceAll('\\', '/');
      if (root) docs.push({ name: path, path, text, root });
    }
  }
  return docs;
}

/**
 * The same, out of the mod archives — where the original campaigns' scenes live.
 *
 * Say so when they are not there. Half the corpus (every C1..C6 scene, and the
 * shared camera library they point into) ships inside UserMODs/*.h5u, so a run
 * without them still passes every check on a quarter of the material — which
 * reads like a green suite and is not one.
 */
function fromMods(): Doc[] {
  const docs: Doc[] = [];
  const mods = join(GAME, 'UserMODs');
  if (!existsSync(mods)) {
    console.log(`  (no UserMODs at ${mods} — the campaigns' scenes are not in this run; set HOMM5_ROOT)`);
    return docs;
  }
  for (const file of readdirSync(mods)) {
    if (!/\.(h5u|pak)$/i.test(file)) continue;
    for (const entry of readEntries(readFileSync(join(mods, file)))) {
      if (!entry.name.endsWith('.xdb') || !SCENE_FOLDERS.some((f) => entry.name.startsWith(`${f}/`))) continue;
      const text = entry.data.toString('utf8');
      const root = rootName(text);
      if (root) docs.push({ name: `${file}:${entry.name}`, path: entry.name, text, root });
    }
  }
  return docs;
}

/** Where the two texts first differ, with a little context either side. */
function firstDiff(a: string, b: string): string {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const near = (s: string) => JSON.stringify(s.slice(Math.max(0, i - 30), i + 30));
  return `at offset ${i}: was ${near(a)}, got ${near(b)}`;
}

const all = [...fromDisk(), ...fromMods()];
// Every document by the path the game addresses it with, most specific first —
// disk before archives, which is also the order a mounted read resolves.
const byPath = new Map<string, Doc>();
for (const d of all) if (!byPath.has(d.path)) byPath.set(d.path, d);

// One entry per PATH, not per file read: a scene the data ships and a mod
// overrides is one document to the game, and counting both would inflate every
// number this prints (the disk copy and the archive copy of the same scene).
const docs = [...byPath.values()].filter((d) => SCENE_ROOTS.has(d.root));
if (!docs.length) {
  console.log('dialog scenes: no game data (set HOMM5_DATA / HOMM5_ROOT) — skipped');
  process.exit(0);
}

console.log(`\ndialog scenes — ${docs.length} documents (of ${all.length} read)`);

// ---------------------------------------------------------------------------
// 1. Round-trip
// ---------------------------------------------------------------------------

const byRoot = new Map<string, number>();
const broken: string[] = [];
for (const doc of docs) {
  byRoot.set(doc.root, (byRoot.get(doc.root) ?? 0) + 1);
  const out = serialize(parse(doc.text));
  if (out !== doc.text) broken.push(`${doc.name} ${firstDiff(doc.text, out)}`);
}
for (const [root, n] of [...byRoot].sort((a, b) => b[1] - a[1])) console.log(`    ${root.padEnd(22)} ${n}`);
check('every scene document round-trips byte-for-byte', broken.length === 0,
  broken.length ? `${broken.length} differ, first: ${broken[0]}` : '');

// ---------------------------------------------------------------------------
// 2. Census — what the corpus actually uses
// ---------------------------------------------------------------------------

// Counted over the parsed tree, not the text: a sentence holds nested <Item>
// lists (sounds, effects, animations), so splitting the text on <Item> cuts
// every sentence short at its first nested one and undercounts everything that
// follows — AdditionalCameras came out at 6 instead of 117 that way.
const scenes = docs.filter((d) => d.root === 'DialogScene');
let sentences = 0, inlineActors = 0, siblingActors = 0, withMonster = 0;
const fieldUse = new Map<string, number>();
const animKinds = new Map<string, number>();

/** A field is in use when it has children, text, or a non-empty href. */
function used(field: XmlElement): boolean {
  if (field.attrs.href !== undefined) return field.attrs.href !== '';
  return field.children.some((c) => c.type === 'element' || (c.type === 'text' && c.text.trim() !== ''));
}

for (const scene of scenes) {
  const root = find(parse(scene.text), 'DialogScene');
  const list = root && find(root, 'sentences');
  for (const item of list ? children(list) : []) {
    sentences++;
    const hero = find(item, 'heroLink');
    if (hero?.attrs.href?.startsWith('#n:inline')) inlineActors++;
    else if (hero && used(hero)) siblingActors++;
    const monster = find(item, 'monsterLink');
    if (monster && used(monster)) withMonster++;
    for (const field of children(item)) {
      if (used(field)) fieldUse.set(field.name, (fieldUse.get(field.name) ?? 0) + 1);
    }
  }
  for (const m of scene.text.matchAll(/<AnimName>([^<]+)<\/AnimName>/g)) {
    animKinds.set(m[1], (animKinds.get(m[1]) ?? 0) + 1);
  }
}

console.log(`\n  ${scenes.length} scenes, ${sentences} sentences`);
console.log(`    actor inline in the scene   ${inlineActors}`);
console.log(`    actor in a sibling file     ${siblingActors}`);
console.log(`    line spoken by a monster    ${withMonster}`);
check('both actor styles are present (inline and sibling file)', inlineActors > 0 && siblingActors > 0,
  `inline ${inlineActors}, sibling ${siblingActors}`);

// References and lists: how many of the 2386 sentences fill this in at all.
const interesting = [
  'sound', 'heroLink', 'monsterLink', 'NewCameraSet', 'cameraSet',
  'CustomSounds', 'CustomEffects', 'CustomAnimations', 'AdditionalCameras',
  'CustomAmbientLight', 'MusicOverride', 'AnimName',
];
console.log('\n  per-sentence fields in use:');
for (const f of interesting) console.log(`    ${f.padEnd(22)} ${fieldUse.get(f) ?? 0}`);

// Scalars are always written, so "in use" says nothing about them — what the UI
// needs to know is how often they are moved off their default.
console.log('\n  scalars away from their default:');
for (const [field, dflt] of [['DynamicCamera', 'true'], ['ActorAnimationIndex', '-1'], ['StopAmbient', 'false'], ['StopMusic', 'false']] as const) {
  let off = 0;
  for (const scene of scenes) {
    for (const m of scene.text.matchAll(new RegExp(`<${field}>([^<]*)</${field}>`, 'g'))) if (m[1] !== dflt) off++;
  }
  console.log(`    ${field.padEnd(22)} ${off} (default ${dflt})`);
}

console.log('\n  animation clips named by scenes:');
for (const [kind, n] of [...animKinds].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  console.log(`    ${kind.padEnd(22)} ${n}`);
}

// ---------------------------------------------------------------------------
// 3. Cameras — the orbit parameters, so the viewport knows their range
// ---------------------------------------------------------------------------

const cams = docs.filter((d) => d.root === 'DSceneCamera');
const nums = (text: string, tag: string): number | null => {
  const m = new RegExp(`<${tag}>([-0-9.eE+]+)</${tag}>`).exec(text);
  return m ? Number(m[1]) : null;
};
const stat = (tag: string): string => {
  const v = cams.map((c) => nums(c.text, tag)).filter((x): x is number => x !== null);
  if (!v.length) return 'none';
  v.sort((a, b) => a - b);
  return `min ${v[0].toFixed(2)}  median ${v[v.length >> 1].toFixed(2)}  max ${v[v.length - 1].toFixed(2)}`;
};
console.log(`\n  ${cams.length} cameras`);
for (const tag of ['Rod', 'Pitch', 'Yaw', 'Roll', 'FOV']) console.log(`    ${tag.padEnd(6)} ${stat(tag)}`);
check('every camera is an orbit pose (Rod + angles + Anchor)',
  cams.every((c) => nums(c.text, 'Rod') !== null && /<Anchor>/.test(c.text)));

// ---------------------------------------------------------------------------
// 4. The typed document
// ---------------------------------------------------------------------------
//
// The read model the player and the inspector will work from, checked two ways:
// it must survive a load/save with the bytes intact (so opening a scene in the
// editor can never rewrite it), and it must actually see the moving parts of a
// real scene — C1M1's opening, the one with Isabell and Agrael, which is the
// richest the game ships.

const reloaded: string[] = [];
let shotsRead = 0, animationsRead = 0, effectsRead = 0;
for (const scene of scenes) {
  const doc = loadDialogScene(scene.text);
  if (saveDialogScene(doc) !== scene.text) reloaded.push(scene.name);
  shotsRead += doc.shots.length;
  for (const shot of doc.shots) {
    animationsRead += shot.animations.length;
    effectsRead += shot.effects.length;
  }
}
check('a scene loaded and saved through the document model is unchanged', reloaded.length === 0,
  reloaded.length ? `${reloaded.length} differ, first: ${reloaded[0]}` : '');
check('the document model reads every sentence', shotsRead === sentences, `${shotsRead} of ${sentences}`);
console.log(`    ${animationsRead} actor animations, ${effectsRead} placed effects across the corpus`);

// A delay is measured from the shot that writes it, and nothing keeps it inside
// that shot: read a scene as a row of islands and better than a quarter of what
// it schedules is dropped on the floor — the shot ends before the cue arrives,
// or the cue is written before the shot begins. Which is why the player runs
// the whole scene on ONE clock.
let cued = 0, late = 0, early = 0;
for (const scene of scenes) {
  for (const shot of loadDialogScene(scene.text).shots) {
    const span = shot.duration || 3;
    const delays = [
      ...(shot.animName || shot.actorAnimationIndex >= 0 ? [shot.animationDelay] : []),
      ...shot.animations.map((a) => a.animationDelay),
      ...shot.effects.map((e) => e.delay),
    ];
    for (const d of delays) { cued++; if (d > span) late++; else if (d < 0) early++; }
  }
}
check('a cue is a moment in the SCENE, not in its shot', late > 0 && early > 0,
  `${late} of ${cued} start after their shot has ended, ${early} before it begins`);

// A link does not only POINT at an actor — it can BE the declaration, body and
// all, and not only in a sentence: a CustomAnimation declares its own. Read
// only from `<objects>` and the sentences and most of a scene's cast is not on
// the field at all.
let byFile = 0, byIdRef = 0, declared = 0, declaredInAnim = 0;
for (const scene of scenes) {
  const root = find(parse(scene.text), 'DialogScene');
  const sentences = root && find(root, 'sentences');
  for (const shot of sentences ? children(sentences) : []) {
    const anims = find(shot, 'CustomAnimations');
    const groups: Array<[XmlElement, boolean]> = [[shot, false]];
    for (const a of anims ? children(anims) : []) groups.push([a, true]);
    for (const [el, inAnim] of groups) {
      for (const name of ['heroLink', 'monsterLink']) {
        const href = find(el, name)?.attrs.href;
        if (!href) continue;
        if (href.startsWith('#n:inline')) { declared++; if (inAnim) declaredInAnim++; }
        else if (href.startsWith('#xpointer')) byIdRef++;
        else byFile++;
      }
    }
  }
}
check('an actor can be declared inside the link that names them',
  declared > byFile && declaredInAnim > 0,
  `${declared} declared inline (${declaredInAnim} of them inside a CustomAnimation),`
  + ` ${byIdRef} mentioned by element id, ${byFile} in a file of their own`);

// A walk is a list of TILES and nothing else: no pace, no starting point, and
// (unlike an ordinary cue) always a clip named outright.
let walks = 0, paced = 0, unnamed = 0;
for (const scene of scenes) {
  for (const shot of loadDialogScene(scene.text).shots) {
    for (const a of shot.animations) {
      if (!a.movePoints.length) continue;
      walks++;
      if (a.movementSpeed) paced++;
      if (!a.animName) unnamed++;
    }
  }
}
check('a walk brings no pace of its own', walks > 0 && paced === 0 && unnamed === 0,
  `${walks} walks, ${paced} with a MovementSpeed, ${unnamed} without a clip name`);

const d1 = byPath.get('DialogScenes/C1/M1/D1/DialogScene.xdb');
if (!d1) console.log('  (C1M1 D1 is not in this run — it ships inside All_campaigns.data.h5u)');
else {
  const scene = loadDialogScene(d1.text);
  const walks = scene.shots.flatMap((s) => s.animations).filter((a) => a.movePoints.length);
  check('C1M1 D1 reads as the scene it is', scene.shots.length === 73 && scene.props.length > 100, [
    `${scene.shots.length} shots`, `${scene.props.length} props`,
    `stage ${scene.stage.split('#')[0].split('/').slice(-2)[0]}`,
    `${scene.shots.flatMap((s) => s.animations).length} animations, ${walks.length} of them walks`,
  ].join(', '));
  const spoken = scene.shots.filter((s) => s.heroLink || s.monsterLink).length;
  const framed = scene.shots.filter((s) => s.newCameraSet).length;
  check('every line in it has a speaker and a camera', spoken === 73 && framed === 73,
    `${spoken} speakers, ${framed} cameras`);
}

// ---------------------------------------------------------------------------
// 5. What a camera is aimed at
// ---------------------------------------------------------------------------
//
// Measured, not reasoned about. A shot's camera orbits an `Anchor`, and two
// things about it decide how the viewport has to place the camera: what unit it
// is in, and whether it sits on the actor who speaks.
//
// The unit is settled by range alone. Every stage is a 72-tile arena, so an
// anchor in TILES could never exceed 72 — and plenty of them do, right up to
// twice that. World units it is, at 2 per tile, the same factor the rest of the
// renderer already runs on.
//
// Whether the anchor is the speaker is a weaker story, and worth knowing before
// the UI promises anything: many shots do sit on the actor, but the median is
// nowhere near zero. Wide shots, two-handers and cameras aimed at the LISTENER
// are all normal, so "frame the speaker" can be an offered default and never an
// assumption.

/** Resolve an href against the document carrying it, the way the game would. */
function resolveRef(href: string, from: string): Doc | null {
  const file = href.split('#')[0];
  if (!file) return null; // a pointer into the same document
  const parts = (file.startsWith('/') ? file.slice(1) : `${from.slice(0, from.lastIndexOf('/'))}/${file}`).split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p !== '.' && p !== '') out.push(p);
  }
  return byPath.get(out.join('/')) ?? null;
}

/** The `<Pos>` of an actor element, in tiles. */
function actorPos(el: XmlElement): { x: number; y: number; z: number } | null {
  const pos = find(el, 'Pos');
  if (!pos) return null;
  return { x: Number(childText(pos, 'x')), y: Number(childText(pos, 'y')), z: Number(childText(pos, 'z')) };
}

/** The actor a sentence's link points at, inline or in a sibling file. */
function linkedActor(link: XmlElement | null, scenePath: string): XmlElement | null {
  if (!link) return null;
  const href = link.attrs.href ?? '';
  if (!href) return null;
  if (href.startsWith('#n:inline')) return children(link)[0] ?? null;
  const doc = resolveRef(href, scenePath);
  if (!doc) return null;
  return find(parse(doc.text), doc.root);
}

const asTiles: number[] = [];
const asWorld: number[] = [];
let shots = 0, unresolved = 0;

for (const scene of scenes) {
  const root = find(parse(scene.text), 'DialogScene');
  const list = root && find(root, 'sentences');
  for (const item of list ? children(list) : []) {
    const actor = linkedActor(find(item, 'heroLink'), scene.path)
      ?? linkedActor(find(item, 'monsterLink'), scene.path);
    const pos = actor && actorPos(actor);
    const setRef = find(item, 'NewCameraSet')?.attrs.href;
    if (!pos || !setRef) continue;
    shots++;
    const set = resolveRef(setRef, scene.path);
    const camRef = set && find(parse(set.text), 'DSceneCameraSet');
    const cam = camRef && find(camRef, 'StartCamera')?.attrs.href
      ? resolveRef(find(camRef, 'StartCamera')!.attrs.href!, set!.path) : null;
    const anchor = cam && find(find(parse(cam.text), 'DSceneCamera') ?? cam as never, 'Pos');
    const a = anchor && find(anchor, 'Anchor');
    if (!a) { unresolved++; continue; }
    const ax = Number(childText(a, 'x')), ay = Number(childText(a, 'y'));
    asTiles.push(Math.hypot(ax - pos.x, ay - pos.y));
    asWorld.push(Math.hypot(ax - pos.x * 2, ay - pos.y * 2));
  }
}

const pct = (v: number[], p: number): number => (v.length ? [...v].sort((x, y) => x - y)[Math.floor((v.length - 1) * p)] : NaN);
const line = (label: string, v: number[]): string =>
  `    ${label.padEnd(28)} p10 ${pct(v, 0.1).toFixed(1)}  median ${pct(v, 0.5).toFixed(1)}  p90 ${pct(v, 0.9).toFixed(1)}`;

// The unit, from range: a 72-tile stage cannot hold a tile coordinate over 72.
const anchors: number[] = [];
for (const cam of cams) {
  const pos = find(parse(cam.text), 'DSceneCamera');
  const a = pos && find(find(pos, 'Pos') ?? pos, 'Anchor');
  if (!a) continue;
  anchors.push(Math.abs(Number(childText(a, 'x'))), Math.abs(Number(childText(a, 'y'))));
}
// A stage is 72 tiles (96 for the combat arenas a few scenes borrow), so 144 to
// 192 world units across. Coordinates past 72 cannot be tiles; the hundred-odd
// past 200 are off the stage entirely — 74 cameras, all in Hammers of Fate scenes,
// left pointing at nothing. Worth knowing before one of them is trusted as a
// reference, not worth chasing until the player runs those scenes.
const overTiles = anchors.filter((v) => v > 72).length;
const offStage = anchors.filter((v) => v > 200).length;
console.log(`\n  ${anchors.length} anchor coordinates, ${overTiles} past the 72-tile edge, ${offStage} off the stage (max ${Math.max(...anchors).toFixed(0)})`);
check('the anchor is in WORLD units — a tile is 2 of them', overTiles > anchors.length / 4,
  `${overTiles} of ${anchors.length} coordinates could not be tiles`);

console.log(`\n  ${shots} shots with both an actor and a camera (${unresolved} whose camera did not resolve)`);
console.log('  distance from the camera anchor to the speaking actor:');
console.log(line('anchor read as tiles', asTiles));
console.log(line('anchor read as world units', asWorld));
check('framing the speaker is a default, not a rule — a fifth of shots sit on them',
  asWorld.filter((d) => d < 6).length > asWorld.length / 5,
  `${asWorld.filter((d) => d < 6).length} of ${asWorld.length} shots anchor within 3 tiles of the speaker`);

// ---------------------------------------------------------------------------
// 6. The camera arithmetic
// ---------------------------------------------------------------------------
//
// Where the eye goes is measured (tools/camera-shape.ts, and the header of
// src/dialog/camera.ts). What is checked here is that the two directions agree
// — put a pose through eyeOf and back through poseFrom and the same pose comes
// out — because "use what I am looking at" is exactly that round trip, and a
// sign error in it would frame every captured shot backwards.

// Compared as EYE POSITIONS, not as angles. The same eye has more than one
// spelling — four shipped cameras carry a NEGATIVE rod, which is the same place
// written with the heading turned around, and a yaw past 2π is another. What
// must not move is where the camera ends up.
let worstPose = 0, posesChecked = 0, negativeRod = 0;
for (const cam of cams) {
  const pose = loadCamera(cam.text);
  if (Math.abs(pose.rod) < 1e-3) continue; // sitting on its own anchor: no heading to recover
  posesChecked++;
  if (pose.rod < 0) negativeRod++;
  const eye = eyeOf(pose);
  const again = eyeOf(poseFrom(eye, pose.anchor, pose.fov, pose.roll));
  worstPose = Math.max(worstPose, Math.hypot(again.x - eye.x, again.y - eye.y, again.z - eye.z));
}
check('a pose survives the trip through the viewport and back', worstPose < 1e-9,
  `${posesChecked} poses (${negativeRod} of them written with a negative rod), worst drift ${worstPose.toExponential(1)}`);

// The ends of a move are the poses it was built from — nothing creeps in from
// the easing, the corrections or the extra turns.
let worstEnd = 0, shotsChecked = 0;
for (const doc of docs.filter((d) => d.root === 'DSceneCameraSet')) {
  const set = loadCameraSet(doc.text);
  const startDoc = set.startCamera && byPath.get(resolveHref(dirOf(doc.path), set.startCamera));
  const finishDoc = set.finishCamera && byPath.get(resolveHref(dirOf(doc.path), set.finishCamera));
  if (!startDoc || !finishDoc || set.ignoreYawDiff || set.circles) continue;
  shotsChecked++;
  const shot = cameraShot(set, loadCamera(startDoc.text), loadCamera(finishDoc.text));
  const a = poseAt(shot, 0), b = poseAt(shot, 1);
  worstEnd = Math.max(worstEnd,
    Math.abs(a.rod - shot.start.rod), Math.abs(b.rod - shot.finish.rod),
    Math.abs(a.anchor.x - shot.start.anchor.x - set.startDiff.x),
    Math.abs(b.anchor.z - shot.finish.anchor.z - set.finishDiff.z));
}
check('a move starts and ends exactly on its two cameras', worstEnd < 1e-9,
  `${shotsChecked} moves, worst drift ${worstEnd.toExponential(1)}`);

// `Direction` is which WAY the heading goes, not "take the long way round".
// Read the other way it agreed with the two angles for a quarter of the sets
// and sent the rest 330° round the wrong side — Agrael's first cast, a straight
// pull-back in the game, orbited him. Under the right reading a sweep past half
// a turn is the rare deliberate one: the shot that swings behind somebody.
let sweeps = 0, laps = 0, agrees = 0, turning = 0;
for (const doc of docs.filter((d) => d.root === 'DSceneCameraSet')) {
  const set = loadCameraSet(doc.text);
  const startDoc = set.startCamera && byPath.get(resolveHref(dirOf(doc.path), set.startCamera));
  const finishDoc = set.finishCamera && byPath.get(resolveHref(dirOf(doc.path), set.finishCamera));
  if (!startDoc || !finishDoc || set.ignoreYawDiff || set.circles) continue;
  const shot = cameraShot(set, loadCamera(startDoc.text), loadCamera(finishDoc.text));
  const swept = Math.abs(poseAt(shot, 1).yaw - poseAt(shot, 0).yaw);
  if (swept < 1e-9) continue;
  sweeps++;
  if (swept > Math.PI) laps++;
  turning++;
  const plain = Math.abs(shot.finish.yaw + shot.finishCorrectionRot - shot.start.yaw - shot.startCorrectionRot);
  if ((plain < Math.PI ? plain : 2 * Math.PI - plain) - swept > -1e-9) agrees++;
}
check('a camera sweep is a turn, not a lap', laps < sweeps / 4,
  `${sweeps} sets turn at all, ${laps} of them past half a turn; the flag agrees with the short way in ${agrees}`);


// ---------------------------------------------------------------------------
// 7. The scene the campaign actually plays, drawn
// ---------------------------------------------------------------------------
//
// Everything above reads documents. This builds C1M1's opening the way the
// editor will: unpack its folder out of the archives, mount it over the data
// root, hand the stage and the scene's own objects to the scene builder, and
// rig the actors off their arena characters. It is the check that the parts
// still meet — a scene that parses perfectly and cannot be drawn is no use.

const SHOWCASE = 'DialogScenes/C1/M1/D1';
const showcasePath = `${SHOWCASE}/DialogScene.xdb`;
if (!byPath.has(showcasePath)) {
  console.log(`  (${SHOWCASE} is not in this run — it ships inside All_campaigns.data.h5u)`);
} else {
  const workspace = join(import.meta.dirname, '..', '_tmp', 'scene-stage');
  const roots = [DATA];
  if (!existsSync(join(DATA, showcasePath))) {
    mkdirSync(workspace, { recursive: true });
    const mods = join(GAME, 'UserMODs');
    const archives = [...gameArchives(GAME), ...(existsSync(mods)
      ? readdirSync(mods).filter((f) => /\.h5u$/i.test(f)).sort().map((f) => join(mods, f)) : [])];
    if (!existsSync(join(workspace, showcasePath))) extractMapFolder(archives, SHOWCASE, workspace);
    if (!existsSync(join(DATA, 'Dialogs')) && !existsSync(join(workspace, 'Dialogs'))) {
      extractMapFolder(archives, 'Dialogs', workspace);
    }
    roots.unshift(workspace);
  }
  const data = assets(roots);
  const scene = loadDialogScene(data.text(showcasePath)!);
  const objects = stageObjects(data, showcasePath, scene);
  const built = buildScene(data, data.path(resolveHref(dirOf(showcasePath), scene.stage)),
    { extraObjects: objects.map((o) => o.object) });
  const placed = built.scene.floors.reduce((a, f) => a + f.instances.length, 0);
  check('C1M1 D1 builds into a drawable stage', placed > 600 && built.skipped.length <= 1,
    `${built.scene.geoms.length} meshes, ${placed} placed, ${built.skipped.length} skipped${
      built.skipped.length ? ' (' + built.skipped.join(', ') + ')' : ''}`);

  // A figure the scene both LISTS and SPEAKS THROUGH is one figure. Placed
  // twice, an actor stands inside their own still adventure copy and every
  // close-up has two of them — which is how it looked before this held.
  const paths = objects.map((o) => o.href).filter((h) => h && !h.startsWith('#'));
  const twice = paths.filter((h, i) => paths.indexOf(h) !== i);
  check('nobody on the stage is placed twice', twice.length === 0,
    twice.length ? twice.join(', ') : `${objects.length} figures, each once`);

  // Which way does `<Rot>` point? A walk has to know, because an actor faces
  // the way they are going — and the two armies drawn up across this field from
  // each other say it outright. Measured against the three other readings of
  // the same two numbers, not assumed.
  const sides = objects
    .filter((o) => /MapObjects\/(Haven|Inferno)\//.test(o.object.shared ?? ''))
    .map((o) => ({ haven: /Haven/.test(o.object.shared!), x: o.object.pos?.x ?? 0, y: o.object.pos?.y ?? 0, rot: o.object.rot }));
  const readings: Record<string, (dx: number, dy: number) => number> = {
    'atan2(dx,dy)': (dx, dy) => Math.atan2(dx, dy),
    'atan2(dy,dx)': (dx, dy) => Math.atan2(dy, dx),
    '-atan2(dx,dy)': (dx, dy) => -Math.atan2(dx, dy),
    '-atan2(dy,dx)': (dx, dy) => -Math.atan2(dy, dx),
  };
  const facing: Record<string, number> = {};
  let facingOff = 0;
  for (const me of sides) {
    let near = null, best = Infinity;
    for (const other of sides) {
      if (other.haven === me.haven) continue;
      const d = Math.hypot(other.x - me.x, other.y - me.y);
      if (d < best) { best = d; near = other; }
    }
    if (!near || best > 20) continue;
    facingOff++;
    for (const [name, read] of Object.entries(readings)) {
      const d = ((read(near.x - me.x, near.y - me.y) - me.rot + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
      if (Math.abs(d - Math.PI) < Math.PI / 2) facing[name] = (facing[name] ?? 0) + 1;
    }
  }
  const ranked = Object.entries(facing).sort((a, b) => b[1] - a[1]);
  check('a facing is zero along +y and grows toward +x — the two armies say so',
    ranked[0]?.[0] === 'atan2(dx,dy)' && (ranked[0]?.[1] ?? 0) > 0.9 * facingOff,
    ranked.map(([k, v]) => `${k} ${v}`).join(', ') + ` of ${facingOff} facing an enemy`);

  const rigs = actorRigs(data, scene, objects);
  const baked = rigs.reduce((a, r) => a + Object.keys(r.clips).length, 0);
  // Eight speak; the rest are the armies behind them, cued by index alone.
  check('its actors rig off their ARENA characters', rigs.length === 45 && baked >= 15,
    `${rigs.length} actors, ${baked} clips baked, ${rigs[0]?.geom.skin?.bones.length ?? 0} bones on the first`);
  // The adventure set holds idle00 and move; anything past those could only
  // have come from the arena one, which is why an actor is resolved twice.
  const beyond = rigs.flatMap((r) => Object.keys(r.clips)).filter((k) => k !== 'idle00' && k !== 'move');
  check('and play clips the adventure set does not have', beyond.length > 0, `${beyond.length} clips`);
  const unmet = rigs.flatMap((r) => r.missing);
  check('every clip the scene names is in the set it plays from', unmet.length === 0, unmet.join(', '));
  // One mesh per CHARACTER, however many figures of it stand on the field:
  // six swordsmen of a kind are one decode and one thing sent to the renderer.
  const meshes = new Set(rigs.map((r) => r.geom));
  check('figures of one character share their mesh', meshes.size < rigs.length,
    `${meshes.size} meshes for ${rigs.length} figures`);

  // What the shots ask of them. Most cues name no clip at all — they carry an
  // index into the actor's own set — so counting cues is what tells whether
  // that reading works at all: by name alone C1M1's opening moves nobody in 34
  // of its 73 shots and never moves an army.
  const play = buildScenePlay(data, showcasePath, { samples: 2, texSize: 8 });
  const cued = play.shots.reduce((a, s) => a + s.cues.length, 0);
  const named = scene.shots.reduce((a, s) => a + (s.animName ? 1 : 0)
    + s.animations.filter((x) => x.animName).length, 0);
  check('a shot cues its actors by index as well as by name', cued > named * 2,
    `${cued} cues over ${play.shots.length} shots, only ${named} of them written as a name`);
  const known = new Map(play.actors.map((a) => [a.key, a]));
  const unplayable = play.shots.flatMap((s) => s.cues).filter((c) => !known.get(c.actor)?.clips[c.kind]);
  check('every cue lands on an actor who has that clip', unplayable.length === 0,
    unplayable.slice(0, 5).map((c) => `${c.actor}:${c.kind}`).join(', ') || `${cued} cues`);

  // Every shot's start on the scene's clock, and every cue with it. Nothing to
  // measure here — either the sums are right or the whole timeline is off — but
  // the numbers say how far outside their own shot the scene reaches.
  const spilled = play.shots.flatMap((s) => [...s.cues, ...s.effects]
    .filter((c) => c.at < s.start || c.at >= s.start + s.duration));
  check('and lands where the scene\'s own clock puts it',
    play.shots[0]!.start === 0 && spilled.length > 0,
    `${spilled.length} of ${cued + play.shots.reduce((a, s) => a + s.effects.length, 0)}`
    + ` fall outside the shot that writes them; the scene runs `
    + `${play.shots.at(-1)!.start + play.shots.at(-1)!.duration}s`);

  // An animation carries an effect of its own — the blue fire that runs up a
  // knight's sword as he casts is his `buff` clip's, not the scene's. A third
  // of what this scene does was happening in silence without them.
  const fired = play.shots.flatMap((s) => s.effects);
  const ofClips = fired.filter((e) => e.fromClip);
  check('an actor\'s clip brings its own effect', ofClips.length > fired.length / 3,
    `${ofClips.length} of ${fired.length} firings come from a clip, not from the scene`);

  // …and every piece of geometry a spell puts on the field knows when to go.
  // Left without one they stay: the praying hands of a Prayer stood inside the
  // soldier they were cast on for the rest of the scene.
  const models = fired.flatMap((e) => e.models);
  const endless = models.filter((m) => !m.life);
  check('an effect model plays its own clip and ends', models.length > 0 && endless.length === 0,
    `${models.length} models, ${models.filter((m) => m.geom.skin?.clip).length} animated,`
    + ` shortest ${Math.min(...models.map((m) => m.life)).toFixed(2)}s`);

  // A hero has nine bodies, one per player colour, and the top-level <Model> is
  // the WHITE one — so drawing that gives every hero of every player a white
  // banner. The data says the list is the colour enum twice over: nine PCOLOR_*
  // values, and nine <Item>s on every character that has any.
  const chars = walk(join(DATA, 'Characters'))
    .map((p) => readFileSync(p, 'utf8'))
    .filter((x) => x.includes('<ColourModels>'));
  const nine = chars.filter((x) =>
    (x.match(/<ColourModels>([\s\S]*?)<\/ColourModels>/)?.[1]?.match(/<Item href/g) ?? []).length
      === PLAYER_COLOURS.length);
  check('a coloured body is named once per player colour', chars.length > 0 && nine.length === chars.length,
    `${chars.length} characters carry <ColourModels>, ${nine.length} of them with`
    + ` ${PLAYER_COLOURS.length} entries — the length of the PCOLOR enum`);

  // And the two commanders of this scene wear the two colours their PlayerIDs
  // ask for. Agrael is PLAYER_1 and Isabell PLAYER_2 on an arena whose eight
  // players are every one of them PCOLOR_NEUTRAL, so the number is all there is
  // — and blue is the banner the game shows her carrying.
  const worn = play.actors.map((a) => a.model).filter((m) => /Heroes\//.test(m));
  check('and a hero wears the one his player flies',
    worn.some((m) => /Knight_Blue/.test(m)) && worn.some((m) => /DemonLord_Red/.test(m)),
    [...new Set(worn.map((m) => m.split('/').pop()))].join(', '));
}

console.log(`\n${failures ? `\x1b[31m${failures} failed\x1b[0m` : '\x1b[32mall checks passed\x1b[0m'}`);
process.exit(failures ? 1 : 0);
