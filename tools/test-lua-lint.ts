// The Lua linter: structural errors are caught, real scripts stay clean.
//
//   node tools/test-lua-lint.ts
//
// The load-bearing case is the last one: the three shipped C1M1 scripts must
// report ZERO diagnostics. A linter that flags working code is worse than none,
// and the whole design (structural only, no "unknown function" errors) exists to
// make that true — so the test that would catch a regression is a real script.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { luaDiagnostics, luaNameWarnings } from '../src/script/lua-lint.ts';

let bad = 0;
const ok = (cond: boolean, msg: string): void => {
  console.log(`${cond ? '  ok  ' : '  FAIL'} ${msg}`);
  if (!cond) bad++;
};

/** The messages a source produces, for asserting the shape of a diagnostic. */
const msgs = (src: string): string[] => luaDiagnostics(src).map((d) => d.message);
const clean = (src: string): boolean => luaDiagnostics(src).length === 0;

console.log('=== clean code produces nothing ===');
ok(clean('function f() return 1 end'), 'a whole function');
ok(clean('if x then y() end'), 'if/then/end');
ok(clean('for i=1,10 do print(i) end'), "for's `do` pairs with `end`, `for` takes no `end`");
ok(clean('while 1 do sleep(1) end'), 'while/do/end');
ok(clean('for i, v in t do end'), 'generic for');
ok(clean('do local x = 1 end'), 'a bare do-block');
ok(clean('repeat sleep(1) until done'), 'repeat/until takes no end');
ok(clean('t = { {1}, {2}, {a=3} }'), 'nested table braces');
ok(clean('newfunc = function() %func( %p1 ) end'), '4.0 %upvalue and anonymous function');
ok(clean('s = "a string with ) and end and } inside"'), 'brackets and keywords inside a string are ignored');
ok(clean('-- if without end in a comment\nx = 1'), 'a keyword in a comment is ignored');
ok(clean('x = [[ a long string ] with ) brackets ]]'), 'a long string is swallowed whole');
ok(clean('function f() if x then return end; y = 1 end'), 'a bare `return` inside an if is fine');

// The one that cost a day in game: Lua 5 takes `return;`, Lua 4 fails the whole
// FILE on it — and in a mod that file was the game's own combat-startup.lua, so
// every battle declaration in it went too. The game's console named the token.
console.log('=== a semicolon after return ===');
ok(msgs('function f() if x then return; end; y = 1 end').length === 1, "`return;` is an error");
ok(clean('-- return; in a comment\nx = 1'), 'not in a comment');
ok(clean('x = "return;"'), 'not in a string');

// And the one that cost this feature days: `if c then return f(); end`. The call
// runs and the block does NOT end, so the caller gets whatever the next return
// left behind — measured in game, with the rule reaching its own last line and
// then the statement after the `if` running too. The game's own 1096 functions
// return a value from a nested block 65 times and a CALL never.
console.log('\n=== returning a call from inside a block ===');
ok(msgs('function f() if c then return g(); end; return nil end').length === 1,
  'returning a call from inside an if is an error');
ok(clean('function f() if c then return nil; end; return g() end'),
  'the same call is fine as the function\'s own last statement');
ok(clean('function f() if g() == nil then return nil; end; return 1 end'),
  'and fine in the CONDITION, which is where it belongs');
ok(clean('function f() if c then return PLAYERFLT_1; end; return nil end'),
  'returning a VALUE from inside a block is what the game itself does');
ok(clean('function f() if c then return t[1]; end; return nil end'),
  'and an index is not a call');

// Separators inside a constructor, and the line between them is the engine's,
// not a style: a trailing `;` asks for a record part that never comes and the
// whole DoString dies (measured — it took the pandora block down with every
// trigger unbound), while a trailing `,` is something the shipped C1M1 script
// does and the tutorial mission certainly parses. This rule flagged both for a
// while, which made the linter refuse working code.
console.log('\n=== separators in a table constructor ===');
ok(msgs('x = { 1, 2; };').length === 1, "a trailing `;` is an error");
ok(clean('x = { 1, 2, };'), 'a trailing `,` is not');
ok(clean('x = { "f.txt"; cost = 5 };'), 'one `;` splits the list part from the record part');
ok(msgs('x = { 1; a = 2; b = 3 };').length === 1, 'a second `;` is an error');

