// WHICH SHAPE of nested `return` the game's own scripts actually use.
//
//   node tools/nested-returns.ts
//
// THE EVIDENCE BEHIND A LINTER RULE, kept because the rule is unusual enough to
// be doubted later. `if c then return f(); end` runs the call and then falls
// through in this engine's Lua — measured in game, and it cost the training
// spell days: its rule reached its own last line and then the statement after
// the `if` ran as well, so the caller got a value the rule never chose.
//
// "The game does it 108 times" was the answer that nearly closed the case, and
// it was the wrong count: `if c then return X; end` on one line and a `then`
// block ending in `return f()` are different things to a compiler. Counted
// apart, the shipped scripts return a VALUE from a nested block 65 times and the
// result of a CALL zero times. That zero is the rule.
import { readFileSync, globSync } from 'node:fs';

const shapes = {
  'one line, returns a value':        0,
  'one line, returns a CALL':         0,
  'multi-statement then, ends return': 0,
  'multi-statement then, ends return of a CALL': 0,
};
const examples: Record<string, string[]> = {};

for (const file of globSync('data-unpacked/**/*.lua')) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.replace(/--.*$/, '').trim());
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const oneLiner = /^if\b.*\bthen\b\s*return\b(.*)$/.exec(line);
    if (oneLiner && /\bend\b/.test(line)) {
      const what = oneLiner[1]!.replace(/;?\s*end;?\s*$/, '').trim();
      const key = /\w+\s*\(/.test(what) ? 'one line, returns a CALL' : 'one line, returns a value';
      shapes[key as keyof typeof shapes]++;
      (examples[key] ??= []).length < 3 && examples[key]!.push(`${file.split(/[\/]/).pop()}: ${line}`);
      continue;
    }
    // `if ... then` opening a block, with a `return` as the block's last statement
    if (!/^if\b.*\bthen\s*$/.test(line)) continue;
    let j = i + 1, body: string[] = [];
    while (j < lines.length && !/^(end|else|elseif)\b/.test(lines[j]!)) { if (lines[j]) body.push(lines[j]!); j++; }
    if (body.length < 2) continue;
    const last = body[body.length - 1]!;
    if (!/^return\b/.test(last)) continue;
    const what = last.replace(/^return\s*/, '').replace(/;\s*$/, '');
    const key = /\w+\s*\(/.test(what)
      ? 'multi-statement then, ends return of a CALL' : 'multi-statement then, ends return';
    shapes[key as keyof typeof shapes]++;
    (examples[key] ??= []).length < 3 && examples[key]!.push(`${file.split(/[\/]/).pop()}: ${body.join(' | ')}`);
  }
}

for (const [key, n] of Object.entries(shapes)) {
  console.log(`${String(n).padStart(4)}  ${key}`);
  for (const e of examples[key] ?? []) console.log(`        ${e}`);
}
