// The one decision the e2e suite makes before it has any tests to look at.
//
// Playwright runs a global setup BEFORE collecting files, so `e2e/build.ts` has
// only the command line to read. From it, one question: could a MOD STAGE be in
// this run? Yes means putting the chain back to its start, which live means
// taking our authored content out of a player's installed mod and spending four
// minutes rebuilding it. Both answers are expensive to get wrong, in opposite
// directions:
//
//   said no, was yes  — the chain starts from last run's leftovers. mod-001
//                       fails on "the dialog opens clean" 93 specs from the end.
//                       This is what `e2e/` did: a folder mentions no stage by
//                       name, so the rule read it as a run about something else.
//   said yes, was no  — a run of one unrelated spec pays the reset, and the
//                       install is left with maps naming content no longer in
//                       the archive. The game loads them and dies.
//
// So the shapes an argument can take are checked here rather than found out in
// a six-minute run against somebody's install.
//
//   node tools/test-e2e-setup.ts

import { runHasModStages } from '../e2e/build.ts';

let failures = 0;
function check(name: string, ok: boolean): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}`);
  if (!ok) failures++;
}

const resets = (...argv: string[]): boolean => runHasModStages(argv);

// Nothing named is the whole suite, and the whole suite has the chain in it.
check('a run with no filter resets the chain', resets() === true);

// A FOLDER names everything under it. `e2e/` is every spec there is — the case
// that cost a live run, because the string mentions no stage.
check('the suite folder is the whole suite, not a narrowing', resets('e2e/') === true);
check('...with or without the slash', resets('e2e') === true);

// A folder that holds no stage is still a run about something else.
check('a folder with no stage under it does not', resets('e2e/c1m1/') === false);

// Named files: the rule that was always right.
check('a stage named by file resets', resets('e2e/mod-001-units-create.spec.ts') === true);
check('the stage folder resets', resets('e2e/mod-007-sharpshooter/') === true);
check('one unrelated spec does not', resets('e2e/qol-001-panel.spec.ts') === false);
check('several unrelated specs do not',
  resets('e2e/qol-001-panel.spec.ts', 'e2e/play-button.spec.ts') === false);
check('and one stage among them is enough',
  resets('e2e/qol-001-panel.spec.ts', 'e2e/mod-003-artifacts-create.spec.ts') === true);

// Switches are not filters — `--headed`, `--grep @nodata` and friends leave the
// run as wide as it was.
check('a switch alone is still the whole suite', resets('--headed') === true);
check('a switch beside an unrelated spec changes nothing',
  resets('--headed', 'e2e/play-button.spec.ts') === false);

// A folder that does not exist is not a folder: nothing to read, nothing to
// claim. It cannot report a stage it has no evidence of.
check('a path that is not there claims no stage', resets('e2e/nosuchfolder/') === false);

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
