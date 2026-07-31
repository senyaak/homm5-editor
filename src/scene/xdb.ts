// Following the game's own asset references.
//
// Every chain the scene builder walks — object to shared to model to geometry,
// shared to effect to particle, model to animation set to clip — is the same
// two steps: resolve an `href` against the file that wrote it, then read the
// document it names. That pair plus the three readers below (an <Item> list,
// a vector, a quaternion) is the whole vocabulary; the modules above this one
// differ only in which tags they ask for.

import { readFileSync, existsSync } from 'node:fs';
import type { Assets } from '../game/assets.ts';


/** Reads an asset .xdb by its href, or null when it is missing. */
export type ReadXdb = (href: string) => string | null;

/** Read a data-root-relative asset as text, or null if it is missing. */
export function readAsset(data: Assets, rel: string): string | null {
  try {
    const p = data.path(rel);
    return existsSync(p) ? readFileSync(p, 'utf8') : null;
  } catch { return null; }
}

/**
 * Follow one href from a file, honouring the inline form.
 *
 * `href="#n:inline(ParticleInstance)"` means the thing is written INSIDE the
 * file that points at it — the same convention map.xdb uses for its objects.
 * Treating that as a path is why most of these chains dead-ended: 249 of the
 * 307 effect-only objects failed at exactly this step. Returns the resolved
 * document and the folder it lives in, for the next href down the chain.
 */
export function followHref(
  data: Assets, xml: string, dir: string, href: string,
): { xml: string; dir: string } | null {
  if (href.startsWith('#')) return { xml, dir };
  const rel = resolveHref(dir, href);
  const doc = readAsset(data, rel);
  return doc ? { xml: doc, dir: dirOf(rel) } : null;
}

/**
 * Split a list block into its top-level `<Item>` elements, attributes and body
 * apart.
 *
 * Needed wherever an item can be inline: the href only says "it is in here",
 * and the "here" that matters is the item, not the file. Depth-counted rather
 * than matched non-greedily, since an item's body can hold `<Item>` lists of
 * its own.
 */
export function listItems(block: string): { attrs: string; body: string }[] {
  const out: { attrs: string; body: string }[] = [];
  const re = /<Item\b([^>]*?)(\/?)>|<\/Item>/g;
  let m: RegExpExecArray | null, depth = 0, start = 0, attrs = '';
  while ((m = re.exec(block))) {
    if (m[0] === '</Item>') {
      if (depth > 0 && --depth === 0) out.push({ attrs, body: block.slice(start, m.index) });
    } else if (m[2] === '/') {
      if (depth === 0) out.push({ attrs: m[1] ?? '', body: '' }); // <Item …/>
    } else if (depth++ === 0) {
      attrs = m[1] ?? '';
      start = re.lastIndex;
    }
  }
  return out;
}

/** Parse a `<tag><x><y><z></tag>` vector; supports scientific notation. */
export function readVec3(xml: string, tag: string): [number, number, number] | null {
  const n = '([-+.\\deE]+)';
  const m = xml.match(new RegExp(`<${tag}>\\s*<x>${n}</x>\\s*<y>${n}</y>\\s*<z>${n}</z>`));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Parse a `<tag><x><y><z><w></tag>` quaternion; supports scientific notation. */
export function readQuat(xml: string, tag: string): [number, number, number, number] | null {
  const n = '([-+.\\deE]+)';
  const m = xml.match(new RegExp(`<${tag}>\\s*<x>${n}</x>\\s*<y>${n}</y>\\s*<z>${n}</z>\\s*<w>${n}</w>`));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])] : null;
}

/**
 * Resolve an asset href the way the game's own references are written.
 *
 * An href beginning with `/` is from the data root; anything else is relative to
 * the file that wrote it. The split is not even: 5469 of the material
 * references in the shipped models are relative against 2019 absolute, and 6009
 * of the texture references inside materials against 3461. Reading a relative
 * href as absolute finds nothing at all, which is how the Alchemist Lab came
 * out as untextured grey.
 *
 * @param baseDir directory of the file the href was read from, data-root relative
 */
export function resolveHref(baseDir: string, href: string): string {
  const clean = href.split('#')[0]!;
  if (clean.startsWith('/')) return clean.slice(1);
  const out = baseDir ? baseDir.split('/').filter(Boolean) : [];
  for (const seg of clean.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') out.pop(); else out.push(seg);
  }
  return out.join('/');
}

/** Directory part of a data-root-relative path. */
export function dirOf(path: string): string {
  const at = path.lastIndexOf('/');
  return at < 0 ? '' : path.slice(0, at);
}
