// Oodle1 decompression — RAD Game Tools' old LZ+arithmetic codec, which is what
// the compressed sections of a Granny GR2 are packed with (every file under
// bin/Skeletons, and about a sixth of bin/animations).
//
// Written from the open specification at github.com/LunaticInAHat/liboodle
// (Unlicense), which documents the format down to the pseudocode and names
// Heroes of Might and Magic V as an example of it. The alternative was calling
// GrannyDecompressData in the game's own bin/granny2.dll, which is 32-bit and
// so unreachable from a 64-bit Node without a sidecar process; this keeps the
// editor dependency-free and works in a packaged build.
//
// Three layers, bottom up:
//
//   1. The BITSTREAM turns the input into fixed-point numbers in [0, 1), scaled
//      to a caller-chosen denominator. Its oddity is the "7+1 split": each byte
//      contributes its top seven bits to the register immediately and holds its
//      LSB back until the next byte arrives.
//   2. The SYMBOL CODER is an adaptive arithmetic coder that learns as it goes.
//      It keeps an ACTIVE alphabet with frequency-proportional spans, a
//      PROBATIONARY one of symbols seen since the last renormalization, and an
//      escape symbol at index 0 that leads to either of the other two.
//   3. The LZ layer decodes literals and (length, offset) repeats through a bank
//      of ~330 of those coders, chosen by context.
//
// Nothing here is guessed, and nothing is approximate: an arithmetic decoder is
// bit-exact or it is noise. tools/test-oodle.ts checks the output against the
// same skeleton stored uncompressed elsewhere in the game data.

/** The parameters the compressor used, stored in 12 bytes ahead of each stream. */
export interface OodleHeader {
  /** Number of distinct byte values the literal coders may emit (256 in practice). */
  literalAlphabetSize: number;
  /** Match window, in bytes. */
  windowSize: number;
  /** How many distinct literals this stream actually uses. */
  uniqueLiterals: number;
  /** Largest match offset, in units of 1 KiB. */
  largest1KOffset: number;
  /** How many distinct length codes each of the four length-coder banks uses. */
  uniqueRepeatLengths: [number, number, number, number];
}

/** Read one 12-byte Oodle1 header. */
export function readOodleHeader(buf: Uint8Array, at: number): OodleHeader {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const w0 = view.getUint32(at, true);
  const w1 = view.getUint32(at + 4, true);
  const w2 = view.getUint32(at + 8, true);
  return {
    literalAlphabetSize: w0 & 0x1ff,
    windowSize: w0 >>> 9,
    uniqueLiterals: w1 & 0x1ff,
    // Stored as a byte offset, always a multiple of 1024, and used as a count of
    // kilobytes: as a byte count it would exceed the coder's alphabet (11264 for
    // an alphabet of 257) and the coder would never learn a symbol at all.
    largest1KOffset: ((w1 >>> 9) & 0xfffff) >>> 10,
    uniqueRepeatLengths: [w2 >>> 24, (w2 >>> 16) & 0xff, (w2 >>> 8) & 0xff, w2 & 0xff],
  };
}

/** Fixed-point 1.0 for the symbol coder's spans. */
const ONE = 0x4000;

/**
 * The bit reader.
 *
 * `R` is the register, `M` its modulus — the full-scale value R is measured
 * against, which shrinks as symbols are consumed and is topped back up by
 * ingesting more input. Both stay below 2^31, so plain arithmetic is exact in a
 * double and no 32-bit bitwise operator (which would go signed) is used.
 */
export class BitStream {
  private at: number;
  private register = 0;
  private modulus = 0x80;
  /** The held-back low bit of the last byte read. */
  private held = 0;
  private readonly input: Uint8Array;

  constructor(input: Uint8Array, start: number) {
    this.input = input;
    this.at = start;
    const first = this.nextByte();
    this.register = first >>> 1;
    this.held = first & 1;
  }

  /** How far the reader has got — where the next stream begins. */
  get position(): number { return this.at; }

  /**
   * Reading past the end yields zeroes rather than throwing: the spec has the
   * input padded with zero bytes, and the last symbols of a stream routinely
   * need a few bytes that were never written.
   */
  private nextByte(): number {
    const b = this.at < this.input.length ? this.input[this.at]! : 0;
    this.at++;
    return b;
  }

  /** Top the register up to at least 24 bits of headroom. */
  private ingest(): void {
    while (this.modulus <= 0x800000) {
      const b = this.nextByte();
      // The held bit first, then seven bits of the new byte — the 7+1 split.
      this.register = this.register * 2 + this.held;
      this.register = this.register * 128 + (b >>> 1);
      this.held = b & 1;
      this.modulus *= 256;
    }
  }

