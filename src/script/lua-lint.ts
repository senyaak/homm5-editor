// A linter for the game's Lua — the errors the engine's parser would reject.
//
// There is no compiler we can call: the game's Lua is 4.0-shaped (`%upvalue` in
// a nested function, `f{}` calls, no `#` operator), and no off-the-shelf parser
// reads that dialect — a Lua 5.x `load()` throws on `%func` before it sees a
// real mistake. So this checks the two things a parser fails a chunk on and that
// a person actually gets wrong: unbalanced blocks/brackets, and an unterminated
// string.
//
// The check is STRUCTURAL, not semantic, and that is on purpose. We could also
// flag "unknown function", but our API list (199 functions from the manuals) is
// admittedly partial — the shipped C1M1 script calls twelve engine functions we
// never extracted (`GiveExp`, `SetControlMode`, `StartCombat`…). Treating "not
// in the list" as an error would paint working code red, which is worse than
// saying nothing. Unknown names are handled separately, and only as a "did you
// mean" hint against a NEAR match, where the false-positive rate is ~0.
//
// The block rule is exact for this dialect, measured on the three shipped C1M1
// scripts (every balance is zero): a block is opened by `function`, `if` and
// `do`, and closed by `end` — `for`/`while` do not take an `end`, their `do`
// does; `repeat` is closed by `until`. See tools/test-lua-lint.ts.

export type LuaSeverity = 'error' | 'warning';

/** One diagnostic, positioned by document offset so an editor can underline it. */
export interface LuaDiagnostic {
  from: number;
  to: number;
  severity: LuaSeverity;
  message: string;
}

type TokKind = 'word' | 'punct' | 'string' | 'string-bad';
interface Tok { kind: TokKind; text: string; from: number; to: number }

/** The keywords that open or close a block or a string-free bracket. */
const OPENERS = new Set(['function', 'if', 'do']);

/**
 * Split Lua into tokens, with strings and comments swallowed whole.
 *
 * Only three things matter downstream — keywords, brackets and whether a string
 * closed — so a number, an operator and a name are all just "not a keyword": the
 * tokeniser keeps words (to test against keywords), single-char brackets, and
 * strings (flagged bad when they run off the end).
 */
function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  const n = src.length;
  let i = 0;
  const isWord = (c: string): boolean => /[A-Za-z0-9_]/.test(c);

  /** A long bracket `[==[ … ]==]` — used by long strings and long comments. */
  const longBracket = (start: number): number | null => {
    if (src[start] !== '[') return null;
    let j = start + 1;
    while (src[j] === '=') j++;
    if (src[j] !== '[') return null;
    const level = j - start - 1;
    const close = ']' + '='.repeat(level) + ']';
    const end = src.indexOf(close, j + 1);
    return end === -1 ? n : end + close.length;
  };

  while (i < n) {
    const c = src[i]!;
    // Comments — line, or a long `--[[ … ]]` block.
    if (c === '-' && src[i + 1] === '-') {
      const lb = src[i + 2] === '[' ? longBracket(i + 2) : null;
      if (lb !== null) { i = lb; continue; }
      i += 2;
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    // Long string `[[ … ]]` / `[=[ … ]=]`.
    if (c === '[' && (src[i + 1] === '[' || src[i + 1] === '=')) {
      const lb = longBracket(i);
      if (lb !== null) {
        const bad = lb === n && !src.slice(i).includes(']');
        toks.push({ kind: bad ? 'string-bad' : 'string', text: src.slice(i, lb), from: i, to: lb });
        i = lb; continue;
      }
    }
    // Short string, `"…"` or `'…'`.
    if (c === '"' || c === "'") {
      const from = i; i++;
      let closed = false;
      while (i < n) {
        const d = src[i]!;
        if (d === '\\') { i += 2; continue; }
        if (d === '\n') break;          // a short string does not cross a line
        if (d === c) { i++; closed = true; break; }
        i++;
      }
      toks.push({ kind: closed ? 'string' : 'string-bad', text: src.slice(from, i), from, to: i });
      continue;
    }
    // A word — keyword or name. Digits are allowed inside, so a number is a word
    // too, but a word carrying a digit can never equal a (letters-only) keyword.
    if (isWord(c)) {
      const from = i;
      while (i < n && isWord(src[i]!)) i++;
      toks.push({ kind: 'word', text: src.slice(from, i), from, to: i });
      continue;
    }
    // Brackets are the only punctuation the structural pass reads.
    if ('(){}[]'.includes(c)) {
      toks.push({ kind: 'punct', text: c, from: i, to: i + 1 });
    }
    i++;
  }
  return toks;
}

const CLOSE_OF: Record<string, string> = { '(': ')', '{': '}', '[': ']' };

/**
 * The structural diagnostics — what the engine's Lua parser rejects.
 *
 * Two stacks, walked once: brackets, and blocks. A close with no matching open
 * (or the wrong one) is reported where it is; anything still open at the end is
 * reported where it was opened, because "you forgot to close this" is most
 * useful pointing at the thing left open.
 */
