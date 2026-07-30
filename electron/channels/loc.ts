// The four channels the Localize dialog drives. What a project's languages
// are and where its tagged texts live is localization.ts, one layer down —
// packing reads it too, to refuse a localized map that has no plain name.txt.

import { ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import type { LocEnablePayload, LocLangPayload, LocResult } from '#electron/ipc.ts';
import { LOC_KNOWN, allTexts, locTagOf, locTagged, readLoc, writeLoc } from '#electron/localization.ts';
import { need } from '#electron/state.ts';
import { copyFileSync, existsSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/** Wire this domain onto ipcMain. Called once, from main. */
export function registerLoc(): void {
  ipcMain.handle('loc:get', async (): Promise<LocResult> => {
    const session = need();
    const cfg = readLoc(session);
    return { enabled: !!cfg, base: cfg?.base ?? '', languages: cfg?.languages ?? [] };
  });

  ipcMain.handle('loc:enable', async (_e: IpcMainInvokeEvent, { base }: LocEnablePayload): Promise<LocResult> => {
    const session = need();
    if (readLoc(session)) throw new Error('localization is already enabled');
    if (!LOC_KNOWN.has(base)) throw new Error(`unknown language "${base}"`);
    // Tag every existing untagged text with the base language, so from now on every
    // source carries its language and the plain name.txt is an export artefact only.
    for (const rel of allTexts(session.mapDir)) {
      if (locTagOf(rel)) continue;
      const from = join(session.mapDir, rel);
      const to = join(session.mapDir, locTagged(rel, base));
      if (from !== to && !existsSync(to)) renameSync(from, to);
    }
    writeLoc(session, { base, languages: [base] });
    return { enabled: true, base, languages: [base] };
  });

  ipcMain.handle('loc:add-language', async (_e: IpcMainInvokeEvent, { lang }: LocLangPayload): Promise<LocResult> => {
    const session = need();
    const cfg = readLoc(session);
    if (!cfg) throw new Error('localization is not enabled');
    if (!LOC_KNOWN.has(lang)) throw new Error(`unknown language "${lang}"`);
    if (!cfg.languages.includes(lang)) {
      // A copy of every base text, so the translator edits in place rather than
      // from a blank — an untouched copy is still the base language until changed.
      for (const rel of allTexts(session.mapDir)) {
        if (locTagOf(rel) !== cfg.base) continue;
        const to = join(session.mapDir, locTagged(rel, lang));
        if (!existsSync(to)) copyFileSync(join(session.mapDir, rel), to);
      }
      cfg.languages.push(lang);
      writeLoc(session, cfg);
    }
    return { enabled: true, base: cfg.base, languages: cfg.languages };
  });

  ipcMain.handle('loc:remove-language', async (_e: IpcMainInvokeEvent, { lang }: LocLangPayload): Promise<LocResult> => {
    const session = need();
    const cfg = readLoc(session);
    if (!cfg) throw new Error('localization is not enabled');
    if (lang === cfg.base) throw new Error('cannot remove the base language');
    for (const rel of allTexts(session.mapDir)) {
      if (locTagOf(rel) === lang) rmSync(join(session.mapDir, rel), { force: true });
    }
    cfg.languages = cfg.languages.filter((l) => l !== lang);
    writeLoc(session, cfg);
    return { enabled: true, base: cfg.base, languages: cfg.languages };
  });
}
