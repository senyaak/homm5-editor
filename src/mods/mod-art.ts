// Copying a shipped model's art into the mod, and repainting it there.
//
// A creature could point at the model it borrows and be a few kilobytes;
// instead the whole reachable closure — geometry, skeleton, animations,
// materials, textures, sounds and the binaries behind them — is copied under
// the creature's own folder. With the art inside, swapping a model or
// recolouring a texture is an edit to the mod and changes nothing else.
//
// Copied geometry, skeletons and animations get a FRESH uid, because their
// binaries are keyed by uid under `bin/…` and sharing one would mean editing
// our creature's mesh edited the original creature's.

import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { children, parse, text as textOf } from '../format/xml.ts';
import type { XmlElement } from '../format/xml.ts';
import { decodeDDSBuffer } from '../format/dds.ts';
import { recolorPixels } from '../format/recolor.ts';
import { writeDDS } from '../format/texture.ts';
import type { RecolorOps } from '../format/recolor.ts';
import type { DataReader } from './mod-files.ts';


// --- the art a creature borrows ----------------------------------------------

/**
 * The four references that decide what a creature LOOKS like. Each is a document
 * in the game's data that we copy into the mod, so each can be swapped later
 * without the mod's shape changing.
 */
export type ArtSlot = 'character' | 'model' | 'animSet' | 'icon';

/** Which field of which of our two documents each slot fills. */
export const ART_FIELD: Record<ArtSlot, { doc: 'visual' | 'monster'; field: string; type: string }> = {
  // What fights: a Character bundles the combat model with its arena animations.
  character: { doc: 'visual', field: 'AnimCharacter', type: 'Character' },
  // What stands on the adventure map. Usually the same model, separately named.
  model: { doc: 'monster', field: 'Model', type: 'Model' },
  animSet: { doc: 'monster', field: 'AnimSet', type: 'AnimSet' },
  // The hire and army icon. A creature without one stops the game at startup,
  // which is how we learned that None.xdb's empty icons are a privilege of id 0.
  icon: { doc: 'visual', field: 'Icon128', type: 'Texture' },
};

export const ART_SLOTS = Object.keys(ART_FIELD) as ArtSlot[];

/**
 * Where a copied `.xdb`'s binary lives, by the document's root element. These
 * are keyed by the uid inside the document, not by its path, which is why a copy
 * that keeps its uid would share one file with the creature it copied from.
 */
export const UID_BINS: Record<string, string> = {
  Geometry: 'bin/Geometries',
  AIGeometry: 'bin/AIGeometries',
  Skeleton: 'bin/Skeletons',
  BasicSkelAnim: 'bin/animations',
  Sound: 'bin/Sounds',
  Effect: 'bin/effects',
  Light: 'bin/Lights',
};

// --- copying art -------------------------------------------------------------

/** What a copy produced: the files, where each source landed, what was absent. */
/**
 * Paint every texture in a copied art tree, and correct the documents that
 * describe them.
 *
 * The bytes come out uncompressed 32-bit with one surface, so the paired `.xdb`
 * has to say so — a `.dds` its document misdescribes is present and invisible,
 * which looks exactly like a texture that failed to copy.
 */
export function repaint(files: Map<string, Buffer>, ops: RecolorOps): void {
  for (const [path, data] of files) {
    const lower = path.toLowerCase();
    if (lower.endsWith('.dds')) {
      const img = decodeDDSBuffer(data);
      recolorPixels(img.rgba, ops);
      files.set(path, writeDDS(img));
    } else if (lower.endsWith('.(texture).xdb')) {
      files.set(path, Buffer.from(data.toString('latin1')
        .replace(/<Format>[^<]*<\/Format>/, '<Format>TF_8888</Format>')
        .replace(/<IsDXT>[^<]*<\/IsDXT>/, '<IsDXT>false</IsDXT>')
        .replace(/<NMips>[^<]*<\/NMips>/, '<NMips>1</NMips>')
        .replace(/<UseS3TC>[^<]*<\/UseS3TC>/, '<UseS3TC>false</UseS3TC>'), 'latin1'));
    }
  }
}

export interface ArtCopy {
  files: Map<string, Buffer>;
  /** Source data path → its path inside the mod. */
  at: Map<string, string>;
  missing: string[];
}

/**
 * Copy the whole closure of documents reachable from `seeds` into `dest`.
 *
 * The structure is preserved under `dest`, which is what makes this simple: a
 * relative href inside a copied file resolves to the copy of what it named
 * before, with no rewriting at all. Absolute hrefs are repointed at our copies —
 * but only when we actually copied the target, since plenty of them name
 * authoring sources (`/H5A2/…/model.mb`) that were never shipped.
 *
 * Documents whose data sits in `bin/…` keyed by uid get a fresh uid and their
 * binary copied under it. Sharing the original uid would work, right up to the
 * first time somebody edited the mesh and found they had edited the shipped
 * creature's too.
 */
