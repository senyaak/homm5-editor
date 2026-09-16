// The template's doors to disk and to the mounted chain.
//
// `template.ts` is the model and its reader, pure so the renderer can share
// them; this is where a template is found — by path for the tests, by name
// through the chain for the generator, in either of the two spellings.

import { readFileSync } from 'node:fs';

import { readText, toAssets } from './data.ts';
import type { DataRoot } from './data.ts';
import { parseTemplate } from './template.ts';
import type { RmgTemplate } from './template.ts';

/** A template by its full path on disk — the tests' door. */
export function readTemplate(path: string): RmgTemplate {
  return parseTemplate(readFileSync(path, 'utf8'));
}

/**
 * The two spellings of a template file. `.xdb` is the game's; `.h5et` is
 * OURS — the same document with the fields of our own the game's serialiser
 * would not know, kept out of the folder the game lists so that its own
 * generator never meets them. One name may exist in both; ours wins, the
 * way a mod's file wins over the shipped one.
 */
export const TEMPLATE_EXTENSIONS = ['.h5et', '.xdb'] as const;

/** `RMG/Templates/<name>.h5et` or `.xdb`, whichever the mounted chain has first. */
export function templateFile(dataRoot: DataRoot, name: string): string {
  const data = toAssets(dataRoot);
  for (const ext of TEMPLATE_EXTENSIONS) {
    const rel = `RMG/Templates/${name}${ext}`;
    if (data.text(rel) !== null) return rel;
  }
  throw new Error(`RMG/Templates/${name}: neither .h5et nor .xdb in any mounted root (${data.roots.join(', ')})`);
}

/** A template by name through the mounted chain — the generator's door. */
export function readTemplateNamed(dataRoot: DataRoot, name: string): RmgTemplate {
  return parseTemplate(readText(dataRoot, templateFile(dataRoot, name)));
}
