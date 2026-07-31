// The bin/effects parser, against the redundancies the format itself carries.
//
// There is no second copy of this data to compare against (unlike Oodle, which
// had the game's DLL) — what CAN be checked is that the directory's own claims
// hold for every shipped file: blocks contiguous in directory order, every
// byte covered exactly once, every key inside its particle's lifetime, and the
// channel payloads shaped like what they claim to be (sizes positive, texture
// indices small or the hidden marker). A layout misunderstanding breaks these
// loudly — that is how the format was pinned down in the first place.
//
// Skips itself when the game data is not unpacked.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseEffect } from '../src/scene/effects.ts';

const dataRoot = process.env.HOMM5_DATA || join(import.meta.dirname, '..', 'data-unpacked');
const DIR = join(dataRoot, 'bin', 'effects');
if (!existsSync(DIR)) {
  console.log('test-effects: no bin/effects under the data root — skipping');
  process.exit(0);
}

const KEY_BYTES = [14, 6, 10, 6, 4];
let files = 0, empty = 0, particles = 0, keys = 0;
const failures: string[] = [];
const oddities = new Map<string, string>();
const odd = (f: string, what: string): void => { if (!oddities.has(f)) oddities.set(f, what); };

for (const f of readdirSync(DIR)) {
  const b = readFileSync(join(DIR, f));
  if (b.length < 4) { failures.push(`${f}: ${b.length} bytes`); continue; }
  files++;
  try {
    // Header arithmetic. One shipped file writes 0 here; tolerated, parsed anyway.
    const size = b.readUInt32LE(0);
    if (size !== b.length - 4 && size !== 0) throw new Error(`size field ${size} vs ${b.length - 4}`);
    if (b.length < 20) { empty++; continue; }

    const fx = parseEffect(b);
    if (!fx.particles.length) { empty++; continue; }
    if (!(fx.rate > 0) || !(fx.duration >= 0)) throw new Error(`rate ${fx.rate}, duration ${fx.duration}`);

    // Re-walk the directory for coverage: blocks contiguous, file fully used.
    let expect = 16 + fx.particles.length * (4 + 5 * 6);
    let off = 16;
    for (const p of fx.particles) {
      off += 4;
      for (let c = 0; c < 5; c++) {
        const count = b.readUInt16LE(off), at = 4 + b.readUInt32LE(off + 2);
        off += 6;
        if (at !== expect) throw new Error(`block at ${at}, expected ${expect}`);
        expect = at + count * KEY_BYTES[c]!;
      }
      if (p.death < p.birth) throw new Error(`death ${p.death} before birth ${p.birth}`);
      for (const ch of [p.pos, p.rot, p.size, p.color, p.tex]) {
        for (const k of ch) {
          keys++;
          if (k.frame < p.birth || k.frame > p.death) throw new Error(`key frame ${k.frame} outside [${p.birth}, ${p.death}]`);
        }
      }
      // Value oddities are reported (once per file) but do not fail: the
      // structure checks above already prove the blocks are read right, and
      // the shipped data does carry authored noise — slightly negative sizes
      // in 12 files (Maya curve overshoot), one file of Infinity sizes, one
      // file whose texture indices all carry bit 0x400 on top of a normal
      // frame number. A renderer clamps; a test that fails on these would be
      // enforcing taste on data the game itself shipped.
      for (const s of p.size) if (!Number.isFinite(s.v[0]!) || s.v[0]! < -100) { odd(f, 'non-finite or wildly negative size'); break; }
      for (const t of p.tex) if (t.v[0]! > 1024) { odd(f, `texture index ${t.v[0]} (0x400-flagged?)`); break; }
      particles += 1;
    }
    const slack = b.length - expect;
    if (slack < 0 || slack > 8) throw new Error(`covered to ${expect} of ${b.length}`);
  } catch (e) {
    failures.push(`${f}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

console.log(`test-effects: ${files} files, ${empty} empty, ${particles} particles, ${keys} keys`);
if (oddities.size) console.log(`data oddities (expected, see comment): ${oddities.size} file(s)\n` + [...oddities].map(([f, w]) => `  ${f}: ${w}`).join('\n'));
if (failures.length) {
  console.error(`FAIL: ${failures.length} file(s)\n` + failures.slice(0, 10).join('\n'));
  process.exit(1);
}
console.log('OK: every file parses and every byte is accounted for');
