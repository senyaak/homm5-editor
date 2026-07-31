// The mod as a file: written to a folder, packed into an .h5u, installed into
// the game, found again and read back.
//
// Reading back has two halves. The manifest we ship (units.json) carries
// provenance — which shipped model a creature borrowed — and is what the editor
// reopens. Without it, reconstruct still recovers ids and stats out of
// types.xml and the reference table, which is what makes a mod built by an
// older editor, or edited by hand, still openable.



import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { extract, readEntries, readEntryFrom, readIndex, writeArchive } from '../format/pak.ts';
import { MOD_DIR, ensureModDir, modFile } from '../game/mod-paths.ts';
import { setArtifactLimit } from '../exe/artifact-limit.ts';
import { setCreatureLimit } from '../exe/creature-limit.ts';
import { SHIPPED_CREATURES, creatureRoot, readStats } from './creatures.ts';
import { artifactLimit, creatureLimit } from './mod-model.ts';
import { MOD_MANIFEST, MOD_STEM, REF_TABLE, TYPES } from './mod-files.ts';
import { hrefOf } from './xml-edit.ts';
import type { ZipEntry, ZipIndexEntry } from '../format/pak.ts';
import type { ArtifactExeResult } from '../exe/artifact-limit.ts';
import type { ExeResult } from '../exe/creature-limit.ts';
import type { ArtSlot } from './mod-art.ts';
import type { BuildReport } from './mod-files.ts';
import type { CreatureMod, ModCreature } from './mod-model.ts';

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

/** Where an installed mod went, and what the executable now says. */
export interface Installed {
  archive: string;
  /**
   * The ceiling that was set — or null when the mod adds no creature and the
   * executable is none of its business. Dwellings and other objects are data.
   */
  exe: ExeResult | null;
  /**
   * And the artifact ceiling, which is also in the executable — a thing the
   * format gives every appearance of deciding by itself and does not.
   */
  artifacts: ArtifactExeResult | null;
}

/**
 * Install a built mod: the archive into our folder, and the ceiling into the
 * executable, as ONE action.
 *
 * They cannot be separate. A mod whose creatures sit above the ceiling is read
 * and silently ignored, and a ceiling above the mod's last creature stops the
 * game at launch, so an install that writes one and forgets the other leaves the
 * game in one of those two states. Adding or removing a creature therefore
 * re-patches by itself; nothing has to be remembered.
 *
 * Throws with the reason if the ceiling cannot be set — and then the archive is
 * NOT installed either, because a mod the game will ignore is worse than no mod:
 * it looks installed.
 */
export function installCreatureMod(gameRoot: string, mod: CreatureMod, archive: Buffer): Installed {
  const exe = mod.creatures.length ? setCreatureLimit(gameRoot, creatureLimit(mod)) : null;
  // Artifacts have a ceiling in the executable too, and finding that out cost
  // three wrong answers: raising the table's declared size in types.xml is
  // enough for the game to READ a hundred artifacts and not enough for it to use
  // the ones past 97. See src/artifact-limit.ts.
  const artifacts = mod.artifacts?.length
    ? setArtifactLimit(gameRoot, artifactLimit(mod))
    : null;
  ensureModDir(gameRoot);
  const target = modFile(gameRoot, 'mod', mod.stem);
  writeFileSync(target, archive);
  return { archive: target, exe, artifacts };
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
      const mod = readManifest(manifest);
      if (mod) return { path: archivePath, mod, limit: creatureLimit(mod) };
    }

    // No manifest — but a creature mod is recognisable from what it must carry.
    // A dwelling leaves no such trace: it edits nothing of the game's, so an
    // archive without a manifest is only ever read for its creatures.
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
  if (manifest) return readManifest(manifest);
  const types = members.get(TYPES);
  const table = members.get(REF_TABLE);
  if (!types || !table) return null;
  return reconstruct(types.toString('latin1'), table.toString('latin1'));
}

/**
 * Our manifest, or null when the bytes are not one.
 *
 * `dwellings` is filled in when it is absent: every mod built before dwellings
 * existed has a manifest without it, and the rest of the code reads the field.
 */
function readManifest(bytes: Buffer): CreatureMod | null {
  let mod: CreatureMod;
  try {
    mod = JSON.parse(bytes.toString('utf8')) as CreatureMod;
  } catch {
    return null;
  }
  if (mod.version !== 1 || !Array.isArray(mod.creatures)) return null;
  if (!Array.isArray(mod.dwellings)) mod.dwellings = [];
  if (!Array.isArray(mod.buildings)) mod.buildings = [];
  // A hero used to be `file` + `donor`; he is `id` + `basedOn` now. An archive
  // installed before that rename is still on somebody's disk, and reading it as
  // it is hands the builder a hero with no donor to read — which fails in
  // hero-files with "path must be of type string", nowhere near the cause.
  for (const h of (mod.heroes ?? []) as unknown as Record<string, unknown>[]) {
    h.id ??= h.file;
    h.basedOn ??= h.donor;
  }
  return mod;
}

/**
 * Every mod in our folder that adds creatures.
 *
 * Our folder and not `UserMODs`, because that is the one our build reads: the
 * patched executable scans `H5E/` alone, so a mod anywhere else is not installed
 * as far as the game is concerned (src/mod-paths.ts).
 *
 * More than one is a conflict, not a set: creature ids are global and each mod
 * carries its own whole copy of types.xml and the ref table, so the last one the
 * game reads wins outright and the others' creatures do not exist. The editor
 * reports them all and leaves the merge to a decision, since which registry to
 * keep is not ours to guess.
 */
export function findCreatureMods(gameRoot: string): FoundMod[] {
  const dir = join(gameRoot, MOD_DIR);
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
    // Nothing to reconstruct them from: a dwelling is an ordinary object file
    // among a mod's other files, with no registry to enumerate. An artifact
    // could be read back out of the table it extends, but only its numbers —
    // which picture it was built from is in the manifest or nowhere. A set is
    // the same: its members survive in DefaultStats, its texts do not. A hero
    // is the extreme case: he extends nothing at all, so the only trace of him
    // is his own file, and which donor he was built from is the manifest's to
    // remember.
    dwellings: [],
    buildings: [],
    artifacts: [],
    sets: [],
    heroes: [],
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
