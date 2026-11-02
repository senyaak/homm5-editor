// No failure is swallowed: every catch in the app hands the error on, reports
// it through its layer's one reporter, or says in a comment why it is not one.
//
// A catch that drops an error turns a broken gesture into nothing at all: the
// window waits for a result that never comes, the person sees no message, and
// an e2e spec sits out its timeout instead of failing with the cause
// (docs/todo/e2e-fail-fast.md). A catch that only writes into a form's error
// line or a log is no better: seen by whoever looks there. So every `catch`
// clause and every `.catch(…)` in renderer/, electron/ and src/ is one of:
//
//   hands on   throws, calls reject(…), or returns / posts the caught error
//   reports    failed(…) / failing(…) (renderer/core/failure.ts),
//              mainFailed(…) (electron/failure.ts), noteFailure(…) (src/failure.ts)
//   marked     holds a comment `not a failure: <why>` — a probe whose "no" is
//              an answer, a clean-up of something that may already be gone
//
// and anything else is refused.
//
// `throw new UnknownFailure(…)` is the honest "not decided yet" (src/failure.ts):
// loud, but a place still to be looked at. Their number may only go down —
// UNKNOWN_AT_MOST is lowered as each gets a kind of its own, never raised.
//
//   node tools/test-silent-catches.ts           # the check, with its fixtures
//   node tools/test-silent-catches.ts --list    # every catch and its verdict

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DIRS = ['renderer', 'electron', 'src'];
const MARK = /not a failure:/;
/** Failures thrown as UnknownFailure: still to be given a kind. Only ever lowered. */
const UNKNOWN_AT_MOST = 32;

/** How many times a source text throws an UnknownFailure. */
export const unknownsIn = (src: string): number =>
  tokens(src).filter((t, k, all) => t.text === 'UnknownFailure' && all[k - 1]?.text === 'new').length;

interface Tok { kind: 'word' | 'punct' | 'str' | 'num' | 'regex' | 'comment'; text: string; line: number }

/**
 * TypeScript source as tokens, enough to find blocks: strings, templates
 * (with their `${}` holes), comments and regex literals are single tokens, so
 * a brace inside one never counts.
 */
export function tokens(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  let line = 1;
  // Template nesting: how many `{` deep each open `${` is.
  const holes: number[] = [];
  const push = (kind: Tok['kind'], from: number, to: number, at: number): void => {
    out.push({ kind, text: src.slice(from, to), line: at });
  };
  const regexMayStart = (): boolean => {
    for (let k = out.length - 1; k >= 0; k--) {
      const t = out[k]!;
      if (t.kind === 'comment') continue;
      if (t.kind === 'punct') return !/^[)\]}]$/.test(t.text);
      if (t.kind === 'word') return /^(return|typeof|case|do|else|in|of|new|delete|void|throw|yield|await)$/.test(t.text);
      return false;
    }
    return true;
  };
  const template = (start: number): number => {
    // From just after a backtick or a closing hole brace to the end of the
    // template, or to the start of the next hole.
    let j = start;
    while (j < src.length) {
      const c = src[j]!;
      if (c === '\\') { j += 2; continue; }
      if (c === '\n') line++;
      if (c === '`') return j + 1;
      if (c === '$' && src[j + 1] === '{') { holes.push(0); return j + 2; }
      j++;
    }
    return j;
  };
  while (i < src.length) {
    const c = src[i]!;
    const at = line;
    if (c === '\n') { line++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && src[i + 1] === '/') {
      const end = src.indexOf('\n', i);
      const to = end < 0 ? src.length : end;
      push('comment', i, to, at); i = to; continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const to = end < 0 ? src.length : end + 2;
      for (let k = i; k < to; k++) if (src[k] === '\n') line++;
      push('comment', i, to, at); i = to; continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      push('str', i, j + 1, at); i = j + 1; continue;
    }
    if (c === '`') { const to = template(i + 1); push('str', i, to, at); i = to; continue; }
    if (c === '}' && holes.length && holes[holes.length - 1] === 0) {
      holes.pop();
      const to = template(i + 1);
      push('str', i, to, at); i = to; continue;
    }
    if (c === '/' && regexMayStart()) {
      let j = i + 1;
      let cls = false;
      while (j < src.length && src[j] !== '\n') {
        const d = src[j]!;
        if (d === '\\') { j += 2; continue; }
        if (d === '[') cls = true;
        else if (d === ']') cls = false;
        else if (d === '/' && !cls) break;
        j++;
      }
      j++;
      while (j < src.length && /[a-z]/i.test(src[j]!)) j++;
      push('regex', i, j, at); i = j; continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1;
      while (j < src.length && /[\w$]/.test(src[j]!)) j++;
      push('word', i, j, at); i = j; continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i + 1;
      while (j < src.length && /[\w.]/.test(src[j]!)) j++;
      push('num', i, j, at); i = j; continue;
    }
    if (src.startsWith('=>', i) || src.startsWith('?.', i)) { push('punct', i, i + 2, at); i += 2; continue; }
    if (holes.length) {
      if (c === '{') holes[holes.length - 1]!++;
      if (c === '}') holes[holes.length - 1]!--;
    }
    push('punct', i, i + 1, at); i++;
  }
  return out;
}

