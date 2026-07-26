// The units mod — creatures the game does not ship with, as a project on disk.
//
// A creature added this way is a mod in `<game>/UserMODs/*.h5u`: the same ZIP
// container a pak is, applied after everything in `data/` including the addon's
// own `a2p1-*`. Nothing goes into `data/` and no `index.bin` is needed.
//
// `UserMODs/` is not the only place it can sit. A `.h5m` or a `.h5c` is mounted
// the same way and for the whole session, so these files can travel inside a
// campaign instead of beside it — see docs/ARCHIVES.md, which also covers why two
// maps that each carry a creature set collide exactly as two mods would.
//
// WHAT A MOD HAS TO CARRY. Three of the game's own files, edited:
//
//   types.xml                          the CREATURE_ enum, the name→number map,
//                                      and the ref table's declared size
//   GameMechanics/RefTables/Creatures.xdb   one entry per creature
//   UI/UIGameRoot.(UIGameRoot).xdb     a camera for the hire dialog
//
// and, per creature, five small files of its own plus its art. The `Creature`
// record itself is written INTO the ref table rather than shipped as a file:
// entries may carry their object inline under `href="#n:inline(Creature)"`, which
// is how the game's own WarMachines.xdb and MicroArtifactEffects.xdb are written.
// One camera entry covers every creature — its `<creatures>` is a list, and the
// game hangs Familiar, Imp and Quasit on one.
//
// What does NOT work, since it looks as though it should: pointing several ids at
// one *file*. The ids in WarMachines.xdb that appear to share a file share only
// the literal string `#n:inline(WarMachine)`, which is a marker and not a path.
// Every id needs its own object and its own ObjectRecordID.
//
// THE ART IS COPIED IN, NOT REFERENCED. A creature could point at the shipped
// model it borrows and be a few kilobytes; instead the whole reachable closure of
// that model — geometry, skeleton, animations, materials, textures, sounds and
// the binaries behind them, about 1.7 MB — is copied under the creature's own
// folder. That is the point: with the art inside, swapping a model or recolouring
// a texture is an edit to the mod and changes nothing else, and the mod stays
// self-contained wherever it goes. Copied geometry, skeletons and animations get
// a FRESH uid too, because their binaries are keyed by uid in `bin/…` and sharing
// one would mean editing our creature's mesh edited the original creature's.
//
// See docs/NEW_CREATURES.md in the port for how the ceiling was found and why the
// first several attempts at a mod were read and silently ignored.

import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, join, posix } from 'node:path';
import { SHIPPED_CREATURES, NULL_CREATURE, blankStats, creatureRoot, readStats, setCreatureRefs, writeStats } from './creatures.ts';
import type { CreatureStats } from './creatures.ts';
import { serialize, setAttr } from './xml.ts';
import { extract, readEntries, readEntryFrom, readIndex, writeArchive } from './pak.ts';
import type { ZipEntry, ZipIndexEntry } from './pak.ts';

/** The mod's file name stem — `homm5-units.h5u` in UserMODs. */
export const MOD_STEM = 'homm5-units';

/**
 * Our own record of the mod, shipped inside it.
 *
 * The mod is readable without this — ids come out of types.xml's name→number map
 * and stats out of the inline objects — but provenance does not survive that trip.
 * Which shipped model a creature borrowed is the thing you need to re-copy its
 * art or swap it, and nothing in the game's own formats records it.
 */
export const MOD_MANIFEST = 'units.json';

/** The game's files a mod has to edit, all three of them. */
const TYPES = 'types.xml';
const REF_TABLE = 'GameMechanics/RefTables/Creatures.xdb';
const UI_ROOT = 'UI/UIGameRoot.(UIGameRoot).xdb';

/** The last creature the shipped enum lists — our anchor for appending to it. */
const LAST_SHIPPED = 'CREATURE_CYCLOP_BLOODEYED';

/** The camera the hire dialog uses. CREATURE_UNKNOWN already sits on this one. */
const HIRE_CAMERA = '/Cameras/Interface/HireCreatures.(Camera).xdb#xpointer(/Camera)';

/**
 * Where our inline objects number from. Record ids look file-local for creatures
 * that ship as files (None is 2, the Skeleton 64), but every table that inlines
 * its objects numbers from 1000000 and the addon reaches 1000059. Starting at
 * 1001000 stays clear of both and marks the range as ours.
 */
