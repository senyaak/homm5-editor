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

/** The dialect's own words, so `return nil` is not read as a call to `nil`. */
const KEYWORDS = new Set([
  'and', 'do', 'else', 'elseif', 'end', 'for', 'function', 'if', 'in', 'local',
  'nil', 'not', 'or', 'repeat', 'return', 'then', 'until', 'while',
]);

/**
 * `return;` — a semicolon straight after `return` — and why it earns a rule.
 *
 * Lua 4 does not take it. Lua 5 does, every modern reference shows it, and the
 * line looks like every other statement — which is why it cost a day. The game's
 * own console named it, dead on:
 *
 *     (Script) ERROR: expected;   last token read: `;' at line 2
 *
 * The whole FILE fails to compile, not the function. And while our battle code
 * sat inside the game's `combat-startup.lua`, it took every declaration in that
 * file with it — `IsAttacker`, `UnitDeath`, the aliases — so the game's own
 * battle scripting was quietly broken by a mod, and it looked like anything
 * except a misplaced semicolon. Write `return` bare, and last in its block.
 */
const RETURN_SEMICOLON =
  "';' after 'return' — Lua 4 rejects the whole file; write a bare `return`";

/**
 * Separators inside a table constructor — the second rule the game taught us.
 *
 * Lua 4's constructor grammar allows ONE `;`, separating the list part from
 * the record part — `{ PATH.."file.txt"; cost=COST }` is a shipped idiom — and
 * no trailing `;`. The pandora block died on exactly this:
 *
 *     (Script) ERROR: invalid constructor syntax;
 *     last token read: `}' at line 13 in string "DoString script"
 *
 * A `;` after the last field asks the parser for a record part, `}` arrives
 * instead, and the whole DoString fails — with every Trigger in the file
 * unbound, which plays as objects that silently do nothing.
 *
 * A TRAILING COMMA IS FINE, and this rule used to say otherwise — reading the
 * game's failure as being about separators in general when it was about the
 * semicolon alone. C1M1's own script is the counter-example, and it is the
 * tutorial mission, so it certainly parses:
 *
 *     { "c1_m1_t3_2", REGION_ENTER_AND_STOP_TRIGGER, "cam1", ..., 0 },
 *     --{ "c1_m1_t11_1", COMBAT, 0, 0, 0 },
 *     }
 *
 * Flagging it made the linter refuse a form the engine accepts, and the suite
 * that lints the shipped scripts said so — which is why it lints them.
 */
const TABLE_TRAILING =
  "a ';' straight before '}' — Lua 4 asks for a record part and finds none, and the whole file fails";
const TABLE_SECOND_SEMI =
  "a second ';' in one constructor — Lua 4 allows exactly one, splitting the list part from the record part; use ','";

/**
 * `if c then return f(); end` — returning the RESULT OF A CALL from inside a
 * nested block, which this engine's Lua does not carry out.
 *
 * MEASURED, in the game, and it cost days. The call happens and the block does
 * not end: a run of the training spell showed its rule reaching its own last
 * line — the kind and the count both written down, the army printed — and then
 * the statement AFTER the `if` running as well. So the value the caller received
 * was never the rule's answer; it was whatever the second `return` left behind,
 * and it read as yes every time. A spell page stayed live over an army with
 * nothing to train, and clicking it did nothing, because the rule inside was
 * refusing honestly all along.
 *
 * THE GAME'S OWN SCRIPTS ARE THE SPECIFICATION and they are unambiguous: across
 * 47 shipped scripts and 1096 functions they return a VALUE from a nested block
 * 65 times and the result of a CALL exactly never. `tools/nested-returns.ts`
 * counts it.
 *
 * Put the call in the CONDITION (`if f() == nil then return nil; end`) or in a
 * local, and give the function one exit.
 */