export function luaDiagnostics(src: string): LuaDiagnostic[] {
  const out: LuaDiagnostic[] = [];
  const toks = tokenize(src);

  const brackets: { char: string; from: number }[] = [];
  const blocks: { word: string; from: number; to: number }[] = [];

  for (const t of toks) {
    if (t.kind === 'string-bad') {
      out.push({ from: t.from, to: Math.min(t.to, t.from + 40), severity: 'error', message: 'unterminated string' });
      continue;
    }
    if (t.kind === 'punct') {
      if (t.text === '(' || t.text === '{' || t.text === '[') {
        brackets.push({ char: t.text, from: t.from });
      } else {
        const open = brackets.pop();
        if (!open) {
          out.push({ from: t.from, to: t.to, severity: 'error', message: `unmatched '${t.text}'` });
        } else if (CLOSE_OF[open.char] !== t.text) {
          out.push({ from: t.from, to: t.to, severity: 'error', message: `'${t.text}' does not close '${open.char}'` });
        }
      }
      continue;
    }
    if (t.kind !== 'word') continue;
    if (OPENERS.has(t.text) || t.text === 'repeat') {
      blocks.push({ word: t.text, from: t.from, to: t.to });
    } else if (t.text === 'end') {
      const open = blocks.pop();
      if (!open || open.word === 'repeat') {
        if (open) blocks.push(open);   // `repeat` is closed by `until`, not `end`
        out.push({ from: t.from, to: t.to, severity: 'error', message: "unexpected 'end'" });
      }
    } else if (t.text === 'until') {
      const open = blocks.pop();
      if (!open || open.word !== 'repeat') {
        if (open) blocks.push(open);
        out.push({ from: t.from, to: t.to, severity: 'error', message: "'until' without 'repeat'" });
      }
    }
  }

  for (const b of brackets) {
    out.push({ from: b.from, to: b.from + 1, severity: 'error', message: `unclosed '${b.char}'` });
  }
  for (const b of blocks) {
    const what = b.word === 'repeat' ? "'repeat' without 'until'" : `'${b.word}' without matching 'end'`;
    out.push({ from: b.from, to: b.to, severity: 'error', message: what });
  }
  out.sort((a, b) => a.from - b.from);
  return out;
}

/** Lua's own globals a script may call without the map defining them. */
const LUA_BUILTINS = new Set([
  'print', 'type', 'tostring', 'tonumber', 'pairs', 'ipairs', 'next', 'error',
  'assert', 'pcall', 'setmetatable', 'getmetatable', 'rawget', 'rawset', 'select',
  'unpack', 'format', 'strlen', 'strsub', 'strfind', 'gsub', 'tinsert', 'tremove',
  'getn', 'random', 'floor', 'ceil', 'abs', 'mod', 'min', 'max', 'sqrt',
]);

/** Levenshtein, capped: we only care whether it is ≤ 2. */
function editDistance(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      cur.push(v);
      if (v < best) best = v;
    }
    if (best > cap) return cap + 1;   // whole row past the cap → no point going on
    prev = cur;
  }
  return prev[b.length]!;
}

/**
 * "Did you mean" warnings for a mistyped call — the ONLY name check we make.
 *
 * A bare unknown name is left alone: our API is partial, so an unknown with no
 * near match is most likely a real engine function we did not extract, and
 * flagging it would be the noise the structural check is careful to avoid. But
 * an unknown that sits one or two edits from a name we DO know is a typo far more
 * often than not — `SetObjectvieState` beside `SetObjectiveState` — and that is
 * worth a warning. Reported as a warning, never an error: even here we might be
 * wrong, and a wrong red mark is worse than a yellow one.
 */
export function luaNameWarnings(src: string, known: Iterable<string>): LuaDiagnostic[] {
  const knownSet = new Set(known);
  // No vocabulary, no opinion. The engine API is what "a real name" is measured
  // against; before it has loaded, the only names we know are the script's own,
  // and matching against those alone turns every engine call into a "did you
  // mean one of this file's functions?" — `sleep` "corrected" to a local
  // `tsleep`. So with nothing external to compare to, say nothing.
  if (knownSet.size === 0) return [];
  // The script's own functions and globals are "known" too.
  for (const m of src.matchAll(/\bfunction\s+([A-Za-z_][\w.:]*)/g)) knownSet.add(m[1]!.replace(/[.:].*$/, ''));
  for (const m of src.matchAll(/^\s*([A-Za-z_]\w*)\s*=/gm)) knownSet.add(m[1]!);

  const out: LuaDiagnostic[] = [];
  const seen = new Set<string>();
  // A call: a name at the start of a word boundary, then `(` or `{`. A field or
  // method call (`a.b(`, `a:b(`) is skipped — its name is not a global.
  const re = /([.:]?)\b([A-Za-z_]\w*)\s*[({]/g;
  for (const m of src.matchAll(re)) {
    const [, dot, name] = m;
    if (dot || !name || name.length < 5) continue;
    if (knownSet.has(name) || LUA_BUILTINS.has(name)) continue;
    const at = m.index! + m[0].indexOf(name);
    let near: string | null = null;
    for (const k of knownSet) {
      if (Math.abs(k.length - name.length) > 2) continue;
      if (editDistance(name, k, 2) <= 2) { near = k; break; }
    }
    if (!near) continue;             // unknown with no near match → probably real
    const dupe = `${at}:${name}`;
    if (seen.has(dupe)) continue;
    seen.add(dupe);
    out.push({ from: at, to: at + name.length, severity: 'warning', message: `unknown '${name}' — did you mean '${near}'?` });
  }
  return out;
}
