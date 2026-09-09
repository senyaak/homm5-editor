// The editor's FPU, against the editor's own answers.
//
//   node tools/test-x87.ts --game <dir>
//
// `src/exe/x87.ts` claims the editor computes at single precision, rounding
// toward zero. The claim is not a reading of the code — it is the control word
// `0x0C7F` read out of the running process, plus every value two of its
// functions returned during one minimap build. The pairs below are a slice of
// that log: the engine's argument and the engine's answer, as raw doubles.
//
// A suite that only asked "does the minimap come out right" would pass on a
// wrong sine and a compensating filter. These ask each function on its own.

import { readEngineSine, engineSin24 } from '../src/exe/sine-table.ts';
import { add24, div24, mul24, parse24, parse24Right, sub24, tr24 } from '../src/exe/x87.ts';
import { lanczos3 } from '../src/rmg/resample.ts';
import { gameDirIfAny } from './game-dir.ts';
import { join } from 'node:path';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

console.log('the operations, on their own');
{
  // A third of a dyadic number is where truncating a rounded product and
  // truncating the exact one part company — the case that cost a day.
  check('a product truncates the EXACT result, not a rounded one',
    mul24(0.31640625, 0.3333333333333333) === 0.10546874254941940,
    `${mul24(0.31640625, 0.3333333333333333)}`);
  check('and the double product would have rounded up to the next float',
    Math.fround(0.31640625 * 0.3333333333333333) === 0.10546875);
  check('a store rounds toward zero', tr24(0.9999999998798883) === 0.9999999403953552,
    `${tr24(0.9999999998798883)}`);
  check('negatives round toward zero too', tr24(-0.9999999998798883) === -0.9999999403953552,
    `${tr24(-0.9999999998798883)}`);
  check('a sum lands on a float', add24(0.9999250173568726, 0.0000749825) === 0.9999999403953552,
    `${add24(0.9999250173568726, 0.0000749825)}`);
  check('a difference does as well', Math.fround(sub24(1, 0.9999250173568726)) === sub24(1, 0.9999250173568726));
  check('a quotient truncates', div24(-0.8382253646850586, 5.289165496826172) === -0.1584796905517578,
    `${div24(-0.8382253646850586, 5.289165496826172)}`);
}

console.log('\nthe two builds read a decimal differently');
{
  // A tile colour's byte, both ways: parse the xdb's text, multiply by 255 on
  // the chopping machine, truncate. The texts are the game's own tile
  // documents, and the numbers on the right are what each build's minimap has.
  const gameByte = (s: string): number => Math.trunc(mul24(parse24(s), 255));
  const editorByte = (s: string): number => Math.trunc(mul24(parse24Right(s), 255));
  // Bog's green is the one colour the EDITOR carries higher than the game, and
  // the only reason `parse24Right` exists: 0.772549 is 2e-8 under 197/255, and
  // accumulating the fraction from the right lands over it. Accumulate from
  // the left instead — under nearest or under chop — and this case reddens.
  check('the editor lifts Bog\'s green over 197/255', editorByte('0.772549') === 197, `${editorByte('0.772549')}`);
  check('the game does not', gameByte('0.772549') === 196, `${gameByte('0.772549')}`);
  // Eleven colours go the other way: the game's parse drops them a byte and
  // the editor's keeps them. Four of them, one from each ground.
  const LOWERED: ReadonlyArray<readonly [string, number, number]> = [
    ['0.00784314', 1, 2],   // Water, red
    ['0.337255', 85, 86],   // Dead_Land, red
    ['0.454902', 115, 116], // SandRoad, green
    ['0.709804', 180, 181], // SnowRoad, green
  ];
  const badLowered = LOWERED.filter(([s, g, e]) => gameByte(s) !== g || editorByte(s) !== e);
  check('the colours the game lowers, the editor keeps', badLowered.length === 0,
    badLowered.map(([s, g, e]) => `${s}: game ${gameByte(s)} want ${g}, editor ${editorByte(s)} want ${e}`).join('; '));
  // And the near neighbours that must NOT move, or the fit would be a fudge:
  // the same 2e-8 shortfall as Bog's on a different pair of digits, and a road
  // colour whose 371 tiles are on the map that closed Bog.
  const KEPT: ReadonlyArray<readonly [string, number]> = [['0.572549', 145], ['0.862745', 219]];
  const badKept = KEPT.filter(([s, want]) => gameByte(s) !== want || editorByte(s) !== want);
  check('and a colour just as close to its boundary stays where it is', badKept.length === 0,
    badKept.map(([s, want]) => `${s}: game ${gameByte(s)}, editor ${editorByte(s)}, want ${want}`).join('; '));
}

const game = gameDirIfAny();
if (!game) {
  console.log('\nnobody said where the game is (HOMM5_GAME or --game) — skipping the engine\'s own answers');
  process.exit(failures ? 1 : 0);
}
const sine = readEngineSine(join(game, 'bin', 'H5_Game_H5E.exe'));

// Logged by `native/rmg/minimap-probe.c` from the editor's 0xED3A80, one
// minimap build of the reference order. Argument, then answer.
const SINE_CALLS: ReadonlyArray<readonly [number, number]> = [
  [4.71238899230957, -0.9999999403953552], [7.792622089385986, 0.9981179237365723],
  [3.423845052719116, -0.2785196006298065], [0.306796133518219, 0.30200594663619995],
  [1.5748867988586426, 1.0000249147415161], [2.163935422897339, 0.8292184472084045],
  [8.578020095825195, 0.7491369247436523], [0.8794822692871094, 0.7703955769538879],
  [7.571728706359863, 0.9604305028915405], [0.40497085452079773, 0.3939919173717499],
];
// The same for the filter at 0x7911C0, whose two sinc terms call the above.
const FILTER_CALLS: ReadonlyArray<readonly [number, number]> = [
  [2.68359375, 0.011509252712130547], [-1.91015625, -0.021095212548971176],
  [0.86328125, 0.13346749544143677], [2.63671875, 0.014759906567633152],
  [-1.95703125, -0.009480820037424564], [0.81640625, 0.18764370679855347],
  [2.58984375, 0.018125176429748535], [-1.00390625, -0.003212705021724105],
  [0.76953125, 0.2452906221151352], [2.54296875, 0.021450504660606384],
];

console.log('\nagainst the engine\'s own answers');
{
  const badSine = SINE_CALLS.filter(([x, want]) => engineSin24(sine, x) !== want);
  check('every logged sine is reproduced bit for bit', badSine.length === 0,
    badSine.map(([x, want]) => `sin(${x}) ${engineSin24(sine, x)} vs ${want}`).join(' '));

  const filter = lanczos3(sine);
  const badFilter = FILTER_CALLS.filter(([x, want]) => filter(x) !== want);
  check('every logged filter weight is reproduced bit for bit', badFilter.length === 0,
    badFilter.map(([x, want]) => `f(${x}) ${filter(x)} vs ${want}`).join(' '));

  // And the shape of the answer, which a double version cannot have: the
  // editor's FPU has no result that is not a float.
  check('every answer is a float, as single precision requires',
    SINE_CALLS.every(([, v]) => Math.fround(v) === v)
    && FILTER_CALLS.every(([, v]) => Math.fround(v) === v));
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
