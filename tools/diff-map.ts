// Compare a reconstruction's map SETTINGS against the original's — the third
// gap report, beside diff-terrain and diff-objects.
//
// Everything in `<AdvMapDesc>` except `<objects>`, which diff-objects owns:
// dimensions and rules, players and teams, objectives and rumours, the tile
// list, the regions with their script triggers, and the refs to the entities a
// map points at (ambient light, wind, birds, weather, the start scene).
//
// Compared as a TREE rather than as text: element order and float formatting
// differ between editor versions and mean nothing to the engine, while "player 3
// has the wrong starting town" means everything. Values are matched by path, so
// a difference says where it is.
//
// Usage: npm run diff-map _tmp/fixtures/C1M1/C1M1.xdb <ours>/map.xdb

import { readFileSync } from 'node:fs';
import { loadMap } from '../src/map.ts';
import type { HommMap } from '../src/map.ts';
import { readTree } from '../src/tree.ts';
import type { TreeData } from '../src/tree.ts';
import { buildBlankMap } from '../src/blank-map.ts';
import { mapSchema, resolveSchemaAtPath } from '../src/schema.ts';
import { defaultFor } from '../src/skeleton.ts';

const [refPath, ourPath] = process.argv.slice(2);
if (!refPath || !ourPath) {
  console.error('usage: node tools/diff-map.ts <original map.xdb> <ours map.xdb>');
  process.exit(2);
}

const A = loadMap(readFileSync(refPath, 'utf8'));
const B = loadMap(readFileSync(ourPath, 'utf8'));

let diffs = 0;
const ok = (name: string, detail = ''): void =>
  console.log(`  ok    ${name}${detail ? ' — ' + detail : ''}`);
const fail = (name: string, detail = ''): void => {
  diffs++;
  console.log(`  DIFF  ${name}${detail ? ' — ' + detail : ''}`);
};

/** Objects are diff-objects' subject; everything else here. */
const SKIP = new Set(['objects']);

/**
 * A reference as the engine reads it: case and a leading slash vary between
 * editor versions and the engine takes either, so they are normalised. What is
 * NOT normalised is the path itself — pointing at another file is a difference.
 */
const norm = (v: string): string => v.trim().toLowerCase().replace(/^\/+/, '');

/** True for the two spellings of an empty value. */
const empty = (v: TreeData | undefined): boolean =>
  v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

/** Numbers written differently (1 vs 1.0, 0.5000 vs 0.5) are the same value. */
function sameScalar(a: string, b: string): boolean {
  if (norm(a) === norm(b)) return true;
  const x = Number(a), y = Number(b);
  return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) < 1e-6;
}

interface Report { path: string; ref: string; ours: string }
const found: Report[] = [];

/**
 * What a map of this size looks like the moment New Map makes it.
 *
 * The third side of the comparison, and the one that separates "we authored
 * something the original does not have" from "the original's editor version did
 * not write this field at all". A blank carries `Version`, `HasSurface`, the RMG
 * block and eight scenario-information slots; C1M1 predates them. Judging that
 * by schema defaults would miss it — the skeleton is a document, not a set of
 * defaults — so the blank itself is the reference (`src/blank-map.ts`, whose
 * output is byte-identical to the original editor's own blank).
 */
// The rosters come from OURS, because that is what a fresh map is given: New Map
// enables every spell and artifact the installation has. Passing empty lists
// made those 450 entries look authored, when they are exactly what the blank
// wrote — while a spell we actually disabled would still show up, since then
// ours would no longer match the roster it was built from.
const listOf = (m: HommMap, name: string): string[] => {
  const v = (readTree(m.desc) as Record<string, TreeData>)[name];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
};
const blank = loadMap(buildBlankMap({
  tiles: A.tileX,
  twoLevel: A.hasUnderground,
  spells: listOf(B, 'spellIDs'),
  artifacts: listOf(B, 'artifactIDs'),
}));
let untouched = 0;
const untouchedFields = new Set<string>();

/**
 * What a freshly built item carries at this path, per the schema.
 *
 * The blank map is the first answer to "did we author this or is it just what
 * the editor writes", but it can only answer for things a blank HAS. An
 * objective we added ourselves has no counterpart in a blank at all, so its
 * fields — `CheckDelay`, `AllowMultipleActivations` — looked authored, when they
 * are exactly what the schema says a new item is born with (src/skeleton.ts,
 * which is also what built it).
 */
function builtDefault(steps: (string | number)[]): string | null {
  const f = resolveSchemaAtPath(mapSchema, steps);
  if (!f || f.type === 'object' || f.type === 'array') return null;
  return defaultFor(f);
}

