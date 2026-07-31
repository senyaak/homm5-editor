// The random map generator's table of contents, read out of the executable.
//
//   node tools/reverse/rmg-map.ts            rewrite docs/RMG_CODE_MAP.md
//   node tools/reverse/rmg-map.ts --check    fail if it drifted
//   node tools/reverse/rmg-map.ts --print    just look
//
// WHY THIS EXISTS. The port in src/rmg is a reading of ~250 KB of x86, and the
// thing that makes it readable at all is that the generator narrates itself:
// every phase logs "Rnd Counter(<phase>): %d." on entry and "at %g <what did>"
// on exit. Those two strings bracket each phase, so the log strings alone
// recover the pipeline — its steps, their order, and their names as the people
// who wrote it named them.
//
// THE PIPELINE IS ONE FUNCTION, not a chain of calls — that was the first thing
// this tool got wrong. `GenerateMap` runs about 3,900 bytes with every phase
// inlined into it, so there are no per-phase functions to list and no call
// order to read: the order is the order the code is written in. Inside one
// straight-line function that is the same thing, which is why the pipeline
// table below is sorted by address and only the pipeline table is.
//
// Landmarks, not constants: a GOG build is a different compilation and every
// address below moves. This is why the map is generated rather than typed —
// the tool is the knowledge, the markdown is a snapshot of it.

import { existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { gameDirIfAny } from '../game-dir.ts';
import { functionBody } from '../../src/exe/disasm.ts';
import { PEFile } from '../../src/exe/pe.ts';

const args = process.argv.slice(2);
const flagValue = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && !args[i + 1]?.startsWith('--') ? args[i + 1] : undefined;
};

const editor = resolve(import.meta.dirname, '..', '..');

/**
 * The executable, or a clean exit.
 *
 * A machine with no game — a CI runner, a fresh clone — skips rather than
 * fails, the rule the rest of the suite follows for checks that need content.
 * Said, never guessed from the checkout's position (tools/game-dir.ts).
 */
function openOrSkip(): PEFile {
  const said = flagValue('exe');
  if (said) return PEFile.read(said);
  const game = gameDirIfAny();
  if (!game) {
    console.log('skipping — no executable said (pass --exe <file>, --game <dir>, or set HOMM5_GAME)');
    process.exit(0);
  }
  const path = join(game, 'bin', 'H5_Game_H5E.exe');
  if (!existsSync(path)) {
    console.log(`skipping — ${path} is not there; \`npm run unwrap-exe\` makes it`);
    process.exit(0);
  }
  return PEFile.read(path);
}

const pe = openOrSkip();
const text = pe.section('.text');
const codeLo = pe.imageBase + text.va;
const codeHi = codeLo + text.virtualSize;

// ---------------------------------------------------------------------------
// Strings, and the functions that use them
// ---------------------------------------------------------------------------

// The generator's own vocabulary. Narrow on purpose: a bare `Cant ` also
// matches "Cant create player" and a bare `Can't place` matches nothing here,
// and a table of contents padded with a hundred lines from the combat scripts
// is not one. Everything kept below either names a zone or is unique to the
// generator's own narration.
const RMG_STRING = new RegExp(
  [
    'at %g ', // "at %g towns placed" — a finished step, with its seconds
    'Rnd Counter', // the draw count, the lockstep check
    'RMG started',
    'filling zones',
    'Zone #%d',
    'zone #%d',
    'ObstaclePlacementParams',
    'Obstacles grid',
    'in zone with town',
    'no zone found with index',
    'cant place mine',
    'cant find empty tiles',
    'Cant set ',
    "Can't place .+ at zone",
    "Can't place aban mine",
  ]
    .map((s) => `(?:${s})`)
    .join('|'),
);
// Anchored: every one of them starts its literal.
const RMG_LITERAL = new RegExp(`^(?:${RMG_STRING.source})`);

interface Reference {
  /** The literal, with its trailing newline stripped for display. */
  str: string;
  /** The instruction that loads it. */
  from: number;
  /** The function that instruction is in. */
  fn: number;
}

/** A run this long is alignment padding; anything shorter is instruction bytes. */
const PADDING = 2;

/**
 * The start of the function containing `va`.
 *
 * MSVC pads between functions with `int3` to a 16-byte boundary, so the first
 * byte after a run of them starts one. The run length matters: a single 0xCC is
 * usually part of an instruction — a displacement, an immediate — and treating
 * one as a boundary chops big functions into fictional pieces. That is exactly
 * what happened here, and it made four phases of `GenerateMap` look like four
 * separate functions that nothing in the executable ever called.
 */
