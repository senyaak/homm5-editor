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
const OUT = join(ROOT, 'src', 'script-api.json');
const TMP = join(ROOT, '_tmp', 'script-api');

/** The two manuals, base game first — the supplement's version of a shared
 *  function wins, since ToE is what we edit for. */
const PDFS = ['HOMM5_Script_Functions.pdf', 'HOMM5_A2_Script_Functions.pdf'];

/** A section heading: a bare all-caps line, which is how the manual sets them. */
const HEADING = /^ {0,4}([A-Z][A-Z ]{3,30})\s*$/;

/**
 * Signatures, in document order, with the section each sits under.
 *
 * A signature is the line under "Syntax" (or "Synopsis" — the manual uses both)
 * and can run over several lines when the call has many parameters, so the
 * parameter list is read up to its closing bracket and then squeezed back onto
 * one line.
 */
function parse(text: string): ApiFn[] {
  const out: ApiFn[] = [];
  const lines = text.split(/\r?\n/);
  let group = '';
  for (let i = 0; i < lines.length; i++) {
    const h = HEADING.exec(lines[i]!);
    // A heading in the table of contents is followed by dots and a page number;
    // those lines never match, because the dots are part of the line.
    if (h) { group = h[1]!.trim(); continue; }
    if (!/^\s*(Syntax|Synopsis)\s*$/.test(lines[i]!)) continue;
    // The ToE supplement fences its examples wiki-style; drop the fences (and
    // blank lines) so the signature is the first thing left. Without this every
    // fenced entry — a fifth of the supplement — was skipped.
    const rest = lines.slice(i + 1, i + 14)
      .filter((l) => !/^\s*[{}]{3}\s*$/.test(l) && l.trim() !== '')
      .join('\n');
    const m = /^\s*([A-Za-z_]\w*)\s*\(([^)]*)\)/.exec(rest);
    if (!m) continue;
    const params = m[2]!.replace(/\s+/g, ' ').trim();
    out.push({
      name: m[1]!,
      // `f(void)` is the manual's way of writing "takes nothing".
      params: params === 'void' ? '' : params,
      group,
    });
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
