// The changelog's entries, one file each, folded into CHANGELOG.md when a
// version is cut.
//
// Every change people can see used to add its paragraph at the top of
// `## Unreleased` — one line of one file, so any two changes in flight at once
// collided there. Now a change adds a file:
//
//   changes/<issue>-<slug>.md      one entry: "- " and its paragraph(s)
//
// and nothing else touches CHANGELOG.md until a version is cut:
//
//   node tools/changelog.ts                      the Unreleased section as it would be cut
//   node tools/changelog.ts --cut 0.12.0         fold the entries in, newest first, under
//                                                "## 0.12.0 — <today>", delete them
//
// Newest first means the order the entries were committed in (git), then
// those not yet committed on top. `release.yml` reads the version's section
// out of CHANGELOG.md as before.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
export const CHANGES_DIR = 'changes';
export const UNRELEASED = '## Unreleased';
/** The line `## Unreleased` keeps after a cut, and which a cut drops. */
export const POINTER = '> New entries are files under `changes/`, one per change — see `changes/README.md`.';

export interface Entry {
  file: string;
  text: string;
  /** Seconds since the epoch the file was first committed; null if it is not yet. */
  added: number | null;
}

/** What is wrong with one entry's text, or null. */
export function entryProblem(text: string): string | null {
  const lines = text.replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n');
  if (!lines[0]?.startsWith('- ')) return 'an entry starts with "- "';
  if (lines.slice(1).some((l) => l.startsWith('- '))) return 'one entry per file — a second "- " at the left margin';
  if (lines.some((l) => /^#{1,6}\s/.test(l))) return 'no headings in an entry';
  if (lines.some((l) => l.trim() === POINTER)) return 'the pointer line is not an entry';
  return null;
}

/** Newest first: by commit time, uncommitted ones on top, then by name. */
export function ordered(entries: readonly Entry[]): Entry[] {
  return [...entries].sort((a, b) => {
    const ta = a.added ?? Number.MAX_SAFE_INTEGER;
    const tb = b.added ?? Number.MAX_SAFE_INTEGER;
    return tb - ta || b.file.localeCompare(a.file);
  });
}

/** The changelog with the entries folded in under `version`, and a fresh Unreleased with the pointer. */
export function cut(changelog: string, entries: readonly Entry[], version: string, date: string): string {
  const eol = changelog.includes('\r\n') ? '\r\n' : '\n';
  const lines = changelog.split(/\r?\n/);
  const at = lines.indexOf(UNRELEASED);
  if (at < 0) throw new Error(`CHANGELOG.md has no "${UNRELEASED}" heading`);
  let end = lines.findIndex((l, i) => i > at && l.startsWith('## '));
  if (end < 0) end = lines.length;
  const kept = lines.slice(at + 1, end).filter((l) => l.trim() !== POINTER);
  while (kept.length && kept[0]!.trim() === '') kept.shift();
  while (kept.length && kept[kept.length - 1]!.trim() === '') kept.pop();
  const fresh = ordered(entries).flatMap((e) => e.text.replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n'));
  const body = [...fresh, ...kept];
  if (!body.length) throw new Error('nothing to release: no entries and an empty Unreleased');
  return [
    ...lines.slice(0, at),
    UNRELEASED, '', POINTER, '',
    `## ${version} — ${date}`, '', ...body, '',
    ...lines.slice(end),
  ].join(eol);
}

function addedAt(path: string): number | null {
  try {
    const out = execFileSync('git', ['log', '--diff-filter=A', '--format=%ct', '-1', '--', path], { cwd: ROOT, encoding: 'utf8' }).trim();
    return out ? Number(out) : null;
  } catch {
    return null;
  }
}

export function readEntries(root = ROOT): Entry[] {
  const dir = join(root, CHANGES_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md') && f !== 'README.md')
    .map((f) => {
      const path = join(CHANGES_DIR, f);
      return { file: path, text: readFileSync(join(root, path), 'utf8'), added: addedAt(path) };
    });
}

function main(): void {
  const argv = process.argv.slice(2);
  const entries = readEntries();
  const bad = entries.map((e) => [e.file, entryProblem(e.text)] as const).filter(([, p]) => p);
  if (bad.length) {
    for (const [file, problem] of bad) console.error(`${file}: ${problem}`);
    process.exit(1);
  }
  const path = join(ROOT, 'CHANGELOG.md');
  const changelog = readFileSync(path, 'utf8');
  const i = argv.indexOf('--cut');
  if (i < 0) {
    const preview = cut(changelog, entries, '<version>', '<date>').split(/\r?\n/);
    const from = preview.indexOf('## <version> — <date>');
    const to = preview.findIndex((l, n) => n > from && l.startsWith('## '));
    console.log(preview.slice(from, to < 0 ? undefined : to).join('\n'));
    console.log(`\n(${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} in ${CHANGES_DIR}/)`);
    return;
  }
  const version = argv[i + 1];
  if (!version || version.startsWith('-')) {
    console.error('usage: node tools/changelog.ts --cut <version>');
    process.exit(2);
  }
  const date = new Date().toISOString().slice(0, 10);
  writeFileSync(path, cut(changelog, entries, version, date));
  for (const e of entries) rmSync(join(ROOT, e.file));
  console.log(`CHANGELOG.md: ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} folded in under ${version} — ${date}; ${CHANGES_DIR}/ emptied`);
}

if (import.meta.main) main();