function functionStart(pe: PEFile, va: number): number | null {
  const off = pe.offsetOf(va);
  if (off === null) return null;
  let o = off;
  for (;;) {
    while (o > 0 && pe.buf[o - 1] !== 0xcc) o--;
    let run = 0;
    while (o - run > 0 && pe.buf[o - run - 1] === 0xcc) run++;
    if (run >= PADDING || o === 0) return pe.addressOf(o);
    o -= run; // a lone 0xCC inside an instruction — keep walking back
  }
}

/** Where the function starting at `va` ends, by the same padding rule. */
function functionEnd(pe: PEFile, va: number): number {
  const start = pe.offsetOf(va);
  if (start === null) return va;
  for (let o = start; o < pe.buf.length; o++) {
    if (pe.buf[o] !== 0xcc) continue;
    let run = 0;
    while (o + run < pe.buf.length && pe.buf[o + run] === 0xcc) run++;
    if (run >= PADDING) return pe.addressOf(o)!;
    o += run;
  }
  return va;
}

/** Every RMG literal in read-only and initialised data, with its code references. */
function collect(): Reference[] {
  const out: Reference[] = [];
  for (const name of ['.rdata', '.data']) {
    const section = pe.section(name);
    const lo = section.raw;
    const hi = section.raw + section.rawSize;
    let start = lo;
    for (let i = lo; i < hi; i++) {
      if (pe.buf[i] !== 0) continue;
      if (i > start) {
        const literal = pe.buf.toString('latin1', start, i);
        // Printable plus the tab and newline these format strings carry —
        // rejecting those was what first hid every phase in this list.
        if (RMG_LITERAL.test(literal) && /^[\t\n\r\x20-\x7e]+$/.test(literal)) {
          const strVa = pe.addressOf(start);
          if (strVa !== null) {
            for (const pointer of pe.pointersTo(strVa)) {
              const from = pe.addressOf(pointer);
              if (from === null || from < codeLo || from >= codeHi) continue;
              const fn = functionStart(pe, from);
              if (fn !== null) out.push({ str: literal.replace(/[\r\n]+$/, ''), from, fn });
            }
          }
        }
      }
      start = i + 1;
    }
  }
  return out;
}

const references = collect();
const byFunction = new Map<number, Reference[]>();
for (const ref of references) {
  const list = byFunction.get(ref.fn);
  if (list) list.push(ref);
  else byFunction.set(ref.fn, [ref]);
}
for (const list of byFunction.values()) list.sort((a, b) => a.from - b.from);

// ---------------------------------------------------------------------------
// The pipeline
// ---------------------------------------------------------------------------

/** One line the pipeline prints: a counter reading, or a finished step. */
interface Beat {
  at: number;
  /** The name inside `Rnd Counter(...)`, when this line is one. */
  counter?: string;
  /** What an "at %g …" line says just finished. */
  step?: string;
}

/** The function that logs "Rnd Counter (GenerateMap)" — the whole run. */
function topFunction(): number {
  for (const [fn, list] of byFunction) {
    if (list.some((r) => /^Rnd Counter \(GenerateMap\)/.test(r.str))) return fn;
  }
  throw new Error('no function logs "Rnd Counter (GenerateMap)" — is this the game executable?');
}

/**
 * What the top function prints, in the order it is written.
 *
 * Both kinds of line are kept and interleaved rather than paired up: a counter
 * reading and the step report next to it are not always the same phase, and
 * inventing the pairing would put a guess in a document whose whole job is to
 * be quotable.
 */
function pipeline(root: number): Beat[] {
  const end = functionEnd(pe, root);
  const out: Beat[] = [];
  for (const ref of references) {
    if (ref.from < root || ref.from > end) continue;
    const rnd = /^Rnd Counter\s*\((.+?)\)/.exec(ref.str);
    const step = /^at %g (.+)$/.exec(ref.str);
    if (rnd) out.push({ at: ref.from, counter: rnd[1] });
    else if (step) out.push({ at: ref.from, step: step[1] });
  }
  return out.sort((a, b) => a.at - b.at);
}

// ---------------------------------------------------------------------------
// Classes
// ---------------------------------------------------------------------------

