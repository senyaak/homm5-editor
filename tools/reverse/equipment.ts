// Every place the engine asks "how many of artifact N is this hero wearing".
//
//   node tools/reverse/equipment.ts [--fn 0xb4c270] [--exe <path>] [--types <types.xml>]
//
// The answer to that question is the whole of what the executable hardcodes per
// artifact id: a new id gets none of it, which is why a new artifact arrives
// without properties. The catalogue printed here is the table in
// docs/engineInternals/ARTIFACTS_AND_EQUIPMENT.md, so it can be checked rather
// than trusted.
//
// The query is one function — `CountEquipped`, `0xb4c270` in this build — walked
// to from the hero's vtable at +0x74. Call sites are grouped by the function
// they sit in, and each one's artifact id comes from the `push` that set up the
// call, resolved to a name through the enum in types.xml.

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { functionBody } from '../../src/exe/disasm.ts';
import { PEFile } from '../../src/exe/pe.ts';
import { gameDir } from '../game-dir.ts';
import { dataDir } from '../game-dir.ts';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

// Said, never guessed from the checkout's position (tools/game-dir.ts).
const pe = PEFile.read(flag('exe') ?? resolve(gameDir(), 'bin', 'H5_Game_H5E.exe'));
const COUNT_EQUIPPED = Number.parseInt(flag('fn') ?? 'b4c270', 16);

/** The artifact enum, in declaration order — the index is the id. */
function artifactNames(): string[] {
  const path = flag('types') ?? join(dataDir(), 'types.xml');
  if (!existsSync(path)) return [];
  const xml = readFileSync(path, 'utf8');
  // The enum is the one whose dbid points at the artifact table.
  const at = xml.indexOf('Table_DBArtifact_ArtifactEffect');
  if (at < 0) return [];
  const block = xml.slice(at, xml.indexOf('</EnumEntries>', at));
  return [...block.matchAll(/<Item>([A-Z0-9_]+)<\/Item>/g)].map((m) => m[1]!);
}

/**
 * A function's first address, found by scanning back to the int3 padding the
 * compiler leaves between functions. Good enough here because everything we
 * land in is a real function rather than a jump table.
 */
function startOf(va: number): number {
  const off = pe.offsetOf(va);
  if (off === null) return va;
  for (let i = off; i > off - 0x4000; i--) {
    if (pe.buf[i - 1] === 0xcc && pe.buf[i - 2] === 0xcc) return pe.addressOf(i) ?? va;
  }
  return va;
}

const names = artifactNames();
const pretty = (id: number): string =>
  names[id] ? `${names[id]!.replace(/^ARTIFACT_/, '')} (0x${id.toString(16)})` : `0x${id.toString(16)}`;

const sitesByFunction = new Map<number, Set<number>>();
for (const { from, kind } of pe.callsTo(COUNT_EQUIPPED)) {
  if (kind !== 'call') continue;
  const fn = startOf(from);
  if (!sitesByFunction.has(fn)) sitesByFunction.set(fn, new Set());
  sitesByFunction.get(fn)!.add(from);
}

let total = 0;
const seen = new Set<number>();
for (const [fn, sites] of [...sitesByFunction].sort((a, b) => a[0] - b[0])) {
  const at = pe.offsetOf(fn);
  if (at === null) continue;
  const body = functionBody(pe.buf.subarray(at), fn, 0x2000);
  const asked: string[] = [];
  for (let i = 0; i < body.length; i++) {
    if (!sites.has(body[i]!.address)) continue;
    total++;
    // The id is the last immediate pushed before the call.
    let id: number | undefined;
    for (let j = i - 1; j > i - 8 && j >= 0; j--) {
      if (body[j]!.mnemonic === 'push' && body[j]!.immediates.length) {
        id = body[j]!.immediates[0]!;
        break;
      }
    }
    if (id === undefined) asked.push('?');
    else {
      seen.add(id);
      asked.push(pretty(id));
    }
  }
  console.log(`0x${fn.toString(16)}  ${asked.join(', ')}`);
}

console.log(`\n${total} call sites in ${sitesByFunction.size} functions, ${seen.size} distinct artifacts`);
if (!names.length) console.log('(no types.xml found — ids shown raw; pass --types or unpack the data)');
