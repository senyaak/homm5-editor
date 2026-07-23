// C1M1 stage 13 — the mission's actual texts.
//
// A campaign mission takes its visible strings from the localized text archive,
// not the map folder, so the reconstruction has carried empty placeholders where
// the name, description and objectives should read. This fills them with the
// ORIGINAL strings — extracted into the fixture's texts/ from
// All_campaigns.texts_en.h5u (`npm run extract-fixture C1M1`) — and checks every
// file matches, byte for byte, in the UTF-16LE the game reads.
//
// Written through the app's own file API (the path the text editor saves by),
// the same way the scripts stage wrote the Lua: a mission's texts are content
// taken from the reference, not a UI gesture to reproduce key by key — the editor
// typing path is covered on its own by e2e/text-authoring.spec.ts.
//
// Because they are the game's copyrighted strings, the texts live only in the
// git-ignored fixture, regenerated from the player's own copy; nothing here
// embeds them.

import { test, expect } from '@playwright/test';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { launchEditor } from '../launch.ts';
import type { Launched } from '../launch.ts';
import { MAP_DIR, FIXTURE, NEED_FIXTURE, openMap, requireFixture } from './shared.ts';

let ed: Launched;
const TEXTS = join(FIXTURE, '..', 'texts');

test.beforeAll(async () => { ed = await launchEditor(); });
test.afterAll(async () => { await ed?.app.close(); });

/** A map text is UTF-16LE with a BOM; decode it to compare content. */
function decode(buf: Buffer): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le', 2);
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.toString('utf8', 3);
  return buf.toString('utf8');
}

/** Every text file under `dir`, as posix paths relative to it. */
function allTexts(dir: string, rel = ''): string[] {
  const out: string[] = [];
  for (const e of readdirSync(join(dir, rel))) {
    const r = rel ? `${rel}/${e}` : e;
    if (statSync(join(dir, r)).isDirectory()) out.push(...allTexts(dir, r));
    else if (/\.txt$/i.test(e)) out.push(r);
  }
  return out;
}

test('C1M1 texts: the original strings, authored into the map and matching', async () => {
  requireFixture({ ok: existsSync(TEXTS), need: `${NEED_FIXTURE} (texts too)` });
  test.setTimeout(5 * 60_000);
  const { page } = ed;

  await openMap(page);

  const files = allTexts(TEXTS);
  expect(files.length, 'the fixture carries the mission texts').toBeGreaterThan(10);

  // Write each original string to its file through the app's file API — the same
  // write the text editor performs on Save, encoding included.
  for (const rel of files) {
    const text = decode(readFileSync(join(TEXTS, rel)));
    await page.evaluate(([href, t]) => window.editor.writeFile({ href: href!, text: t! }), [rel, text]);
  }
  console.log(`texts: ${files.length} file(s) authored`);

  // Every one matches the original — content, and the bytes the game reads.
  const wrong: string[] = [];
  for (const rel of files) {
    const want = readFileSync(join(TEXTS, rel));
    const on = join(MAP_DIR, rel);
    if (!existsSync(on)) { wrong.push(`${rel}: not written`); continue; }
    const got = readFileSync(on);
    if (got.equals(want)) continue;
    if (decode(got) !== decode(want)) wrong.push(`${rel}: content differs`);
    else wrong.push(`${rel}: bytes differ (${got.length} vs ${want.length})`);
  }
  expect(wrong, `texts that do not match the original (${wrong.length})`).toEqual([]);

  // The strings really are the mission's — a spot check that reads like English,
  // so a silent all-empty pass can't happen.
  expect(decode(readFileSync(join(MAP_DIR, 'name.txt'))).length, 'the map has a name').toBeGreaterThan(0);
  expect(decode(readFileSync(join(MAP_DIR, 'objectives/prim1_name.txt'))).length, 'an objective has a caption').toBeGreaterThan(0);
});
