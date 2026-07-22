// The placeable-object catalogue: what the original editor's Objects tab offers.
//
// Three separate things come together here, and none of them lives in the map:
//
//   * `MapObjects/_(AdvMapObjectLink)/**.xdb` — one tiny file per palette entry,
//     pointing at the shared definition an actual map object would reference.
//     This is the catalogue. It ships in the paks, so a mod that drops files
//     here gains palette entries for free — the expansion does exactly that.
//   * `Editor/MapFilters.xml` — the Filter dropdown: named groups, each a union
//     of folder prefixes. Loose on disk, NOT in any pak, so a mod cannot add a
//     group by shipping one.
//   * `Editor/IconCache/**` — pre-rendered thumbnails, in the same Nival
//     container the terrain uses.
//
// Because the filter list is unreachable by mods, entries that match no group
// are collected under "Other" rather than dropped. Being invisible is how the
// original behaves, not a rule of the format, and copying it would hide exactly
// the objects a mod author most wants to place.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';

/** One entry of the object palette. */
export interface PlaceableObject {
  /** Path of the link file, relative to the data root, with forward slashes. */
  path: string;
  /** Leaf name, cleaned of the `.(AdvMapObjectLink)` suffix. */
  name: string;
  /**
   * What the original editor shows under the icon, from the icon cache.
   * Falls back to `name` when there is no cache entry.
   */
  label: string;
  /** The tooltip the original shows, when the cache carries one. */
  description: string | null;
  /** Filter group this falls in, or 'Other'. */
  group: string;
  /** href of the shared definition a placed object points at. */
  shared: string;
  /** Object type implied by the shared href, e.g. 'AdvMapStatic'. */
  type: string;
  /** True when the file asks to be kept out of the editor. */
  hidden: boolean;
  /** True for the "Random ..." entries, which resolve to a group at load. */
  random: boolean;
}

/** A group in the Filter dropdown. Separator rows carry no prefixes. */
export interface ObjectGroup {
  name: string;
  /** Folder prefixes, data-root relative with forward slashes. */
  prefixes: string[];
  /** True for the `==== Environment ====` heading rows. */
  separator: boolean;
}

const LINK_ROOT = 'MapObjects/_(AdvMapObjectLink)';

/** Strip the editor's suffixes from a file name. */
function cleanName(file: string): string {
  return file.replace(/\.\(AdvMapObjectLink\)\.xdb$/i, '').replace(/\.xdb$/i, '');
}

/**
 * The shared href a link points at, and the object type it implies.
 *
 * The type comes from the xpointer rather than from a lookup table: the file
 * says `#xpointer(/AdvMapStaticShared)`, and dropping the `Shared` suffix gives
 * the element name a placed object uses. A table would be a second opinion
 * about something the data already states.
 */
/**
 * The object type a shared href implies, from its xpointer: the file says
 * `#xpointer(/AdvMapStaticShared)`, and dropping the `Shared` suffix gives the
 * element name a placed object uses. Empty when the href names no `…Shared`
 * (e.g. an `AdvMapSharedGroup`, which must be resolved to a member first).
 */
function typeFromShared(href: string): string {
  const x = /#xpointer\(\/(\w+)Shared\)/i.exec(href);
  return x ? `AdvMap${x[1]!.replace(/^AdvMap/i, '')}` : '';
}

function readLink(xml: string): { shared: string; type: string; random: boolean } | null {
  const direct = /<Link\s+href="([^"]*)"/i.exec(xml);
  // The "Random ..." entries carry an empty <Link/> and point at an
  // AdvMapSharedGroup instead — one of which the game picks at load. There are
  // 53 of them and they are the first thing in several palette groups, so
  // requiring a direct link dropped exactly the entries a designer reaches for
  // first.
  const rnd = /<RndGroup\s+href="([^"]*)"/i.exec(xml);
  const shared = direct?.[1] || rnd?.[1] || '';
  if (!shared) return null;
  return { shared, type: typeFromShared(shared), random: !direct?.[1] && !!rnd?.[1] };
}

/**
 * Resolve a random group to a concrete member the editor can place.
 *
 * A random link points at an `AdvMapSharedGroup` — a list of interchangeable
 * shareds the game chooses from at load (every generic hero is one of these).
 * The group is not itself placeable: it has no type and no model, so placing it
 * failed with "unknown object type". The editor stands in the first member, a
 * real object with a type and a mesh; the game would have picked one anyway.
 */
function resolveGroupMember(dataRoot: string, groupHref: string): { shared: string; type: string } | null {
  const rel = groupHref.split('#')[0]!.replace(/^\//, '');
  let xml: string;
  try { xml = readFileSync(join(dataRoot, rel), 'utf8'); } catch { return null; }
  const first = xml.match(/<links>[\s\S]*?<Item href="([^"]+)"/)?.[1];
  const type = first ? typeFromShared(first) : '';
  return first && type ? { shared: first, type } : null;
}

