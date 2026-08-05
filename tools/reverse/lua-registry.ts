// Regenerate docs/EXE_LUA_REGISTRY.md from the executable.
//
//   node tools/reverse/lua-registry.ts                 rewrite the document
//   node tools/reverse/lua-registry.ts --check         fail if it is out of date
//   node tools/reverse/lua-registry.ts --exe <path>
//
// Reads an UNWRAPPED executable — `npm run unwrap-exe` makes one.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PEFile } from '../../src/exe/pe.ts';
import { gameDirIfAny } from '../game-dir.ts';
import { describeSignature, readLuaRegistry } from '../../src/exe/lua-registry.ts';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const editor = resolve(import.meta.dirname, '..', '..');
// Said, never guessed from the checkout's position (tools/game-dir.ts). The
// --check mode runs inside `npm test`, so with nothing said it SKIPS in so
// many words rather than failing every machine that has not set HOMM5_GAME.
const game = gameDirIfAny();
const exePath = flag('exe') ?? (game ? resolve(game, 'bin', 'H5_Game_H5E.exe') : null);
if (!exePath) {
  const how = 'pass --exe <file>, --game <dir>, or set HOMM5_GAME';
  if (process.argv.includes('--check')) {
    console.log(`skip — no executable said (${how})`);
    process.exit(0);
  }
  console.error(`where is the executable? ${how}`);
  process.exit(2);
}
const docPath = flag('out') ?? resolve(editor, 'docs', 'EXE_LUA_REGISTRY.md');

const pe = PEFile.read(exePath);
const functions = readLuaRegistry(pe);

/** Names the shipped manuals document, as written up in our own reference. */
const documented = new Set(
  [...readFileSync(resolve(editor, 'docs', 'SCRIPT_API.md'), 'utf8')
    .matchAll(/`([A-Za-z_]\w*)\(/g)].map((m) => m[1]!),
);

const byTable = new Map<number, typeof functions>();
for (const fn of functions) {
  const list = byTable.get(fn.table) ?? [];
  list.push(fn);
  byTable.set(fn.table, list);
}

const lines: string[] = [
  "# The executable's Lua registration tables",
  '',
  'Read out of `bin/H5_Game_H5E.exe` on 2026-07-27. **Use an unwrapped binary**',
  "— a Steam install ships `H5_Game.exe` with its `.text` encrypted (entropy",
  '7.98, an extra `.bind` section) and it disassembles to nonsense. `npm run',
  'unwrap-exe` produces the clean copy; GOG and retail builds need no such step.',
  'Data sections are identical either way, so string and pointer addresses',
  'transfer; only code needs the clean build.',
  '',
  `Seven \`{name pointer, function pointer}\` arrays sit in \`.data\`. Together they`,
  `expose **${functions.length} functions to Lua** — against the 204 signatures the shipped`,
  'manuals admit to. Everything marked ·undoc is absent from those manuals.',
  '',
  '## Signatures come from the binary',
  '',
  'Every registered function opens by copying two strings onto the heap: an',
  'argument format and its own name. The format is a compact grammar —',
  '`s` string, `n` number, `b` bool, `f` float, `o` object, `t` table, and',
  '`[default]` marking an optional argument. `GiveArtefact` carries `snn[0]`,',
  "which is exactly the manual's `GiveArtefact(hero, id, [bindToHero = 0])`.",
  'The parser at `0xa454d0` reads it and reports mismatches by function name.',
  '',
  'So the tables below are not guesses: the argument list is what the engine',
  'itself checks. Where the manual and the binary disagree, **the binary wins** —',
  'see `HasArtefact`, which really takes a third argument',
  '([ARTIFACT_EFFECTS.md](ARTIFACT_EFFECTS.md#knowing-what-the-hero-has)).',
  '',
  'Function addresses belong to this build only. Patch by pattern, never by',
  'address — the same rule the creature and artifact ceilings follow.',
  '',
  'Regenerate with `node tools/reverse/lua-registry.ts`.',
  '',
  '**Adding functions of our own** is four bytes, not a proxy DLL: each table is',
  'reached through an accessor (`mov eax,<table>; ret`), so the extension hands the',
  'engine a copy with its own rows appended. How, and what a registered function',
  'has to look like, is in',
  '[engineInternals/LUA.md](engineInternals/LUA.md);',
  'what ours do is in [SCRIPT_API.md](SCRIPT_API.md) under *Ours*.',
  '',
];

let index = 0;
for (const [table, entries] of [...byTable].sort((a, b) => a[0] - b[0])) {
  index++;
  lines.push('', `## Table ${index} — \`0x${table.toString(16)}\` (${entries.length} entries)`, '',
    '| function | arguments | code | |', '|---|---|---|---|');
  for (const fn of entries) {
    const args_ = fn.signature ? describeSignature(fn.signature) : '?';
    lines.push(`| \`${fn.name}\` | \`${args_}\` | \`0x${fn.address.toString(16)}\` | ${documented.has(fn.name) ? '' : '·undoc'} |`);
  }
}

const text = `${lines.join('\n')}\n`;

if (args.includes('--check')) {
  const current = readFileSync(docPath, 'utf8').replace(/\r\n/g, '\n');
  if (current === text) {
    console.log(`up to date — ${functions.length} functions`);
    process.exit(0);
  }
  console.error('EXE_LUA_REGISTRY.md does not match the executable; run this without --check');
  process.exit(1);
}

writeFileSync(docPath, text);
const withSignature = functions.filter((f) => f.signature).length;
console.log(`${functions.length} functions, ${withSignature} with a signature -> ${docPath}`);
