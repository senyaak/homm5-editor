// C1M1 stage 11 — the mission's objectives, and the save it names.
//
// What the player sees in the quest log: four primary objectives for the first
// player (`prim1a`, `prim1`, `prim3`, `prim2`), each with a caption and a
// description in its own text file under `objectives/`. Plus the one entry in
// `Resources.SavesFilenames` — the save the mission makes, `scene1`.
//
// Both are lists of STRUCTURES, so each item is added with the tree's "+ add",
// which builds it from the schema with the declared defaults. What this stage
// then sets is only what a fresh item does NOT already have: the differences are
// taken from the original rather than written out here, so there is no second
// copy of the mission to keep in step.
//
// Idempotent: every value is read before it is written, and the lists are grown
// to the length the original has rather than appended to blindly.

import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchEditor } from './launch.ts';
import type { Launched } from './launch.ts';
import { settle } from './tiles.ts';
import { MAP_DIR, NEED_FIXTURE, FIXTURE, hasFixture, openMap } from './c1m1.ts';
import {
  addItem, addValueItem, listLength, listValues, openTree, setTreeTextRef, setTreeValue, treeValue,
} from './tree.ts';
import { loadMap } from '../src/map.ts';
import { readTree } from '../src/tree.ts';
import type { TreeData } from '../src/tree.ts';

let ed: Launched;

test.beforeAll(async () => { ed = await launchEditor(); });
test.afterAll(async () => { await ed?.app.close(); });

/** The two lists this stage fills, and where the original keeps them. */
const LISTS: (string | number)[][] = [
  ['Resources', 'SavesFilenames'],
  ['Objectives', 'Primary', 'PlayerSpecific', 0, 'Objectives'],
];

/** A field whose value is a text FILE, not a string — set through "New". */
const isTextRef = (name: string): boolean => /FileRef$/.test(name);

/**
 * Every non-empty leaf under a value, as [path, value].
 *
 * A list of plain strings is a leaf too — `Parameters` is one, holding the
 * object an objective is about (`zastava`, `Isabell`) — and it is written whole
 * rather than field by field.
 */
function leaves(
  v: TreeData | undefined, at: (string | number)[] = [],
): [(string | number)[], string | string[]][] {
  if (typeof v === 'string') return v === '' ? [] : [[at, v]];
  if (Array.isArray(v)) {
    const vals = v.filter((x): x is string => typeof x === 'string');
    return vals.length === v.length && vals.length ? [[at, vals]] : [];
  }
  if (!v) return [];
  return Object.entries(v).flatMap(([k, child]) => leaves(child, [...at, k]));
}

const at = (tree: TreeData | undefined, path: (string | number)[]): TreeData | undefined => {
  let cur = tree;
  for (const step of path) {
    if (cur === undefined || typeof cur === 'string') return undefined;
    cur = (cur as Record<string | number, TreeData>)[step];
  }
  return cur;
};

test('C1M1 objectives and its save name, built in the tree', async () => {
  test.skip(!hasFixture(), NEED_FIXTURE);
  test.setTimeout(60 * 60_000);
  const { page } = ed;

  const original = loadMap(readFileSync(join(FIXTURE, '..', 'C1M1.xdb'), 'utf8'));
  const want = readTree(original.desc) as Record<string, TreeData>;

  await openMap(page);
  await openTree(page);

  let set = 0;
  for (const list of LISTS) {
    const items = at(want, list);
    const wanted = Array.isArray(items) ? items : [];
    // Grow the list to length first: an item is appended, so every index has to
    // exist before anything can be written into one.
    let have = await listLength(page, list);
    for (; have < wanted.length; have++) await addItem(page, list);
    console.log(`${list.join('.')}: ${wanted.length} item(s)`);

    for (let i = 0; i < wanted.length; i++) {
      for (const [rel, value] of leaves(wanted[i])) {
        const path = [...list, i, ...rel];
        const field = String(rel[rel.length - 1]);
        if (Array.isArray(value)) {
          const has = await listValues(page, path);
          for (const v of value) {
            if (has.includes(v)) continue;
            await addValueItem(page, path, v);
            set++;
          }
          continue;
        }
        if (isTextRef(field)) {
          // Pointed again when the ref is right but the FILE is not there: a ref
          // to a file that does not exist is a ref to nothing, and "New" is what
          // creates it — along with the objectives/ folder the original keeps
          // its texts in.
          if ((await treeValue(page, path)) === value && existsSync(join(MAP_DIR, value))) continue;
          await setTreeTextRef(page, path, value);
        } else {
          if ((await treeValue(page, path)) === value) continue;
          await setTreeValue(page, path, value);
        }
        set++;
      }
    }
  }
  console.log(`objectives: ${set} value(s) set`);

  await settle(page);
  if (await page.locator('#save').isEnabled()) await page.locator('#save').click();
  await expect(page.locator('#save')).toBeDisabled({ timeout: 120_000 });

  // --- what landed in the file ---
  const built = readTree(loadMap(readFileSync(join(MAP_DIR, 'map.xdb'), 'utf8')).desc) as Record<string, TreeData>;
  const wrong: string[] = [];
  for (const list of LISTS) {
    const wanted = Array.isArray(at(want, list)) ? at(want, list) as TreeData[] : [];
    const got = Array.isArray(at(built, list)) ? at(built, list) as TreeData[] : [];
    if (got.length !== wanted.length) {
      wrong.push(`${list.join('.')}: ${got.length} item(s) instead of ${wanted.length}`);
      continue;
    }
    wanted.forEach((item, i) => {
      for (const [rel, value] of leaves(item)) {
        const g = at(built, [...list, i, ...rel]);
        if (Array.isArray(value)) {
          const got = Array.isArray(g) ? g.filter((x): x is string => typeof x === 'string') : [];
          if (got.join('|') !== value.join('|')) {
            wrong.push(`${[...list, i, ...rel].join('.')}: [${got.join(', ')}] instead of [${value.join(', ')}]`);
          }
          continue;
        }
        const have = typeof g === 'string' ? g : '';
        // A reference's case and leading slash vary between editor versions.
        if (have === value) continue;
        if (have.toLowerCase().replace(/^\//, '') === value.toLowerCase().replace(/^\//, '')) continue;
        wrong.push(`${[...list, i, ...rel].join('.')}: "${have}" instead of "${value}"`);
      }
    });
  }
  // Every text a ref names has to BE there. A ref into objectives/ pointing at
  // nothing reads as fine in the file and shows the player an empty quest.
  const missing: string[] = [];
  for (const list of LISTS) {
    const wanted = Array.isArray(at(built, list)) ? at(built, list) as TreeData[] : [];
    wanted.forEach((item, i) => {
      for (const [rel, value] of leaves(item)) {
        if (Array.isArray(value) || !isTextRef(String(rel[rel.length - 1]))) continue;
        if (!existsSync(join(MAP_DIR, value))) missing.push(`${[...list, i, ...rel].join('.')} -> ${value}`);
      }
    });
  }
  expect(missing, `text files a ref names but the map does not have (${missing.length})`).toEqual([]);
  expect(wrong, `objective values that differ (${wrong.length})`).toEqual([]);
});
