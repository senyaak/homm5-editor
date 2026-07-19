// Undo/redo, as byte differences between whole documents.
//
// The alternative was an inverse for every operation — move remembers its old
// position, sculpt its old heights, and so on. That is more code, and it is
// code that rots: every new edit has to remember to bring its own inverse, and
// the day one forgets, the mistake shows up as a corrupted map rather than as a
// missing feature. `addLayer` alone would need a structural inverse, since it
// splices the terrain container and moves every offset past the insert.
//
// So nothing here knows what an edit MEANS. An edit is "the documents looked
// like this, then they looked like that", and the difference is recorded as
// byte spans. Every operation is undoable by construction, including ones not
// written yet, and the recorded bytes are the same bytes that would be saved.
//
// The cost is that a patch has to be computed per edit, which means serializing
// the map and composing the terrain. Edits are discrete — a brush stroke
// commits once, on release — so this happens at human rates, not frame rates.

/** One contiguous stretch of a document that an edit replaced. */
export interface Span {
  at: number;
  before: Uint8Array;
  after: Uint8Array;
}

/** What one edit did to one document. */
export interface DocPatch {
  spans: Span[];
  /** Guards against applying a patch to a document it was not taken from. */
  lenBefore: number;
  lenAfter: number;
}

/**
 * Runs closer together than this are recorded as one span.
 *
 * A sculpt stroke changes scattered floats in the height plane, so a diff with
 * no coalescing produces a span per vertex and pays a per-span overhead that
 * dwarfs the four bytes it carries. Joining near neighbours trades a few
 * unchanged bytes for far fewer spans.
 */
const COALESCE = 64;

/**
 * Byte difference between two states of one document, or null when identical.
 *
 * Two shapes, because two things happen. A terrain edit rewrites values in
 * place, so the buffers are the same length and the changes are scattered —
 * that wants a scan for differing runs. A map edit inserts or deletes XML, so
 * everything after the edit shifts; a run scan would call the whole tail
 * different. There the common prefix and suffix bound one span, which is exact
 * for the single-region edits the map model makes.
 */
export function diff(before: Uint8Array, after: Uint8Array): DocPatch | null {
  const lenBefore = before.length, lenAfter = after.length;

  if (lenBefore !== lenAfter) {
    let head = 0;
    const max = Math.min(lenBefore, lenAfter);
    while (head < max && before[head] === after[head]) head++;
    let tail = 0;
    while (tail < max - head && before[lenBefore - 1 - tail] === after[lenAfter - 1 - tail]) tail++;
    return {
      spans: [{
        at: head,
        before: before.slice(head, lenBefore - tail),
        after: after.slice(head, lenAfter - tail),
      }],
      lenBefore, lenAfter,
    };
  }

  const spans: Span[] = [];
  let i = 0;
  while (i < lenBefore) {
    if (before[i] === after[i]) { i++; continue; }
    const start = i;
    let lastDiff = i;
    // Extend while differences keep coming within COALESCE of the last one.
    while (i < lenBefore && i - lastDiff <= COALESCE) {
      if (before[i] !== after[i]) lastDiff = i;
      i++;
    }
    const end = lastDiff + 1;
    spans.push({ at: start, before: before.slice(start, end), after: after.slice(start, end) });
    i = end;
  }
  return spans.length ? { spans, lenBefore, lenAfter } : null;
}

/**
 * Apply a patch, forwards or backwards.
 *
 * The length check is not paranoia: a patch is only meaningful against the
 * exact document it was taken from, and the failure mode of applying one to the
 * wrong document is a silently mangled map rather than an error.
 */
export function apply(doc: Uint8Array, patch: DocPatch, direction: 'redo' | 'undo'): Uint8Array {
  const from = direction === 'redo' ? 'before' : 'after';
  const to = direction === 'redo' ? 'after' : 'before';
  const expect = direction === 'redo' ? patch.lenBefore : patch.lenAfter;
  if (doc.length !== expect) {
    throw new Error(`patch does not fit: document is ${doc.length} bytes, patch expects ${expect}`);
  }
  // Right to left, so an earlier span's offsets are still valid after a later
  // one has changed the length.
  const out: Uint8Array[] = [];
  let cut = doc.length;
  for (let i = patch.spans.length - 1; i >= 0; i--) {
    const s = patch.spans[i]!;
    const end = s.at + s[from].length;
    out.unshift(doc.slice(end, cut));
    out.unshift(s[to]);
    cut = s.at;
  }
  out.unshift(doc.slice(0, cut));
  let size = 0;
  for (const part of out) size += part.length;
  const joined = new Uint8Array(size);
  let at = 0;
  for (const part of out) { joined.set(part, at); at += part.length; }
  return joined;
}

