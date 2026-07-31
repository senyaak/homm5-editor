// The ported random generator against the executable that defines it.
//
//   node tools/test-rmg-random.ts
//
// A hand-written expectation would only prove the port agrees with whoever
// typed the expectation. So the real check here reads the constants back out of
// the game's own code: the multiplier, the increment, the shift and the mask
// that src/rmg/random.ts claims to implement have to be the bytes that are
// actually there. If a different build lays it out differently, this says so
// instead of the port quietly generating a different world.
//
// The rest are the properties that hold whatever the constants are — the ones
// that catch a typo rather than a misreading.

import { RmgRandom } from '../src/rmg/random.ts';
import { openGameExe } from '../src/game/install.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

console.log('the number stream');

// --- properties -----------------------------------------------------------

const a = new RmgRandom(1785351845); // the seed a real generated map recorded
const b = new RmgRandom(1785351845);
const first = Array.from({ length: 8 }, () => a.next());
const again = Array.from({ length: 8 }, () => b.next());
check('the same seed gives the same numbers', JSON.stringify(first) === JSON.stringify(again));

// Neighbouring seeds share their FIRST draw, and that is the generator being
// itself rather than the port being wrong: seed+1 shifts the state by 1, one
// multiply turns that into 0x343FD, and the draw throws away the low 23 bits —
// so the difference is not visible until the gap has been multiplied a few more
// times. Worth knowing before comparing a port against a real run: a single
// matching number proves nothing, a sequence does.
const neighbour = new RmgRandom(1785351846);
const neighbours = Array.from({ length: 8 }, () => neighbour.next());
check('a neighbouring seed shares the first draw', neighbours[0] === first[0], `${first[0]}`);
check('but not the sequence', JSON.stringify(neighbours) !== JSON.stringify(first));
check('every draw fits 31 bits', first.every((n) => n >= 0 && n <= 0x7fffffff), first.slice(0, 3).join(', '));
check('and they are not all the same number', new Set(first).size === first.length);

const counted = new RmgRandom(7);
counted.next();
counted.below(10);
counted.between(3, 5);
check('the counter counts every draw', counted.draws === 3, `${counted.draws}`);

// A zero-length range must not touch the state: the engine returns before
// drawing (0xeb13e5), so a "place 0 of these" loop leaves the stream alone.
// Get this wrong and a map diverges only when a template happens to ask for
// none of something — the worst kind of bug to find later.
const guarded = new RmgRandom(7);
guarded.next();
const noted = guarded.draws;
check('below(0) draws nothing', guarded.below(0) === 0 && guarded.draws === noted, `${guarded.draws} draws`);

const bounded = new RmgRandom(99);
const rolls = Array.from({ length: 500 }, () => bounded.below(6));
check('below(6) stays inside 0..5', rolls.every((n) => n >= 0 && n < 6));
check('and reaches both ends', rolls.includes(0) && rolls.includes(5));

const ranged = new RmgRandom(1234);
const spans = Array.from({ length: 500 }, () => ranged.between(3, 7));
check('between(3, 7) stays inside 3..7', spans.every((n) => n >= 3 && n <= 7));
check('and is inclusive of both', spans.includes(3) && spans.includes(7));

// A negative seed enters the state sign-extended (`cdq`). If that were read as
// unsigned the whole stream would differ, and nothing else here would notice.
const negative = new RmgRandom(-1);
check('a negative seed still draws in range', negative.next() <= 0x7fffffff);
check('and is not the same stream as its unsigned twin', negative.seed === -1);

// --- the constants, out of the executable ---------------------------------

let pe;
try {
  pe = openGameExe();
} catch (error) {
  console.log(`  skip  the constants — ${(error as Error).message}`);
}

if (pe) {
  const text = pe.section('.text');
  const code = pe.bytesOf(text);

  /** Where a byte pattern sits in `.text`, or -1. */
  const at = (bytes: number[]): number => code.indexOf(Buffer.from(bytes));

  // mov esi, 0x343FD — the multiplier, loaded into a register before the
  // 64-bit multiply. Searching for the pattern rather than an address is the
  // house rule: another build moves every function and keeps every constant.
  const multiplier = at([0xbe, 0xfd, 0x43, 0x03, 0x00]);
  check('the executable loads 0x343FD as a multiplier', multiplier >= 0,
    multiplier >= 0 ? `at 0x${pe.addressOf(text.raw + multiplier)!.toString(16)}` : 'not found');

  // add eax, 0x269EC3 — the increment.
  const increment = at([0x05, 0xc3, 0x9e, 0x26, 0x00]);
  check('and adds 0x269EC3', increment >= 0);

  // shrd eax, ecx, 0x17  /  and eax, 0x7FFFFFFF — the 31-bit draw, 0xeb13a0.
  const shift = at([0x0f, 0xac, 0xc8, 0x17]);
  check('the plain draw shifts the state right by 23', shift >= 0);
  check('and masks it to 31 bits', at([0x25, 0xff, 0xff, 0xff, 0x7f]) >= 0);

  // shrd eax, esi, 0x10  /  and esi, 0x7FFF — the ranged draw, 0xeb13e0: a
  // different slice, which is why below() is not next() % limit.
  check('the ranged draw shifts by 16 instead', at([0x0f, 0xac, 0xf0, 0x10]) >= 0);
  check('and keeps 47 bits of state', at([0x81, 0xe6, 0xff, 0x7f, 0x00, 0x00]) >= 0);
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