/** The index of the token closing the bracket opened at `open`. */
function closing(toks: Tok[], open: number): number {
  const pair: Record<string, string> = { '(': ')', '{': '}', '[': ']' };
  const want = pair[toks[open]!.text]!;
  let depth = 0;
  for (let k = open; k < toks.length; k++) {
    const t = toks[k]!;
    if (t.kind !== 'punct') continue;
    if (t.text === toks[open]!.text) depth++;
    else if (t.text === want && --depth === 0) return k;
  }
  return toks.length - 1;
}

export type Verdict = 'hands on' | 'reports' | 'marked' | 'swallows';

export interface Catch { line: number; verdict: Verdict; shape: string }

const REPORTERS = /^(failed|failing|mainFailed|noteFailure)$/;

/** Is the word at `k` called: followed by `(`, or by `?.(`? */
const called = (code: Tok[], k: number): boolean =>
  code[k + 1]?.text === '(' || (code[k + 1]?.text === '?.' && code[k + 2]?.text === '(');

/**
 * What a handler does with the error. `code` is its body without comments,
 * `binding` the name the error was caught under, if any.
 */
function verdictOf(all: Tok[], binding: string | undefined): Verdict {
  if (all.some((x) => x.kind === 'comment' && MARK.test(x.text))) return 'marked';
  const code = all.filter((x) => x.kind !== 'comment');
  for (let k = 0; k < code.length; k++) {
    const w = code[k]!;
    if (w.kind !== 'word') continue;
    // throw, reject(…), or a handler the caller gave: opt.onError(…, e)
    if (w.text === 'throw' || ((w.text === 'reject' || /^on[A-Z]\w*$/.test(w.text)) && called(code, k))) return 'hands on';
    if (REPORTERS.test(w.text) && called(code, k)) return 'reports';
  }
  // The caught error itself, returned or posted to whoever waits on it.
  if (binding) {
    for (let k = 0; k < code.length; k++) {
      const w = code[k]!.text;
      if (w !== 'return' && w !== 'postMessage' && w !== 'resolve') continue;
      let depth = 0;
      for (let j = k + 1; j < code.length; j++) {
        const t = code[j]!.text;
        if (depth === 0 && (t === ';' || t === '}')) break;
        if (t === '(' || t === '{' || t === '[') depth++;
        if (t === ')' || t === '}' || t === ']') depth--;
        if (t === binding) return 'hands on';
      }
    }
  }
  return 'swallows';
}