/** Parse `Editor/MapFilters.xml` into the Objects tab's groups. */
export function readObjectGroups(editorRoot: string): ObjectGroup[] {
  const file = join(editorRoot, 'MapFilters.xml');
  if (!existsSync(file)) return [];
  const xml = readFileSync(file, 'utf8');
  // Only the MAPOBJECT key describes the Objects tab; the TILE_SET key in the
  // same file drives the Tiles tab's Terra skin dropdown.
  const key = xml.indexOf('<Key>MAPOBJECT</Key>', xml.indexOf('<Filters>'));
  if (key < 0) return [];
  const end = xml.indexOf('<Key>', key + 10);
  const section = xml.slice(key, end < 0 ? undefined : end);
  const out: ObjectGroup[] = [];
  for (const m of section.matchAll(/<Name>([^<]*)<\/Name>([\s\S]*?)(?=<Name>|$)/g)) {
    const name = m[1] ?? '';
    const body = m[2] ?? '';
    const prefixes: string[] = [];
    for (const p of body.matchAll(/<Item>(MapObjects[^<]*)<\/Item>/g)) {
      // The file uses Windows separators and may omit the trailing one.
      prefixes.push((p[1] ?? '').replace(/\\/g, '/').replace(/\/?$/, '/'));
    }
    out.push({ name, prefixes, separator: /<Separator>1<\/Separator>/.test(body) || !prefixes.length });
  }
  return out;
}

/** Which group a link path belongs to, or 'Other' when no filter covers it. */
function groupOf(path: string, groups: ObjectGroup[]): string {
  for (const g of groups) {
    if (g.separator) continue;
    for (const p of g.prefixes) if (path.toLowerCase().startsWith(p.toLowerCase())) return g.name;
  }
  return 'Other';
}

/**
 * Every placeable object under the data root, grouped by the editor's filters.
 *
 * `hidden` entries are kept rather than dropped, so the UI can offer to show
 * them: 51 of the 1469 shipped links are marked, and they are exactly the test
 * and developer objects someone poking at the game may want.
 */
export function listPlaceable(dataRoot: string, editorRoot: string): {
  objects: PlaceableObject[];
  groups: ObjectGroup[];
} {
  const groups = readObjectGroups(editorRoot);
  const base = join(dataRoot, LINK_ROOT);
  const objects: PlaceableObject[] = [];
  if (!existsSync(base)) return { objects, groups };

  const walk = (dir: string): void => {
    let ents: string[];
    try { ents = readdirSync(dir); } catch { return; }
    for (const e of ents) {
      const full = join(dir, e);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) { walk(full); continue; }
      if (!e.toLowerCase().endsWith('.xdb')) continue;
      let xml: string;
      try { xml = readFileSync(full, 'utf8'); } catch { continue; }
      const link = readLink(xml);
      if (!link) continue;
      // A random group is not placeable as itself — stand in its first member,
      // which carries the type and mesh the group only points to.
      if (!link.type) {
        const member = resolveGroupMember(dataRoot, link.shared);
        if (member) { link.shared = member.shared; link.type = member.type; }
      }
      const rel = relative(dataRoot, full).split(sep).join('/');
      const leaf = cleanName(e);
      // The label lives in the icon cache, so read it while we are here rather
      // than per-icon later: the palette sorts by it, so it is needed up front.
      let meta: { name: string | null; description: string | null } = { name: null, description: null };
      const icon = iconPathFor(editorRoot, rel);
      if (icon) { try { meta = readIconMeta(readFileSync(icon)); } catch { /* keep the file name */ } }
      objects.push({
        path: rel,
        name: leaf,
        label: meta.name?.trim() || leaf,
        description: meta.description?.trim() || null,
        group: groupOf(rel, groups),
        shared: link.shared,
        type: link.type,
        hidden: /<HideInEditor>\s*true\s*<\/HideInEditor>/i.test(xml),
        random: link.random,
      });
    }
  };
  walk(base);
  // Sorted by the label, which is what the original orders by — Arcane Library
  // lands beside Alchemist Lab rather than under S for SpellShop.
  objects.sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label));
  return { objects, groups };
}

// --- icons ------------------------------------------------------------------
//
// `Editor/IconCache/<type>/<link path without extension>` holds pre-rendered
// thumbnails in the same container the terrain uses:
//
//   04 08 <u32 version>
//   01 <size> <payload>            -- the whole image list
//     01 <size>                    -- one image
//       01 08 <u32 width>
//       02 08 <u32 height>
//       03 <size> <w*h*4 BGRA>
//
// Sizes follow the terrain rule: the low bit is a width flag. Odd -> a u32
// follows and the length is (size-1)/2; even -> that byte IS the size and the
// length is size/2. Decoded once for the terrain, reused unchanged here.

/** Read a size field at `off`; returns the byte length and where data starts. */
function readSize(b: Buffer, off: number): { len: number; at: number } {
  const s = b[off]!;
  if (s & 1) {
    const v = b.readUInt32LE(off);
    return { len: (v - 1) / 2, at: off + 4 };
  }
  return { len: s / 2, at: off + 1 };
}

