// The Sharpshooter's palace, authored through the window.
//
// This is the dwelling the map stage places, and it was the one thing in the
// mod with no form to make it: every dwelling that existed was authored by
// writing a spec in a file, which is why the port's tier 4-7 buildings are still
// data in the maps repo with nothing to install them. The window's Dwelling tab
// is that form, and this spec is what it was missing.
//
// It is also the only stage that exercises BAKE. The per-tier dwellings live on
// the town screen and have no adventure-map art at all: their models are two to
// three times map scale and stand where they sit in the town scene, so one
// dropped on the map is both giant and nowhere near the tile that placed it.
// Baking copies it, moves it to the origin and scales it, and the footprint
// follows what will be seen (src/mods/bake-model.ts).
//
// Runs after mod-001 in the chain, whose creature it hires; alone, it still
// builds — the id it names is simply one the install does not have.

import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA, launchEditor } from './launch.ts';
import type { Launched } from './launch.ts';
import { PALACE, modGameRoot } from './mods.ts';
import { readEntries } from '../src/format/pak.ts';
import { modFile } from '../src/game/mod-paths.ts';
import { MOD_STEM } from '../src/mods/mod-files.ts';

let ed: Launched;
const GAME = modGameRoot();

test.beforeAll(async () => { ed = await launchEditor({ HOMM5_ROOT: GAME }); });
test.afterAll(async () => { await ed?.app.close(); });

test('a dwelling for a creature the game does not ship', async () => {
  test.setTimeout(5 * 60_000);
  const { page } = ed;

  await page.locator('#bldbtn').click();
  await expect(page.locator('#bldmod')).toBeVisible();
  await page.locator('#bld-tabs .mp-tab', { hasText: 'Dwelling' }).first().click();
  await expect(page.locator('#bld-new')).toHaveText('New dwelling…');
  await page.locator('#bld-new').click();
  await expect(page.locator('#bldedit')).toBeVisible();

  // No preset: what is wanted is the elves' tier-3 dwelling's LOOK with our own
  // creature behind it, so the art is named outright and everything else is
  // authored rather than inherited from some shipped object's fields.
  await page.locator('#bld-file').fill(PALACE.file);
  await page.locator('#bld-type').selectOption(PALACE.type);
  await page.locator('#bld-model').fill(PALACE.model);
  await page.locator('#bld-animset').fill(PALACE.animSet);
  await page.locator('#bld-effect').fill(PALACE.effect);
  await page.locator('#bld-icon').fill(PALACE.icon);

  // What it hires — the field only this class has.
  const creatures = page.locator('.bld-field[data-field="creatures"]');
  await expect(creatures, 'the Dwelling form asks what it hires').toBeVisible();
  await creatures.fill(PALACE.creatures.join(', '));

  // Its six lines, in the order the engine reads them.
  const lines = [
    PALACE.name, PALACE.description, PALACE.firstVisit,
    PALACE.secondVisit, PALACE.firstVisitNoHire, PALACE.secondVisitNoHire,
  ];
  await expect(page.locator('#bld-texts .bld-text'), 'a dwelling says six things').toHaveCount(6);
  for (const [i, line] of lines.entries()) {
    await page.locator('#bld-texts .bld-text').nth(i).fill(line);
  }

  await page.locator('#bld-ok').click();
  await expect(page.locator('#bldedit')).toBeHidden({ timeout: 240_000 });
  await expect(page.locator('#bld-note')).toContainText(`under Buildings/${PALACE.file}/`);
  await expect(page.locator('#bld-list')).toContainText(PALACE.name);

  // Repainted, because otherwise it IS the High Cabins with a different sign on
  // it: same model, same animation, same colours, standing next to the real one
  // on the same map.
  // ITS row, by the name it was given: mod-005 has already put a dwelling of its
  // own in this list, and the first brush in the list is that one's.
  await page.locator('#bld-list .um-item', { hasText: PALACE.name }).locator('.um-paint').click();
  await expect(page.locator('#recolor')).toBeVisible();
  await page.locator('#rc-hue').fill(String(PALACE.recolor.hue));
  await page.locator('#rc-ok').click();
  await expect(page.locator('#rc-note')).toContainText(/repainted \d+ texture/, { timeout: 240_000 });
  await page.locator('#rc-close').click();
});

test('it hires the creature, wearing the elves\' art in its own colours', async () => {
  const members = readEntries(readFileSync(modFile(GAME, 'mod', MOD_STEM)));
  const names = members.map((e) => e.name.replace(/\\/g, '/'));
  const doc = members
    .find((e) => e.name.replace(/\\/g, '/').endsWith(`${PALACE.file}.(AdvMapDwellingShared).xdb`))!
    .data.toString('latin1');

  expect(doc, 'the class is the dwelling one').toContain('<AdvMapDwellingShared>');
  expect(doc).toContain(`<Item>${PALACE.creatures[0]}</Item>`);
  expect(doc).toContain(`<Type>${PALACE.type}</Type>`);
  // Its art is the mod's own copy — model, animation, effect and icon alike —
  // and not a reference to the shipped dwelling it looks like.
  for (const field of ['Model', 'AnimSet', 'Effect', 'Icon128']) {
    expect(doc, `${field} names our copy`)
      .toMatch(new RegExp(`<${field} href="/Buildings/${PALACE.file}/art/`));
  }
  expect(names.some((n) => n.startsWith(`Buildings/${PALACE.file}/art/_(Model)/Buildings/Dwelings/`)),
    'the elves\' dwelling was copied in').toBe(true);

  // Measured off that model, not baked: this art is already adventure-map scale,
  // so it stands on the three tiles the shipped High Cabins declares. One tile
  // would mean it was never measured, and the building would sit inside its
  // neighbour instead of failing.
  const tiles = [...doc.matchAll(/<x>(-?\d+)<\/x>/g)].map((m) => Number(m[1]));
  const span = Math.max(...tiles) - Math.min(...tiles) + 1;
  expect(span, 'three tiles across, as the shipped one is').toBe(3);

  // And it is repainted: at least one texture must differ from the bytes it was
  // copied from, or this is the High Cabins with a different sign on it.
  //
  // At least ONE, not the first: a hue turn moves nothing on a grey texture, and
  // the copy carries several — the terrain under it, a spark, a glow — that have
  // no colour to turn. Byte-identical is the right answer for those.
  const textures = members.filter((e) => {
    const n = e.name.replace(/\\/g, '/');
    return n.startsWith(`Buildings/${PALACE.file}/art/`) && n.toLowerCase().endsWith('.dds');
  });
  expect(textures.length, 'it carries textures of its own').toBeGreaterThan(0);
  const repainted = textures.filter((t) => {
    const source = join(DATA, t.name.replace(/\\/g, '/').split('/art/')[1]!);
    return existsSync(source) && !t.data.equals(readFileSync(source));
  });
  expect(repainted.length, 'no texture came out different — the repaint did not land')
    .toBeGreaterThan(0);
});