const RETURN_CALL_NESTED =
  'returning a call\'s result from inside a block — this Lua runs the call and then '
  + 'falls through; assign it to a local and return once, at the end of the function';


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
    // Brackets and the separators: the rules below need to know whether a `;`
    // follows a `return`, and what separates fields inside a constructor. By
    // here comments and strings are already swallowed, so no match is false.
    if ('(){}[];,'.includes(c)) {
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

  const brackets: { char: string; from: number; blocksAt: number; semis: number }[] = [];
  const blocks: { word: string; from: number; to: number }[] = [];

  for (let at = 0; at < toks.length; at++) {
    const t = toks[at]!;
    if (t.kind === 'string-bad') {
      out.push({ from: t.from, to: Math.min(t.to, t.from + 40), severity: 'error', message: 'unterminated string' });
      continue;
    }
    if (t.kind === 'punct') {
      if (t.text === ';' || t.text === ',') {
        // Inside a constructor — the top bracket is `{` and no function body
        // has opened since — Lua 4's separator rules apply (see above). A
        // separator anywhere else is a statement's business and not ours.
        const top = brackets[brackets.length - 1];
        if (top && top.char === '{' && blocks.length === top.blocksAt) {
          const next = toks[at + 1];
          if (t.text === ';' && next && next.kind === 'punct' && next.text === '}') {
            out.push({ from: t.from, to: t.to, severity: 'error', message: TABLE_TRAILING });
          } else if (t.text === ';') {
            if (top.semis > 0) out.push({ from: t.from, to: t.to, severity: 'error', message: TABLE_SECOND_SEMI });
            top.semis++;
          }
        }
        continue;
      }
      if (t.text === '(' || t.text === '{' || t.text === '[') {
        brackets.push({ char: t.text, from: t.from, blocksAt: blocks.length, semis: 0 });
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
    // `false` IS NOT A WORD IN THIS LUA, and `true` is — which is the sort of
    // asymmetry nobody guesses. The engine said so in red, twice a line:
    //
    //     [Script warning!] Value was NIL when getting global with name 'false'
    //
    // and what it does is worse than the warning. `x == false` reads a global
    // that does not exist, so it means `x == nil` — the opposite of what it
    // says wherever the value being tested is a number. That is what made the
    // Pandora box open without asking: every human was answered "not a human".
    // Write nil and 1, the way the shipped scripts do.
    if (t.text === 'false') {
      out.push({
        from: t.from, to: t.to, severity: 'error',
        message: "'false' does not exist in this Lua — it reads as nil, so `x == false` means `x == nil`; use nil",
      });
    }
    // A name this engine does not have, called as a function.
    if (ABSENT_BUILTINS.has(t.text)) {
      const next = toks[at + 1];
      if (next && next.kind === 'punct' && (next.text === '(' || next.text === '{')) {
        out.push({
          from: t.from, to: t.to, severity: 'warning',
          message: `the game registers no Lua standard library — '${t.text}' does not exist here`,
        });
      }
    }
    if (t.text === 'return') {
      const next = toks[at + 1];
      if (next && next.kind === 'punct' && next.text === ';') {
        out.push({ from: t.from, to: next.to, severity: 'error', message: RETURN_SEMICOLON });
      }
      // `return f()` is only safe as the function's OWN last statement, so the
      // innermost open block has to be the function itself.
      const after = toks[at + 2];
      const callsSomething = next?.kind === 'word' && !KEYWORDS.has(next.text)
        && after?.kind === 'punct' && (after.text === '(' || after.text === '{');
      const inner = blocks[blocks.length - 1];
      if (callsSomething && inner && inner.word !== 'function') {
        out.push({ from: t.from, to: after!.to, severity: 'error', message: RETURN_CALL_NESTED });
      }
    }
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

/**
 * Lua's own globals a script may call without the map defining them.
 *
 * SHORT, because this game registers almost none of the standard library. Every
 * name here was found as a string in the executable; the ones that are NOT there
 * are in ABSENT_BUILTINS below, and calling one of those is a certain failure
 * rather than a maybe.
 */
const LUA_BUILTINS = new Set([
  // Called by the game's own shipped scripts, or measured in a run of ours —
  // evidence rather than inference.
  'print', 'abs', 'sqrt', 'random', 'length', 'floor',
  // Only the executable's strings say these exist, which is exactly what was
  // said about `type` and `format` before each failed in game. They stay here
  // because we have no evidence AGAINST them either; if a script dies on one,
  // move it down and write the date next to it.
  'next', 'error', 'sort', 'ceil', 'mod', 'min', 'max', 'getglobal', 'setglobal',
]);

/**
 * And the ones this engine does NOT have, though every Lua reference lists them.
 *
 * Read out of the executable: a function Lua can call must exist there as a
 * string, and not one of these does. So `tinsert(t, v)` is not a portability
 * question — it is a call to nil, and the handler dies where it stands.
 *
 * `dofile` earns its place twice over: the engine's own is `doFile`, capital F,
 * and the lowercase spelling every Lua tutorial uses silently does nothing.
 *
 * `type` AND `format` ARE HERE BECAUSE THE GAME SAID SO, 07.08.2026: "Value was
 * NIL when getting global with name 'type'", and an hour later the same about
 * `format`, from a script building a file path. Both were on the ALLOWED list,
 * both for the same reason — the string is in the executable — which turns out
 * to prove only that something MENTIONS the name, not that Lua can call it.
 * Two measurements against one inference; the inference lost.
 */
const ABSENT_BUILTINS = new Set([
  'type', 'format',
  'tinsert', 'tremove', 'getn', 'setn', 'foreach', 'foreachi',
  'tostring', 'tonumber', 'strfind', 'strsub', 'strlen', 'gsub',
  'rawget', 'rawset', 'pairs', 'ipairs', 'pcall', 'assert', 'unpack',
  'setmetatable', 'dofile',
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
