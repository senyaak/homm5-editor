// Finding the same code in a DIFFERENT build of the game.
//
// Somebody else's patch names addresses in the executable they had. Ours is a
// different build of the same version — compiled for SSE where the retail one
// is x87, a megabyte of code apart — so not one address survives, and every
// site has to be found again. These are the three ways that have worked, in
// the order to try them:
//
//   node tools/reverse/match.ts table <exeA> <vaA> <exeB> <vaB> <len>
//       A jump table's SHAPE: which ids share a case, which sit on the default.
//       Case numbers differ between builds (ours deduplicates identical bodies)
//       but the grouping is the switch's own structure. This is what matched
//       Barbarian Learning.
//
//   node tools/reverse/match.ts find <exe> <maxFnLen> <hex:count> [hex:count…]
//       Every function in .text whose bytes contain each needle at least
//       `count` times — `??` matches any byte. A filter, not an answer: it cuts
//       400 000 functions down to a handful worth reading.
//
//   node tools/reverse/match.ts fingerprint <refExe> <refVA> <exe> <va…>
//       Scores candidates against a reference function by what it DOES — the
//       sequence of virtual-call slots, notable immediates and the `ret` form.
//       That is what a recompilation keeps; registers, encodings and addresses
//       are exactly what it throws away. This is what found the snare's crash
//       (two candidates, 88% against 34%).
//
// A byte table is often IDENTICAL between builds, so before any of this, try
// searching the target for the reference table's bytes — one hit is an answer.
// See docs/engineInternals/RULES_FIXES.md for how each was used.

import { PEFile } from '../../src/exe/pe.ts';
import { functionBody } from '../../src/exe/disasm.ts';

const args = process.argv.slice(2);
const [command, ...rest] = args;

/** A hex string with `??` wildcards, as bytes where -1 means "anything". */
function pattern(hex: string): number[] {
  const clean = hex.replace(/\s+/g, '');
  const out: number[] = [];
  for (let i = 0; i < clean.length; i += 2) {
    const pair = clean.slice(i, i + 2);
    out.push(pair === '??' ? -1 : Number.parseInt(pair, 16));
  }
  return out;
}

function countIn(buf: Buffer, from: number, to: number, bytes: number[]): number {
  let hits = 0;
  for (let at = from; at + bytes.length <= to; at++) {
    let ok = true;
    for (let j = 0; j < bytes.length; j++) {
      if (bytes[j] !== -1 && buf[at + j] !== bytes[j]) { ok = false; break; }
    }
    if (ok) hits++;
  }
  return hits;
}

/**
 * What a function DOES, as tokens a recompilation preserves.
 *
 * Virtual calls by slot, direct calls as a bare mark, immediates and structure
 * displacements worth naming, and how it returns. Deliberately NOT: registers,
 * encodings, addresses, stack offsets — the things that differ between two
 * builds of the same source, which is the whole problem being solved.
 */
function tokens(pe: PEFile, va: number): string[] {
  const at = pe.offsetOf(va);
  if (at === null) return [];
  const out: string[] = [];
  for (const ins of functionBody(pe.buf.subarray(at), va, 0x400)) {
    if (ins.mnemonic === 'call') {
      if (ins.memory && ins.memory.base !== 'None') out.push(`V${(ins.memory.displacement >>> 0).toString(16)}`);
      else out.push('C');
      continue;
    }
    if (ins.mnemonic === 'ret') {
      out.push(`R${ins.text.replace(/[^0-9A-Fa-f]/g, '') || '0'}`);
      continue;
    }
    for (const imm of ins.immediates) {
      if (imm > 0x10 && imm < 0x10000) out.push(`I${imm.toString(16)}`);
    }
    const m = ins.memory;
    if (m && m.base !== 'None' && m.base !== 'ESP' && m.displacement > 0x10) {
      out.push(`M${(m.displacement >>> 0).toString(16)}`);
    }
  }
  return out;
}

/** Longest common subsequence — order matters, gaps are free. */
function lcs(a: readonly string[], b: readonly string[]): number {
  const prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let diag = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = a[i - 1] === b[j - 1] ? diag + 1 : Math.max(prev[j]!, prev[j - 1]!);
      diag = tmp;
    }
  }
  return prev[b.length]!;
}

