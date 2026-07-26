// The placeable-object catalogue: what the original editor's Objects tab offers.
//
// Three separate things come together here, and none of them lives in the map:
//
//   * `MapObjects/_(AdvMapObjectLink)/**.xdb` — one tiny file per palette entry,
//     pointing at the shared definition an actual map object would reference.
//     This is the catalogue. It ships in the paks, so a mod that drops files
//     here gains palette entries for free — the expansion does exactly that,
//     and so does our units mod. Which is why the scans below go through the
//     MOUNTED chain (src/assets.ts): walking one root shows the game as shipped,
//     and a creature a mod adds was simply not in the palette.
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
import { toAssets } from './assets.ts';
import type { Assets } from './assets.ts';
import { Registry } from './registry.ts';

/** One entry of the object palette. */
export interface PlaceableObject {
  /** Path of the link file, relative to the data root, with forward slashes. */
  path: string;
  /** Leaf name, cleaned of the `.(AdvMapObjectLink)` suffix. */
  name: string;
  /**
   * What the palette shows under the icon.
   *
   * The object's OWN name comes first, where its type has one: a monster's
   * creature, a dwelling's first message. That is the name the game shows, and
   * the only source for anything a mod added, whose file name is a file name and
   * not a name. Otherwise the icon cache's, and `name` when there is neither.
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
  /**
   * The link's own `<IconFile>`, verbatim.
   *
   * The shipped ones name a `.tga` under an authoring tree that was never
   * shipped — it is what BUILT the icon cache, not something to read. A mod has
   * no cache entry at all, so ours names a texture that really is in the mod and
   * the icon handler falls back to it.
   */
  iconFile?: string;
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

function readLink(xml: string): { shared: string; type: string; random: boolean; iconFile: string } | null {
  const direct = /<Link\s+href="([^"]*)"/i.exec(xml);
  // The "Random ..." entries carry an empty <Link/> and point at an
  // AdvMapSharedGroup instead — one of which the game picks at load. There are
  // 53 of them and they are the first thing in several palette groups, so
  // requiring a direct link dropped exactly the entries a designer reaches for
  // first.
  const rnd = /<RndGroup\s+href="([^"]*)"/i.exec(xml);
  const shared = direct?.[1] || rnd?.[1] || '';
  if (!shared) return null;
  const iconFile = /<IconFile>([^<]*)<\/IconFile>/i.exec(xml)?.[1]?.trim() ?? '';
  return { shared, type: typeFromShared(shared), random: !direct?.[1] && !!rnd?.[1], iconFile };
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
function resolveGroupMember(data: Assets, groupHref: string): { shared: string; type: string } | null {
  const rel = groupHref.split('#')[0]!.replace(/^\//, '');
  const xml = data.text(rel);
  if (xml === null) return null;
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
export function listPlaceable(root: string | Assets, editorRoot: string): {
  objects: PlaceableObject[];
  groups: ObjectGroup[];
} {
  const data = toAssets(root);
  const groups = readObjectGroups(editorRoot);
  const objects: PlaceableObject[] = [];
  // Every mounted root's copy of the catalogue folder. A mod ADDS entries rather
  // than replacing the folder, so all of them are walked and the first root to
  // reach a path keeps it — the same "topmost wins" a file read follows.
  const bases = data.dirs(LINK_ROOT);
  if (!bases.length) return { objects, groups };
  const seen = new Set<string>();
  const nameOf = sharedLabeller(data);

  let base = bases[0]!;
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
        const member = resolveGroupMember(data, link.shared);
        if (member) { link.shared = member.shared; link.type = member.type; }
      }
      const rel = `${LINK_ROOT}/${relative(base, full).split(sep).join('/')}`;
      if (seen.has(rel.toLowerCase())) continue;
      seen.add(rel.toLowerCase());
      const leaf = cleanName(e);
      // The label lives in the icon cache, so read it while we are here rather
      // than per-icon later: the palette sorts by it, so it is needed up front.
      let meta: { name: string | null; description: string | null } = { name: null, description: null };
      const icon = iconPathFor(editorRoot, rel);
      if (icon) { try { meta = readIconMeta(readFileSync(icon)); } catch { /* keep the file name */ } }
      objects.push({
        path: rel,
        name: leaf,
        label: nameOf(link.type, link.shared) || meta.name?.trim() || leaf,
        description: meta.description?.trim() || null,
        group: groupOf(rel, groups),
        shared: link.shared,
        type: link.type,
        hidden: /<HideInEditor>\s*true\s*<\/HideInEditor>/i.test(xml),
        random: link.random,
        ...(link.iconFile ? { iconFile: link.iconFile } : {}),
      });
    }
  };
  for (const b of bases) { base = b; walk(b); }
  const linked = new Set(objects.map((x) => sharedKey(x.shared)));
  for (const o of unlinkedShared(data, linked, nameOf)) objects.push(o);
  // Sorted by the label, which is what the original orders by — Arcane Library
  // lands beside Alchemist Lab rather than under S for SpellShop.
  objects.sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label));
  return { objects, groups };
}

