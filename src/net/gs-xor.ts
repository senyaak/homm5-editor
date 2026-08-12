// The obfuscation every plain GS message body wears.
//
// Two steps, and neither is encryption: each byte is XORed with its own index
// (`i - 119`), then the bytes are written into a square diagonal-by-diagonal and
// read back row by row. There is no key — anybody who knows the shuffle reads
// the message — so this exists to stop a packet sniffer from showing readable
// text, nothing more. The encrypted variant of a message body uses Blowfish with
// a negotiated key instead; that is a separate thing (PROPERTY.GS_ENCRYPT).
//
// The square is why the transform is not its own inverse and why the two
// directions look so different: writing runs along anti-diagonals, reading runs
// along rows, and the cells a short body never fills are skipped by a sentinel.
//
// Ported from michal-kapala's Python implementation (MIT), which is where the
// algorithm was first written down — see docs/NETWORK.md.

/** Side of the square that holds `size` bytes. */
function squareSide(size: number): number {
  let side = Math.floor(Math.sqrt(size));
  if (side * side < size) side++;
  return side;
}

export function encrypt(input: Uint8Array): Buffer {
  const size = input.length;
  const result = Buffer.from(input);
  for (let i = 0; i < size; i++) result[i]! ^= (i - 119) & 0xff;

  const side = squareSide(size);
  // -1 marks a cell no byte landed in, so the read-back can skip it. That is
  // also why this holds i16 and not bytes: 0xff is a legal byte value.
  const square = new Int16Array(side * side).fill(-1);
  let a = 0;
  let b = 0;
  for (let i = 0; i < size; i++) {
    if (a < side) {
      if (b < 0) {
        b = a;
        a = 0;
      }
    } else {
      a = b + 2;
      b = side - 1;
    }
    square[a + side * b] = result[i]!;
    a++;
    b--;
  }

  let idx = 0;
  for (let row = 0; row < side; row++) {
    for (let col = 0; col < side; col++) {
      const cell = square[col + side * row]!;
      if (cell !== -1) result[idx++] = cell;
    }
  }
  return result;
}

export function decrypt(input: Uint8Array): Buffer {
  const size = input.length;
  const result = Buffer.from(input);
  const side = squareSide(size);
  const square = new Int16Array(side * side);

  // First walk the anti-diagonals again, marking which cells were used.
  let a = 0;
  let b = 0;
  for (let left = size; left > 0; left--) {
    if (b < side) {
      if (a < 0) {
        a = b;
        b = 0;
      }
    } else {
      b = a + 2;
      a = side - 1;
    }
    square[b + side * a] = 1;
    a--;
    b++;
  }

  // Then fill those cells row by row, in the order the bytes arrived.
  let col = 0;
  let taken = 0;
  let rowStart = 0;
  while (taken < size) {
    if (col >= side) {
      rowStart += side;
      col = 0;
    }
    if (square[rowStart + col]! > 0) square[rowStart + col] = input[taken++]!;
    col++;
  }

  // And read them back along the diagonals, which undoes the shuffle.
  let e = 0;
  let f = 0;
  for (let i = 0; i < size; i++) {
    if (f < side) {
      if (e < 0) {
        e = f;
        f = 0;
      }
    } else {
      f = e + 2;
      e = side - 1;
    }
    result[i] = square[f + side * e]!;
    e--;
    f++;
  }

  for (let i = 0; i < size; i++) result[i]! ^= (i - 119) & 0xff;
  return result;
}
