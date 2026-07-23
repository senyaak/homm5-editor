// Localization: author a map's texts in several languages, side by side.
//
// The game reads ONE language — a text ref names a plain `name.txt` and the
// engine reads whatever bytes are there. So localization is the editor's: every
// language is kept as a TAGGED file (`name.en.txt`, `name.ru.txt`), and export
// (a separate step) bakes one back into the plain `name.txt`. This checks the
// authoring half end to end: enabling tags the existing texts, adding a language
// copies them, the text window's tabs edit each, and removing deletes them.
//
// On its OWN throwaway map, never the reconstruction: enabling renames every
// .txt, which would pull the ground out from under the other C1M1 specs.

import { test, expect } from '@playwright/test';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { launchEditor } from './launch.ts';
import type { Launched } from './launch.ts';
import { tmpdir } from 'node:os';
import { newMap } from './tiles.ts';
import { DATA } from './c1m1/shared.ts';
import { readEntries } from '../src/pak.ts';

let ed: Launched;
const NAME = 'e2e Localize';
const MAP_DIR = join(DATA, 'Maps', 'SingleMissions', NAME);

/** A map text is UTF-16LE with a BOM (what the game writes); decode it. */
function readTxt(rel: string): string {
  const buf = readFileSync(join(MAP_DIR, rel));
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le', 2);
  return buf.toString('utf8');
}
const has = (rel: string): boolean => existsSync(join(MAP_DIR, rel));

test.beforeAll(async () => { ed = await launchEditor(); });
test.afterAll(async () => {
  await ed?.app.close();
  if (existsSync(MAP_DIR)) rmSync(MAP_DIR, { recursive: true, force: true });
});

test('localize a map: enable tags the texts, a language copies them, tabs edit each', async () => {
  test.setTimeout(5 * 60_000);
  const { page } = ed;
  page.on('dialog', (d) => void d.accept());   // accept the "remove language?" confirm

  // A fresh map — it ships a name.txt and a description.txt.
  if (existsSync(MAP_DIR)) rmSync(MAP_DIR, { recursive: true, force: true });
  await newMap(page, NAME, '72');
  expect(has('name.txt'), 'a new map has name.txt').toBe(true);

  // --- enable: the existing texts are tagged with the base language ----------
  await page.locator('#locbtn').click();
  await expect(page.locator('#localize')).toBeVisible();
  await page.locator('#lz-body select').selectOption('en');
  await page.locator('#lz-body button', { hasText: 'Enable localization' }).click();
  await expect(async () => {
    expect(has('name.en.txt'), 'name.txt tagged to name.en.txt').toBe(true);
    expect(has('name.txt'), 'the untagged name.txt is gone (an export artefact only)').toBe(false);
    expect(has('description.en.txt'), 'description.txt tagged too').toBe(true);
  }).toPass({ timeout: 10_000 });

  // --- add Russian: a copy of every base text --------------------------------
  await page.locator('#lz-body select').selectOption('ru');
  await expect(async () => {
    expect(has('name.ru.txt'), 'name.ru.txt provisioned as a copy').toBe(true);
    expect(has('description.ru.txt'), 'description.ru.txt provisioned').toBe(true);
  }).toPass({ timeout: 10_000 });
  // The copy starts as the base text, so a translator edits in place.
  expect(readTxt('name.ru.txt')).toBe(readTxt('name.en.txt'));
  await page.locator('#lz-close').click();

  // --- the tabs edit each language -------------------------------------------
  // The ref names the plain name.txt; the editor resolves it to the active
  // language's tagged file. Open it and check both languages are offered.
  await page.evaluate(() => window.view.editText('name.txt'));
  await expect(page.locator('#docedit')).toBeVisible();
  const tabs = page.locator('#de-langs');
  await expect(tabs.locator('button[data-lang="en"]')).toHaveClass(/active/);
  await expect(tabs.locator('button[data-lang="ru"]')).toBeVisible();

  const content = page.locator('#de-text .cm-content');
  const setText = async (t: string): Promise<void> => {
    await content.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type(t);
  };

  // English tab (the base) is active — write and save.
  await setText('The Siege of Whitecap');
  await page.locator('#de-save').click();
  await expect(async () => expect(readTxt('name.en.txt')).toContain('Siege of Whitecap')).toPass({ timeout: 10_000 });

  // Switch to Russian — the base text is shown as the source, and Save writes
  // the RU file, not the EN one.
  await tabs.locator('button[data-lang="ru"]').click();
  await expect(page.locator('#de-ref'), 'the base text is shown while translating').toContainText('Siege of Whitecap');
  await setText('Осада Белого Мыса');
  await page.locator('#de-save').click();
  await expect(async () => expect(readTxt('name.ru.txt')).toContain('Осада')).toPass({ timeout: 10_000 });

  // The two languages are independent files.
  expect(readTxt('name.en.txt'), 'English untouched by the RU edit').toContain('Siege of Whitecap');
  expect(readTxt('name.ru.txt'), 'Russian has its own text').toContain('Осада');

  // Switching back shows English again.
  await tabs.locator('button[data-lang="en"]').click();
  await expect(content).toContainText('Siege of Whitecap');
  await page.locator('#de-close').click();

  // --- export: one language baked into an ordinary single-language map --------
  // The plain name.txt the game reads carries the chosen language, and neither the
  // tagged sources nor the sidecar ship.
  const nameOf = (rel: string): string => rel.split('/').pop() ?? rel;
  for (const [lang, want] of [['ru', 'Осада'], ['en', 'Siege of Whitecap']] as const) {
    const out = join(tmpdir(), `e2e-loc-${lang}.h5m`);
    if (existsSync(out)) rmSync(out);
    const r = await page.evaluate(([l, o]) => window.editor.locExport({ lang: l!, output: o! }), [lang, out]);
    expect('ok' in r && r.ok, `export ${lang} succeeded`).toBeTruthy();
    const entries = readEntries(readFileSync(out));
    const texts = entries.map((e) => nameOf(e.name));
    // The name.txt in the archive holds this language's text…
    const nameEntry = entries.find((e) => nameOf(e.name) === 'name.txt');
    expect(nameEntry, 'the export has a plain name.txt').toBeTruthy();
    const buf = nameEntry!.data;
    const text = buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe ? buf.toString('utf16le', 2) : buf.toString('utf8');
    expect(text, `name.txt is the ${lang} text`).toContain(want);
    // …and the tagged sources and sidecar are NOT in the shipped map.
    expect(texts.some((n) => /\.(en|ru)\.txt$/.test(n)), 'no tagged files shipped').toBe(false);
    expect(texts.includes('localization.json'), 'no sidecar shipped').toBe(false);
    rmSync(out, { force: true });
  }

  // --- remove Russian: its files go --------------------------------------------
  await page.locator('#locbtn').click();
  await page.locator('#localize .lz-lang', { hasText: 'Russian' }).locator('button', { hasText: 'remove' }).click();
  await expect(async () => expect(has('name.ru.txt'), 'name.ru.txt deleted').toBe(false)).toPass({ timeout: 10_000 });
  expect(has('name.en.txt'), 'the base survives a removal').toBe(true);
});