/**
 * The label and tooltip the original editor shows, read from the icon cache.
 *
 * The cache is not only thumbnails: after the images it carries the object's
 * display NAME (tag 3) and DESCRIPTION (tag 4). That is where "Arcane Library"
 * comes from for the file named SpellShop — the link files and the shared
 * definitions have no such name, and only 125 of 1634 shared files reference a
 * text resource at all, so this is the sole source.
 *
 * It also settles the palette's ordering: the original sorts by this label,
 * which is why Arcane Library sits just after Alchemist Lab while the file
 * names would put SpellShop under S.
 *
 * The strings sit beside the images INSIDE the file's one big block, not at the
 * top level, so this descends exactly one level. Scanning the whole file for a
 * tag 3 instead would hit the pixel records first — inside an image, tag 3 is
 * the BGRA.
 */
export function readIconMeta(buf: Buffer): { name: string | null; description: string | null } {
  /** Records filling [start, end), without descending. */
  const walk = (start: number, end: number): { tag: number; at: number; len: number }[] => {
    const out: { tag: number; at: number; len: number }[] = [];
    let p = start;
    // Bounded: an icon holds a handful of images plus these two strings.
    for (let guard = 0; guard < 64 && p + 1 < end; guard++) {
      const tag = buf[p]!;
      const { len, at } = readSize(buf, p + 1);
      if (len < 0 || at + len > end) break;
      out.push({ tag, at, len });
      p = at + len;
    }
    return out;
  };
  const body = walk(0, buf.length).find((r) => r.tag === 1);
  if (!body) return { name: null, description: null };
  // Windows-1252, not UTF-8: the apostrophe in "Astrologer's Tower" is the
  // single byte 0x92, which as UTF-8 is a broken sequence.
  const dec = new TextDecoder('windows-1252');
  const text = (r: { at: number; len: number } | undefined): string | null =>
    r ? dec.decode(buf.subarray(r.at, r.at + r.len)) : null;
  const inner = walk(body.at, body.at + body.len);
  // Tag 4 also frames the format version at the very start of the file, which
  // is why this looks inside the block rather than anywhere.
  return { name: text(inner.find((r) => r.tag === 3)), description: text(inner.find((r) => r.tag === 4)) };
}

/** One decoded icon: RGBA pixels ready for a canvas. */
export interface Icon {
  w: number;
  h: number;
  rgba: Uint8Array;
}

/**
 * Decode the largest image in an icon-cache file.
 *
 * A file holds the same icon at several sizes; the biggest is the one worth
 * showing, and picking by area avoids assuming which order they are in.
 */
export function readIconFile(buf: Buffer): Icon | null {
  let best: Icon | null = null;
  // Walk records looking for the width/height/data triple. Scanning rather than
  // descending the tree keeps this indifferent to how the images are nested,
  // which differs between the two cache folders.
  for (let i = 0; i + 12 < buf.length; i++) {
    if (buf[i] !== 0x01 || buf[i + 1] !== 0x08) continue;
    if (buf[i + 6] !== 0x02 || buf[i + 7] !== 0x08) continue;
    const w = buf.readUInt32LE(i + 2), h = buf.readUInt32LE(i + 8);
    if (w <= 0 || h <= 0 || w > 4096 || h > 4096) continue;
    if (buf[i + 12] !== 0x03) continue;
    const { len, at } = readSize(buf, i + 13);
    if (len !== w * h * 4 || at + len > buf.length) continue;
    if (best && best.w * best.h >= w * h) { i = at + len - 1; continue; }
    // BGRA on disk, RGBA in a canvas.
    const rgba = new Uint8Array(len);
    for (let p = 0; p < len; p += 4) {
      rgba[p] = buf[at + p + 2]!;
      rgba[p + 1] = buf[at + p + 1]!;
      rgba[p + 2] = buf[at + p]!;
      rgba[p + 3] = buf[at + p + 3]!;
    }
    best = { w, h, rgba };
    i = at + len - 1;
  }
  return best;
}

/** Icon-cache path for a link file, or null when the cache has none. */
export function iconPathFor(editorRoot: string, linkPath: string): string | null {
  // The cache mirrors the link path with the extension dropped.
  const p = join(editorRoot, 'IconCache', 'AdvMapObjectLink', linkPath.replace(/\.xdb$/i, ''));
  return existsSync(p) ? p : null;
}

/**
 * Find the editor-config folder by walking up from `from`.
 *
 * Walks to the filesystem root rather than a fixed number of steps. A fixed
 * limit is guesswork about how deep the caller happens to sit, and it was
 * wrong: from the bundled `data-unpacked` the game's Editor folder is four
 * levels up, one past where a limit of four stopped looking, so the palette
 * came up with no groups and no icons.
 *
 * The test is specific — a folder called Editor that actually contains
 * MapFilters.xml or IconCache — so walking further does not risk matching some
 * unrelated directory named Editor along the way.
 *
 * Prefer HOMM5_ROOT when the game folder is known; this is the fallback.
 */
export function findEditorRoot(from: string): string | null {
  let dir = from;
  for (;;) {
    const cand = join(dir, 'Editor');
    if (existsSync(join(cand, 'MapFilters.xml')) || existsSync(join(cand, 'IconCache'))) return cand;
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}