  /** The next value in [0, f), without consuming it. */
  peek(f: number): number {
    this.ingest();
    const scale = Math.floor(this.modulus / f);
    return Math.min(Math.floor(this.register / scale), f - 1);
  }

  /** Consume the span [low, low + span) of a peeked value. */
  consume(low: number, span: number, f: number): void {
    const scale = Math.floor(this.modulus / f);
    const scaled = low * scale;
    this.register -= scaled;
    if (low < f - span) this.modulus = span * scale;
    else this.modulus -= scaled;
  }

  /** Peek and consume one uniformly-distributed value in [0, f). */
  get(f: number): number {
    if (f <= 1) return 0;
    this.ingest();
    const scale = Math.floor(this.modulus / f);
    const z = Math.min(Math.floor(this.register / scale), f - 1);
    const scaled = z * scale;
    this.register -= scaled;
    if (z < f - 1) this.modulus = scale;
    else this.modulus -= scaled;
    return z;
  }
}

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/**
 * One adaptive arithmetic symbol coder.
 *
 * Symbols are learned as they appear. `LS` holds the learned symbol values,
 * `LSW` their recent frequencies and `SW` the cumulative spans those
 * frequencies map to along [0, 1). Index 0 is the ESCAPE symbol, which means
 * "the symbol is not in the active alphabet" and leads either to the
 * probationary symbols (learned since the last renormalization, all equally
 * likely) or to a raw read of a brand-new one.
 */
class SymbolCoder {
  private readonly symbols: Int32Array;
  private readonly spans: Int32Array;
  private readonly weights: Int32Array;
  /** Total weight, and the thresholds that trigger renormalizing and decay. */
  private total = 4;
  private nextRenormalize = 8;
  private readonly decayThreshold: number;
  private readonly renormalizeInterval: number;
  private rapidInterval = 4;
  /** Highest learned index, and what it was at the last renormalization. */
  private highest = 0;
  private highestAtRenormalize = 0;
  private readonly uniqueSymbols: number;

  constructor(alphabetSize: number, uniqueSymbols: number) {
    this.uniqueSymbols = uniqueSymbols;
    const size = alphabetSize + 2;
    this.symbols = new Int32Array(size);
    this.weights = new Int32Array(size);
    this.spans = new Int32Array(size).fill(ONE);
    this.spans[0] = 0;
    this.weights[0] = 4;
    this.decayThreshold = Math.max(256, Math.min((alphabetSize - 1) * 32, 15160));
    // max(128, min(...)) and NOT a clamp: the two differ exactly when the upper
    // bound falls below 128, which happens for the four-symbol byte-offset
    // coder — decayThreshold 256 puts its upper bound at 96, so a clamp yields
    // 96 where this yields 128. That coder runs on every match, so renormalizing
    // it a third too often drifts out of step with the encoder after a hundred
    // matches or so, and the stream decodes plausibly right up until it doesn't.
    this.renormalizeInterval = Math.max(128, Math.min((alphabetSize - 1) * 2, this.decayThreshold / 2 - 32));
  }

  /**
   * Age the alphabet: halve every weight, and drop symbols that have fallen to
   * nothing by swapping the highest-indexed one down into their place. The
   * heaviest symbol is moved to the end, where the escape path finds it first.
   */
  private decay(): void {
    const { weights, symbols } = this;
    weights[0] = Math.floor(weights[0]! / 2);
    this.total = weights[0]!;
    let heaviest = 0, heaviestAt = 0;
    for (let i = 1; i <= this.highest; i++) {
      while (weights[i]! <= 1) {
        if (i < this.highest) {
          weights[i] = weights[this.highest]!;
          weights[this.highest] = 0;
          symbols[i] = symbols[this.highest]!;
          this.highest--;
        } else {
          weights[i] = 0;
          this.highest--;
          break;
        }
      }
      weights[i] = Math.floor(weights[i]! / 2);
      this.total += weights[i]!;
      if (weights[i]! > heaviest) { heaviest = weights[i]!; heaviestAt = i; }
    }
    if (heaviest && heaviestAt !== this.highest) {
      const h = this.highest;
      [weights[h], weights[heaviestAt]] = [weights[heaviestAt]!, weights[h]!];
      [symbols[h], symbols[heaviestAt]] = [symbols[heaviestAt]!, symbols[h]!];
    }
    // Keep escaping possible while symbols remain unlearned.
    if (this.highest !== this.uniqueSymbols && weights[0] === 0) {
      weights[0] = 1;
      this.total += 1;
    }
  }

