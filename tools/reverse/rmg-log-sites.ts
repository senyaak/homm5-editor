// Where the generator narrates — every "at %g …" call site, with its arity.
//
//   node tools/reverse/rmg-log-sites.ts --exe game/bin/H5_MapEditor.exe
//   node tools/reverse/rmg-log-sites.ts --exe … --c        the table, as C
//   node tools/reverse/rmg-log-sites.ts --exe … --check    hold the table to it
//
// WHY THIS EXISTS. docs/RMG_CODE_MAP.md says WHAT the generator prints and in
// what order; the oracle needs something narrower and more exact — the address
// of the `call` that prints it, and how many bytes of arguments that call
// carries. Both are patch inputs: native/rmg/oracle.c bends each of these calls
// to a hook that reads the draw counter on the way past, and a hook whose
// signature disagrees with the call returns into the middle of an argument
// (the `ret 8` lesson in oracle.c, paid for once already).
//
// So the arity is READ, never assumed: the `add esp,N` the caller cleans with
// says how many bytes went on the stack, and N/4 is the slot count. A site
// whose bytes do not say `call <the formatter>` is reported and skipped rather
// than guessed at.
//
// Landmarks, not constants — every address moves with the build, which is why
// this is a tool and not a list.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { gameDirIfAny } from '../game-dir.ts';
import { disassemble } from '../../src/exe/disasm.ts';
import { PEFile } from '../../src/exe/pe.ts';

const args = process.argv.slice(2);
const flagValue = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && !args[i + 1]?.startsWith('--') ? args[i + 1] : undefined;
};

/**
 * The map editor, or a clean exit — the rule the rest of the suite follows for
 * checks that need content. It is the EDITOR because these sites are patched
 * in the editor: it is the host with a seed field, so it is where ordered runs
 * come from (docs/RMG.md). The game carries the same narration at its own
 * addresses, and `--exe` reaches it.
 */
function openOrSkip(): PEFile {
  const said = flagValue('exe');
  if (said) return PEFile.read(said);
  const game = gameDirIfAny();
  if (!game) {
    console.log('skipping — no executable said (pass --exe <file>, --game <dir>, or set HOMM5_GAME)');
    process.exit(0);
  }
  const path = resolve(game, 'bin', 'H5_MapEditor.exe');
  if (!existsSync(path)) {
    console.log(`skipping — ${path} is not there`);
    process.exit(0);
  }
  return PEFile.read(path);
}

const pe = openOrSkip();

/** The literals this tool is about: a finished step, with its seconds. */
const NARRATION = /^at %g /;

interface Site {
  /** The literal, newline stripped. */
  text: string;
  /** The `call` itself. */
  call: number;
  /** Bytes of arguments the caller cleans off — the format string included. */
  cleaned: number;
}

/**
 * Every "at %g …" literal, and the address of the operand that loads it.
 *
 * The search is for the PATTERN, not for NUL-separated runs, and that
 * distinction cost a step boundary. `at %g chests in zone %d set` has a float
 * constant packed against its front with no terminator between them:
 *
 *     …k == %2.2f, R = %d\n \0 f3 04 b5 3f at %g chests in zone %d set\n \0
 *
 * A scanner that splits on NUL and anchors the literal at the run's start sees
 * one unprintable blob there and drops it without a word — which is why the
 * editor's code map has no `chests` line and no `cant place mine` either.
 * Finding the pattern and reading forward to the NUL is right whatever sits
 * in front of it.
 */
function referenced(): Array<{ text: string; from: number }> {
  const out: Array<{ text: string; from: number }> = [];
  const code = pe.section('.text');
  const lo = pe.imageBase + code.va;
  const hi = lo + code.virtualSize;
  const needle = Buffer.from('at %g ', 'latin1');
  for (const name of ['.rdata', '.data']) {
    const section = pe.section(name);
    const end = section.raw + section.rawSize;
    for (let i = pe.buf.indexOf(needle, section.raw); i >= 0 && i < end; i = pe.buf.indexOf(needle, i + 1)) {
      let stop = i;
      while (stop < end && pe.buf[stop] !== 0) stop++;
      const literal = pe.buf.toString('latin1', i, stop);
      if (!NARRATION.test(literal) || !/^[\t\n\r\x20-\x7e]+$/.test(literal)) continue;
      const va = pe.addressOf(i);
      if (va === null) continue;
      for (const pointer of pe.pointersTo(va)) {
        const from = pe.addressOf(pointer);
        if (from !== null && from >= lo && from < hi) {
          out.push({ text: literal.replace(/[\r\n]+$/, ''), from });
        }
      }
    }
  }
  return out;
}

/** The instructions at `va`, however many `count` asks for. */
function at(va: number, count: number) {
  const offset = pe.offsetOf(va);
  if (offset === null) return [];
  return [...disassemble(pe.buf.subarray(offset, offset + 0x40), va, count)];
}