/** RTTI names in the NRMG namespace, with the vtables that claim them. */
function classes(): Array<{ name: string; vtables: number[] }> {
  const out: Array<{ name: string; vtables: number[] }> = [];
  const seen = new Set<string>();
  for (const offset of pe.findBytes('@NRMG@@')) {
    let s = offset;
    while (s > 0 && pe.buf[s - 1] !== 0) s--;
    const name = pe.buf.toString('latin1', s, offset + '@NRMG@@'.length);
    if (!name.startsWith('.?A') || seen.has(name)) continue;
    seen.add(name);
    const descriptor = pe.addressOf(s - 8);
    const vtables: number[] = [];
    if (descriptor !== null) {
      for (const ref of pe.pointersTo(descriptor)) {
        const locator = pe.addressOf(ref - 12); // pTypeDescriptor sits at +12
        if (locator === null) continue;
        for (const back of pe.pointersTo(locator)) {
          const vtable = pe.addressOf(back + 4); // the locator precedes the vtable
          if (vtable !== null) vtables.push(vtable);
        }
      }
    }
    out.push({ name, vtables });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

const hex = (n: number): string => `0x${n.toString(16)}`;

function render(): string {
  const root = topFunction();
  const beats = pipeline(root);
  const lines: string[] = [];

  lines.push('# The random map generator, as the executable lays it out');
  lines.push('');
  lines.push('Generated by `node tools/reverse/rmg-map.ts` — do not edit by hand.');
  lines.push('`npm run test-rmg-map` fails when the executable no longer says this.');
  lines.push('');
  lines.push('Addresses are from the unwrapped `bin/H5_Game_H5E.exe` and are landmarks,');
  lines.push('not constants: another build is another compilation. What survives a build');
  lines.push('is the *shape* — the phases, their order, and what each one reports.');
  lines.push('');
  lines.push(`## GenerateMap (${hex(root)} .. ${hex(functionEnd(pe, root))})`);
  lines.push('');
  lines.push('The whole run, in the order the code is written. `Rnd Counter(x)` reads the');
  lines.push('draw count so far; `at %g …` reports a step that just finished with the');
  lines.push('seconds it took. Two different things worth two different columns: the');
  lines.push('counter is the lockstep check a port is measured against, the step names');
  lines.push('are the module list.');
  lines.push('');
  lines.push('| at | counter | finished |');
  lines.push('| --- | --- | --- |');
  for (const beat of beats) {
    lines.push(`| \`${hex(beat.at)}\` | ${beat.counter ? `\`${beat.counter}\`` : ''} | ${beat.step ?? ''} |`);
  }
  lines.push('');

  lines.push('## Everywhere else it logs');
  lines.push('');
  lines.push('Grouped by the function that prints it. The per-zone fill steps live here:');
  lines.push('one function often carries several, which is how the order *within* a zone');
  lines.push('is known. The "cannot place" lines are the constraints — each one is a rule');
  lines.push('the port has to reproduce, stated by the code that gives up on it.');
  lines.push('');
  for (const [fn, list] of [...byFunction].sort((a, b) => a[0] - b[0])) {
    if (fn === root) continue;
    lines.push(`- \`${hex(fn)}\``);
    for (const ref of list) lines.push(`  - \`${hex(ref.from)}\` ${ref.str.trim()}`);
  }
  lines.push('');

  lines.push('## Classes');
  lines.push('');
  lines.push('RTTI names survived the build, so the generator states its own types.');
  lines.push('');
  for (const { name, vtables } of classes()) {
    const where = vtables.length ? vtables.map((v) => `\`${hex(v)}\``).join(', ') : '—';
    lines.push(`- \`${name}\` — vtable ${where}`);
  }
  lines.push('');
  return lines.join('\n');
}

const document = render();
const path = join(editor, 'docs', 'RMG_CODE_MAP.md');

if (args.includes('--print')) {
  console.log(document);
} else if (args.includes('--check')) {
  // Line endings normalised, the way lua-registry.ts does it: git checks this
  // file out with CRLF on Windows, and a document that only differs in those is
  // not out of date.
  const onDisk = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
  if (onDisk === document) {
    console.log('docs/RMG_CODE_MAP.md matches the executable');
  } else {
    console.error('docs/RMG_CODE_MAP.md is out of date — run `node tools/reverse/rmg-map.ts`');
    process.exit(1);
  }
} else {
  writeFileSync(path, document);
  console.log(`wrote ${path}`);
}