  /** Turn the accumulated frequencies into spans along [0, 1). */
  private renormalize(): void {
    const { weights, spans } = this;
    // Scaled by 0x20000 rather than 0x4000 and divided back down by 8: the
    // extra three bits are what keeps the integer division from collapsing
    // small weights to a zero-width span.
    const q = Math.floor(0x20000 / this.total);
    spans[0] = 0;
    let acc = Math.floor((weights[0]! * q) / 8);
    for (let i = 1; i <= this.highest; i++) {
      spans[i] = acc;
      acc += Math.floor((weights[i]! * q) / 8);
    }
    if (this.rapidInterval * 2 < this.renormalizeInterval) {
      this.rapidInterval *= 2;
      this.nextRenormalize = this.total + this.rapidInterval;
    } else {
      this.nextRenormalize = this.total + this.renormalizeInterval;
    }
    this.highestAtRenormalize = this.highest;
    spans.fill(ONE, this.highest + 1);
  }

  /**
   * Decode one symbol. `effectiveAlphabet` is how many values are possible
   * *here* — it can be smaller than the alphabet the coder was built with (the
   * offset coders narrow as the window fills), and it bounds the raw read that
   * learns a new symbol.
   */
  decode(bits: BitStream, effectiveAlphabet: number): number {
    if (this.total >= this.nextRenormalize) {
      if (this.total >= this.decayThreshold) this.decay();
      this.renormalize();
    }
    const z = bits.peek(ONE);
    const { spans, weights, symbols } = this;
    // Which symbol owns z. The spec scans up from 0; that is one comparison per
    // symbol per BYTE decoded, and with a 256-symbol alphabet it dominates
    // everything else — the library took minutes to walk. The spans are
    // cumulative and so sorted, and the symbol wanted is the last one whose
    // span starts at or below z, which a binary search finds in eight steps.
    let lo = 0, hi = this.highestAtRenormalize + 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (spans[mid]! <= z) lo = mid; else hi = mid - 1;
    }
    const i = lo;
    bits.consume(spans[i]!, spans[i + 1]! - spans[i]!, ONE);
    weights[i]!++;
    this.total++;
    if (i !== 0) return symbols[i]!;

    // Escape. A probationary symbol costs one bit plus its index; anything else
    // is a symbol never seen before, read out at full width.
    if (this.highest !== this.highestAtRenormalize && bits.get(2)) {
      const j = bits.get(this.highest - this.highestAtRenormalize) + this.highestAtRenormalize + 1;
      weights[j]! += 2;
      this.total += 2;
      return symbols[j]!;
    }
    this.highest++;
    symbols[this.highest] = bits.get(effectiveAlphabet);
    // Two rather than one, so a symbol just learned survives the next decay.
    weights[this.highest]! += 2;
    this.total += 2;
    if (this.highest === this.uniqueSymbols) {
      // Every symbol is known; escaping can never be needed again.
      this.total -= weights[0]!;
      weights[0] = 0;
    }
    return symbols[this.highest]!;
  }
}

/** Length code -> match length. Codes above 60 jump: there is no 62..127. */
const LENGTH_TABLE = ((): Int32Array => {
  const table = new Int32Array(65);
  for (let code = 1; code <= 60; code++) table[code] = code + 1;
  table[61] = 128;
  table[62] = 192;
  table[63] = 256;
  table[64] = 512;
  return table;
})();

/** Offsets are (1k * 1024) + (4b * 4) + 1b, so the byte part spans 1..4. */
const ONE_BYTE_ALPHABET = 4;

/**
 * Decompress one Oodle1 stream into `out` at `outStart`, stopping once
 * `length` bytes have been produced.
 *
 * @returns how far into the input the reader has got.
 */
