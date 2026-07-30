// Localization: author every language in the project, export one at a time.
//
// The GAME reads ONE language: a text ref points at `name.txt` and the engine
// reads whatever bytes are there — you cannot switch language in play, it is the
// installation's. So localization is OURS, not the map's. Every language is kept
// side by side as a TAGGED file (`name.en.txt`, `name.ru.txt`), the plain
// `name.txt` the map references exists only as an EXPORT of one language, and a
// small sidecar (never shipped) records which languages the project carries.
//
// Enabling tags the existing texts with the base language; adding a language
// copies every base text so a translator edits in place; removing deletes them.

// --- Localization: author every language in the project, export one at a time
//
// The GAME reads ONE language: a text ref points at `name.txt` and the engine
// reads whatever bytes are there — you cannot switch language in play, it is the
// installation's. So localization is OURS, not the map's. Every language is kept
// side by side as a TAGGED file (`name.en.txt`, `name.ru.txt`), the plain
// `name.txt` the map references exists only as an EXPORT of one language, and a
// small sidecar (never shipped) records which languages the project carries.
//
// Enabling tags the existing texts with the base language; adding a language
// copies every base text so a translator edits in place; removing deletes them.

import { ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import type { LocEnablePayload, LocLangPayload, LocResult } from '#electron/ipc.ts';
import { need } from '#electron/state.ts';
import type { Session } from '#electron/state.ts';
import { copyFileSync, existsSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const LOC_FILE = 'localization.json';

/** The languages the editor offers — the codes the game's own text archives use. */
const LOC_KNOWN = new Set(['en', 'ru', 'de', 'fr', 'es', 'it', 'pl', 'cz', 'hu']);

const LOC_TAG = /\.([a-z]{2})\.txt$/i;

interface LocConfig { base: string; languages: string[] }

function locPath(s: Session): string { return join(s.mapDir, LOC_FILE); }

export function readLoc(s: Session): LocConfig | null {
  const p = locPath(s);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')) as LocConfig; } catch { return null; }
}

function writeLoc(s: Session, cfg: LocConfig): void {
  writeFileSync(locPath(s), JSON.stringify(cfg, null, 1) + '\n');
  s.watch.resync();
}

/** Every `.txt` under the map folder, as posix paths relative to it. */
function allTexts(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string): void => {
    let ents: string[]; try { ents = readdirSync(dir); } catch { return; }
    for (const e of ents) {
      const abs = join(dir, e); const r = rel ? `${rel}/${e}` : e;
      let st; try { st = statSync(abs); } catch { continue; }
      if (st.isDirectory()) walk(abs, r);
      else if (/\.txt$/i.test(e)) out.push(r);
    }
  };
  walk(root, '');
  return out;
}

/** A text file's language tag, or '' when it is untagged — only KNOWN codes count. */
function locTagOf(path: string): string {
  const t = LOC_TAG.exec(path)?.[1]?.toLowerCase();
  return t && LOC_KNOWN.has(t) ? t : '';
}

/** Retag a text path to a language: `name.txt` / `name.ru.txt` → `name.<lang>.txt`. */
function locTagged(path: string, lang: string): string {
  const bare = locTagOf(path) ? path.replace(LOC_TAG, '.txt') : path;
  return bare.replace(/\.txt$/i, `.${lang}.txt`);
}

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