/** Compare shared references by what they point at: case and leading slash vary. */
const sharedKey = (href: string): string => href.toLowerCase().replace(/^\/+/, '').split('#')[0]!;

/** The data path an href names: no fragment, no leading slash. */
const hrefPath = (href: string): string => href.split('#')[0]!.replace(/^\/+/, '');

/**
 * Names an entry from its own data, when the object type carries a name at all.
 *
 * The palette's own name source is the icon cache, which only the game's
 * installer writes: it has nothing for anything a mod adds, so such an entry
 * fell back to the LINK FILE'S NAME. That is a path, not a name — and the way to
 * change it was to rename a file, which is backwards.
 *
 * Two types do carry one, each somewhere else:
 *
 *   a MONSTER names a creature, and the creature's name is what the roster and
 *     the game show. 49 of the 187 shipped monsters have no cache name either
 *     and gain one here.
 *   a DWELLING's first message IS its name — true of all 42 shipped dwellings,
 *     so the "Поляна единорогов" a captured building calls itself is on its tile.
 *
 * Gated on the type because the alternative is reading all 1467 shared
 * definitions for the handful that say anything. The creature roster is built
 * lazily and once, so a catalogue with no monsters never pays for it.
 */
function sharedLabeller(data: Assets): (type: string, shared: string) => string {
  let names: Map<string, string> | null = null;
  return (type, shared) => {
    if (type !== 'AdvMapMonster' && type !== 'AdvMapDwelling') return '';
    const xml = data.text(hrefPath(shared));
    if (!xml) return '';
    if (type === 'AdvMapDwelling') {
      const first = /<messagesFileRef>\s*<Item href="([^"]+)"/.exec(xml)?.[1];
      return first ? gameText(data, first) : '';
    }
    const id = /<Creature>\s*([A-Za-z0-9_]+)\s*<\/Creature>/.exec(xml)?.[1];
    if (!id) return '';
    if (!names) {
      names = new Map();
      for (const c of new Registry(data).creatures()) if (c.name) names.set(c.id, c.name);
    }
    return names.get(id) ?? '';
  };
}

/** A HoMM5 text file's contents: UTF-16 LE with a byte-order mark. */
function gameText(data: Assets, href: string): string {
  const b = data.bytes(hrefPath(href));
  if (!b || !b.length) return '';
  const s = b.length >= 2 && b[0] === 0xff && b[1] === 0xfe ? b.toString('utf16le', 2) : b.toString('utf8');
  return s.replace(/\0+$/, '').trim();
}

/** Group name for a shared definition no filter covers — its own top folder. */
const sharedGroup = (rel: string): string => {
  const parts = rel.split('/');
  return `Shared: ${parts[1] ?? 'MapObjects'}`;
};

/**
 * Placeable definitions no object link points at.
 *
 * 559 of the 1634 shared definitions are like this, and they are not leftovers:
 * they are the members of the `_(AdvMapSharedGroup)` lists an editor places one
 * of at random (434 statics — fences, mushrooms, flowers) and the 83 NAMED
 * heroes, reachable in the original only through a "Random hero" entry. C1M1
 * alone uses 24 of them, for 713 of its 2645 objects, so a catalogue built from
 * links only cannot rebuild a shipped map — and a person cannot place a
 * particular fence or put Cyrus on the map at all.
 *
 * They carry no icon (the cache is keyed by link path) and no filter group, so
 * they land in a "Shared: …" group of their own rather than pretending to be
 * catalogue entries of the same kind.
 */
function unlinkedShared(
  data: Assets,
  linked: Set<string>,
  nameOf: (type: string, shared: string) => string,
): PlaceableObject[] {
  const out: PlaceableObject[] = [];
  const roots = data.dirs('MapObjects');
  if (!roots.length) return out;
  const seen = new Set<string>();
  let root = roots[0]!;
  const walk = (dir: string): void => {
    let ents: string[];
    try { ents = readdirSync(dir); } catch { return; }
    for (const e of ents) {
      const full = join(dir, e);
      let st;
      try { st = statSync(full); } catch { continue; }
      // The link and group folders hold references, not definitions.
      if (st.isDirectory()) { if (!e.startsWith('_(')) walk(full); continue; }
      const m = /^(.*)\.\((AdvMap\w+Shared)\)\.xdb$/i.exec(e);
      if (!m) continue;
      const rel = `MapObjects/${relative(root, full).split(sep).join('/')}`;
      if (seen.has(rel.toLowerCase())) continue;
      seen.add(rel.toLowerCase());
      const href = `/${rel}#xpointer(/${m[2]})`;
      if (linked.has(sharedKey(href))) continue;
      const type = typeFromShared(href);
      out.push({
        path: rel,
        name: m[1]!,
        // A creature a mod ships without a link file lands here, and this is the
        // only chance it gets to be named.
        label: nameOf(type, href) || m[1]!,
        description: null,
        group: sharedGroup(rel),
        shared: href,
        type,
        hidden: false,
        random: false,
      });
    }
  };
  for (const r of roots) { root = r; walk(r); }
  return out;
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
