// Recolouring a mod creature's textures.
//
// The recolour is RECORDED on the creature and reapplied by every build, not
// painted onto the archive: a build copies the art off the game's data each
// time, so bytes changed afterwards last exactly until the next thing that
// touches the mod.

import { ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import type { ModsRecolorPayload, ModsRecolorResult, ModsTexturesPayload, ModsTexturesResult } from '#electron/ipc.ts';
import { buildAndInstall, ourMod } from '#electron/mod-install.ts';
import { gameRoot, isConfigured } from '#electron/paths.ts';
import { readFileSync } from 'node:fs';
import { findCreatureMods } from '#src/mods/mod-archive.ts';
import type { ModCreature } from '#src/mods/mod-model.ts';
import { decodeDDSBuffer } from '#src/format/dds.ts';
import { MOD_DIR, modFile } from '#src/game/mod-paths.ts';
import { readEntries } from '#src/format/pak.ts';
import { extractPalette, isIdentity } from '#src/format/recolor.ts';
import { pngDataUri } from '#src/format/png.ts';

/** Our mod's archive and the creature in it, for the texture channels. */
function modCreatureArchive(g: string, creatureId: string): { path: string; creature: ModCreature } {
  for (const f of findCreatureMods(g)) {
    if (f.reconstructed) continue;
    const creature = f.mod.creatures.find((c) => c.id === creatureId);
    if (creature) return { path: f.path, creature };
  }
  throw new Error(`${creatureId} is not in any manifest-carrying mod in ${MOD_DIR}`);
}

/** Wire this domain onto ipcMain. Called once, from main. */
export function registerModTextures(): void {
  ipcMain.handle('mods:textures', async (_e: IpcMainInvokeEvent, { creature }: ModsTexturesPayload): Promise<ModsTexturesResult> => {
    const g = gameRoot();
    if (!g) throw new Error('no game install configured');
    const found = modCreatureArchive(g, creature);
    const prefix = `Units/${found.creature.file}/`;
    const textures: ModsTexturesResult['textures'] = [];
    const pixels: Uint8Array[] = [];
    for (const e of readEntries(readFileSync(found.path))) {
      const name = e.name.replace(/\\/g, '/');
      if (!name.startsWith(prefix) || !name.toLowerCase().endsWith('.dds')) continue;
      const img = decodeDDSBuffer(e.data);
      pixels.push(img.rgba);
      textures.push({ path: name, width: img.width, height: img.height, png: pngDataUri(img.width, img.height, img.rgba) });
    }
    return { textures, palette: extractPalette(pixels) };
  });

  // Recolouring REWRITES the archive in place: the mod's textures are its own
  // copies (that is what the art closure is for), so no shipped file is touched
  // and reverting is re-picking the donor. The ceilings do not move — no install,
  // just the new bytes where the old ones were.
  ipcMain.handle('mods:recolor', async (_e: IpcMainInvokeEvent, p: ModsRecolorPayload): Promise<ModsRecolorResult> => {
    const g = gameRoot();
    if (!g) throw new Error('no game install configured');
    if (!isConfigured()) throw new Error('no data root configured');
    if (isIdentity(p.ops)) throw new Error('nothing to change — every control is at its neutral value');

    // RECORDED, then rebuilt — not painted onto the archive in place. A build
    // copies the creature's art off the game's data every time, so paint applied
    // to the bytes afterwards lasts exactly until the next thing that touches the
    // mod: add an artifact, and the creature is the donor's colours again with
    // nothing anywhere to say it ever was not. Kept on the creature, every build
    // reapplies it.
    const mod = ourMod(g);
    const creature = mod.creatures.find((c) => c.id === p.creature);
    if (!creature) throw new Error(`${p.creature} is not in ${modFile(g, 'mod', mod.stem)}`);
    creature.recolor = p.ops;

    const { installed, report } = buildAndInstall(g, mod);
    const prefix = `Units/${creature.file}/`;
    const textures = report.files.filter(
      (x) => x.path.split('\\').join('/').startsWith(prefix) && x.path.toLowerCase().endsWith('.dds'),
    ).length;
    if (!textures) throw new Error(`${p.creature} carries no textures to recolour`);
    return { archive: installed.archive, textures };
  });
}
