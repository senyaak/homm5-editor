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
// It closes the chain in both modes. Isolated it reads mod-008's throwaway
// install, which by then holds everything the four specs made; live it reads
// the game, and the report is exactly what a player would get.

import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BOOTS, creatureTextures, MOD, modGameRoot, PALACE, PIECES, SHARPSHOOTER, UNDEAD_KING,
} from './mods.ts';
import { readEntries } from '../src/format/pak.ts';
import { modFile } from '../src/game/mod-paths.ts';
import { readCreatureMod } from '../src/mods/mod-archive.ts';
import { EFFECTS_FILE, readEffects } from '../src/mods/artifact-effects.ts';
import { COMMON_SCRIPT, SCRIPT_DIR } from '../src/mods/artifact-scripts.ts';
import { ORIGINAL_ARTIFACTS, readArtifactLimit, SITES_FILE } from '../src/exe/artifact-limit.ts';
import type { Site } from '../src/exe/artifact-limit.ts';
import { ORIGINAL_LIMIT, readExe } from '../src/exe/creature-limit.ts';

// mod-008's install, because it is the last to write and the only one that ends
// with all four kinds in it. Live, every spec shares one install anyway.
const GAME = modGameRoot();
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
  test.skip(!existsSync(ARCHIVE), `nothing to read — no ${ARCHIVE}; run mod-001…mod-008 first`);
});

test('the archive carries what the run authored', () => {
  const found = readCreatureMod(ARCHIVE);
  expect(found, 'the archive has a manifest of ours').toBeTruthy();
  const mod = found!.mod;

  expect(mod.creatures.map((c) => c.id)).toContain(SHARPSHOOTER.id);
  expect((mod.artifacts ?? []).map((a) => a.id)).toEqual(PIECES.map((p) => p.id));
  expect((mod.sets ?? []).map((s) => s.effect)).toContain(UNDEAD_KING.effect);

  // The buildings: the palace mod-006 authored, and one of every class from
  // mod-005. They are `buildings` and not `dwellings` — the old list is the
  // pre-window path, and the palace moved off it when the window gained the
  // Dwelling tab.
  const buildings = (mod.buildings ?? []).map((b) => b.file);
  expect(buildings).toContain(PALACE.file);
  expect(buildings.length, 'one of every class, plus the palace').toBeGreaterThanOrEqual(17);
  // Every class exactly once: a class silently skipped in the loop would leave
  // the archive one building short and nothing else would say so.
  expect(new Set((mod.buildings ?? []).map((b) => b.className)).size).toBe(16);
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
  expect(rows).toEqual([
    ...PIECES.map((p, i) => ({
      stat: 'necromancy', artifacts: [ORIGINAL_ARTIFACTS + i], threshold: 1, amount: p.necromancy,
    })),
    // And the set's own row, which no piece carries: two of the three worn,
    // and the members named by number because that is what the engine knows.
    {
      stat: 'energy',
      artifacts: PIECES.map((_, i) => ORIGINAL_ARTIFACTS + i),
      threshold: UNDEAD_KING.energy.worn,
      amount: UNDEAD_KING.energy.amount,
    },
  ]);
  expect(rows[PIECES.length - 1]?.amount, 'the boots grant what they say').toBe(BOOTS.necromancy);
});

test('the set brought its script, and the global one still loads it', () => {
  const files = members();
  const script = files.get(`${SCRIPT_DIR}/${UNDEAD_KING.file}.lua`);
  expect(script, 'a set with a script contributes its own file').toBeTruthy();
  const common = files.get(COMMON_SCRIPT)?.toString('latin1');
  expect(common, "and the game's global script, carried by the mod").toBeTruthy();
  expect(common).toContain(`doFile("/${SCRIPT_DIR}/${UNDEAD_KING.file}.lua");`);
  // The 73 lines the game ships in this file are what every mission expects to
  // find. Replacing it is how a mod loads anything globally; dropping them is
  // how a mod breaks everything else quietly.
  expect(common).toContain('function SetPlayerStartResource(');
  expect(common).toContain('function IsPlayerHeroesInRegion(');
});

test('the creature is still wearing the paint mod-002 gave it', () => {
  // Asked of the manifest, not of the mode: if a recolour was recorded, the
  // textures have to show it. Run the chain and mod-002 recorded one; run this
  // stage alone and the fixture's creature carries none, and there is nothing
  // to check rather than something to skip for the wrong reason.
  const creature = readCreatureMod(ARCHIVE)!.mod.creatures.find((c) => c.id === SHARPSHOOTER.id);
  test.skip(!creature?.recolor, 'nothing repainted this creature');
  const textures = creatureTextures(GAME);
  expect(textures.length, 'the creature carries its textures').toBeGreaterThan(0);
  // Grey is what mod-002 leaves: r=g=b everywhere. A rebuild of the creature
  // copies the art off the donor again and puts the colour back — which is
  // exactly what a later stage did until it stopped updating a creature that
  // was already installed. The paint is in the archive's bytes and NOWHERE
  // else, so anything that rebuilds it loses it silently.
  for (const t of textures) {
    for (let i = 0; i < t.rgba.length; i += 4) {
      if (t.rgba[i] !== t.rgba[i + 1] || t.rgba[i + 1] !== t.rgba[i + 2]) {
        throw new Error(`${t.name}: pixel ${i / 4} is coloured again — something rebuilt the creature`);
      }
    }
  }
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

// Nothing is swept here. The stages share one install, and it is reset by the
// global setup at the START of a run — the only moment that is safe, since a
// stage tidying up after itself takes the next one's ground away.
