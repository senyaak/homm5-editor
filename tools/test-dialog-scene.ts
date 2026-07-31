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
import { children, find, parse, serialize } from '../src/format/xml.ts';
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

interface Doc { name: string; text: string; root: string }

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

/** Every scene document on disk, under the folders scenes live in. */
function fromDisk(): Doc[] {
  const docs: Doc[] = [];
  for (const rel of ['DialogScenes', 'Maps/SmallSpecialArenas']) {
    for (const path of walk(join(DATA, rel))) {
      const text = readFileSync(path, 'utf8');
      const root = rootName(text);
      if (root && SCENE_ROOTS.has(root)) docs.push({ name: path.slice(DATA.length + 1), text, root });
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
      if (!entry.name.endsWith('.xdb') || !entry.name.startsWith('DialogScenes/')) continue;
      const text = entry.data.toString('utf8');
      const root = rootName(text);
      if (root && SCENE_ROOTS.has(root)) docs.push({ name: `${file}:${entry.name}`, text, root });
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

const docs = [...fromDisk(), ...fromMods()];
if (!docs.length) {
  console.log('dialog scenes: no game data (set HOMM5_DATA / HOMM5_ROOT) — skipped');
  process.exit(0);
}

console.log(`\ndialog scenes — ${docs.length} documents`);

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

console.log(`\n${failures ? `\x1b[31m${failures} failed\x1b[0m` : '\x1b[32mall checks passed\x1b[0m'}`);
process.exit(failures ? 1 : 0);
