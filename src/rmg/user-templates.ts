// The install's own templates — where the template editor saves.
//
// A template of the user's is a loose `.h5et` under `<game>/H5E/RMG/Templates/`,
// beside the maps the editor makes: the same folder the game mounts its
// archives from, which ignores a loose file (its scan takes archives by
// extension, and so does ours — `mountableArchives`), so the game never meets
// one and the generator's chain reads it as a root put IN FRONT of the
// application's `assets/rmg` and the mounted install. In front means a
// template saved under a shipped name — `S1P2Z2M1.h5et` — shadows the game's
// `S1P2Z2M1.xdb` the way a mod's file shadows the shipped one, and the
// editor's dialog then lists the user's.
//
// Nothing here validates a template (Senya, 16.09: "if they made a mess of
// it, it is their mess") — the generator warns on the HUD line instead.

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { modDir } from '../game/mod-paths.ts';
import type { RmgTemplate } from './template.ts';
import { writeTemplate } from './write-template.ts';

/** The root the chain mounts in front: `<game>/H5E`, with `RMG/Templates/` under it. */
export function userTemplateRoot(gameRoot: string): string {
  return modDir(gameRoot);
}

/** `<game>/H5E/RMG/Templates/<file>.h5et` — always ours, whatever it holds. */
export function userTemplateFile(gameRoot: string, file: string): string {
  return join(userTemplateRoot(gameRoot), 'RMG', 'Templates', `${file}.h5et`);
}

/** A file name a template may be saved under — the order names it, and it becomes a file. */
export function checkTemplateFileName(file: string): void {
  if (!file.trim()) throw new Error('the template needs a file name');
  if (/[\\/:*?"<>|]/.test(file)) throw new Error('the file name cannot contain \\ / : * ? " < > |');
  if (file !== file.trim()) throw new Error('the file name cannot begin or end with a space');
}

/** Write the template as `<file>.h5et` in the install's own folder; the path it landed at. */
export function saveUserTemplate(gameRoot: string, file: string, template: RmgTemplate): string {
  checkTemplateFileName(file);
  const path = userTemplateFile(gameRoot, file);
  mkdirSync(join(userTemplateRoot(gameRoot), 'RMG', 'Templates'), { recursive: true });
  writeFileSync(path, writeTemplate(template), 'utf8');
  return path;
}

/** Remove the user's `<file>.h5et`; false when there was none (the game's and the app's are not ours to remove). */
export function deleteUserTemplate(gameRoot: string, file: string): boolean {
  checkTemplateFileName(file);
  const path = userTemplateFile(gameRoot, file);
  if (!existsSync(path)) return false;
  rmSync(path, { force: true });
  return true;
}
