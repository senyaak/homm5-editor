// The changelog's entries (tools/changelog.ts): every file under changes/ is
// one well-formed entry, and a cut folds them in newest first above what
// Unreleased already held, leaving a fresh Unreleased with only the pointer.

import { cut, entryProblem, POINTER, readEntries, UNRELEASED } from './changelog.ts';

let failures = 0;
const check = (ok: boolean, what: string): void => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures++;
};

// The repo's own entries.
for (const e of readEntries()) {
  const problem = entryProblem(e.text);
  check(problem === null, `${e.file}${problem ? `: ${problem}` : ' is one entry'}`);
}

// The shape rules.
check(entryProblem('- One entry\n  that wraps.\n') === null, 'a wrapped entry is fine');
check(entryProblem('One entry\n') !== null, 'an entry must start with "- "');
check(entryProblem('- one\n- two\n') !== null, 'two entries in one file are refused');
check(entryProblem('- one\n## Heading\n') !== null, 'a heading in an entry is refused');

// A cut.
const before = [
  '# Changelog', '', 'Intro.', '',
  UNRELEASED, '', POINTER, '',
  '- Old entry written before the split.', '',
  '## 0.11.0 — 2026-09-16', '', '- Shipped.', '',
].join('\r\n');
const after = cut(before, [
  { file: 'changes/2-b.md', text: '- Second, committed later.\n', added: 200 },
  { file: 'changes/1-a.md', text: '- First, committed earlier.\n  Wrapped.\n', added: 100 },
  { file: 'changes/3-c.md', text: '- Not committed yet.\n', added: null },
], '0.12.0', '2026-11-02');
const lines = after.split('\r\n');
const ver = lines.indexOf('## 0.12.0 — 2026-11-02');
const old = lines.indexOf('## 0.11.0 — 2026-09-16');
check(after.includes('\r\n') && !/[^\r]\n/.test(after), 'the file keeps its CRLF');
check(lines.indexOf(UNRELEASED) < ver && ver < old, 'the new version sits between Unreleased and the last one');
check(lines.slice(lines.indexOf(UNRELEASED) + 1, ver).filter((l) => l).join('|') === POINTER, 'Unreleased keeps only the pointer');
const body = lines.slice(ver + 1, old).filter((l) => l);
check(body.join('|') === [
  '- Not committed yet.', '- Second, committed later.', '- First, committed earlier.', '  Wrapped.',
  '- Old entry written before the split.',
].join('|'), `newest first, then what Unreleased held (${body.join(' / ')})`);
let threw = false;
try { cut([UNRELEASED, '', POINTER, '', '## 0.1 — x'].join('\n'), [], '0.2', 'y'); } catch { threw = true; }
check(threw, 'a cut with nothing to release refuses');

if (failures) {
  console.log(`\ntest-changelog: ${failures} failure(s)`);
  process.exit(1);
}
console.log('\ntest-changelog: all good');
