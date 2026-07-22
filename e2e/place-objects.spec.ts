// Place objects in the real app and check the SAVED FILE against the
// measurement.
//
// The unit tests place objects by calling the model directly. This one runs the
// editor: a new map through its own dialog, objects placed through the
// catalogue and the real IPC path, Save, and then the map.xdb that landed on
// disk is read back and every object compared, field by field, against what the
// original editor writes for a new object of that type
// (tools/fixtures/object-defaults.json, see docs/OBJECT_DEFAULTS.md).
//
// That is a different claim from the unit suite's. There, the defaults reach
// the DOM. Here they survive the whole stack — catalogue lookup, donor
// selection from the game's own maps, the registry roster, undo recording,
// serialisation — and come out of a file the game would load. A field lost
// between the model and the file would pass every unit check and fail here.
//
// Needs the game data (the catalogue and the donors come from it), so it skips
// itself when there is none.

import { test, expect } from '@playwright/test';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { launchEditor, REPO_ROOT } from './launch.ts';
import type { Launched } from './launch.ts';
import { loadMap } from '../src/map.ts';
import { parse, find, serialize } from '../src/xml.ts';
import { objectProps } from '../src/schema.ts';
import type { XmlElement } from '../src/xml.ts';

let ed: Launched;

const NAME = 'e2e Place Objects';
const DATA = process.env.HOMM5_DATA || join(REPO_ROOT, 'samples', 'paks', 'data');
const MAP_DIR = join(DATA, 'Maps', 'SingleMissions', NAME);
const FIXTURE = join(REPO_ROOT, 'tools', 'fixtures', 'object-defaults.json');

/** Placement, not defaults; spellIDs is the installation's roster. */
const SKIP = new Set(['Pos', 'Rot', 'Floor', 'Name', 'Shared', 'spellIDs']);

function cleanup(): void {
  if (existsSync(MAP_DIR)) rmSync(MAP_DIR, { recursive: true, force: true });
}

/** The measured default body for each type, as an element to look fields up in. */
function expected(): Map<string, XmlElement> {
  const { types } = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { types: Record<string, string> };
  const out = new Map<string, XmlElement>();
  for (const [type, body] of Object.entries(types)) out.set(type, find(parse(`<${type}>${body}</${type}>`), type)!);
  return out;
}

/**
 * Compare a saved field against the measured one, element by element.
 *
 * Not by serialising both and comparing text: a field the donor's game version
 * did not have is missing from ours, and a text compare of a whole structure
 * reports that as "everything after here differs". Walking it says which field,
 * and separates the two outcomes that mean different things — a WRONG value
 * (`diffs`, a failure) and a field we could not write at all (`absent`, a
 * known cost of building from a donor).
 */
function compare(mine: XmlElement, theirs: XmlElement, path: string, diffs: string[], absent: string[]): void {
  const kidsA = mine.children.filter((c): c is XmlElement => c.type === 'element');
  const kidsB = theirs.children.filter((c): c is XmlElement => c.type === 'element');
  if (kidsB.length) {
    // Repeated names (a list of <Item>) are matched in order; named fields by name.
    const byName = (kids: XmlElement[]): Map<string, XmlElement[]> => {
      const m = new Map<string, XmlElement[]>();
      for (const k of kids) { if (!m.has(k.name)) m.set(k.name, []); m.get(k.name)!.push(k); }
      return m;
    };
    const a = byName(kidsA), b = byName(kidsB);
    for (const [name, list] of b) {
      const ours = a.get(name);
      if (!ours) { absent.push(`${path}/${name}`); continue; }
      if (ours.length !== list.length) {
        diffs.push(`${path}/${name}: saved ${ours.length}, expected ${list.length}`);
        continue;
      }
      list.forEach((el, i) => compare(ours[i]!, el, `${path}/${name}`, diffs, absent));
    }
    for (const name of a.keys()) if (!b.has(name)) diffs.push(`${path}/${name}: we wrote a field the original does not`);
    return;
  }
  const text = (e: XmlElement): string => e.children.map((c) => (c.type === 'element' ? '' : c.text)).join('').trim();
  if (text(mine) !== text(theirs)) diffs.push(`${path}: saved "${text(mine)}", expected "${text(theirs)}"`);
  if (mine.attrs.href !== theirs.attrs.href) {
    diffs.push(`${path}: saved href ${JSON.stringify(mine.attrs.href)}, expected ${JSON.stringify(theirs.attrs.href)}`);
  }
}

