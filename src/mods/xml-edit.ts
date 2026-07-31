// Editing the game's own XML as TEXT, not as a tree.
//
// A mod replaces a file whole, so the copy it ships should differ from the
// original in exactly the lines that were meant to change: reserialising a
// parsed document rewrites entity escapes, attribute order and whitespace
// across a 40k-line types.xml, and a diff of that tells nobody anything.
//
// Hence these: find one anchor, insert beside it at the anchor's own
// indentation, or bump a single number. Every one of them THROWS when the
// anchor is not found exactly once — a patch that silently did nothing is how
// a mod ends up half-applied and the game stops at startup with a message
// about a different file entirely.


/** The game's files are CRLF throughout; matching that keeps diffs readable. */
export const EOL = '\r\n';

// --- text surgery -------------------------------------------------------------
//
// These documents are serialized structs whose field order is part of the format,
// and the game's own editor writes them with tabs and CRLF. Splicing lines keeps
// every byte we did not mean to touch, which a reserialize would not.

/** Locate `needle`, insisting it appears exactly once. An anchor that moved is a bug. */
export function once(text: string, needle: string, what: string): number {
  const i = text.indexOf(needle);
  if (i < 0) throw new Error(`${what}: anchor missing — ${needle}`);
  if (text.indexOf(needle, i + 1) >= 0) throw new Error(`${what}: anchor appears twice — ${needle}`);
  return i;
}

/** The whitespace the line containing `at` begins with. */
export function indentOf(text: string, at: number): string {
  const start = text.lastIndexOf('\n', at) + 1;
  return /^[\t ]*/.exec(text.slice(start, at))![0];
}

/** Insert `lines` after the line `at` falls on, indented to match it. */
export function insertAfterLine(text: string, at: number, lines: string[]): string {
  const indent = indentOf(text, at);
  const eol = text.indexOf('\n', at);
  if (eol < 0) throw new Error('anchor is on the last line');
  return `${text.slice(0, eol + 1)}${lines.map((l) => indent + l).join(EOL)}${EOL}${text.slice(eol + 1)}`;
}

/** Insert `lines` before the line `at` falls on, indented one level deeper. */
export function insertBeforeLine(text: string, at: number, lines: string[]): string {
  const start = text.lastIndexOf('\n', at) + 1;
  const indent = `${indentOf(text, at)}\t`;
  return `${text.slice(0, start)}${lines.map((l) => indent + l).join(EOL)}${EOL}${text.slice(start)}`;
}

/**
 * Retune a number, matching the whole element so its value is part of the anchor.
 * Both sites sit inside a nesting that repeats the tag — `ref_table_num_objs`
 * holds its number in a `<Data>` inside a `<Data>` — so "the next `<Data>`" is
 * the wrong thing to look for and "the next `<Data>180</Data>`" is the right one.
 */
export function retune(text: string, from: number, tag: string, expect: number, to: number, what: string): string {
  const needle = `<${tag}>${expect}</${tag}>`;
  const i = text.indexOf(needle, from);
  if (i < 0) throw new Error(`${what}: no ${needle} after offset ${from}`);
  return `${text.slice(0, i)}<${tag}>${to}</${tag}>${text.slice(i + needle.length)}`;
}

/** An element's `href`, as written. */
export function hrefOf(text: string, field: string): string | null {
  return new RegExp(`<${field}\\s+href="([^"]*)"`).exec(text)?.[1] ?? null;
}

/** Replace one, whether it was written with an href or as an empty element. */
export function setHref(text: string, field: string, value: string, what: string): string {
  const re = new RegExp(`<${field}(?:\\s+[^>]*?)?/>`);
  if (!re.test(text)) throw new Error(`${what}: no <${field}/> to point at ${value}`);
  return text.replace(re, `<${field} href="${value}"/>`);
}

export function count(text: string, re: RegExp): number {
  return [...text.matchAll(re)].length;
}