const shapeOf = (toks: Tok[]): string => {
  const s = toks.filter((x) => x.kind !== 'comment').map((x) => x.text).join(' ');
  return s.length > 70 ? `${s.slice(0, 67)}...` : s;
};

/** Every catch in one source text, with what it does. */
export function catchesIn(src: string): Catch[] {
  const toks = tokens(src);
  const found: Catch[] = [];
  // A reporter kept under a name of its own — `const report = failing(…)` —
  // and then handed over by that name.
  const reporters = new Set<string>();
  for (let k = 0; k + 3 < toks.length; k++) {
    if (toks[k]!.text === 'const' && toks[k + 2]!.text === '=' && REPORTERS.test(toks[k + 3]!.text)) {
      reporters.add(toks[k + 1]!.text);
    }
  }
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k]!;
    if (t.kind !== 'word' || t.text !== 'catch') continue;
    const dotted = toks[k - 1]?.text === '.' || toks[k - 1]?.text === '?.';
    if (!dotted) {
      // catch (e) { ... } / catch { ... }
      let open = k + 1;
      let binding: string | undefined;
      if (toks[open]?.text === '(') {
        binding = toks[open + 1]?.kind === 'word' ? toks[open + 1]!.text : undefined;
        open = closing(toks, open) + 1;
      }
      if (toks[open]?.text !== '{') continue;
      const inner = toks.slice(open + 1, closing(toks, open));
      found.push({ line: t.line, verdict: verdictOf(inner, binding), shape: `catch { ${shapeOf(inner)} }` });
      continue;
    }
    // .catch(handler)
    const open = k + 1;
    if (toks[open]?.text !== '(') continue;
    const arg = toks.slice(open + 1, closing(toks, open));
    const code = arg.filter((x) => x.kind !== 'comment');
    let binding: string | undefined;
    const arrow = code.findIndex((x) => x.text === '=>');
    if (arrow > 0) binding = code[0]!.text === '(' ? code[1]?.text : code[0]!.text;
    // A function handed over by name: `.catch(reject)` hands on, a named
    // reporter reports.
    const only = code.length === 1 ? code[0]!.text : '';
    const named: Verdict | undefined = only === 'reject' ? 'hands on' : reporters.has(only) ? 'reports' : undefined;
    found.push({ line: t.line, verdict: named ?? verdictOf(arg, binding), shape: `.catch(${shapeOf(arg)})` });
  }
  return found;
}

// --- fixtures: the shapes refused, the shapes let through ---