/** Ids grouped by the case they land in — a switch's shape. */
function shape(bytes: number[]): number[][] {
  const byCase = new Map<number, number[]>();
  bytes.forEach((c, i) => {
    if (!byCase.has(c)) byCase.set(c, []);
    byCase.get(c)!.push(i);
  });
  return [...byCase.values()].sort((a, b) => b.length - a.length || a[0]! - b[0]!);
}

function readTable(exe: string, va: string, len: number): number[] {
  const pe = PEFile.read(exe);
  const at = pe.offsetOf(Number.parseInt(va, 16));
  if (at === null) throw new Error(`${va} is not inside ${exe}`);
  return [...pe.buf.subarray(at, at + len)];
}

switch (command) {
  case 'table': {
    const [exeA, vaA, exeB, vaB, lenS] = rest;
    const len = Number.parseInt(lenS!, 16);
    const a = shape(readTable(exeA!, vaA!, len));
    const b = shape(readTable(exeB!, vaB!, len));
    const key = (g: number[][]): string => g.map((x) => x.join(',')).join(' | ');
    console.log(`A: ${a.length} cases, sizes ${a.map((g) => g.length).join(',')}`);
    console.log(`B: ${b.length} cases, sizes ${b.map((g) => g.length).join(',')}`);
    if (key(a) === key(b)) { console.log('SAME SHAPE — the same switch'); break; }
    console.log('different shape — where they disagree:');
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const ga = a[i]?.join(',') ?? '(none)';
      const gb = b[i]?.join(',') ?? '(none)';
      if (ga !== gb) console.log(`  group ${i}:\n    A ${ga}\n    B ${gb}`);
    }
    break;
  }

  case 'find': {
    const [exe, maxLenS, ...specs] = rest;
    const maxLen = Number.parseInt(maxLenS!, 16);
    const pe = PEFile.read(exe!);
    const text = pe.section('.text');
    const needles = specs.map((s) => {
      const [hex, n] = s.split(':');
      return { bytes: pattern(hex!), count: Number(n ?? 1) };
    });

    // Function starts, from the int3 padding the compiler leaves between them.
    const from = text.raw;
    const to = text.raw + text.rawSize;
    const starts: number[] = [];
    for (let at = from; at < to - 2; at++) {
      if (pe.buf[at] !== 0xcc || pe.buf[at + 1] !== 0xcc) continue;
      let s = at + 2;
      while (s < to && pe.buf[s] === 0xcc) s++;
      starts.push(s);
    }
    console.log(`${starts.length} function starts in .text`);

    let found = 0;
    for (let i = 0; i < starts.length; i++) {
      const begin = starts[i]!;
      const end = Math.min(starts[i + 1] ?? to, begin + maxLen);
      if (!needles.every((n) => countIn(pe.buf, begin, end, n.bytes) >= n.count)) continue;
      found++;
      console.log(`  0x${(pe.addressOf(begin) ?? 0).toString(16)}`);
    }
    console.log(`${found} match every needle`);
    break;
  }

  case 'fingerprint': {
    const [refExe, refVA, exe, ...cands] = rest;
    const refPe = PEFile.read(refExe!);
    const pe = PEFile.read(exe!);
    const ref = tokens(refPe, Number.parseInt(refVA!, 16));
    console.log(`reference ${refVA}: ${ref.length} tokens`);
    console.log(`  ${ref.join(' ')}`);

    const scored = cands.map((va) => {
      const t = tokens(pe, Number.parseInt(va, 16));
      const n = lcs(ref, t);
      return { va, t, n, score: ref.length ? n / Math.max(ref.length, t.length) : 0 };
    }).sort((a, b) => b.score - a.score);

    for (const s of scored.slice(0, 8)) {
      console.log(`\n${s.va}: ${(s.score * 100).toFixed(0)}% (${s.n}/${ref.length}), ${s.t.length} tokens`);
      console.log(`  ${s.t.join(' ')}`);
    }
    break;
  }

  default:
    console.error('usage: match.ts table|find|fingerprint …  (see the top of this file)');
    process.exit(2);
}
