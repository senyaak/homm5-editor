// The mounted file system — what the GAME will see, not what one folder holds.
//
// The game reads a path out of the last archive that carries it: `data/*.pak`
// first, then `UserMODs/`, then the map or campaign being played (see
// docs/ARCHIVES.md). So `/GameMechanics/RefTables/Creatures.xdb` is not one file,
// it is whichever copy wins — and a creature a mod adds exists only in that copy.
//
// The editor mirrors that with a CHAIN OF ROOTS, most specific first. A single
// unpacked data root is a chain of one, which is why every caller that has always
// passed a plain directory string still works: `toAssets` accepts either.
//
// Roots are real folders, so a resolved path is a real path — the DDS decoder,
// the geometry reader and the texture cache keep taking a filename. That is the
// whole reason this resolves to paths rather than to bytes.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** A chain of asset roots, resolved most-specific-first. */
export interface Assets {
  /** The roots, in the order they are searched. */
  readonly roots: readonly string[];
  /**
   * Absolute path of `rel`. When no root has it, the BASE root's path is
   * returned rather than null — callers that check `existsSync` themselves keep
   * reporting the path a reader would have used.
   */
  path(rel: string): string;
  exists(rel: string): boolean;
  /** Contents as text, or null when no root has it. */
  text(rel: string, encoding?: BufferEncoding): string | null;
  /** Contents as bytes, or null when no root has it. */
  bytes(rel: string): Buffer | null;
  /** Every root's candidate for `rel` that exists, most specific first. */
  all(rel: string): string[];
  /**
   * Every root's candidate for `rel` that is a DIRECTORY, most specific first.
   *
   * A folder scan cannot pick one root the way a file read can: a mod adding a
   * tile does not replace the shipped folder, it adds to it. So scans walk them
   * all and drop what they have already seen, which reproduces the file rule —
   * topmost wins — one entry at a time.
   */
  dirs(rel: string): string[];
}

/** A chain over `roots`. The last is the base — the shipped data. */
export function assets(roots: readonly string[]): Assets {
  const chain = roots.filter(Boolean);
  if (!chain.length) throw new Error('an asset chain needs at least one root');
  const base = chain[chain.length - 1]!;

  // Answered once per path for the life of the chain. A scene build asks for
  // the same texture and material documents thousands of times over (every
  // object's chain of hrefs runs through the same few hundred files), and a
  // stat per root per ask — a thrown exception per root that lacks it — was
  // a fifth of opening a map. The chain describes its roots as they were when
  // it was made: mods are mounted into a new chain, not into this one.
  const where = new Map<string, string | null>();
  const found = (rel: string): string | null => {
    const known = where.get(rel);
    if (known !== undefined) return known;
    let hit: string | null = null;
    for (const root of chain) {
      const p = join(root, rel);
      try {
        if (statSync(p).isFile()) { hit = p; break; }
      } catch { /* not in this root */ }
    }
    where.set(rel, hit);
    return hit;
  };

  // Documents read through `text` are kept: a scene build opens a material's
  // document for every mesh that names it and a texture's for every material,
  // which is the same few hundred files thousands of times. Bytes (`bytes`)
  // are not kept — a model or a texture is read once per decode, and the
  // decodes have caches of their own.
  const texts = new Map<string, string>();
  let textBytes = 0;
  const TEXT_BUDGET = 64 * 1024 * 1024;

  return {
    roots: chain,
    path: (rel) => found(rel) ?? join(base, rel),
    exists: (rel) => found(rel) !== null,
    text: (rel, encoding = 'utf8') => {
      const p = found(rel);
      if (!p) return null;
      const k = `${encoding}|${p}`;
      const known = texts.get(k);
      if (known !== undefined) return known;
      const s = readFileSync(p, encoding);
      texts.set(k, s);
      textBytes += s.length;
      for (const old of texts.keys()) {
        if (textBytes <= TEXT_BUDGET || old === k) break;
        textBytes -= texts.get(old)!.length;
        texts.delete(old);
      }
      return s;
    },
    bytes: (rel) => {
      const p = found(rel);
      return p ? readFileSync(p) : null;
    },
    all: (rel) => chain.map((root) => join(root, rel)).filter((p) => existsSync(p)),
    dirs: (rel) => chain.map((root) => join(root, rel)).filter((p) => {
      try {
        return statSync(p).isDirectory();
      } catch {
        return false;
      }
    }),
  };
}

/** A chain of one — the plain unpacked data root. */
export function singleRoot(root: string): Assets {
  return assets([root]);
}

/**
 * Take either. Every entry point accepts a directory string for the sake of the
 * callers that predate mounting, and normalizes here.
 */
export function toAssets(root: string | Assets): Assets {
  return typeof root === 'string' ? singleRoot(root) : root;
}

/**
 * One folder in front of a chain: consulted first, and when it has nothing
 * the chain answers as it would have. The chain's own rule for choosing among
 * ITS roots — newest archive member wins, for a mounted install — is kept,
 * which is why this wraps the chain rather than rebuilding it from its roots.
 * It is how the application's own documents (`assets/rmg`, the templates of
 * ours) sit over the game's without being a mod inside the game folder.
 */
export function inFront(front: string, chain: Assets): Assets {
  const own = singleRoot(front);
  return {
    roots: [front, ...chain.roots],
    path: (rel) => own.exists(rel) ? own.path(rel) : chain.path(rel),
    exists: (rel) => own.exists(rel) || chain.exists(rel),
    text: (rel, encoding) => own.text(rel, encoding) ?? chain.text(rel, encoding),
    bytes: (rel) => own.bytes(rel) ?? chain.bytes(rel),
    all: (rel) => [...own.all(rel), ...chain.all(rel)],
    dirs: (rel) => [...own.dirs(rel), ...chain.dirs(rel)],
  };
}

/** The base root — the shipped data, under everything mounted over it. */
export function baseRoot(a: Assets): string {
  return a.roots[a.roots.length - 1]!;
}
