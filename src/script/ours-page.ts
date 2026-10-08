// docs/api/functions.md, made from the write-ups of our functions.
//
// A pure function so the page has one maker: tools/build-api.ts writes what this
// returns, and tools/test-our-api.ts compares the file on disk with it — a page
// edited by hand, or a write-up changed without `npm run build-api`, fails there.

import type { ApiDoc } from './script-api-curated.ts';

const anchor = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const paramList = (fn: ApiDoc): string =>
  fn.params.map((p) => (p.optional && p.default ? `${p.name} = ${p.default}` : p.name)).join(', ');
/** A literal `|` in a cell (a type like `path | table`) would split the column. */
const cell = (s: string): string => s.replace(/\|/g, '\\|');

/** The page, grouped by category in the order the write-ups are listed. */
export function oursPage(ours: readonly ApiDoc[]): string {
  const groups = new Map<string, ApiDoc[]>();
  for (const fn of ours) (groups.get(fn.category) ?? groups.set(fn.category, []).get(fn.category)!).push(fn);
  const title = (c: string): string => c.replace(/^Ours · /, '');
  const P: string[] = [
    '# Our functions',
    '',
    '**Generated** by `npm run build-api` from `src/script/script-api-ours.ts` — do not',
    'edit by hand; write the function up there and re-run.',
    '',
    "Every function the editor's extension (`bin/homm5-editor.dll`) and its mod add to",
    "the game's Lua. A map played without the extension finds each of them nil, so a",
    'script that may run without it checks first: `if H5EHireScreen ~= nil then`.',
    '',
    '**How they answer.** One value or nothing, and nothing reads as nil: "1 or',
    'nothing" for a yes/no, and nothing — never a made-up zero — when the question',
    'could not be asked (no such hero, no screen up). Test with `~= nil`. Every',
    'refusal is named in `bin/homm5-editor-*.log`.',
    '',
    "**Where.** The adventure map's Lua and a battle's share no functions: a battle",
    'function is nil on the map and the other way round. Each entry says which.',
    '',
    `${ours.length} functions:`,
    '',
    ...[...groups.keys()].map((c) => `- [${title(c)}](#${anchor(title(c))}) — ${groups.get(c)!.map((f) => `\`${f.name}\``).join(', ')}`),
    '',
  ];
  for (const [c, fns] of groups) {
    P.push(`## ${title(c)}`, '');
    for (const fn of fns) {
      const where = fn.context === 'combat' ? 'battle script' : 'map script';
      P.push(`### \`${fn.name}(${paramList(fn)})\``, '', `${fn.summary} · *${where}*`, '');
      if (fn.params.length) {
        P.push('| param | type | meaning |', '|---|---|---|');
        for (const p of fn.params) {
          const opt = p.optional ? ` _(optional${p.default ? `, default ${p.default}` : ''})_` : '';
          P.push(`| \`${p.name}\` | ${cell(p.type)} | ${cell(p.desc)}${opt} |`);
        }
        P.push('');
      }
      if (fn.returns) P.push(`**Returns:** ${fn.returns}`, '');
      if (fn.example) P.push('```lua', fn.example, '```', '');
      if (fn.notes) P.push(`> ${fn.notes}`, '');
    }
  }
  return P.join('\n');
}
