// Getting a readable executable, so the ceiling patchers have something to work
// on.
//
// Steam ships Heroes with its `.text` encrypted and a loader bolted on in an
// extra `.bind` section. Every offset the patchers look for then reads noise,
// and creature-limit.ts refuses the file rather than writing into it. GOG and
// retail builds have no wrapper and need none of this.
//
// THE UNWRAPPING IS NOT OURS TO DO. Steamless (atom0s, MIT) does it, and this
// module only arranges the meeting: it says whether the file needs unwrapping,
// fetches the tool when it does, runs it, and puts the result where the rest of
// the editor already looks — `bin/H5_Game_NCF.exe`.
//
// WHY A COPY AT ALL. A mod is a thing you turn off by launching the other file,
// so the game's own executable is never written to. `_NCF` is the name the
// modding scene already uses for the patched copy, so anyone who has done this
// by hand has the file this looks for.
//
// AN EXISTING COPY IS NEVER OVERWRITTEN. It is very likely already patched —
// a creature or artifact ceiling lives in it — and replacing it with a fresh
// unwrap would silently undo that. Say it is there and stop.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { extract } from './pak.ts';

/** The game's own executable. Read, never written. */
export const SHIPPED_EXE = join('bin', 'H5_Game.exe');
/** The copy everything else patches. */
export const CLEAN_EXE = join('bin', 'H5_Game_NCF.exe');

/**
 * The release we ask for, pinned.
 *
 * Pinned rather than "latest" because this downloads a program and then runs
 * it: what arrives should be decided by us reading a changelog, not by whoever
 * pushed a release this morning. `size` is from the GitHub API and is checked
 * before anything is unpacked; `sha256` starts empty and is written into
 * `DOWNLOADED.json` on the first fetch, so a second machine can be compared
 * against the first.
 */
export const STEAMLESS = {
  version: 'v3.1.0.5',
  url: 'https://github.com/atom0s/Steamless/releases/download/v3.1.0.5/Steamless.v3.1.0.5.-.by.atom0s.zip',
  size: 610_646,
  /** Where it is kept, relative to the editor. Not committed. */
  dir: join('tools', 'vendor', 'steamless'),
  cli: 'Steamless.CLI.exe',
} as const;

export type ExeKind =
  /** Ordinary PE: readable code, patchable. */
  | 'clean'
  /** Steam's wrapper: `.text` encrypted, a `.bind` section carrying the loader. */
  | 'wrapped';

/** Section names in a PE image, or an empty list when it is not one. */
function sectionNames(buf: Buffer): string[] {
  if (buf.length < 0x40 || buf.readUInt16LE(0) !== 0x5a4d) return [];
  const pe = buf.readUInt32LE(0x3c);
  if (pe + 24 > buf.length || buf.readUInt32LE(pe) !== 0x4550) return [];
  const count = buf.readUInt16LE(pe + 6);
  const table = pe + 24 + buf.readUInt16LE(pe + 20);
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    const at = table + i * 40;
    if (at + 40 > buf.length) break;
    names.push(buf.toString('latin1', at, at + 8).replace(/\0.*$/, ''));
  }
  return names;
}

/**
 * Whether this executable is wrapped.
 *
 * The section table is the tell, not a string search: `.bind` as text can sit
 * anywhere in a file, but a section by that name beside a `.text` is what the
 * wrapper actually builds.
 */
export function classify(buf: Buffer): ExeKind {
  return sectionNames(buf).includes('.bind') ? 'wrapped' : 'clean';
}

export interface UnwrapResult {
  /** What happened, in the past tense, for a caller that wants to print it. */
  action: 'kept' | 'copied' | 'unwrapped';
  /** The clean executable, absolute. */
  path: string;
  kind: ExeKind;
  /** Set when this run downloaded Steamless. */
  fetched?: string;
}

/** Fetch and unpack Steamless into `dir`, and answer with the CLI's path. */
async function fetchSteamless(dir: string, log: (s: string) => void): Promise<string> {
  const cli = join(dir, STEAMLESS.cli);
  if (existsSync(cli)) return cli;

  log(`downloading Steamless ${STEAMLESS.version} (${(STEAMLESS.size / 1024).toFixed(0)} KiB)`);
  const res = await fetch(STEAMLESS.url);
  if (!res.ok) throw new Error(`Steamless download failed: ${res.status} ${res.statusText}`);
  const zip = Buffer.from(await res.arrayBuffer());
  if (zip.length !== STEAMLESS.size) {
    throw new Error(`Steamless download is ${zip.length} bytes, expected ${STEAMLESS.size} — refusing to run it`);
  }
  const sha256 = createHash('sha256').update(zip).digest('hex');

  mkdirSync(dir, { recursive: true });
  const archive = join(dir, 'steamless.zip');
  writeFileSync(archive, zip);
  extract(archive, dir);
  rmSync(archive, { force: true });
  writeFileSync(join(dir, 'DOWNLOADED.json'),
    `${JSON.stringify({ ...STEAMLESS, sha256, when: new Date().toISOString() }, null, 2)}\n`);

  if (!existsSync(cli)) {
    throw new Error(`unpacked Steamless but found no ${STEAMLESS.cli} in ${dir}`);
  }
  log(`  sha256 ${sha256}`);
  return cli;
}

/**
 * Make sure `bin/H5_Game_NCF.exe` exists and holds readable code.
 *
 * Copies the shipped executable when it is already clean; unwraps it with
 * Steamless when it is not, downloading the tool once. Never touches an
 * existing copy — see the note at the top about what that copy probably is.
 */
export async function ensureCleanExe(
  gameRoot: string,
  opt: { editorRoot?: string; log?: (s: string) => void } = {},
): Promise<UnwrapResult> {
  const log = opt.log ?? (() => {});
  const target = join(gameRoot, CLEAN_EXE);
  const shipped = join(gameRoot, SHIPPED_EXE);

  if (existsSync(target)) {
    const kind = classify(readFileSync(target));
    if (kind === 'clean') return { action: 'kept', path: target, kind };
    // A wrapped copy under this name is not the patched copy anyone means; it is
    // someone's `copy H5_Game.exe H5_Game_NCF.exe`, and nothing can patch it.
    throw new Error(`${target} is itself wrapped — delete it and run this again`);
  }
  if (!existsSync(shipped)) throw new Error(`no executable at ${shipped}`);

  if (classify(readFileSync(shipped)) === 'clean') {
    copyFileSync(shipped, target);
    return { action: 'copied', path: target, kind: 'clean' };
  }

  const editorRoot = opt.editorRoot ?? process.cwd();
  const cli = await fetchSteamless(join(editorRoot, STEAMLESS.dir), log);
  log(`unwrapping ${SHIPPED_EXE}`);
  try {
    execFileSync(cli, ['--quiet', shipped], { stdio: 'pipe' });
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    throw new Error(`Steamless could not run (it needs .NET Framework 4.8): ${why}`);
  }

  // Steamless writes beside its input, adding its own suffix.
  const produced = `${shipped}.unpacked.exe`;
  if (!existsSync(produced)) throw new Error(`Steamless ran but left no ${produced}`);
  if (classify(readFileSync(produced)) === 'wrapped') {
    rmSync(produced, { force: true });
    throw new Error('Steamless produced a file that is still wrapped — a newer wrapper than it knows');
  }
  mkdirSync(dirname(target), { recursive: true });
  renameSync(produced, target);
  return { action: 'unwrapped', path: target, kind: 'clean', fetched: STEAMLESS.version };
}