function fixtures(): string[] {
  const bad: string[] = [];
  const expectVerdicts = (src: string, want: Verdict[], why: string): void => {
    const got = catchesIn(src).map((c) => c.verdict);
    if (got.join() !== want.join()) bad.push(`${why}: expected [${want}], got [${got}] in ${JSON.stringify(src)}`);
  };
  const S: Verdict = 'swallows';
  expectVerdicts('try { a(); } catch {}', [S], 'an empty catch');
  expectVerdicts('try { a(); } catch (e) { }', [S], 'an empty catch with a binding');
  expectVerdicts('try { a(); } catch { return null; }', [S], 'a bare fallback');
  expectVerdicts('for (;;) { try { a(); } catch { continue; } }', [S], 'a skip');
  expectVerdicts('try { a(); } catch (e) { console.error(e); }', [S], 'a log only');
  expectVerdicts("try { a(); } catch (e) { $('x-err').textContent = String(e); }", [S], 'an error line only');
  expectVerdicts('try { a(); } catch { return fallback(); }', [S], 'a fallback that hides the cause');
  expectVerdicts('void p().catch(() => {});', [S], 'a dropped promise');
  expectVerdicts('void p().catch((_e: unknown) => undefined);', [S], 'a typed dropped promise');
  expectVerdicts('p.catch((e) => console.warn(e));', [S], 'a promise logged only');
  expectVerdicts('try { a(); } catch { /* not a failure: may be gone */ }', ['marked'], 'a marked catch');
  expectVerdicts('p.catch(() => { /* not a failure: probe */ });', ['marked'], 'a marked promise');
  expectVerdicts('try { a(); } catch (e) { throw new Error(`x ${e}`); }', ['hands on'], 'a rethrow');
  expectVerdicts('new Promise((ok, reject) => p.then(ok).catch(reject));', ['hands on'], 'a promise handed on by name');
  expectVerdicts('try { a(); } catch (e) { reject(e); }', ['hands on'], 'a reject');
  expectVerdicts('try { a(); } catch (err) { n++; opt.onError?.(name, err); }', ['hands on'], "the caller's handler");
  expectVerdicts('try { a(); } catch (e) { return { error: msg(e) }; }', ['hands on'], 'the error returned as a value');
  expectVerdicts('try { a(); } catch (err) { postMessage({ id, err: String(err) }); }', ['hands on'], 'the error posted');
  expectVerdicts("try { a(); } catch (e) { failed('saving', e); }", ['reports'], 'a renderer report');
  expectVerdicts("void p().catch(failing('loading'));", ['reports'], 'a renderer report as a handler');
  expectVerdicts("try { a(); } catch (e) { mainFailed('watching', e); }", ['reports'], 'a main report');
  expectVerdicts("const report = failing('the list', 'x-err'); p.catch(report);", ['reports'], 'a named reporter');
  expectVerdicts('const report = (e) => show(e); p.catch(report);', [S], 'a named handler that is not a reporter');
  expectVerdicts("const s = 'catch {}'; const t = `a ${'catch {}'} b`; // catch {}", [], 'catch in strings and comments');
  expectVerdicts('const r = /catch \\{\\}/; try { a(); } catch {}', [S], 'a regex is not code');
  expectVerdicts('const s = `${a ? `${b}` : "}"}`; try { a(); } catch {}', [S], 'nested templates');
  expectVerdicts('x = a / b; y = c / d; try { a(); } catch {}', [S], 'division is not a regex');
  return bad;
}

function main(): void {
  const list = process.argv.includes('--list');
  const bad = fixtures();
  const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard', ...DIRS], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter((f) => /\.ts$/.test(f) && !/\.d\.ts$/.test(f));
  const count: Record<Verdict, number> = { 'hands on': 0, reports: 0, marked: 0, swallows: 0 };
  let unknowns = 0;
  for (const f of files) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    if (f !== 'src/failure.ts') unknowns += unknownsIn(src);
    for (const c of catchesIn(src)) {
      count[c.verdict]++;
      if (c.verdict === 'swallows' || list) console.log(`${c.verdict.padEnd(9)} ${f}:${c.line}  ${c.shape}`);
    }
  }
  if (unknownsIn('throw new UnknownFailure(a, e); x = UnknownFailure;') !== 1) bad.push('unknownsIn counts only the thrown ones');
  for (const b of bad) console.log(`FIXTURE ${b}`);
  console.log(`\n${files.length} files: ${count.swallows} swallow, ${count['hands on']} hand on, `
    + `${count.reports} report, ${count.marked} marked not a failure`);
  console.log(`${unknowns} UnknownFailure still to be given a kind (at most ${UNKNOWN_AT_MOST})`);
  let failed = bad.length > 0;
  if (count.swallows) {
    console.log('every catch hands the error on, reports it (failed / mainFailed / noteFailure), or holds `not a failure: <why>`');
    failed = true;
  }
  if (unknowns > UNKNOWN_AT_MOST) {
    console.log(`more UnknownFailure than ${UNKNOWN_AT_MOST}: a new failure gets a kind of its own, not "unknown"`);
    failed = true;
  }
  if (unknowns < UNKNOWN_AT_MOST) {
    console.log(`fewer UnknownFailure than ${UNKNOWN_AT_MOST}: lower UNKNOWN_AT_MOST to ${unknowns}`);
    failed = true;
  }
  if (failed) process.exit(1);
  console.log('all good');
}

main();
