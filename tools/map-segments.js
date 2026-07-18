// Build an exact segment map of a GroundTerrain.bin by locating anchors and
// printing every inter-segment gap byte-for-byte. Ground-truth for the grammar.
import { readFileSync } from 'node:fs';

const path = process.argv[2] ?? 'samples/A2M3_GroundTerrain.bin';
const tiles = Number(process.argv[3] ?? 96);
const V = tiles + 1, N = V * V;
const b = readFileSync(path);
const hx = (o, n) => Buffer.from(b.subarray(o, o + n)).toString('hex').replace(/(..)/g, '$1 ').trim();

// Find height block (N float32 in sane range) — our reliable anchor.
function findHeight() {
  for (let off = 0; off + N * 4 <= b.length; off++) {
    let ok = true;
    for (let i = 0; i < N; i += 7) { // sparse check first for speed
      const f = b.readFloatLE(off + i * 4);
      if (!(f >= 0 && f <= 64) && !(f > -1e-30 && f < 1e-30)) { ok = false; break; }
    }
    if (!ok) continue;
    let good = 0;
    for (let i = 0; i < N; i++) {
      const f = b.readFloatLE(off + i * 4);
      if ((f >= 0 && f <= 64) || (f > -1e-30 && f < 1e-30)) good++;
    }
    if (good >= N * 0.99) return off;
  }
  return -1;
}

const hOff = findHeight();
const hEnd = hOff + N * 4;
console.log(`file ${path}  size ${b.length}  V=${V} N=${N}`);
console.log(`HEIGHT  @${hOff}..${hEnd}  (${N} float32)\n`);

// Walk u8 planes after height. Grammar hypothesis: an optional framing group
// then N raw bytes. Detect a plane start as the offset where the next N bytes
// contain NO framing signature and advance. We instead detect framing groups:
// a framing group is a short sequence of small tagged records that ends right
// before a long low-entropy run. Here we just print gaps between N-sized planes
// by anchoring on the arithmetic end-block first.

// Locate end block: the tail arithmetic sequence "xx yy 03 0c 02 02 00 03" repeating.
let endStart = -1;
for (let o = hEnd; o + 8 < b.length; o++) {
  if (b[o + 2] === 0x03 && b[o + 3] === 0x0c && b[o + 4] === 0x02 && b[o + 5] === 0x02 &&
      b[o + 6] === 0x00 && b[o + 7] === 0x03 &&
      b[o + 10] === 0x03 && b[o + 11] === 0x0c) { endStart = o; break; }
}
console.log(`END block starts ~@${endStart}  (len ${b.length - endStart})`);
console.log(`  head: ${hx(endStart, 24)}\n`);

// Between hEnd and endStart lie the u8 planes + framing. Total bytes:
const planeRegion = endStart - hEnd;
console.log(`plane region: ${hEnd}..${endStart} = ${planeRegion} bytes`);
console.log(`  / N(${N}) = ${(planeRegion / N).toFixed(4)}  ->  ${Math.round(planeRegion / N)} planes if framing≈0`);
console.log(`  planes*N = ${Math.floor(planeRegion / N) * N}, leftover framing = ${planeRegion - Math.floor(planeRegion / N) * N}\n`);

// Print the first 24 bytes right after hEnd (framing before plane0):
console.log('framing after HEIGHT:', hx(hEnd, 28));
// Try to detect framing length: framing = small records until a >=64 run of a repeated byte.
function scanPlanes(startAssumingFraming) {
  let p = hEnd, idx = 0;
  const planes = [];
  while (p + N <= endStart) {
    // measure framing: advance while we are NOT at a plausible plane start.
    // plausible plane start = position where bytes[p..p+64] has <=2 distinct high-entropy transitions.
    let f = 0;
    while (p + f + N <= endStart && f < 48) {
      // heuristic: plane byte[0..64] mostly equal-ish / small; framing has the 0x08 0x61 tokens
      const w = b.subarray(p + f, p + f + 6).toString('hex');
      if (/^(01|02|03|04|07)08610000/.test(w) || /0861000000/.test(b.subarray(p+f,p+f+8).toString('hex'))) { f += 1; continue; }
      break;
    }
    // fallback: if framing not clearly detected, assume 0
    const dataO = p + f;
    if (dataO + N > endStart) break;
    // stats
    const c = {};
    for (let i = 0; i < N; i++) { const v = b[dataO + i]; c[v] = (c[v] || 0) + 1; }
    const top = Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `0x${(+k).toString(16)}:${v}`).join(' ');
    planes.push({ idx, framing: f, dataO, top });
    console.log(`plane ${idx}: framing ${f}B [${hx(p, Math.min(f, 24))}]  data@${dataO}  ${top}`);
    p = dataO + N;
    idx++;
  }
  console.log(`\nwalked to ${p}; endStart ${endStart}; delta ${endStart - p}`);
}
scanPlanes();
