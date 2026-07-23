// Build the script API list the Lua editor completes from — names and
// parameters of every function the game exposes to a map script.
//
//   npm run script-api ["<game>/Editor Documentation"]
//
// The source is the manuals the game ships (`HOMM5_Script_Functions.pdf` and
// its ToE supplement `HOMM5_A2_Script_Functions.pdf`), read through `pdftotext`.
// They are the only authoritative list: these functions are implemented in the
// engine, so nothing in the game's own Lua declares them — scanning the scripts
// finds the ones a mission happens to call and misses the other hundred.
//
// What lands in src/script-api.json is the NAME, the PARAMETER LIST and the
// section each belongs to: what an editor needs to complete a call, and facts
// about an interface rather than any of the manual's prose. The descriptions
// stay in the PDF, where the user's own copy of the game keeps them.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';

/** One entry of the API list, as the editor's completion source reads it. */
export interface ApiFn {
  name: string;
  /** The parameters as the manual writes them, e.g. "heroName, x, y, floorID = -1". */
  params: string;
  /** The manual's section: ADVMAP, HEROES, OBJECTS, COMBATS… */
  group: string;
}

const ROOT = join(import.meta.dirname, '..');
const DOCS = process.argv[2]
  ?? join(ROOT, '..', 'Editor Documentation');
// The RAW extraction — signatures only, a reference the merge falls back on. The
// completion source and the readable doc are built from this plus our own curated
// reference by tools/build-api.ts.
const OUT = join(ROOT, 'src', 'script-api-extracted.json');
const TMP = join(ROOT, '_tmp', 'script-api');

/** The two manuals, base game first — the supplement's version of a shared
 *  function wins, since ToE is what we edit for. */
const PDFS = ['HOMM5_Script_Functions.pdf', 'HOMM5_A2_Script_Functions.pdf'];

/** A section heading: a bare all-caps line, which is how the manual sets them. */
const HEADING = /^ {0,4}([A-Z][A-Z ]{3,30})\s*$/;

/** A dash the manual uses to separate an entry's name from its blurb (an en/em
 *  dash, often mis-decoded to the replacement char), spaced on both sides. */
const DASH = /\s(?:[‒–—―−�]|-)\s/;

/** Fold a raw parameter list onto one line the way the completion shows it. */
function tidyParams(raw: string): string {
  const p = raw.replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim();
  return p === 'void' ? '' : p;
}

/**
 * Signatures, in document order, with the section each sits under.
 *
 * The manual writes a signature two ways, and both have to be read or a working
 * function is dropped as if it did not exist:
 *
 *  - on the entry's TITLE line, `Name(params) — description` (an empty or prose
 *    "Syntax" section follows). `SetControlMode(side, mode)` is one of these.
 *  - under a "Syntax"/"Synopsis" heading, and there it can run over many lines
 *    when the call has a dozen parameters — `StartCombat` spans fifteen — so the
 *    list is read until its brackets balance, not for a fixed number of lines.
 */
function parse(text: string): ApiFn[] {
  const out: ApiFn[] = [];
  const lines = text.split(/\r?\n/);
  let group = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const h = HEADING.exec(line);
    // A heading in the table of contents is followed by dots and a page number;
    // those lines never match, because the dots are part of the line.
    if (h) { group = h[1]!.trim(); continue; }

    // (a) The title form: a bare `Name(params) — blurb` at the line's start. The
    // dash (spaced, an en/em dash) is what tells an entry title from prose that
    // merely mentions a call, together with the name being the very first token.
    const t = /^ {0,4}([A-Za-z_]\w*)\s*\(([^)]*)\)/.exec(line);
    if (t && DASH.test(line.slice(t[0].length))) {
      out.push({ name: t[1]!, params: tidyParams(t[2]!), group });
      continue;
    }

    // (b) The signature under Syntax/Synopsis, read until the brackets balance.
    if (!/^\s*(Syntax|Synopsis)\s*$/.test(line)) continue;
    let sig = '';
    let depth = 0, started = false;
    for (let j = i + 1; j < lines.length && j < i + 60; j++) {
      const l = lines[j]!;
      // The ToE supplement fences its examples wiki-style; drop the fences and
      // blank padding so the signature is contiguous.
      if (/^\s*[{}]{3}\s*$/.test(l) || l.trim() === '') continue;
      // An empty Syntax section (the signature was on the title line) is followed
      // by prose, not a call — stop before mistaking a sentence for one.
      if (!started && !/^\s*[A-Za-z_]\w*\s*\(/.test(l)) break;
      sig += (sig ? ' ' : '') + l.trim();
      for (const ch of l) { if (ch === '(') { depth++; started = true; } else if (ch === ')') depth--; }
      if (started && depth <= 0) break;
    }
    const m = /^([A-Za-z_]\w*)\s*\(([\s\S]*)\)/.exec(sig);
    if (m) out.push({ name: m[1]!, params: tidyParams(m[2]!), group });
  }
  return out;
}

function textOf(pdf: string): string {
  mkdirSync(TMP, { recursive: true });
  const txt = join(TMP, basename(pdf).replace(/\.pdf$/i, '.txt'));
  execFileSync('pdftotext', ['-layout', pdf, txt]);
  const s = readFileSync(txt, 'utf8');
  rmSync(txt, { force: true });
  return s;
}

const missing = PDFS.filter((p) => !existsSync(join(DOCS, p)));
if (missing.length) {
  console.error(`not found under ${DOCS}: ${missing.join(', ')}`);
  console.error('pass the folder as an argument, e.g. npm run script-api "<game>/Editor Documentation"');
  process.exit(2);
}

const byName = new Map<string, ApiFn>();
for (const pdf of PDFS) {
  const found = parse(textOf(join(DOCS, pdf)));
  console.log(`${pdf}: ${found.length} signature(s)`);
  for (const fn of found) byName.set(fn.name, fn);
}

const api = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
writeFileSync(OUT, JSON.stringify(api, null, 1) + '\n');
console.log(`${OUT}: ${api.length} function(s), ${new Set(api.map((f) => f.group)).size} section(s)`);
console.log('run `npm run build-api` to merge with the curated reference and write the doc');
