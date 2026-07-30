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

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Session } from '#electron/state.ts';

const LOC_FILE = 'localization.json';

/** The languages the editor offers — the codes the game's own text archives use. */
export const LOC_KNOWN = new Set(['en', 'ru', 'de', 'fr', 'es', 'it', 'pl', 'cz', 'hu']);

const LOC_TAG = /\.([a-z]{2})\.txt$/i;

export interface LocConfig { base: string; languages: string[] }

function locPath(s: Session): string { return join(s.mapDir, LOC_FILE); }

export function readLoc(s: Session): LocConfig | null {
  const p = locPath(s);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')) as LocConfig; } catch { return null; }
}

export function writeLoc(s: Session, cfg: LocConfig): void {
  writeFileSync(locPath(s), JSON.stringify(cfg, null, 1) + '\n');
  s.watch.resync();
}

/** Every `.txt` under the map folder, as posix paths relative to it. */
export function allTexts(root: string): string[] {
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
export function locTagOf(path: string): string {
  const t = LOC_TAG.exec(path)?.[1]?.toLowerCase();
  return t && LOC_KNOWN.has(t) ? t : '';
}

/** Retag a text path to a language: `name.txt` / `name.ru.txt` → `name.<lang>.txt`. */
export function locTagged(path: string, lang: string): string {
  const bare = locTagOf(path) ? path.replace(LOC_TAG, '.txt') : path;
  return bare.replace(/\.txt$/i, `.${lang}.txt`);
}
