// What the run left on disk — read off the files, not off the app.
//
// The four specs before this one each check their own step through the window:
// the dialog said "installed", the list showed the name, the manifest held the
// fields. None of that is the same question as WHAT IS IN THE GAME when the run
// is over, and that question has been answered by hand every time so far — by
// unzipping the archive and reading the texts, which is how a description that
// nobody had written for a week was found still sitting in it.
//
// So this stage opens what the run produced and reads it: the archive's own
// text files, the icons it carries, the file the native extension reads beside
// the executable, and the two ceilings in it. Nothing here drives the app.
//
// It closes the chain in both modes. Isolated it reads mod-004's throwaway
// install, which by then holds everything the four specs made; live it reads
// the game, and the report is exactly what a player would get.

import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BOOTS, gameRootFor, MOD, PALACE, PIECES, removeGameRoot, SHARPSHOOTER, UNDEAD_KING } from './mods.ts';
import { readEntries } from '../src/pak.ts';
import { modFile } from '../src/mod-paths.ts';
import { readCreatureMod } from '../src/creature-mod.ts';
import { EFFECTS_FILE, readEffects } from '../src/artifact-effects.ts';
import { ORIGINAL_ARTIFACTS, readArtifactLimit, SITES_FILE } from '../src/artifact-limit.ts';
import type { Site } from '../src/artifact-limit.ts';
import { ORIGINAL_LIMIT, readExe } from '../src/creature-limit.ts';

// mod-004's install, because it is the last to write and the only one that ends
// with all four kinds in it. Live, every spec shares one install anyway.
const GAME = gameRootFor('e2e-sharp-game');
const ARCHIVE = modFile(GAME, 'mod', MOD);

/** A text in the archive is UTF-16LE with a BOM, as the game writes them. */
function decode(buf: Buffer): string {
  return buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe ? buf.toString('utf16le', 2) : buf.toString('utf8');
}

/** Every member of the built archive, by its forward-slashed name. */
function members(): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  for (const e of readEntries(readFileSync(ARCHIVE))) out.set(e.name.replace(/\\/g, '/'), e.data);
  return out;
}

test.beforeAll(() => {
  test.skip(!existsSync(ARCHIVE), `nothing to read — no ${ARCHIVE}; run mod-001…mod-004 first`);
});

test('the archive carries what the run authored', () => {
  const found = readCreatureMod(ARCHIVE);
  expect(found, 'the archive has a manifest of ours').toBeTruthy();
  const mod = found!.mod;

  expect(mod.creatures.map((c) => c.id)).toContain(SHARPSHOOTER.id);
  expect(mod.dwellings.map((d) => d.file)).toContain(PALACE.file);
  expect((mod.artifacts ?? []).map((a) => a.id)).toEqual(PIECES.map((p) => p.id));
  expect((mod.sets ?? []).map((s) => s.effect)).toContain(UNDEAD_KING.effect);
});

test('and the words a player reads are the ones we wrote', () => {
  const files = members();
  for (const p of PIECES) {
    const name = `Artifacts/${p.file}/${p.file}_Name.txt`;
    const desc = `Artifacts/${p.file}/${p.file}_Description.txt`;
    expect(files.has(name), name).toBe(true);
    expect(decode(files.get(name)!)).toBe(p.name);
    // The one that has been wrong twice: a description edited in the source and
    // never rebuilt into the archive looks identical everywhere except in game.
    expect(decode(files.get(desc)!), desc).toBe(p.description);
  }
  // Its own picture, built into the game's texture — not a shipped artifact's
  // icon borrowed because ours was missing.
  for (const p of PIECES) {
    expect(files.has(`Textures/HeroScreen/Artifacts/${p.file}.(Texture).dds`), p.file).toBe(true);
  }
});

test('the extension is told about every piece, and only about ours', () => {
  const path = join(GAME, EFFECTS_FILE);
  expect(existsSync(path), `${path} — an artifact whose bonus is not in here grants nothing`).toBe(true);
  const rows = readEffects(readFileSync(path, 'latin1'));
  // One row per piece, in mod order, with the percentage its description
  // promises. The boots were the ones missing when this stage did not exist:
  // installed, worn, and doing nothing.
  expect(rows).toEqual(PIECES.map((p, i) => ({
    stat: 'necromancy', artifact: ORIGINAL_ARTIFACTS + i, amount: p.necromancy,
  })));
  expect(rows.at(-1)?.amount, 'the boots grant what they say').toBe(BOOTS.necromancy);
});

test('and the executable counts exactly what is installed', () => {
  const found = readCreatureMod(ARCHIVE)!;
  const exe = join(GAME, 'bin', 'H5_Game_H5E.exe');
  expect(existsSync(exe), exe).toBe(true);
  const bytes = readFileSync(exe);

  // Both ceilings have to equal what the archive holds — one too high stops the
  // game at launch, one too low makes the last entries unreachable.
  expect(readExe(bytes).limit).toBe(ORIGINAL_LIMIT + found.mod.creatures.length);
  const noted = JSON.parse(readFileSync(join(GAME, SITES_FILE), 'utf8')) as Site[];
  expect(readArtifactLimit(bytes, noted).limit).toBe(ORIGINAL_ARTIFACTS + (found.mod.artifacts ?? []).length);
});

// The end of the chain, so the throwaway install goes now rather than in
// mod-004 — that spec used to sweep it, and this stage would have had nothing
// to read. Live it is the game and removeGameRoot leaves it alone.
test.afterAll(() => { removeGameRoot(GAME); });