/** Walk the three trees together, collecting differences by path. */
function walk(a: TreeData | undefined, b: TreeData | undefined, c: TreeData | undefined, path: string, steps: (string | number)[] = []): void {
  if (empty(a) && empty(b)) return;
  // Lists FIRST, and an empty element counts as an empty list. A list nobody
  // touched is written `<regions/>`, which reads back as the empty string — so
  // comparing strings first made "seventeen regions against none" look like two
  // empty values agreeing, and hid the whole regions subsystem from the report.
  if (Array.isArray(a) || Array.isArray(b)) {
    const al = Array.isArray(a) ? a : [], bl = Array.isArray(b) ? b : [];
    const cl = Array.isArray(c) ? c : [];
    if (al.length !== bl.length) {
      // A list the original does not have, still exactly as a blank leaves it,
      // is the blank's — the eight empty scenario-information slots, say.
      if (empty(a) && bl.length === cl.length) {
        untouched++; untouchedFields.add(`${path}[]`);
      } else {
        found.push({ path, ref: `${al.length} item(s)`, ours: `${bl.length} item(s)` });
      }
    }
    for (let i = 0; i < Math.max(al.length, bl.length); i++) {
      walk(al[i], bl[i], cl[i], `${path}[${i}]`, [...steps, i]);
    }
    return;
  }
  if (typeof a === 'string' || typeof b === 'string') {
    const av = typeof a === 'string' ? a : '', bv = typeof b === 'string' ? b : '';
    if (sameScalar(av, bv)) return;
    // Absent from the original, and exactly as a fresh map — or a freshly built
    // item — has it: not authored.
    const fresh = typeof c === 'string' ? c : builtDefault(steps);
    if (empty(a) && fresh !== null && sameScalar(fresh, bv)) {
      untouched++; untouchedFields.add(path.replace(/\[\d+\]/g, '[]'));
      return;
    }
    found.push({ path, ref: av, ours: bv });
    return;
  }
  const ao = (a ?? {}) as Record<string, TreeData>, bo = (b ?? {}) as Record<string, TreeData>;
  const co = (c ?? {}) as Record<string, TreeData>;
  for (const k of new Set([...Object.keys(ao), ...Object.keys(bo)])) {
    walk(ao[k], bo[k], co[k], path ? `${path}.${k}` : k, [...steps, k]);
  }
}

const treeA = readTree(A.desc) as Record<string, TreeData>;
const treeB = readTree(B.desc) as Record<string, TreeData>;
const treeBlank = readTree(blank.desc) as Record<string, TreeData>;

console.log(`ref  ${refPath}`);
console.log(`ours ${ourPath}\n`);

// --- section by section, so a report says which subsystem is behind ---------
//
// Grouped the way the original's own forms are: the map's rules, who plays it,
// what winning means, and the world around it.
const SECTIONS: [string, string[]][] = [
  ['SIZE AND RULES', ['CustomGameMap', 'TileX', 'TileY', 'HasUnderground', 'InitialFloor',
    'MapVersion', 'HeroMaxLevel', 'AllowedDifficulty', 'MapDifficulty', 'BorderSize',
    'ReflectiveWater', 'DisabledHeroes', 'DisabledArtifacts', 'DisabledSpells']],
  ['PLAYERS AND TEAMS', ['players', 'teams', 'CustomTeams', 'MaxTeams']],
  ['GOALS AND TEXT', ['objectives', 'Rumours', 'NameFileRef', 'DescriptionFileRef',
    'AllowedDifficultyMask']],
  ['THE WORLD', ['tiles', 'regions', 'Resources', 'AmbientLight', 'UndergroundAmbientLight',
    'GroundAmbientLights', 'UndergroundAmbientLights', 'Weathers', 'Winds', 'Birds',
    'Moons', 'StartScene', 'MapScript', 'GroundTerrainFileName', 'UndergroundTerrainFileName']],
];

const covered = new Set<string>(SECTIONS.flatMap(([, keys]) => keys));
const rest = [...new Set([...Object.keys(treeA), ...Object.keys(treeB)])]
  .filter((k) => !covered.has(k) && !SKIP.has(k));

/**
 * The tile set is a SET, not a sequence.
 *
 * `<tiles>` names the AdvMapTile documents the terrain paints with. The engine
 * looks a tile up in it; nothing indexes it — the original's own order matches
 * neither its terrain's layer order nor anything else, so it is that editor
 * session's history and not a property of the map. Compared sorted, so "the
 * same twelve tiles in a different order" is not twelve differences.
 */
const setLike = (k: string, v: TreeData | undefined): TreeData | undefined =>
  k === 'tiles' && Array.isArray(v)
    // Sorted the way they are COMPARED — case and leading slash folded — or two
    // spellings of the same path would sort into different places.
    ? [...v].sort((a, b) => norm(String(a)).localeCompare(norm(String(b))))
    : v;

for (const [title, keys] of [...SECTIONS, ['EVERYTHING ELSE', rest] as [string, string[]]]) {
  const present = keys.filter((k) => k in treeA || k in treeB);
  if (!present.length) continue;
  console.log(title);
  for (const k of present) {
    found.length = 0;
    walk(setLike(k, treeA[k]), setLike(k, treeB[k]), setLike(k, treeBlank[k]), k, [k]);
    if (!found.length) { ok(k); continue; }
    fail(k, `${found.length} difference(s)`);
    for (const f of found.slice(0, 6)) {
      console.log(`          ${f.path}: ref ${JSON.stringify(f.ref)} vs ours ${JSON.stringify(f.ours)}`);
    }
    if (found.length > 6) console.log(`          … ${found.length - 6} more`);
  }
  console.log('');
}

if (untouched) {
  console.log('FIELDS THE ORIGINAL DOES NOT HAVE, LEFT AS A FRESH MAP WRITES THEM');
  for (const f of [...untouchedFields].slice(0, 10)) console.log(`  ok    ${f}`);
  if (untouchedFields.size > 10) console.log(`  ok    … ${untouchedFields.size - 10} more`);
  console.log(`        ${untouched} value(s) on ${untouchedFields.size} field(s)\n`);
}

console.log(`${diffs} difference(s)`);
process.exit(diffs ? 1 : 0);
