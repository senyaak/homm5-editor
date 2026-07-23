// Build the script API the editor completes from, and the reference doc, by
// merging OUR hand-written reference with the PDF extraction.
//
//   npm run build-api
//
// Two inputs:
//   - src/script-api-curated.ts     — what we have written up, the source of truth
//   - src/script-api-extracted.json — the PDF signatures, a fallback (npm run script-api)
//
// A function we have documented wins: the editor shows our summary and typed
// params, and the doc shows the full write-up. A function only in the extraction
// still completes, as a bare signature, and is listed in the doc under "not yet
// written up" — a to-do list for the next time it turns up in a mission.
//
// Outputs:
//   - src/script-api.json  — the completion source (name, params, group, summary?)
//   - docs/SCRIPT_API.md    — the readable reference

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CURATED } from '../src/script-api-curated.ts';
import type { ApiDoc } from '../src/script-api-curated.ts';

const ROOT = join(import.meta.dirname, '..');
const EXTRACTED = join(ROOT, 'src', 'script-api-extracted.json');
const OUT = join(ROOT, 'src', 'script-api.json');
const DOC = join(ROOT, 'docs', 'SCRIPT_API.md');

/** The completion source shape — what electron/main.ts serves to the editor. */
interface ApiFn { name: string; params: string; group: string; summary?: string }

const extracted: ApiFn[] = existsSync(EXTRACTED)
  ? JSON.parse(readFileSync(EXTRACTED, 'utf8')) as ApiFn[]
  : [];

/** A curated function's parameter list, as the completion's one-line detail. */
const curatedParams = (fn: ApiDoc): string =>
  fn.params.map((p) => (p.optional && p.default ? `${p.name} = ${p.default}` : p.name)).join(', ');

// --- the completion source: curated wins, extraction fills the gaps ----------
const byName = new Map<string, ApiFn>();
for (const fn of extracted) byName.set(fn.name, fn);
for (const fn of CURATED) {
  byName.set(fn.name, { name: fn.name, params: curatedParams(fn), group: fn.category, summary: fn.summary });
}
const api = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
writeFileSync(OUT, JSON.stringify(api, null, 1) + '\n');

// --- the doc: our write-ups first, the un-written signatures after -----------
const curatedNames = new Set(CURATED.map((f) => f.name));
const anchor = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const sig = (fn: ApiDoc): string => `${fn.name}(${curatedParams(fn)})`;

const byCategory = new Map<string, ApiDoc[]>();
for (const fn of CURATED) (byCategory.get(fn.category) ?? byCategory.set(fn.category, []).get(fn.category)!).push(fn);
const categories = [...byCategory.keys()].sort();

const L: string[] = [
  '# Script API',
  '',
  '**Generated** by `npm run build-api` — do not edit by hand. Write functions up',
  'in `src/script-api-curated.ts` (the source of truth) and re-run.',
  '',
  `This is OUR reference, written by hand and grown as missions turn up new calls,`,
  'because the shipped manuals are the only published list and they are crooked',
  '(mangled by `pdftotext`, no clean grouping, and not ours to reproduce). Each',
  'entry is in our own words, with typed arguments and a real example.',
  '',
  `**${CURATED.length}** functions written up so far, of **${api.length}** the editor knows`,
  `(the rest are signatures from the manual, listed at the end — a to-do list).`,
  'For the task view — which call for which job — see',
  '[RECIPES.md](RECIPES.md#which-call-for-what).',
  '',
  '## Written up',
  '',
  ...categories.map((c) => `- [${c}](#${anchor(c)}) — ${byCategory.get(c)!.length}`),
  '',
];

for (const c of categories) {
  L.push(`## ${c}`, '');
  for (const fn of byCategory.get(c)!.sort((a, b) => a.name.localeCompare(b.name))) {
    const tag = fn.source === 'observed' ? ' · **undocumented** (learned from a script)' : '';
    const since = fn.since ? ` · first seen in ${fn.since}` : '';
    L.push(`### \`${sig(fn)}\``, '');
    L.push(`${fn.summary}${tag}${since}`, '');
    if (fn.params.length) {
      // A literal `|` in a cell (a type like `name | nil`) would split the column.
      const cell = (s: string): string => s.replace(/\|/g, '\\|');
      L.push('| param | type | meaning |', '|---|---|---|');
      for (const p of fn.params) {
        const opt = p.optional ? ` _(optional${p.default ? `, default ${p.default}` : ''})_` : '';
        L.push(`| \`${p.name}\` | ${cell(p.type)} | ${cell(p.desc)}${opt} |`);
      }
      L.push('');
    }
    if (fn.returns) L.push(`**Returns:** ${fn.returns}`, '');
    if (fn.example) L.push('```lua', fn.example, '```', '');
    if (fn.notes) L.push(`> ${fn.notes}`, '');
  }
}

// The extraction's leftovers, grouped by the manual's section — the to-do list.
const todo = extracted.filter((f) => !curatedNames.has(f.name));
if (todo.length) {
  const bySection = new Map<string, ApiFn[]>();
  for (const fn of todo) (bySection.get(fn.group) ?? bySection.set(fn.group, []).get(fn.group)!).push(fn);
  L.push('---', '', '## From the manual — signature only, not yet written up', '');
  L.push(`${todo.length} functions the extraction found that we have not documented in our`,
    'own words yet. Signature is the manual\'s; when one turns up in a mission, move it',
    'into `src/script-api-curated.ts` with a real description.', '');
  for (const s of [...bySection.keys()].sort()) {
    L.push(`### ${s}`, '');
    for (const fn of bySection.get(s)!) L.push(`- \`${fn.name}(${fn.params})\``);
    L.push('');
  }
}

writeFileSync(DOC, L.join('\n'));
console.log(`${OUT}: ${api.length} functions (${CURATED.length} curated, ${todo.length} extracted-only)`);
console.log(`${DOC}: ${CURATED.length} written up across ${categories.length} categories`);