const FIRST_RECORD_ID = 1001000;

/** The game's files are CRLF throughout; matching that keeps diffs readable. */
const EOL = '\r\n';

// --- the art a creature borrows ----------------------------------------------

/**
 * The four references that decide what a creature LOOKS like. Each is a document
 * in the game's data that we copy into the mod, so each can be swapped later
 * without the mod's shape changing.
 */
export type ArtSlot = 'character' | 'model' | 'animSet' | 'icon';

/** Which field of which of our two documents each slot fills. */
const ART_FIELD: Record<ArtSlot, { doc: 'visual' | 'monster'; field: string; type: string }> = {
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
const UID_BINS: Record<string, string> = {
  Geometry: 'bin/Geometries',
  AIGeometry: 'bin/AIGeometries',
  Skeleton: 'bin/Skeletons',
  BasicSkelAnim: 'bin/animations',
  Sound: 'bin/Sounds',
  Effect: 'bin/effects',
  Light: 'bin/Lights',
};

// --- what a creature is ------------------------------------------------------

/** A creature as the editor takes it in. */
export interface CreatureSpec {
  /** `CREATURE_…`. Its NUMBER is what maps and saves store — see addCreature. */
  id: string;
  /** The stem of every file generated for it, and of its folder in the mod. */
  file: string;
  name: string;
  description: string;
  /** The ability line the hire dialog prints, in words rather than ids. */
  abilitiesText: string;
  stats: CreatureStats;
  /** The shipped `CreatureVisual` this creature's own starts from. */
  visualSource: string;
  /** And the shipped `AdvMapMonsterShared` its map stack starts from. */
  monsterSource: string;
  /**
   * Art to use instead of what those two point at. Anything omitted is taken
   * from the source documents, so a bare spec already works.
   */
  art?: Partial<Record<ArtSlot, string>>;
}

/** One in a mod: a spec, plus the id number it holds and what it actually got. */
export interface ModCreature extends CreatureSpec {
  /** Its id number. Assigned on the way in and never changed — see addCreature. */
  number: number;
  /** The art each slot resolved to, in the game's data. Provenance. */
  from: Record<ArtSlot, string>;
}

/** The mod itself. */
export interface CreatureMod {
  /** Bumped only if the manifest's shape changes incompatibly. */
  version: 1;
  /** The archive's name stem. */
  stem: string;
  /** The id the mod's creatures start at — the shipped count when it was made. */
  first: number;
  creatures: ModCreature[];
}

/** A fresh, empty mod. */
export function newCreatureMod(stem = MOD_STEM): CreatureMod {
  return { version: 1, stem, first: SHIPPED_CREATURES, creatures: [] };
}

/**
 * What the executable's creature ceiling has to be patched to for this mod.
 *
 * The two must agree EXACTLY. Patch higher and the ids past the mod are empty,
 * which stops the game; patch lower and the mod's last creatures do not exist.
 */
export function creatureLimit(mod: CreatureMod): number {
  return mod.first + mod.creatures.length;
}

/**
 * Append a creature and give it the next id number.
 *
 * THE LIST IS APPEND-ONLY. A creature's number is what maps, saved games and Lua
 * store — never its name — so inserting or reordering silently repoints every
 * creature after it. To drop one, blank it rather than closing the gap up.
 */
export function addCreature(mod: CreatureMod, spec: CreatureSpec): ModCreature {
  if (mod.creatures.some((c) => c.id === spec.id)) throw new Error(`${spec.id} is already in the mod`);
  if (!/^CREATURE_[A-Z0-9_]+$/.test(spec.id)) throw new Error(`${spec.id} is not a usable creature id`);
  if (mod.creatures.some((c) => c.file === spec.file)) throw new Error(`two creatures cannot both be "${spec.file}"`);
  const c: ModCreature = {
    ...spec,
    stats: { ...blankStats(), ...spec.stats },
    number: mod.first + mod.creatures.length,
    from: {} as Record<ArtSlot, string>,
  };
  mod.creatures.push(c);
  return c;
}

/**
 * Where the editor's object palette looks for its entries.
 *
 * One tiny file per entry, and it ships in the paks — so a mod that drops one
 * here gains a palette entry, which is how the expansion added its own monsters.
 * Under `Monsters/` because the Filter dropdown's groups are folder prefixes read
 * from `Editor/MapFilters.xml`, a loose file no mod can add to: land outside a
 * known prefix and the entry is filed under "Other" instead of with the monsters.
 */
const LINK_DIR = 'MapObjects/_(AdvMapObjectLink)/Monsters/Units';

/** Where a creature's own files sit inside the mod. */
export function creaturePaths(c: CreatureSpec): {
  dir: string; art: string; link: string;
  visual: string; monster: string; name: string; description: string; abilities: string;
} {
  const dir = `Units/${c.file}`;
  return {
    dir,
    link: `${LINK_DIR}/${c.file}.xdb`,
    // The art keeps its original directory structure under here, so every
    // relative href inside it resolves exactly as it did in the game's data.
    art: `${dir}/art`,
    visual: `${dir}/${c.file}.(CreatureVisual).xdb`,
    monster: `${dir}/${c.file}.(AdvMapMonsterShared).xdb`,
    name: `${dir}/${c.file}_Name.txt`,
    description: `${dir}/${c.file}_Desc.txt`,
    abilities: `${dir}/${c.file}_Abils.txt`,
  };
}

// --- reading the game's data --------------------------------------------------

/** Raw bytes of a data path, or null when there is no such file. */
export type DataReader = (rel: string) => Buffer | null;

/** A reader over an unpacked data root. */
export function dataReader(root: string): DataReader {
  return (rel) => {
    const p = join(root, rel);
    try {
      return statSync(p).isFile() ? readFileSync(p) : null;
    } catch {
      return null;
    }
  };
}

// --- building the mod ---------------------------------------------------------

/** A file in the built mod. */
export interface ModFile {
  path: string;
  data: Buffer;
}

/** What a build produced, and what it had to leave out. */
export interface BuildReport {
  files: ModFile[];
  /** The ceiling the executable must be patched to. */
  limit: number;
  /** Art files copied, per creature. */
  art: Record<string, number>;
  /** References we could not resolve — authoring paths, mostly, and harmless. */
  missing: string[];
}

/**
 * Build the whole mod: the three edited game files, and each creature's own five
 * plus its art.
 *
 * Nothing here touches the filesystem — `read` supplies the game's data and the
 * result is a file set, so the same code serves a project folder, an archive and
 * a test.
 */
export function buildCreatureMod(mod: CreatureMod, read: DataReader): BuildReport {
  if (!mod.creatures.length) throw new Error('the mod has no creatures, so there is no slot to open');
  const limit = creatureLimit(mod);
  const files: ModFile[] = [];
  const art: Record<string, number> = {};
  const missing: string[] = [];

  for (const c of mod.creatures) {
    const p = creaturePaths(c);
    let visual = mustRead(read, c.visualSource);
    let monster = mustRead(read, c.monsterSource);

    // Resolve each art slot: the spec's override, else whatever the source
    // document already points at. Recorded on the creature either way — the
    // manifest is where provenance lives.
    const sources: Partial<Record<ArtSlot, string>> = {};
    for (const slot of ART_SLOTS) {
      const at = ART_FIELD[slot];
      const found = c.art?.[slot] ?? hrefOf(at.doc === 'visual' ? visual : monster, at.field);
      if (found) sources[slot] = dataPath(found);
    }
    if (!sources.icon) throw new Error(`${c.id}: no icon — a creature without one stops the game at startup`);
    c.from = sources as Record<ArtSlot, string>;

    const copied = copyArt(Object.values(sources), p.art, read, c.id);
    for (const [path, data] of copied.files) files.push({ path, data });
    missing.push(...copied.missing);
    art[c.id] = copied.files.size;

    // Point the two documents at our copies and at our texts.
    for (const slot of ART_SLOTS) {
      const src = sources[slot];
      if (!src) continue;
      const to = copied.at.get(src);
      if (!to) throw new Error(`${c.id}: ${slot} art ${src} is not in the game's data`);
      const at = ART_FIELD[slot];
      const value = `/${to}#xpointer(/${at.type})`;
      if (at.doc === 'visual') visual = setHref(visual, at.field, value, c.visualSource);
      else monster = setHref(monster, at.field, value, c.monsterSource);
    }

    files.push({ path: p.visual, data: Buffer.from(creatureVisual(visual, p, c.visualSource), 'latin1') });
    files.push({ path: p.monster, data: Buffer.from(monsterShared(monster, p, c), 'latin1') });
    // The palette entry. Its icon names the creature's own 128px texture, which
    // the art copy already put in the mod: the editor's thumbnail cache is keyed
    // by link path and a mod has no entry in it, so without this the tile is
    // blank among 185 that are not.
    files.push({ path: p.link, data: Buffer.from(objectLink(p, copied.at.get(sources.icon!) ?? ''), 'latin1') });
    files.push({ path: p.name, data: utf16(c.name) });
    files.push({ path: p.description, data: utf16(c.description) });
    files.push({ path: p.abilities, data: utf16(c.abilitiesText) });
  }

  files.push({ path: TYPES, data: Buffer.from(patchTypes(mustRead(read, TYPES), mod, limit), 'latin1') });
  files.push({ path: REF_TABLE, data: Buffer.from(patchRefTable(mustRead(read, REF_TABLE), mod, read), 'latin1') });
  files.push({ path: UI_ROOT, data: Buffer.from(patchUiRoot(mustRead(read, UI_ROOT), mod), 'latin1') });

  // Last, so it records the art each slot actually resolved to.
  files.unshift({ path: MOD_MANIFEST, data: Buffer.from(`${JSON.stringify(mod, null, 2)}\n`, 'utf8') });

  return { files, limit, art, missing };
}

/** Write a built mod out as a project folder — the editable form. */
export function writeCreatureMod(dir: string, report: BuildReport): void {
  rmSync(dir, { recursive: true, force: true });
  for (const f of report.files) {
    const path = join(dir, f.path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, f.data);
  }
}

/**
 * Pack one into a `.h5u`.
 *
 * The archive members MUST carry a real modification time. Given one path in
 * several mounted archives the game takes the newest member, so a mod stamped
 * with the ZIP epoch loses every file to the game's own 2007 copies and is read
 * and then silently ignored. writeArchive defaults to now; this only says so.
 */
export function packCreatureMod(report: BuildReport, when = new Date()): Buffer {
  const entries: ZipEntry[] = report.files.map((f) => ({ name: f.path.replace(/\\/g, '/'), data: f.data }));
  return writeArchive(entries, { mtime: when });
}

// --- reading a built mod back -------------------------------------------------

/** A mod read back off disk. */
export interface FoundMod {
  path: string;
  mod: CreatureMod;
  /** The ceiling the executable needs for it. */
  limit: number;
  /**
   * Set when the archive carried no manifest of ours and the registry had to be
   * reconstructed — so names, texts and art provenance are missing.
   */
  reconstructed?: true;
}

/**
 * Read the creature registry out of an archive.
 *
 * Prefers our manifest, which is exact. Falls back to reconstructing from the
 * game's own formats — ids and numbers from types.xml's name→number map, stats
 * from the inline objects in the ref table — which is enough to say what a mod
 * adds and what ceiling it needs, and is how a mod built by somebody else reads.
 * Returns null for an archive that says nothing about creatures.
 *
 * Members are fetched one at a time rather than by inflating the whole archive:
 * a stock install has a 284 MB mod sitting next to ours, and this runs over every
 * file in the folder.
 */
export function readCreatureMod(archivePath: string): FoundMod | null {
  const fd = openSync(archivePath, 'r');
  try {
    const index = new Map<string, ZipIndexEntry>();
    for (const e of readIndex(fd, statSync(archivePath).size)) index.set(e.name.replace(/\\/g, '/'), e);
    const member = (name: string): Buffer | null => {
      const e = index.get(name);
      return e ? readEntryFrom(fd, e) : null;
    };

    const manifest = member(MOD_MANIFEST);
    if (manifest) {
      const mod = JSON.parse(manifest.toString('utf8')) as CreatureMod;
      if (mod.version === 1 && Array.isArray(mod.creatures)) {
        return { path: archivePath, mod, limit: creatureLimit(mod) };
      }
    }

    // No manifest — but a creature mod is recognisable from what it must carry.
    const types = member(TYPES);
    const table = member(REF_TABLE);
    if (!types || !table) return null;
    const mod = reconstruct(types.toString('latin1'), table.toString('latin1'));
    if (!mod.creatures.length) return null;
    return { path: archivePath, mod, limit: creatureLimit(mod), reconstructed: true };
  } finally {
    closeSync(fd);
  }
}

/** The same, from bytes already in hand. Used by the tests. */
export function readCreatureModBuffer(archive: Buffer): CreatureMod | null {
  const members = new Map<string, Buffer>();
  for (const e of readEntries(archive)) members.set(e.name.replace(/\\/g, '/'), e.data);
  const manifest = members.get(MOD_MANIFEST);
  if (manifest) return JSON.parse(manifest.toString('utf8')) as CreatureMod;
  const types = members.get(TYPES);
  const table = members.get(REF_TABLE);
  if (!types || !table) return null;
  return reconstruct(types.toString('latin1'), table.toString('latin1'));
}

/**
 * Every mod in `<game>/UserMODs` that adds creatures.
 *
 * More than one is a conflict, not a set: creature ids are global and each mod
 * carries its own whole copy of types.xml and the ref table, so the last one the
 * game reads wins outright and the others' creatures do not exist. The editor
 * reports them all and leaves the merge to a decision, since which registry to
 * keep is not ours to guess.
 */
export function findCreatureMods(gameRoot: string): FoundMod[] {
  const dir = join(gameRoot, 'UserMODs');
  if (!existsSync(dir)) return [];
  const out: FoundMod[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (!/\.(h5u|pak)$/i.test(name)) continue;
    try {
      const found = readCreatureMod(join(dir, name));
      if (found) out.push(found);
    } catch {
      // Not a readable archive. Not our business to complain about it here.
    }
  }
  return out;
}

/** An installed mod, unpacked so the editor can read it like any other root. */
export interface MountedMod extends FoundMod {
  /** The folder its members were extracted to — an asset root to layer on. */
  root: string;
}

/**
 * Unpack the installed creature mods so the editor resolves what the GAME will.
 *
 * Without this the editor reads only the unpacked data and a creature a mod adds
 * does not exist for it: the army picker offers the shipped 180, and a map that
 * places one of ours drops the object from the scene because its
 * `AdvMapMonsterShared` is in the mod and nowhere else.
 *
 * Only mods that add creatures are unpacked. Mounting everything in `UserMODs`
 * would be closer to the game still, but a stock install has a 284 MB cutscene
 * archive in there and no reason to pay for it — a mod that only replaces a
 * texture changes nothing the editor has to resolve.
 *
 * Extraction is cached per archive: re-run after a rebuild and only what changed
 * is unpacked again. Returns the roots most-specific-first, ready to hand to
 * `assets()` ahead of the data root.
 */
export function mountCreatureMods(gameRoot: string, cacheDir: string): MountedMod[] {
  const out: MountedMod[] = [];
  for (const found of findCreatureMods(gameRoot)) {
    const stem = basename(found.path).replace(/\.[^.]+$/, '');
    const root = join(cacheDir, stem);
    const stamp = join(cacheDir, `${stem}.mounted.json`);
    const now = statSync(found.path);
    const want = `${now.size}:${Math.round(now.mtimeMs)}`;
    let have = '';
    try {
      have = (JSON.parse(readFileSync(stamp, 'utf8')) as { of: string }).of;
    } catch { /* never unpacked, or the stamp is unreadable */ }
    if (have !== want) {
      rmSync(root, { recursive: true, force: true });
      mkdirSync(root, { recursive: true });
      extract(found.path, root);
      writeFileSync(stamp, `${JSON.stringify({ of: want, from: found.path }, null, 2)}\n`);
    }
    out.push({ ...found, root });
  }
  return out;
}

/**
 * Rebuild a mod's registry from the game's own formats.
 *
 * WHICH CREATURES ARE ADDED IS READABLE FROM THE TABLE, without knowing what the
 * game shipped: all 180 of its own entries point at a FILE, and an added one
 * carries its object inline. So the inline entries are the mod's, whatever its
 * ceiling, and the number each holds comes from types.xml's name→number map.
 *
 * What cannot be recovered is where the art came from — nothing in the game's
 * formats records it — so `from` is left empty and the source fields name the
 * mod's own files rather than the shipped ones they were copied from. That is
 * what our manifest is for.
 */
function reconstruct(types: string, table: string): CreatureMod {
  const numbers = new Map<string, number>();
  for (const m of types.matchAll(/<Name>(CREATURE_[A-Z0-9_]+)<\/Name>\s*<Value>(\d+)<\/Value>/g)) {
    numbers.set(m[1]!, Number(m[2]));
  }

  const creatures: ModCreature[] = [];
  for (const [id, body] of inlineObjects(table)) {
    const number = numbers.get(id);
    if (number === undefined) continue; // in the table but not in the enum: not usable
    const creature = creatureRoot(body);
    creatures.push({
      id, number, file: id.replace(/^CREATURE_/, ''),
      name: id, description: '', abilitiesText: '',
      stats: readStats(creature),
      visualSource: hrefOf(body, 'Visual') ?? '',
      monsterSource: hrefOf(body, 'MonsterShared') ?? '',
      from: {} as Record<ArtSlot, string>,
    });
  }
  creatures.sort((a, b) => a.number - b.number);
  return {
    version: 1, stem: MOD_STEM,
    first: creatures[0]?.number ?? SHIPPED_CREATURES,
    creatures,
  };
}

/**
 * The ref table's entries that carry their object inline, by creature id.
 *
 * Entries are sliced between consecutive `<ID>` elements, which is sound because
 * a `Creature` record has no `<ID>` of its own — the inline wrapper's identifier
 * is an attribute.
 */
function inlineObjects(table: string): Array<[string, string]> {
  const ids = [...table.matchAll(/<ID>(CREATURE_[A-Z0-9_]+)<\/ID>/g)];
  const out: Array<[string, string]> = [];
  for (const [i, m] of ids.entries()) {
    const until = ids[i + 1]?.index ?? table.length;
    const entry = table.slice(m.index, until);
    const open = entry.indexOf('<Creature ');
    const end = entry.lastIndexOf('</Creature>');
    if (open < 0 || end < 0) continue; // points at a file — one the game shipped
    out.push([m[1]!, entry.slice(open, end + '</Creature>'.length)]);
  }
  return out;
}

// --- copying art -------------------------------------------------------------

/** What a copy produced: the files, where each source landed, what was absent. */
interface ArtCopy {
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
function copyArt(seeds: string[], dest: string, read: DataReader, salt: string): ArtCopy {
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

    // Its binary, under a uid of ours.
    const kind = rootName(text);
    const uid = /<uid>([0-9A-Fa-f-]{36})<\/uid>/.exec(text);
    const bin = kind ? UID_BINS[kind] : undefined;
    if (bin && uid) {
      const blob = read(`${bin}/${uid[1]}`);
      if (blob) {
        const fresh = uidFor(`${salt}:${rel}`);
        files.set(`${bin}/${fresh}`, blob);
        text = text.replace(uid[0], `<uid>${fresh}</uid>`);
      }
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
function resolve(from: string, href: string): string | null {
  const [path] = split(href);
  // A Windows path is an authoring leftover — `/H:/Tools/…` and the like.
  if (!path || /^\/?[A-Za-z]:/.test(path)) return null;
  return isAbsolute(path) ? normalize(path) : normalize(posix.join(posix.dirname(from), path));
}

/** A document's root element name, past the XML declaration. */
function rootName(text: string): string | null {
  return /<([A-Za-z_][\w.-]*)[\s>/]/.exec(text.replace(/<\?[\s\S]*?\?>/g, ''))?.[1] ?? null;
}

/**
 * A stable uid for a copied document. Derived from what it is rather than drawn
 * at random, so rebuilding a mod produces the same bytes.
 */
function uidFor(of: string): string {
  const h = createHash('sha1').update(`homm5-units:uid:${of}`).digest('hex').toUpperCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

// --- the creature's own two documents ----------------------------------------

/** Our copy of a shipped `CreatureVisual`: same art, our name and description. */
function creatureVisual(visual: string, p: ReturnType<typeof creaturePaths>, source: string): string {
  let t = visual;
  for (const [field, path] of [
    ['CreatureNameFileRef', p.name],
    ['CreatureAbilitiesFileRef', p.abilities],
    ['DescriptionFileRef', p.description],
  ] as Array<[string, string]>) {
    t = setHref(t, field, `/${path}`, source);
  }
  return t;
}

/**
 * The palette entry: a link file pointing at our map-stack definition.
 *
 * `IconFile` is where this departs from the shipped links. Theirs name a `.tga`
 * under an authoring tree that was never shipped — that file BUILT
 * `Editor/IconCache`, and the editor reads the cache, keyed by link path. A mod
 * cannot add to the cache, so ours names the creature's own 128px texture, which
 * the art copy already placed in the mod, and the icon handler falls back to it.
 */
function objectLink(p: ReturnType<typeof creaturePaths>, icon: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<AdvMapObjectLink>',
    `\t<Link href="/${p.monster}#xpointer(/AdvMapMonsterShared)"/>`,
    '\t<RndGroup/>',
    `\t<IconFile>${icon}</IconFile>`,
    '\t<HideInEditor>false</HideInEditor>',
    '</AdvMapObjectLink>',
  ].join(EOL) + EOL;
}

/**
 * Our copy of a shipped `AdvMapMonsterShared` — and the one line that matters.
 *
 * `<Creature>` at the end of the file is the ONLY thing deciding which creature a
 * stack on the map is: an `AdvMapMonster` object carries no creature field of its
 * own, just a reference to one of these. Copy one without changing that line and
 * the map places the creature you copied from, with its stats and its name,
 * however new everything else about the definition is.
 */
function monsterShared(monster: string, p: ReturnType<typeof creaturePaths>, c: ModCreature): string {
  let t = monster;
  const messages = /<messagesFileRef>[\s\S]*?<\/messagesFileRef>/;
  if (!messages.test(t)) throw new Error(`${c.monsterSource}: no <messagesFileRef>`);
  t = t.replace(messages, `<messagesFileRef>${EOL}\t\t<Item href="/${p.name}"/>${EOL}\t</messagesFileRef>`);

  const creature = /<Creature>CREATURE_[A-Z0-9_]+<\/Creature>/;
  if (!creature.test(t)) throw new Error(`${c.monsterSource}: no <Creature> naming the stack's creature`);
  return t.replace(creature, `<Creature>${c.id}</Creature>`);
}

// --- the game's three files ---------------------------------------------------

/** types.xml: the enum, the name→number map, and the ref table's declared size. */
function patchTypes(types: string, mod: CreatureMod, limit: number): string {
  let t = types;

  const enumAt = once(t, `<Item>${LAST_SHIPPED}</Item>`, 'types.xml enum');
  t = insertAfterLine(t, enumAt, mod.creatures.map((c) => `<Item>${c.id}</Item>`));

  // The name→number map. Numbers are what maps and saves store, so this is the
  // part that must never be reshuffled — see addCreature.
  const mapAt = once(t, `<Name>${LAST_SHIPPED}</Name>`, 'types.xml name→number map');
  const itemEnd = t.indexOf('</Item>', mapAt);
  if (itemEnd < 0) throw new Error('types.xml name→number map: the last entry has no </Item>');
  t = insertAfterLine(t, itemEnd, mod.creatures.flatMap((c) => [
    '<Item>', `\t<Name>${c.id}</Name>`, `\t<Value>${c.number}</Value>`, '</Item>',
  ]));

  // How many objects the table is declared to hold. MinElements stays where it
  // is: it is a floor, and the new count clears it.
  const table = once(t, '<TypeName>Table_Creature_CreatureType</TypeName>', 'types.xml creature table');
  const numObjs = t.indexOf('<Key>ref_table_num_objs</Key>', table);
  if (numObjs < 0) throw new Error('types.xml creature table: no ref_table_num_objs');
  t = retune(t, numObjs, 'Data', mod.first, limit, 'types.xml ref_table_num_objs');
  return retune(t, table, 'MaxElements', mod.first, limit, 'types.xml MaxElements');
}

/** Creatures.xdb: one entry per creature, each carrying its own inline object. */
function patchRefTable(table: string, mod: CreatureMod, read: DataReader): string {
  const had = count(table, /<ID>CREATURE_/g);
  if (had !== mod.first) throw new Error(`${REF_TABLE}: ${had} entries, expected ${mod.first}`);

  const nul = mustRead(read, NULL_CREATURE);
  const close = once(table, '</objects>', `${REF_TABLE} objects`);
  const t = insertBeforeLine(table, close, mod.creatures.flatMap((c, i) => {
    const p = creaturePaths(c);
    const creature = creatureRoot(nul);
    writeStats(creature, c.stats);
    setCreatureRefs(creature, `/${p.visual}`, `/${p.monster}`);
    setAttr(creature, 'ObjectRecordID', String(FIRST_RECORD_ID + i));
    return [
      '<Item>',
      `\t<ID>${c.id}</ID>`,
      // The id has to be unique across the table and nothing appears to read it,
      // so it is derived from the creature — which keeps a rebuild byte-identical.
      `\t<Obj href="#n:inline(Creature)" id="item_${uidFor(`obj:${c.id}`).toLowerCase()}">`,
      ...serialize(creature).split(/\r?\n/).map((l) => `\t\t${l}`),
      '\t</Obj>',
      '</Item>',
    ];
  }));

  const now = count(t, /<ID>CREATURE_/g);
  if (now !== creatureLimit(mod)) throw new Error(`${REF_TABLE}: ended with ${now} entries, expected ${creatureLimit(mod)}`);
  return t;
}

/** UIGameRoot: one camera entry, listing every creature we added. */
function patchUiRoot(ui: string, mod: CreatureMod): string {
  const close = once(ui, '</creaturesCameras>', `${UI_ROOT} cameras`);
  return insertBeforeLine(ui, close, [
    '<Item>',
    `\t<Camera href="${HIRE_CAMERA}"/>`,
    '\t<creatures>',
    ...mod.creatures.map((c) => `\t\t<Item>${c.id}</Item>`),
    '\t</creatures>',
    '</Item>',
  ]);
}

// --- text surgery -------------------------------------------------------------
//
// These documents are serialized structs whose field order is part of the format,
// and the game's own editor writes them with tabs and CRLF. Splicing lines keeps
// every byte we did not mean to touch, which a reserialize would not.

/** Locate `needle`, insisting it appears exactly once. An anchor that moved is a bug. */
function once(text: string, needle: string, what: string): number {
  const i = text.indexOf(needle);
  if (i < 0) throw new Error(`${what}: anchor missing — ${needle}`);
  if (text.indexOf(needle, i + 1) >= 0) throw new Error(`${what}: anchor appears twice — ${needle}`);
  return i;
}

/** The whitespace the line containing `at` begins with. */
function indentOf(text: string, at: number): string {
  const start = text.lastIndexOf('\n', at) + 1;
  return /^[\t ]*/.exec(text.slice(start, at))![0];
}

/** Insert `lines` after the line `at` falls on, indented to match it. */
function insertAfterLine(text: string, at: number, lines: string[]): string {
  const indent = indentOf(text, at);
  const eol = text.indexOf('\n', at);
  if (eol < 0) throw new Error('anchor is on the last line');
  return `${text.slice(0, eol + 1)}${lines.map((l) => indent + l).join(EOL)}${EOL}${text.slice(eol + 1)}`;
}

/** Insert `lines` before the line `at` falls on, indented one level deeper. */
function insertBeforeLine(text: string, at: number, lines: string[]): string {
  const start = text.lastIndexOf('\n', at) + 1;
  const indent = `${indentOf(text, at)}\t`;
  return `${text.slice(0, start)}${lines.map((l) => indent + l).join(EOL)}${EOL}${text.slice(start)}`;
}

/**
 * Retune a number, matching the whole element so its value is part of the anchor.
 * Both sites sit inside a nesting that repeats the tag — `ref_table_num_objs`
 * holds its number in a `<Data>` inside a `<Data>` — so "the next `<Data>`" is
 * the wrong thing to look for and "the next `<Data>180</Data>`" is the right one.
 */
function retune(text: string, from: number, tag: string, expect: number, to: number, what: string): string {
  const needle = `<${tag}>${expect}</${tag}>`;
  const i = text.indexOf(needle, from);
  if (i < 0) throw new Error(`${what}: no ${needle} after offset ${from}`);
  return `${text.slice(0, i)}<${tag}>${to}</${tag}>${text.slice(i + needle.length)}`;
}

/** An element's `href`, as written. */
function hrefOf(text: string, field: string): string | null {
  return new RegExp(`<${field}\\s+href="([^"]*)"`).exec(text)?.[1] ?? null;
}

/** Replace one, whether it was written with an href or as an empty element. */
function setHref(text: string, field: string, value: string, what: string): string {
  const re = new RegExp(`<${field}(?:\\s+[^>]*?)?/>`);
  if (!re.test(text)) throw new Error(`${what}: no <${field}/> to point at ${value}`);
  return text.replace(re, `<${field} href="${value}"/>`);
}

/** Read a data file that has to be there. */
function mustRead(read: DataReader, rel: string): string {
  const data = read(rel);
  if (!data) throw new Error(`the game's data has no ${rel} — is the data root unpacked?`);
  return data.toString('latin1');
}

/** The game's text files: UTF-16 LE with a byte-order mark and no trailing newline. */
function utf16(s: string): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(s, 'utf16le')]);
}

function count(text: string, re: RegExp): number {
  return [...text.matchAll(re)].length;
}