export function decompressStream(
  bits: BitStream, header: OodleHeader, out: Uint8Array, start: number, length: number,
): number {
  const { literalAlphabetSize: literals, windowSize, uniqueLiterals, uniqueRepeatLengths } = header;

  // Literals are coded by output position mod 4 — a cheap stand-in for the
  // column of a table, and the reason a structure array compresses at all.
  const literalCoders = [0, 1, 2, 3].map(() => new SymbolCoder(literals, uniqueLiterals));
  // 65 length coders, chosen by the PREVIOUS length code, in four banks of 16.
  const lengthCoders: SymbolCoder[] = [];
  for (let bank = 0; bank < 4; bank++) {
    for (let j = 0; j < 16; j++) lengthCoders.push(new SymbolCoder(65, uniqueRepeatLengths[bank]!));
  }
  lengthCoders.push(new SymbolCoder(65, uniqueRepeatLengths[3]!));
  const byteOffsetCoder = new SymbolCoder(ONE_BYTE_ALPHABET, ONE_BYTE_ALPHABET);
  const quadAlphabet = Math.min(256, Math.floor(windowSize / 4) + 1);
  const quadOffsetCoders = Array.from({ length: 256 }, () => new SymbolCoder(quadAlphabet, quadAlphabet));
  const kiloAlphabet = Math.floor(windowSize / 1024) + 1;
  const kiloOffsetCoder = new SymbolCoder(kiloAlphabet, header.largest1KOffset + 1);

  // Counted from the start of THIS stream, not of the section. Granny runs the
  // compressor once per data-width run, so each run is its own LZ problem: its
  // own byte counter (which picks the literal coder), its own match window, and
  // no reaching back into the run before it. Only the bit reader is shared.
  // Measured — counting across the section decodes 40 of 68 sampled sections
  // and leaves the last stream as noise; counting per stream decodes 58 and
  // leaves readable text in 25 of them.
  // Counted from the start of THIS stream, not of the section: Granny builds a
  // fresh compressor per data-width run, so the counter that picks the literal
  // coder and bounds the offset alphabets starts at zero for each.
  //
  // The output buffer, though, is SHARED, and a match may reach back over the
  // boundary into the run before it. That is not a curiosity: it is how the
  // last run starts at all, since with its own counter at zero every offset
  // alphabet is one symbol wide and the only encodable offsets are 1 to 4 —
  // the last few bytes of the previous run. Twenty-two files in the library
  // open on exactly that match and decoded to noise until it was allowed.
  const end = length;
  let produced = 0;
  let lengthCode = 0;
  while (produced < end) {
    lengthCode = lengthCoders[lengthCode]!.decode(bits, 65);
    if (lengthCode === 0) {
      out[start + produced] = literalCoders[produced & 3]!.decode(bits, literals);
      produced++;
      continue;
    }
    const matchLength = LENGTH_TABLE[lengthCode]!;
    // Offsets can only reach back as far as there IS output, so the alphabets
    // narrow with the window rather than being fixed — which is also why the
    // encoder and decoder must agree on `produced` exactly.
    const reach = Math.min(windowSize, produced);
    const byte = byteOffsetCoder.decode(bits, ONE_BYTE_ALPHABET) + 1;
    const kilo = kiloOffsetCoder.decode(bits, Math.floor(reach / 1024) + 1);
    const quad = quadOffsetCoders[kilo]!.decode(bits, Math.min(256, Math.floor(reach / 4) + 1));
    const offset = kilo * 1024 + quad * 4 + byte;
    // Against the SECTION's start, not the stream's — see above.
    if (offset > start + produced) {
      throw new Error(`oodle: match at ${start + produced} reaches ${offset} back, before the section`);
    }
    // Copied one byte at a time on purpose: a match may overlap its own tail
    // (offset 1 repeating a byte is how runs are coded), so this cannot be a
    // block copy.
    let from = start + produced - offset;
    const stop = Math.min(produced + matchLength, end);
    for (let i = produced; i < stop; i++) out[start + i] = out[from++]!;
    produced = stop;
  }
  return bits.position;
}

/**
 * Decompress a whole GR2 section: three streams, one per data width, laid out
 * as three 12-byte headers and then their compressed bodies back to back.
 *
 * Granny splits a section by alignment — 32-bit fields first, then 16-bit, then
 * bytes — because like values compress together. `stop0` and `stop1` are where
 * those runs end in the DECOMPRESSED data, and they are the only record of how
 * long each stream is; a stream can be (and usually one is) empty.
 */
export function decompressSection(
  input: Uint8Array, offset: number, compressedSize: number, rawSize: number, stop0: number, stop1: number,
): Uint8Array {
  const headers = [0, 1, 2].map((i) => readOodleHeader(input, offset + i * 12));
  const lengths = [stop0, stop1 - stop0, rawSize - stop1];
  if (lengths.some((n) => n < 0) || stop1 > rawSize) {
    throw new Error(`oodle: section stops (${stop0}, ${stop1}) do not fit ${rawSize} bytes`);
  }
  const out = new Uint8Array(rawSize);
  // ONE bit reader across all three streams. The streams are not byte-aligned
  // blocks: the arithmetic coder never flushes between them, so a transition
  // lands mid-byte and only the symbol coders start fresh. Restarting the
  // reader at any byte boundary — measured, every offset within ±10 — decodes
  // to nothing.
  const bits = new BitStream(input, offset + 36);
  let written = 0;
  for (let i = 0; i < 3; i++) {
    const length = lengths[i]!;
    if (length === 0) continue;
    // One buffer for all three, so a run can quote the one before it.
    decompressStream(bits, headers[i]!, out, written, length);
    written += length;
    if (bits.position > offset + compressedSize + 8) {
      throw new Error(`oodle: stream ${i} read past the end of the section`);
    }
  }
  return out;
}
