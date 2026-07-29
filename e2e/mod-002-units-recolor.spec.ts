// Repainting a mod creature's textures through the window.
//
// Runs alone: its own game install with the creature already in it. Authoring
// one through the form is units-create's subject, so here it is a PREREQUISITE
// — installed headlessly through the same functions the dialog's channel calls
// (e2e/mods.ts), which keeps this spec about the recolour.
//
// Two claims are worth the whole file: the palette is SELECTIVE (repaint one
// colour, the others survive), and what the previews show is what lands in the
// archive.

import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { launchEditor, REPO_ROOT } from './launch.ts';
import type { Launched } from './launch.ts';
import {
  creatureTextures, hueDist, installCreatureHeadless, modGameRoot,
} from './mods.ts';
import { readEntries } from '../src/pak.ts';
import { modFile } from '../src/mod-paths.ts';
import { readFileSync } from 'node:fs';
import { MOD, SHARPSHOOTER } from './mods.ts';
import { extractPalette } from '../src/recolor.ts';

let ed: Launched;

const GAME = modGameRoot();

test.beforeAll(async () => {
  installCreatureHeadless(GAME);
  ed = await launchEditor({ HOMM5_ROOT: GAME });
});
test.afterAll(async () => { await ed?.app.close(); });

/** Open the Recolor dialog on our creature, with its previews drawn. */
async function openRecolor(page: Launched['page']): Promise<void> {
  if (!(await page.locator('#recolor').isVisible())) {
    if (!(await page.locator('#unitsmod').isVisible())) await page.locator('#unitsbtn').click();
    // The brush is on the creature's ROW, and it is a button with an emoji on
    // it: the name is in the row beside it, never on the button, so asking for
    // a `.um-recolor` that says "Снайперы" asks for something that cannot exist.
    const row = page.locator('#um-list .um-item', { hasText: SHARPSHOOTER.name });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.locator('.um-paint').click();
  }
  await expect(page.locator('#recolor')).toBeVisible();
  // The mod carries three textures for it: the body, the add layer, the icon.
  await expect(page.locator('#rc-previews canvas')).toHaveCount(3, { timeout: 60_000 });
  await expect(page.locator('#rc-palette .rc-swatch').first()).toBeVisible();
}

/** The creature's palette as it stands in the archive right now. */
const palette = (): ReturnType<typeof extractPalette> =>
  extractPalette(creatureTextures(GAME).map((t) => t.rgba));

test('the palette remaps one colour and leaves the rest', async () => {
  test.setTimeout(3 * 60_000);
  const { page } = ed;
  await openRecolor(page);

  const swatches = page.locator('#rc-palette .rc-swatch');
  expect(await swatches.count(), 'more than a grey and one colour').toBeGreaterThan(2);

  // What the palette is before: the biggest cluster, and the others.
  const before = palette();
  const top = before[0]!;
  expect(top.hue, 'the top cluster is a colour, not the greys').toBeGreaterThanOrEqual(0);
  const kept = before.filter((p) => p.hue >= 0 && p !== top);
  expect(kept.length).toBeGreaterThan(0);

  // Remap ONLY the top swatch to grey and save.
  await swatches.first().locator('input[type=color]').fill('#808080');
  await page.locator('#rc-ok').click();
  await expect(page.locator('#rc-note')).toContainText('repainted 3 texture(s)', { timeout: 120_000 });

  // After: the remapped hue is gone from the archive's own palette — its pixels
  // went neutral — while every other cluster survived where it was.
  const after = palette();
  expect(after.some((p) => p.hue >= 0 && hueDist(p.hue, top.hue) < 20),
    `the remapped hue ${Math.round(top.hue)}° is still in the palette`).toBe(false);
  for (const k of kept) {
    expect(after.some((p) => p.hue >= 0 && hueDist(p.hue, k.hue) < 25),
      `cluster at ${Math.round(k.hue)}° should have survived`).toBe(true);
  }
});

test('the Grey preset paints the whole creature, and the bytes say so', async () => {
  test.setTimeout(3 * 60_000);
  const { page } = ed;
  await openRecolor(page);

  await page.locator('#rc-grey').click();
  await expect(page.locator('#rc-sat')).toHaveValue('0');
  await page.locator('#rc-ok').click();
  await expect(page.locator('#rc-note')).toContainText('repainted 3 texture(s)', { timeout: 120_000 });

  // Every creature texture is grey now (r=g=b on every pixel) and the alpha
  // cut-out survived — on a creature texture that is the silhouette.
  let alpha = 0;
  const textures = creatureTextures(GAME);
  expect(textures).toHaveLength(3);
  for (const t of textures) {
    for (let i = 0; i < t.rgba.length; i += 4) {
      if (t.rgba[i] !== t.rgba[i + 1] || t.rgba[i + 1] !== t.rgba[i + 2]) {
        throw new Error(`${t.name}: pixel ${i / 4} is not grey`);
      }
      if (t.rgba[i + 3]! < 255) alpha++;
    }
  }
  expect(alpha, 'the alpha cut-out survived the repaint').toBeGreaterThan(0);

  // And each paired document describes the format the new bytes are in: a dds
  // its .xdb misdescribes is present and invisible.
  let xdb = 0;
  for (const e of readEntries(readFileSync(modFile(GAME, 'mod', MOD)))) {
    const name = e.name.split('\\').join('/');
    if (!name.startsWith(`Units/${SHARPSHOOTER.file}/`) || !name.toLowerCase().endsWith('.(texture).xdb')) continue;
    xdb++;
    const text = e.data.toString('latin1');
    expect(text, name).toContain('<Format>TF_8888</Format>');
    expect(text, name).toContain('<IsDXT>false</IsDXT>');
  }
  expect(xdb).toBe(3);
});