/**
 * The formatter every one of these lines goes through, read out of the code.
 *
 * Written down nowhere: the first "at %g …" push whose next instruction is a
 * `call rel32` says where it goes, and every other site is then held to that
 * same target. One reading, and the rest is verification.
 */
function formatter(refs: Array<{ from: number }>): number | null {
  for (const ref of refs) {
    const [ins] = at(ref.from + 4, 1);
    const target = ins && /^call ([0-9A-Fa-f]+)h$/.exec(ins.text.trim());
    if (target) return parseInt(target[1], 16);
  }
  return null;
}

const refs = referenced();
const fmt = formatter(refs);
if (fmt === null) {
  console.log('no "at %g …" call site found — is this the right executable?');
  process.exit(0);
}

const sites: Site[] = [];
const skipped: string[] = [];
for (const ref of refs) {
  // `push <literal>` is five bytes and the operand is the last four of them, so
  // the call — when the push is the last argument pushed, which for a cdecl
  // format string it always is — starts where the operand ends.
  const call = ref.from + 4;
  const [ins, ...after] = at(call, 8);
  const goes = ins && /^call ([0-9A-Fa-f]+)h$/.exec(ins.text.trim());
  if (!goes || parseInt(goes[1], 16) !== fmt) {
    skipped.push(`${hex(call)} does not call the formatter — ${ref.text}`);
    continue;
  }
  // The caller cleans a cdecl call. The `add esp,N` is usually the next
  // instruction but not always: the return value gets moved first often
  // enough that looking only at the next one loses half the sites.
  let cleaned = 0;
  for (const next of after) {
    const add = /^add esp,([0-9A-Fa-f]+)h?$/.exec(next.text.trim());
    if (add) {
      cleaned = parseInt(add[1], 16);
      break;
    }
    if (/^(call|ret|jmp)/.test(next.text.trim())) break;
  }
  if (!cleaned) {
    skipped.push(`${hex(call)} cleans no stack we can see — ${ref.text}`);
    continue;
  }
  sites.push({ text: ref.text, call, cleaned });
}
sites.sort((a, b) => a.call - b.call);

function hex(n: number): string {
  return `0x${n.toString(16)}`;
}

console.log(`the formatter: ${hex(fmt)}  (rva ${hex(fmt - pe.imageBase)})`);
console.log(`${sites.length} narration sites\n`);

if (args.includes('--check')) {
  // The table in the C is the thing that gets patched into a running editor;
  // this holds it to the executable while nothing is running. A site that
  // moved, or an arity typed rather than read, fails here instead of costing a
  // boundary in a run somebody waited for.
  const source = readFileSync(resolve(import.meta.dirname, '..', '..', 'native', 'rmg', 'oracle.c'), 'utf8');
  const table = /static const RmgStepSite g_rmgStepSites\[\] = \{([\s\S]*?)\};/.exec(source);
  if (!table) {
    console.log('FAIL  native/rmg/oracle.c has no g_rmgStepSites table');
    process.exit(1);
  }
  const written = new Map<number, number>();
  for (const m of table[1].matchAll(/\{0x([0-9a-fA-F]+)u,\s*(\d+)\}/g)) {
    written.set(parseInt(m[1], 16), Number(m[2]));
  }
  const read = new Map(sites.map((s) => [s.call - pe.imageBase, s.cleaned / 4]));
  let bad = 0;
  for (const [rva, slots] of read) {
    const has = written.get(rva);
    if (has === undefined) {
      console.log(`  FAIL  ${hex(rva)} is a narration site the table does not have`);
      bad++;
    } else if (has !== slots) {
      console.log(`  FAIL  ${hex(rva)} carries ${slots} slots, the table says ${has}`);
      bad++;
    }
  }
  for (const rva of written.keys()) {
    if (!read.has(rva)) {
      console.log(`  FAIL  ${hex(rva)} is in the table and is not a narration site`);
      bad++;
    }
  }
  console.log(bad ? `\n${bad} disagreements` : `  ok    all ${read.size} sites, address and arity`);
  process.exit(bad ? 1 : 0);
}

if (args.includes('--c')) {
  console.log('// Generated by tools/reverse/rmg-log-sites.ts — addresses are RVAs.');
  console.log('static const RmgStepSite g_rmgStepSites[] = {');
  for (const s of sites) {
    console.log(`    {0x${(s.call - pe.imageBase).toString(16)}u, ${s.cleaned / 4}}, // ${s.text}`);
  }
  console.log('};');
} else {
  for (const s of sites) {
    const slots = s.cleaned / 4;
    console.log(`${hex(s.call)}  rva ${hex(s.call - pe.imageBase).padEnd(10)} ${String(slots)} slots  ${s.text}`);
  }
}

for (const line of skipped) console.log(`  skipped: ${line}`);
