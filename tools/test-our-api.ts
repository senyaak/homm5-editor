// Our functions: every one the extension registers is written up, every one
// written up exists, and the editor knows them — completion, lint, the page.
//
//   node tools/test-our-api.ts
//
// THE LIST IS READ, NOT KEPT. What the DLL registers comes out of native/ — the
// `add_map_function("Name", …)` calls and the two tables in lua/registry.c, the
// map's and the battle's — and what the mod's own Lua defines comes out of
// src/mods/. A function added to the DLL without a write-up fails here, and so
// does a write-up whose function was renamed away (H5EHeroSpecialization, which
// the reference carried for weeks after the DLL had called it
// H5EHeroHasSpecialization).
//
// The mod's scripts define thirty-odd helpers of their own (H5ETrain…,
// H5E_Pandora…) that are the insides of one feature each, not something a map
// calls; they are not required to be written up. Only the other direction is
// checked for them: a write-up of a mod function has to have its function.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { OURS } from '../src/script/script-api-ours.ts';
import { CURATED } from '../src/script/script-api-curated.ts';
import { oursPage } from '../src/script/ours-page.ts';
import { luaNameWarnings } from '../src/script/lua-lint.ts';
import api from '../src/script/script-api.json' with { type: 'json' };

const ROOT = join(import.meta.dirname, '..');
let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

function filesUnder(dir: string, ext: string): string[] {
  const out: string[] = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { if (f !== 'build') out.push(...filesUnder(p, ext)); } else if (p.endsWith(ext)) out.push(p);
  }
  return out;
}

// --- what the DLL registers, and where ---------------------------------------
/** name → 'map' | 'combat', read out of the C sources. */
export function dllRegistrations(nativeDir: string): Map<string, 'map' | 'combat'> {
  const out = new Map<string, 'map' | 'combat'>();
  for (const f of filesUnder(nativeDir, '.c')) {
    const t = readFileSync(f, 'utf8');
    for (const m of t.matchAll(/add_map_function\(\s*"(\w+)"/g)) out.set(m[1]!, 'map');
    // The two tables registry.c starts with: rows `{ "Name", &fn }` inside them.
    for (const [table, where] of [['g_ourFunctions', 'map'], ['g_ourCombatFunctions', 'combat']] as const) {
      const at = t.indexOf(`static LuaEntry ${table}[`);
      if (at < 0) continue;
      const body = t.slice(at, t.indexOf('};', at));
      for (const m of body.matchAll(/\{\s*"(\w+)"\s*,/g)) out.set(m[1]!, where);
    }
  }
  return out;
}

const registered = dllRegistrations(join(ROOT, 'native'));
check('the DLL registers functions at all', registered.size >= 30, `${registered.size} read out of native/`);
check('...the battle\'s among them', [...registered.values()].includes('combat'));

// --- what the mod's Lua defines ------------------------------------------------
const modDefined = new Set<string>();
for (const f of filesUnder(join(ROOT, 'src', 'mods'), '.ts')) {
  for (const m of readFileSync(f, 'utf8').matchAll(/function\s+([A-Za-z_]\w*)\s*\(/g)) modDefined.add(m[1]!);
}

// --- the two directions -----------------------------------------------------------
const written = new Map(OURS.map((f) => [f.name, f]));
const unwritten = [...registered.keys()].filter((n) => !written.has(n));
check('every function the DLL registers is written up', unwritten.length === 0, unwritten.join(', '));

const orphans = OURS.filter((f) => !registered.has(f.name) && !modDefined.has(f.name)).map((f) => f.name);
check('every function written up exists — in the DLL or in the mod\'s Lua', orphans.length === 0, orphans.join(', '));

const wrongPlace = OURS.filter((f) => registered.has(f.name) && registered.get(f.name) !== (f.context ?? 'map'))
  .map((f) => `${f.name}: written ${f.context ?? 'map'}, registered ${registered.get(f.name)}`);
check('each says the Lua it is registered into, map or battle', wrongPlace.length === 0, wrongPlace.join('; '));

const unplaced = OURS.filter((f) => !f.context).map((f) => f.name);
check('each says where it may be called', unplaced.length === 0, unplaced.join(', '));

const notOurs = OURS.filter((f) => f.source !== 'extension' || !f.category.startsWith('Ours')).map((f) => f.name);
check('each is marked as ours', notOurs.length === 0, notOurs.join(', '));

const dupes = OURS.map((f) => f.name).filter((n, i, a) => a.indexOf(n) !== i);
check('no function is written up twice', dupes.length === 0, dupes.join(', '));

const elsewhere = CURATED.filter((f) => f.source === 'extension' && !written.has(f.name)).map((f) => f.name);
check('no write-up of ours lives outside script-api-ours.ts', elsewhere.length === 0, elsewhere.join(', '));

const thin = OURS.filter((f) => !f.summary.trim() || !f.example || f.params.some((p) => !p.desc.trim())).map((f) => f.name);
check('each has a summary, an example and every parameter described', thin.length === 0, thin.join(', '));

// --- the editor has them: completion -------------------------------------------------
interface Entry { name: string; params: string; group: string; summary?: string; args?: unknown[] }
const byName = new Map((api as Entry[]).map((e) => [e.name, e]));
const notCompleted = OURS.filter((f) => {
  const e = byName.get(f.name);
  return !e || e.summary !== f.summary || e.group !== f.category || (e.args?.length ?? 0) !== f.params.length;
}).map((f) => f.name);
check('the completion list carries each as written (run npm run build-api if not)', notCompleted.length === 0,
  notCompleted.join(', '));

// --- the editor has them: lint ---------------------------------------------------------
//
// The linter's one name check is "did you mean": an unknown call one or two
// edits from a known name. So a mistyped function of ours is caught only if
// ours are known — measured both ways, with and without them, so the check is
// shown to be what the write-ups bought and not something the list did anyway.
const names = (api as Entry[]).map((e) => e.name);
const withoutOurs = names.filter((n) => !written.has(n));
const typo = 'H5EHireScren("bought=F", CREATURE_PEASANT, 1, 100);';
const caught = luaNameWarnings(typo, names);
check('a mistyped call of ours is a "did you mean"', caught.length === 1 && /H5EHireScreen/.test(caught[0]!.message),
  caught.map((d) => d.message).join('; '));
check('...and it is the write-ups that catch it', luaNameWarnings(typo, withoutOurs).length === 0);
const falseAlarms = OURS.flatMap((f) => luaNameWarnings(`${f.name}();`, names).map((d) => d.message));
check('a correct call of each of ours is quiet', falseAlarms.length === 0, falseAlarms.join('; '));

// --- the page ---------------------------------------------------------------------------
const PAGE = join(ROOT, 'docs', 'api', 'functions.md');
check('docs/api/functions.md is there', existsSync(PAGE));
if (existsSync(PAGE)) {
  check('...and is what build-api makes of the write-ups (run npm run build-api if not)',
    readFileSync(PAGE, 'utf8') === oursPage(OURS));
}
check('the api folder\'s index links it', /\(functions\.md\)/.test(readFileSync(join(ROOT, 'docs', 'api', 'README.md'), 'utf8')));

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