// The engine registers almost no standard library — read out of the executable,
// where a callable name has to exist as a string and these do not. `dofile` is
// the sharpest: the engine's own is `doFile`, and the lowercase spelling every
// tutorial uses is a call to nil.
console.log('=== names this engine does not have ===');
ok(msgs('tinsert(t, 1)').length === 1, 'tinsert does not exist here');
ok(msgs('dofile("/scripts/x.lua")').length === 1, 'nor does lowercase dofile');
ok(clean('doFile("/scripts/x.lua")'), 'but doFile does');
ok(clean('x = pairs'), 'and a bare name that is never called is left alone');
// Both of these were ALLOWED until the game said otherwise, an hour apart, and
// both for the same bad reason: the name is a string in the executable.
ok(msgs('if type(x) == "table" then y() end').length === 1, 'nor `type`, said the game');
ok(msgs('QuestionBox(format("/a/%d.txt", n), "f", "")').length === 1, 'nor `format`, said the game');
ok(clean('local n = floor(gold / 300); print(abs(n))'), 'but the ones scripts really call pass');

console.log('\n=== the errors a parser would reject ===');
ok(msgs('function f() return 1').includes("'function' without matching 'end'"), 'a function with no end');
ok(msgs('if x then y()').includes("'if' without matching 'end'"), 'an if with no end');
ok(msgs('function f() end end').includes("unexpected 'end'"), 'one end too many');
ok(msgs('print( 1').includes("unclosed '('"), 'an unclosed paren');
ok(msgs('print 1 )').includes("unmatched ')'"), 'a stray close paren');
ok(msgs('x = ( 1 ]').some((m) => m.includes("does not close")), 'a bracket closed by the wrong kind');
ok(msgs('TutorialMessageBox( "c1_m1_t1 );').includes('unterminated string'), 'a string with no closing quote');
ok(msgs('repeat x() end').includes("'repeat' without 'until'"), "repeat is not closed by end");

console.log('\n=== positions point at the offending token ===');
{
  const src = 'a()\nb(';           // the second `(` at offset 5 is unclosed
  const d = luaDiagnostics(src);
  ok(d.length === 1 && d[0]!.from === 5, `unclosed paren located at 5 (got ${d[0]?.from})`);
}

console.log('\n=== "did you mean" — the only name check, and only on a near miss ===');
{
  const api = ['SetObjectiveState', 'GetObjectPosition', 'StartDialogScene'];
  const typo = luaNameWarnings('SetObjectvieState("prim1", 2)', api);
  ok(typo.length === 1 && /did you mean 'SetObjectiveState'/.test(typo[0]!.message), 'a transposed name is flagged');
  ok(typo[0]!.severity === 'warning', 'and only as a warning, never an error');
  // A real engine function we never extracted must NOT be flagged: no near match.
  ok(luaNameWarnings('GiveExp("Isabell", 500)', api).length === 0, 'an unknown with no near match is left alone');
  // A function the script defines itself is known.
  ok(luaNameWarnings('function Helper() end\nHelper()', api).length === 0, "the script's own functions are known");
  ok(luaNameWarnings('obj:GetPos()', api).length === 0, 'a method call is not a global');
  // Without a loaded API there is no vocabulary to judge against, so a core call
  // like `sleep` must not be "corrected" to a same-file `tsleep`.
  ok(luaNameWarnings('function tsleep() end\nsleep(1)', []).length === 0, 'no vocabulary → no warnings');
  ok(luaNameWarnings('sleep(1)', ['sleep', 'startThread']).length === 0, 'a known engine call is fine');
}

console.log('\n=== the shipped C1M1 scripts lint clean ===');
{
  const dir = '_tmp/fixtures/C1M1';
  const files = ['MapScript.lua', 'IsabellScript.lua', 'C1M1-CombatScript.lua'];
  if (!existsSync(join(dir, files[0]!))) {
    console.log('  skip  (no fixture — run `npm run extract-fixture C1M1`)');
  } else {
    for (const f of files) {
      const d = luaDiagnostics(readFileSync(join(dir, f), 'utf8'));
      ok(d.length === 0, `${f}: 0 diagnostics${d.length ? ` (got: ${d.map((x) => x.message).join('; ')})` : ''}`);
    }
  }
}

console.log(`\n${bad === 0 ? 'PASS' : `FAIL (${bad})`}`);
process.exit(bad === 0 ? 0 : 1);
