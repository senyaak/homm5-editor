// Every relative link in the repo's markdown lands on a file that exists, and
// a `#fragment` on a heading that exists.
//
// The docs are a tree of indexes (CLAUDE.md → docs/working/, docs/README.md →
// the subjects), and a split or a rename is how they grow. A link left on the
// old path reads fine and leads nowhere; nothing else in the suite would see
// it. So the tree is checked as a whole: every tracked `.md`, every
// `[text](target)` whose target is not a URL. Fragments are compared with the
// heading slugs GitHub makes, since GitHub is where the docs are read.
//
//   node tools/test-doc-links.ts            # the whole repo
//   node tools/test-doc-links.ts --list     # every link, checked or not

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

/**
 * GitHub's heading anchor: lower case, punctuation dropped (underscores and
 * dashes kept), each space a dash. Markup is taken out first — a link keeps
 * its text, code keeps its letters.
 */
export function slugOf(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

/** The anchors a markdown file offers, with GitHub's `-1`, `-2` for repeats. */
export function anchorsOf(text: string): Set<string> {
  const seen = new Map<string, number>();
  const out = new Set<string>();
  let fenced = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (fenced) continue;
    const m = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const base = slugOf(m[1]);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.add(n === 0 ? base : `${base}-${n}`);
  }
  return out;
}

export interface Link {
  file: string;
  line: number;
  target: string;
}

/** The relative links of one file: inline `[text](target)`, outside code. */
export function linksOf(file: string, text: string): Link[] {
  const out: Link[] = [];
  let fenced = false;
  text.split(/\r?\n/).forEach((raw, i) => {
    if (/^\s*(```|~~~)/.test(raw)) fenced = !fenced;
    if (fenced) return;
    const line = raw.replace(/`[^`]*`/g, '');
    for (const m of line.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const target = m[1];
      if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
      out.push({ file, line: i + 1, target });
    }
  });
  return out;
}

/** What is wrong with a link, or null. */
export function problemOf(link: Link, read: (path: string) => string | null): string | null {
  const [pathPart, fragment] = link.target.split('#', 2);
  const path = pathPart ? join(dirname(link.file), decodeURIComponent(pathPart)) : link.file;
  if (pathPart) {
    const full = join(ROOT, path);
    if (!existsSync(full)) return `no such file: ${path}`;
    if (statSync(full).isDirectory()) return fragment ? `a fragment on a folder: ${path}` : null;
  }
  if (!fragment || !path.endsWith('.md')) return null;
  const text = read(path);
  if (text === null) return `unreadable: ${path}`;
  return anchorsOf(text).has(fragment.toLowerCase()) ? null : `no heading #${fragment} in ${path}`;
}

function trackedMarkdown(): string[] {
  const out = execFileSync('git', ['ls-files', '-z', '--', '*.md'], { cwd: ROOT, encoding: 'utf8' });
  return out.split('\0').filter((f) => f && existsSync(join(ROOT, f)));
}

function main(): void {
  const list = process.argv.includes('--list');
  const cache = new Map<string, string | null>();
  const read = (path: string): string | null => {
    if (!cache.has(path)) {
      const full = join(ROOT, path);
      cache.set(path, existsSync(full) ? readFileSync(full, 'utf8') : null);
    }
    return cache.get(path) ?? null;
  };
  let links = 0;
  const bad: string[] = [];
  for (const file of trackedMarkdown()) {
    const text = read(file);
    if (text === null) continue;
    for (const link of linksOf(file, text)) {
      links++;
      const problem = problemOf(link, read);
      if (list) console.log(`${problem ? 'BAD' : 'ok '} ${link.file}:${link.line} ${link.target}`);
      if (problem) bad.push(`${relative(ROOT, join(ROOT, link.file))}:${link.line}  ${link.target}  — ${problem}`);
    }
  }
  if (bad.length) {
    console.error(bad.join('\n'));
    console.error(`\ntest-doc-links: ${bad.length} broken of ${links} links`);
    process.exit(1);
  }
  console.log(`test-doc-links: all ${links} links land`);
}

if (import.meta.main) main();
