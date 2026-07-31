// The creature-ceiling patcher.
//
//   node tools/test-creature-limit.ts [game]
//
// The self-contained checks — the patch data's own consistency, and a synthetic
// executable built here — always run. The checks against the real executables run
// when the install is there, and skip themselves when it is not.
//
// Nothing here writes to a game file. setCreatureLimit() is exercised against a
// COPY of a real executable in a temporary folder, so a failing test cannot leave
// the install unable to start.

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  BUILDS, ORIGINAL_LIMIT, PATCHED_EXE, SHIPPED_EXE, checkJumps, patchExe, readExe, sections,
  setCreatureLimit,
} from '../src/exe/creature-limit.ts';
import type { Build } from '../src/exe/creature-limit.ts';

const game = resolve(process.argv[2] ?? join(import.meta.dirname, '..', '..'));

let failed = 0;
let skipped = 0;
function check(what: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ok    ${what}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL  ${what}\n        ${e instanceof Error ? e.message : String(e)}`);
  }
}
function skip(what: string, why: string): void {
  skipped++;
  console.log(`  skip  ${what} — ${why}`);
}
function eq(got: unknown, want: unknown, what: string): void {
  if (got !== want) throw new Error(`${what}: got ${String(got)}, want ${String(want)}`);
}
function throws(fn: () => unknown, matching: RegExp): void {
  try {
    fn();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (!matching.test(message)) throw new Error(`threw the wrong thing: ${message}`);
    return;
  }
  throw new Error('did not throw');
}

console.log('\npatch data');

check('every build is identified by bytes no other build has there', () => {
  for (const a of BUILDS) {
    for (const b of BUILDS) {
      if (a === b) continue;
      if (a.check.offset !== b.check.offset) continue;
      if (Buffer.from(a.check.bytes).equals(Buffer.from(b.check.bytes))) {
        throw new Error(`${a.name} and ${b.name} look the same at 0x${a.check.offset.toString(16)}`);
      }
    }
  }
});

check('every build has two count sites, at different offsets', () => {
  for (const b of BUILDS) {
    eq(b.limits.length, 2, `${b.name} count sites`);
    if (b.limits[0] === b.limits[1]) throw new Error(`${b.name}: the same offset twice`);
  }
});

check('the jumps land on their stubs and return', () => BUILDS.forEach(checkJumps));

check('a jump that misses its stub is rejected', () => {
  const b = BUILDS.find((x) => x.code.length === 2)!;
  const moved: Build = { ...b, code: [b.code[0]!, { ...b.code[1]!, offset: b.code[1]!.offset + 1 }] };
  throws(() => checkJumps(moved), /lands on/);
});

// --- a synthetic executable ---------------------------------------------------
//
// A real one is 14 MB and may not be there; the offsets are all this code cares
// about, so a file of zeroes with a PE header and the right bytes at the right
// places exercises every path.

const SYNTH = BUILDS[0]!;

function synthetic(o: { limit?: number; bind?: boolean; identify?: boolean } = {}): Buffer {
  const size = Math.max(...SYNTH.limits) + 0x1000;
  const buf = Buffer.alloc(size);
  const pe = 0x100;
  buf.writeUInt32LE(pe, 0x3c);
  buf.write('PE\0\0', pe, 'ascii');
  const count = o.bind ? 2 : 1;
  buf.writeUInt16LE(count, pe + 6);
  buf.writeUInt16LE(0xe0, pe + 20);              // optional header size
  const table = pe + 24 + 0xe0;
  const section = (i: number, name: string, start: number, len: number): void => {
    buf.write(name.padEnd(8, '\0'), table + i * 40, 'ascii');
    buf.writeUInt32LE(len, table + i * 40 + 16);
    buf.writeUInt32LE(start, table + i * 40 + 20);
  };
  section(0, '.text', 0x400, size - 0x400);
  if (o.bind) section(1, '.bind', 0x400, 0x2d7d0);
  if (o.identify !== false) Buffer.from(SYNTH.check.bytes).copy(buf, SYNTH.check.offset);
  for (const at of SYNTH.limits) buf.writeInt32LE(o.limit ?? ORIGINAL_LIMIT, at);
  return buf;
}

console.log('\na synthetic executable');

check('the section table reads back', () => {
  const s = sections(synthetic({ bind: true }));
  eq(s.length, 2, 'sections');
  eq(s[1]!.name, '.bind', 'second section');
  eq(s[1]!.rawSize, 0x2d7d0, '.bind size');
});

check('fresh: identified, ceiling 180, patchable', () => {
  const r = readExe(synthetic());
  eq(r.build?.name, SYNTH.name, 'build');
  eq(r.limit, ORIGINAL_LIMIT, 'ceiling');
  eq(r.problems.length, 0, 'problems');
});

check('patching writes both sites and nothing else', () => {
  const before = synthetic();
  const p = patchExe(before, 181);
  eq(p.from, ORIGINAL_LIMIT, 'from');
  eq(p.to, 181, 'to');
  eq(p.sites, 2, 'sites written');
  eq(p.data.length, before.length, 'length');
  for (const at of SYNTH.limits) eq(p.data.readInt32LE(at), 181, `0x${at.toString(16)}`);
  // Byte for byte the same but for the two dwords.
  let differing = 0;
  for (let i = 0; i < before.length; i++) if (before[i] !== p.data[i]) differing++;
  eq(differing, 2, 'bytes changed');   // 180 → 181 is one byte at each site
  eq(before.readInt32LE(SYNTH.limits[0]!), ORIGINAL_LIMIT, 'the input is not modified');
});

// This is the case the port's one-shot script could not do, and the reason a
// change to the creature list used to mean unwrapping the executable again.
check('an already-patched file can be re-patched, up or down', () => {
  const at181 = patchExe(synthetic(), 181).data;
  eq(readExe(at181).limit, 181, 'reads back as 181');
  const up = patchExe(at181, 190);
  eq(up.from, 181, 'from');
  eq(up.to, 190, 'to');
  eq(readExe(up.data).limit, 190, 'now 190');
  const down = patchExe(up.data, ORIGINAL_LIMIT);
  eq(down.to, ORIGINAL_LIMIT, 'back to shipped');
  eq(readExe(down.data).limit, ORIGINAL_LIMIT, 'reads back as shipped');
});

check('a file already at the wanted ceiling is left alone', () => {
  const at181 = patchExe(synthetic(), 181).data;
  const again = patchExe(at181, 181);
  eq(again.sites, 0, 'sites written');
  if (!again.data.equals(at181)) throw new Error('the bytes changed');
});

check('a half-patched file is refused', () => {
  const buf = synthetic();
  buf.writeInt32LE(181, SYNTH.limits[0]!);       // one site only
  const r = readExe(buf);
  eq(r.limit, null, 'no ceiling');
  if (!r.problems.some((p) => /half-patched/.test(p))) throw new Error(`problems: ${r.problems.join('; ')}`);
  throws(() => patchExe(buf, 182), /half-patched/);
});

check('a wrapped executable is named as wrapped, not as unknown', () => {
  const r = readExe(synthetic({ bind: true }));
  eq(r.build, null, 'no build');
  if (!r.problems.some((p) => /DRM/.test(p))) throw new Error(`problems: ${r.problems.join('; ')}`);
  throws(() => patchExe(synthetic({ bind: true }), 181), /DRM/);
});

check('an unknown build is refused', () => {
  throws(() => patchExe(synthetic({ identify: false }), 181), /unrecognised/);
});

check('a count site holding noise is not read as a ceiling', () => {
  const buf = synthetic();
  for (const at of SYNTH.limits) buf.writeInt32LE(0x6f2a11c4, at);
  throws(() => patchExe(buf, 181), /not a creature ceiling/);
});

check('a ceiling below the shipped one is refused', () => {
  throws(() => patchExe(synthetic(), 179), /at least 180/);
  throws(() => patchExe(synthetic(), 1.5), /whole number/);
});

// --- the real thing ----------------------------------------------------------

console.log(`\nthe install at ${game}`);

const shipped = join(game, SHIPPED_EXE);
const editor = join(game, 'bin', 'H5_MapEditor.exe');
const patched = join(game, PATCHED_EXE);

if (!existsSync(shipped)) skip('the shipped executable', `no ${SHIPPED_EXE}`);
else {
  check('the shipped executable is read as itself', () => {
    const r = readExe(readFileSync(shipped));
    // Either wrapped (Steam) or a recognised build at the shipped ceiling. What
    // must never happen is being read as some OTHER build's ceiling.
    if (r.wrapped) {
      if (!r.problems.some((p) => /DRM/.test(p))) throw new Error('wrapped but not reported as such');
      return;
    }
    if (!r.build) throw new Error(`unrecognised: ${r.problems.join('; ')}`);
    eq(r.limit, ORIGINAL_LIMIT, 'the shipped ceiling');
  });
}

if (!existsSync(editor)) skip('the map editor executable', 'no bin/H5_MapEditor.exe');
else {
  // Retail, unwrapped, and the only shipped file whose offsets can be checked
  // against the published patch data: it is the reason the data is trusted.
  check('the map editor is identified and reads 180 at both sites', () => {
    const r = readExe(readFileSync(editor));
    eq(r.build?.name, 'H5_MapEditor.exe 3.1', 'build');
    eq(r.limit, ORIGINAL_LIMIT, 'ceiling');
    eq(r.stubbed, false, 'stub not applied');
    eq(r.problems.length, 0, 'problems');
  });
  check('patching it applies the jump and the stub as well as the counts', () => {
    const p = patchExe(readFileSync(editor), 181);
    eq(p.sites, 4, 'sites written');
    const back = readExe(p.data);
    eq(back.limit, 181, 'ceiling');
    eq(back.stubbed, true, 'stub applied');
    eq(back.problems.length, 0, 'problems');
  });
}

if (!existsSync(patched)) skip('setCreatureLimit on a copy', `no ${PATCHED_EXE} to copy`);
else {
  check('setCreatureLimit patches a copy, twice, and leaves the game alone', () => {
    const before = readFileSync(patched);
    const dir = mkdtempSync(join(tmpdir(), 'homm5-limit-'));
    try {
      mkdirSync(join(dir, 'bin'));
      copyFileSync(patched, join(dir, PATCHED_EXE));
      // A shipped file that would be refused, to prove the existing copy is what
      // gets patched rather than a fresh one made from it.
      writeFileSync(join(dir, SHIPPED_EXE), Buffer.alloc(0x2000));

      const was = readExe(before).limit!;
      const up = setCreatureLimit(dir, was + 3);
      eq(up.created, false, 'created');
      eq(up.changed, true, 'changed');
      eq(up.from, was, 'from');
      eq(readExe(readFileSync(join(dir, PATCHED_EXE))).limit, was + 3, 'ceiling on disk');

      const back = setCreatureLimit(dir, was);
      eq(back.from, was + 3, 'second run reads the first');
      const after = readFileSync(join(dir, PATCHED_EXE));
      if (!after.equals(before)) throw new Error('a round trip did not return the original bytes');

      const same = setCreatureLimit(dir, was);
      eq(same.changed, false, 'nothing to do');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    if (!readFileSync(patched).equals(before)) throw new Error('the install was modified');
  });
}

console.log(`\n${failed ? `${failed} FAILED` : 'all checks passed'}${skipped ? `, ${skipped} skipped` : ''}`);
process.exit(failed ? 1 : 0);