test.beforeAll(async () => { cleanup(); ed = await launchEditor(); });
test.afterAll(async () => { await ed?.app.close(); cleanup(); });

test('objects placed in the app are saved at the measured defaults', async () => {
  test.skip(!existsSync(join(DATA, 'MapObjects')), 'needs the game data');
  test.setTimeout(300_000);
  const { page } = ed;

  // --- a new map, through the dialog ---
  await page.locator('#newmapbtn').click();
  await page.locator('#nm-name').fill(NAME);
  await page.locator('#nm-size').selectOption('72');
  await page.locator('#nm-ok').click();
  await expect(page.locator('#newmap')).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('#title')).toContainText(NAME, { timeout: 60_000 });

  // --- one object of every type the catalogue offers ---
  //
  // Which entry is placed does not matter, only its type — but a third of the
  // catalogue has no mesh we can decode yet and placement refuses those, so
  // each type is tried until one lands. What actually got placed is reported,
  // because a type silently skipped would make this test pass by doing nothing.
  const placed = await page.evaluate(async () => {
    const { objects } = await window.editor.listObjects();
    const byType = new Map<string, { shared: string; name: string }[]>();
    for (const o of objects) {
      if (o.hidden || o.random) continue;
      if (!byType.has(o.type)) byType.set(o.type, []);
      byType.get(o.type)!.push({ shared: o.shared, name: o.name });
    }
    const done: Record<string, string> = {};
    const failed: Record<string, string> = {};
    let x = 4, y = 4;
    for (const [type, entries] of byType) {
      for (const e of entries.slice(0, 12)) {
        try {
          await window.editor.addObject({ type, shared: e.shared, x, y, floor: 0, r: 0 });
          done[type] = e.name;
          x += 4; if (x > 60) { x = 4; y += 4; }
          break;
        } catch (err) {
          failed[type] = String((err as Error).message ?? err);
        }
      }
    }
    return { done, failed };
  });

  const types = Object.keys(placed.done).sort();
  console.log(`placed ${types.length} types: ${types.join(', ')}`);
  for (const [t, why] of Object.entries(placed.failed)) {
    if (!placed.done[t]) console.log(`  could not place ${t}: ${why}`);
  }
  expect(types.length, 'at least a few types could be placed').toBeGreaterThan(3);

  // --- save, and read what landed on disk ---
  //
  // Through the same IPC the Save button calls. Not the button itself: it is
  // enabled by the renderer's own dirty flag, which the drag-and-drop path sets
  // and this one does not — and what is under test is the file, not the button.
  const savedTo = await page.evaluate(() => window.editor.save());
  expect(savedTo.status).toBeTruthy();

  const saved = loadMap(readFileSync(join(MAP_DIR, 'map.xdb'), 'latin1'));
  const want = expected();
  console.log(`saved file holds ${saved.objects.length} objects: ${types.length} types placed`);
  // The first object on a map that had none is the case that used to be lost:
  // `<objects/>` is self-closing, and a self-closing element once serialised
  // without its children. Everything below would pass vacuously if it recurred.
  expect(saved.objects.length, 'the objects reached the file at all').toBe(types.length);

  for (const type of types) {
    const objs = saved.objectsOfType(type);
    expect(objs, `${type} is in the saved file`).toHaveLength(1);
    const body = objs[0]!.el;
    const ref = want.get(type);
    if (!ref) { console.log(`  (no measurement for ${type})`); continue; }

    const diffs: string[] = [];
    const absent: string[] = [];
    for (const field of Object.keys(objectProps(type))) {
      if (SKIP.has(field)) continue;
      const mine = find(body, field);
      const theirs = find(ref, field);
      if (!mine || !theirs) continue;
      compare(mine, theirs, field, diffs, absent);
    }
    expect(diffs, `${type} matches the measured default`).toEqual([]);
    // Not a failure: the donor is a real object from a shipped map, and a field
    // its game version predates cannot be written into it (see src/defaults.ts).
    // Reported so the cost of the donor approach stays visible — the fix is to
    // take field sets from the game's own spec, see the ROADMAP item.
    if (absent.length) console.log(`  ${type}: donor has no ${absent.join(', ')}`);

    // And the thing the original does NOT do: every object comes out with a
    // script handle, because one without cannot be addressed from Lua.
    expect(objs[0]!.name, `${type} has a generated handle`).toMatch(/^[A-Z][A-Z_]*_\d{3}$/);
  }

  // Handles are unique across the whole map, not merely per type.
  expect(saved.namesInUse().size).toBe(saved.objects.length);
});