/** One undoable step: what it did to each document it touched. */
export interface Step {
  /** Shown in the UI, so "move object" rather than "object:move". */
  label: string;
  /** Patch per document key; the map is '' and a floor is its index. */
  docs: Record<string, DocPatch>;
}

/** Serializable form, for a history that outlives the process. */
interface StoredSpan { at: number; before: string; after: string }
interface StoredPatch { spans: StoredSpan[]; lenBefore: number; lenAfter: number }
export interface StoredStep { label: string; docs: Record<string, StoredPatch> }
export interface StoredHistory {
  /** Bumped when this file's shape changes, so an old one is dropped not misread. */
  version: number;
  /**
   * Hash of the documents as they stand at `at`.
   *
   * The point of persisting is to keep a history usable across restarts, and
   * the thing that makes it unusable is the files having moved on without us.
   * Comparing a hash is the whole check: match, and every patch still lines up;
   * differ, and the history is dropped rather than applied to bytes it was not
   * taken from.
   */
  hash: string;
  steps: StoredStep[];
  /** How many steps are done; steps past this are redoable. */
  at: number;
}

const b64 = (a: Uint8Array): string => Buffer.from(a).toString('base64');
const unb64 = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, 'base64'));

export function storeSteps(steps: Step[]): StoredStep[] {
  return steps.map((s) => ({
    label: s.label,
    docs: Object.fromEntries(Object.entries(s.docs).map(([k, p]) => [k, {
      lenBefore: p.lenBefore, lenAfter: p.lenAfter,
      spans: p.spans.map((x) => ({ at: x.at, before: b64(x.before), after: b64(x.after) })),
    }])),
  }));
}

export function loadSteps(stored: StoredStep[]): Step[] {
  return stored.map((s) => ({
    label: s.label,
    docs: Object.fromEntries(Object.entries(s.docs).map(([k, p]) => [k, {
      lenBefore: p.lenBefore, lenAfter: p.lenAfter,
      spans: p.spans.map((x) => ({ at: x.at, before: unb64(x.before), after: unb64(x.after) })),
    }])),
  }));
}

/**
 * A linear undo stack.
 *
 * Linear, not a tree: editing after undoing discards what was undone, which is
 * what every editor does and what anyone reaching for Ctrl+Z expects.
 */
export class History {
  private steps: Step[] = [];
  private at = 0;
  /** Beyond this, the oldest steps are dropped. */
  private readonly limit: number;

  constructor(limit = 200) { this.limit = limit; }

  get canUndo(): boolean { return this.at > 0; }
  get canRedo(): boolean { return this.at < this.steps.length; }
  get undoLabel(): string | null { return this.canUndo ? this.steps[this.at - 1]!.label : null; }
  get redoLabel(): string | null { return this.canRedo ? this.steps[this.at]!.label : null; }
  get depth(): number { return this.at; }

  push(step: Step): void {
    if (!Object.keys(step.docs).length) return; // an edit that changed nothing
    this.steps.length = this.at;                // a new edit discards the redo tail
    this.steps.push(step);
    if (this.steps.length > this.limit) this.steps.shift();
    this.at = this.steps.length;
  }

  /** The step to reverse, moving the cursor back. Null when there is none. */
  takeUndo(): Step | null {
    if (!this.canUndo) return null;
    this.at--;
    return this.steps[this.at]!;
  }

  /** The step to replay, moving the cursor forward. Null when there is none. */
  takeRedo(): Step | null {
    if (!this.canRedo) return null;
    const s = this.steps[this.at]!;
    this.at++;
    return s;
  }

  clear(): void { this.steps = []; this.at = 0; }

  save(hash: string): StoredHistory {
    return { version: 1, hash, steps: storeSteps(this.steps), at: this.at };
  }

  /** Adopt a stored history. Rejects one taken from different bytes. */
  restore(stored: StoredHistory, hash: string): boolean {
    if (stored.version !== 1 || stored.hash !== hash) return false;
    this.steps = loadSteps(stored.steps);
    this.at = Math.min(stored.at, this.steps.length);
    return true;
  }
}
