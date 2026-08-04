// Reading and writing the quality of life config — the file itself.
//
// Split from qol.ts, which holds the declarations, for one reason: the panel in
// the renderer needs the list of flags, and a module importing `node:fs` cannot
// be bundled into a browser page. The same split as mod-model beside mod-files.
//
// The format is the flat text the extension parses by hand in C — see
// native/homm5-editor.c. When a flag does not take effect the first question is
// what the file actually says, and it is meant to answer that in a text editor.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { QOL_FILE, QOL_FLAGS, isQolName } from '#src/mods/qol.ts';
import type { QolSettings } from '#src/mods/qol.ts';

/** The file in an install. */
export const qolPath = (gameRoot: string): string => join(gameRoot, QOL_FILE);

/**
 * What the file says, as the extension would read it.
 *
 * A missing file is not an error and not an empty answer either: it is every
 * flag off, which is what the panel should show and what the game does.
 */
export function readQol(gameRoot: string): QolSettings {
  const out: QolSettings = {};
  for (const f of QOL_FLAGS) out[f.name] = false;

  const path = qolPath(gameRoot);
  if (!existsSync(path)) return out;

  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [word, value] = line.split(/\s+/);
    if (!word || !isQolName(word)) continue;
    // The name on its own means on — the C reader takes it that way, and a file
    // edited by hand to try something out should mean the same in both.
    out[word] = value === undefined ? true : value !== '0';
  }
  return out;
}

/**
 * Write the file, in full.
 *
 * Every flag appears, including the ones that are off: the file is then also
 * the list of what this build can do, which is what somebody reads it for when
 * something does not work. The comments carry the same words the panel shows,
 * so the file explains itself away from the editor.
 */
export function writeQolFile(gameRoot: string, settings: QolSettings): string {
  const lines = [
    '# Quality of life, written by homm5-editor.',
    '# Read by homm5-editor.dll at startup. 1 is on, 0 is off; a missing file is all off.',
    '',
  ];
  for (const f of QOL_FLAGS) {
    lines.push(`# ${f.title} — ${f.detail}`);
    // Whose work it is, where there is somebody to name. In the file as well as
    // in the panel, so the acknowledgement travels with the install.
    if ('credit' in f && f.credit) lines.push(`# ${f.credit}`);
    lines.push(`${f.name} ${settings[f.name] ? 1 : 0}`);
    lines.push('');
  }
  const path = qolPath(gameRoot);
  writeFileSync(path, lines.join('\n'), 'utf8');
  return path;
}
