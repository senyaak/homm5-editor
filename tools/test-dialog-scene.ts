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

/** The same, out of the mod archives — where the original campaigns' scenes live. */
function fromMods(): Doc[] {
  const docs: Doc[] = [];
  const mods = join(GAME, 'UserMODs');
  if (!existsSync(mods)) return docs;
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

const docs = all.filter((d) => SCENE_ROOTS.has(d.root));
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
// 4. What a camera is aimed at
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

console.log(`\n${failures ? `\x1b[31m${failures} failed\x1b[0m` : '\x1b[32mall checks passed\x1b[0m'}`);
process.exit(failures ? 1 : 0);
