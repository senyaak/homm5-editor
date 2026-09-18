// The particle table bake (renderer/viewport/fx-table.ts), on recordings made here.
//
//   node tools/test-fx-table.ts
//
// The table is what the effect shaders read, so the checks are about what
// lands in its texels: an entry per alive particle per frame and none for a
// hidden one, the per-frame ranges covering the entries exactly, and the
// channels decoding to the sampled values — in particular the rotation, which
// is an ANGLE and is written wrapped: a shipped recording (the Storm Lord's
// Flow_Initial) spins to 28 million radians, past what a half float holds,
// and the bake used to clamp it and warn once per entry, 4900 times a map.

import { DataUtils } from 'three';
import { bakeTableData, TABLE_ROW } from '../src/scene/fx-table.ts';
import type { FxTransfer } from '../src/scene/effects.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const TAU = Math.PI * 2;
const wrap = (a: number): number => { const r = a - TAU * Math.round(a / TAU); return r <= -Math.PI ? r + TAU : r; };
/** Half floats hold ~3 decimal digits: a wrapped angle comes back within this. */
const HALF_EPS = 0.004;

// Two particles over a 10-frame recording: one spins from 0 to 28 million
// radians, alive the whole way; the other is hidden (tex −1) from frame 5 on.
const FRAMES = 10, SPIN = 28_131_282;
const rec: FxTransfer = {
  duration: FRAMES / 30, rate: 30, maxAlive: 2,
  particles: [
    {
      birth: 0, death: FRAMES - 1,
      pos: new Float32Array([0, 1, 2, 3, FRAMES - 1, 1, 2, 3]),
      rot: new Float32Array([0, 0, FRAMES - 1, SPIN]),
      size: new Float32Array([0, 2, 4]),
      color: new Float32Array([0, 255, 128, 64, 255]),
      tex: new Float32Array([0, 3]),
    },
    {
      birth: 0, death: FRAMES - 1,
      pos: new Float32Array([0, -1, -2, -3]),
      rot: new Float32Array([0, 1.5]),
      size: new Float32Array([0, 1, 1]),
      color: new Float32Array([0, 10, 20, 30, 40]),
      tex: new Float32Array([0, 0, 5, -1]),
    },
  ],
};

const warned: string[] = [];
const warn = console.warn;
console.warn = (...a: unknown[]) => { warned.push(a.map(String).join(' ')); };
const t = bakeTableData(rec);
console.warn = warn;

console.log('entries and ranges');
check('no warning from the bake', warned.length === 0, warned[0]);
check('frames', t.frames === FRAMES, `${t.frames}`);
// Frames 0–4 have both particles, 5–9 the spinner only.
check('entries: 5×2 + 5×1', t.entries === 15, `${t.entries}`);
let covered = true;
for (let f = 0; f < FRAMES; f++) if (t.base[f] !== (f < 5 ? f * 2 : 10 + (f - 5)) || t.count[f] !== (f < 5 ? 2 : 1)) covered = false;
check('per-frame base/count cover the entries in order', covered);
check('rows for the entries', t.rows === Math.ceil(t.entries / TABLE_ROW), `${t.rows}`);

console.log('channels');
const half = (i: number): number => DataUtils.fromHalfFloat(t.data[i]!);
const spinAt = (f: number): number => (SPIN * f) / (FRAMES - 1); // the lerp the bake does
let rotOk = true, rotMax = 0, rotWorst = '';
for (let f = 0; f < FRAMES; f++) {
  const e = t.base[f]!; // the spinner is the first entry of every frame
  const got = half(e * 12 + 3), want = wrap(spinAt(f));
  // Compare as angles: the two may sit on either side of ±π.
  const d = Math.abs(wrap(got - want));
  if (d > rotMax) { rotMax = d; rotWorst = `frame ${f}: table ${got.toFixed(4)}, sampled ${spinAt(f).toExponential(3)} wraps to ${want.toFixed(4)}`; }
  if (Math.abs(got) > Math.PI + HALF_EPS) rotOk = false;
}
check('rotation texels lie within (−π, π]', rotOk);
// The sampled angle is a float32 lerp of a float32 key: at 28e6 its own
// precision is a couple of radians, so equality is asked of the SMALL frames
// only — the wrap must not add error of its own where the angle is exact.
let smallOk = true;
for (let f = 0; f < 3; f++) {
  const got = half(t.base[f]! * 12 + 3), want = wrap(spinAt(f));
  if (Math.abs(wrap(got - want)) > Math.max(HALF_EPS, Math.abs(want) * 2e-3)) smallOk = false;
}
check('rotation texels equal the wrapped sampled angle where the angle is exact', smallOk, rotWorst);
const p2 = t.base[0]! + 1; // the second particle, frame 0
check('position', half(p2 * 12) === -1 && half(p2 * 12 + 1) === -2 && half(p2 * 12 + 2) === -3);
check('rotation of a still particle', Math.abs(half(p2 * 12 + 3) - 1.5) < HALF_EPS);
check('size', half(p2 * 12 + 4) === 1 && half(p2 * 12 + 5) === 1);
check('texture index', half(p2 * 12 + 6) === 0 && half(t.base[0]! * 12 + 6) === 3);
check('colour as 0..1', Math.abs(half(p2 * 12 + 8) - 10 / 255) < 1e-3 && Math.abs(half(p2 * 12 + 11) - 40 / 255) < 1e-3);
check('a hidden particle has no entry', t.count[5] === 1 && half(t.base[5]! * 12 + 6) === 3);

if (failures) { console.log(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nall checks passed');