export function copyArt(seeds: string[], dest: string, read: DataReader, salt: string): ArtCopy {
  const found = new Map<string, Buffer>();
  const missing: string[] = [];
  const queue = seeds.map(normalize);

  // Pass one: what is reachable.
  while (queue.length) {
    const rel = queue.shift()!;
    if (found.has(rel) || missing.includes(rel)) continue;
    const data = read(rel);
    if (!data) { missing.push(rel); continue; }
    found.set(rel, data);
    if (!rel.toLowerCase().endsWith('.xdb')) continue;
    for (const href of hrefs(data.toString('latin1'))) {
      const to = resolve(rel, href);
      if (to) queue.push(to);
    }
  }

  // Pass two: place everything, then rewrite what points inside the set.
  const at = new Map<string, string>();
  for (const rel of found.keys()) at.set(rel, `${dest}/${rel}`);

  const files = new Map<string, Buffer>();
  for (const [rel, data] of found) {
    if (!rel.toLowerCase().endsWith('.xdb')) { files.set(at.get(rel)!, data); continue; }
    let text = data.toString('latin1');

    // Every binary this document keys, under uids of ours.
    //
    // NOT just the root's. A creature's mesh and skeleton are documents of their
    // own, but a BUILDING carries them INLINE — `<Geometry href="#n:inline(…)">`
    // right inside its `Model.xdb`, each with its own `<uid>` and its own file
    // under `bin/…`. Reading the root's uid alone copied a building's model
    // without the mesh it is made of: present, correct, and invisible.
    for (const owner of uidOwners(text)) {
      const blob = read(`${owner.bin}/${owner.uid}`);
      if (!blob) continue;
      // The document's OWN uid keeps the key it always had, so every mod built
      // before this walked inline bodies rebuilds to the same bytes.
      const fresh = uidFor(owner.root ? `${salt}:${rel}` : `${salt}:${rel}:${owner.uid}`);
      files.set(`${owner.bin}/${fresh}`, blob);
      text = text.replace(`<uid>${owner.uid}</uid>`, `<uid>${fresh}</uid>`);
    }

    // Absolute hrefs into the copied set. Relative ones already resolve.
    text = text.replace(/href="([^"]*)"/g, (whole, href: string) => {
      if (!isAbsolute(href)) return whole;
      const [path, fragment] = split(href);
      const to = at.get(normalize(path));
      return to ? `href="/${to}${fragment}"` : whole;
    });

    files.set(at.get(rel)!, Buffer.from(text, 'latin1'));
  }
  return { files, at, missing };
}

/** Every href in a document, as written. */
function hrefs(text: string): string[] {
  return [...text.matchAll(/href="([^"]*)"/g)].map((m) => m[1]!).filter(Boolean);
}

/** A data path as the archive holds it: forward slashes, no leading one. */
function normalize(p: string): string {
  return posix.normalize(p.replace(/\\/g, '/')).replace(/^\/+/, '');
}

/** Strip the `#xpointer(…)` from an href. */
function split(href: string): [string, string] {
  const hash = href.indexOf('#');
  return hash < 0 ? [href, ''] : [href.slice(0, hash), href.slice(hash)];
}

/** The data path an href names, without its fragment. */
export function dataPath(href: string): string {
  return normalize(split(href)[0]);
}

function isAbsolute(href: string): boolean {
  return href.startsWith('/') || href.startsWith('\\');
}

/** What an href in `from` points at, or null when it names nothing we can fetch. */
export function resolve(from: string, href: string): string | null {
  const [path] = split(href);
  // A Windows path is an authoring leftover — `/H:/Tools/…` and the like.
  if (!path || /^\/?[A-Za-z]:/.test(path)) return null;
  return isAbsolute(path) ? normalize(path) : normalize(posix.join(posix.dirname(from), path));
}

/** A document's root element name, past the XML declaration. */
function rootName(text: string): string | null {
  return /<([A-Za-z_][\w.-]*)[\s>/]/.exec(text.replace(/<\?[\s\S]*?\?>/g, ''))?.[1] ?? null;
}

/** One binary a document keys: which folder it lives in, and under what uid. */
interface UidOwner {
  bin: string;
  uid: string;
  /** The document's own, as opposed to something written inline inside it. */
  root: boolean;
}

/**
 * Every element in the document that owns a `bin/…` file, with its uid.
 *
 * Walked as a TREE rather than matched with a regex, because the elements nest:
 * a `<Geometry>` holds an `<AIGeometry>`, each with a `<uid>` of its own, and
 * whichever `<uid>` comes first in the text is not reliably the outer one.
 */
function uidOwners(text: string): UidOwner[] {
  let doc;
  try { doc = parse(text); } catch { return []; }
  const out: UidOwner[] = [];
  const rootEl = children(doc).find((c) => c.type === 'element');
  const walk = (el: XmlElement): void => {
    const bin = UID_BINS[el.name];
    if (bin) {
      // The wrapper around an inline body carries no uid of its own; the body
      // does, as a direct child.
      const uid = children(el).find((c) => c.name === 'uid');
      const value = uid ? textOf(uid).trim() : '';
      if (/^[0-9A-Fa-f-]{36}$/.test(value)) out.push({ bin, uid: value, root: el === rootEl });
    }
    for (const kid of children(el)) walk(kid);
  };
  if (rootEl) walk(rootEl);
  return out;
}

/**
 * A stable uid for a copied document. Derived from what it is rather than drawn
 * at random, so rebuilding a mod produces the same bytes.
 *
 * The salt below is FROZEN at the old mod name and is not `MOD_STEM`: it names
 * nothing, it only keeps this hash away from other hashes. Change it and every
 * copied geometry, skeleton and animation lands under a different uid — which
 * is a new `bin/…` file for each, and the byte-identical rebuild this exists
 * for stops being identical to anything built before.
 */
export function uidFor(of: string): string {
  const h = createHash('sha1').update(`homm5-units:uid:${of}`).digest('hex').toUpperCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
