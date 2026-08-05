// The file the native extension reads.
//
// It is the whole contract between the editor and the extension: the editor
// writes it, a C parser with no library behind it reads it, and nothing checks
// that the two agree except this. So the checks are about the FORMAT — the
// exact shape those forty lines of C expect — rather than about the numbers.

import {
  EFFECTS_FILE, effectsOf, readEffects, readSkillEffects, skillRowsOf, writeEffects,
} from '../src/mods/artifact-effects.ts';
import { artifactNumbers } from '../src/mods/artifacts.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

check('it lands beside the executable, not in the mod',
  EFFECTS_FILE.replace(/\\/g, '/') === 'bin/homm5-editor-effects.txt', EFFECTS_FILE);

// --- the shape the C parser expects -----------------------------------------

const text = writeEffects([
  { stat: 'necromancy', artifacts: [97], threshold: 1, amount: 5, name: 'ARTIFACT_H3_UNDERTAKERS_AMULET' },
  { stat: 'necromancy', artifacts: [98], threshold: 1, amount: 10 },
  { stat: 'necromancy', artifacts: [99], threshold: 1, amount: -3 },
]);
const lines = text.split('\r\n');

// The parser reads a stat word, then a kind word, then decimals.
check('a row is stat, kind, id, amount', lines.includes('necromancy artifact 98 10'),
  lines.find((l) => l.includes('98')) ?? '(none)');
check('a name becomes a trailing comment, not another field',
  /^necromancy artifact 97 5 {3}# ARTIFACT_H3_UNDERTAKERS_AMULET$/.test(lines.find((l) => l.startsWith('necromancy artifact 97')) ?? ''),
  lines.find((l) => l.startsWith('necromancy artifact 97')) ?? '(none)');
check('a negative amount survives', lines.includes('necromancy artifact 99 -3'));
// The C reads the file into a fixed buffer line by line and splits on \n; CRLF
// is what every other file the game and the editor write uses.
check('lines end CRLF', text.includes('\r\n') && !/[^\r]\n/.test(text));
check('the header is commented out', lines[0]!.startsWith('#'));

// A set: threshold and amount first, then the members to the end of the line.
// That order is what lets the C read members until the numbers run out, which
// is also why the comment has to come last.
const setText = writeEffects([
  { stat: 'energy', artifacts: [97, 98, 99], threshold: 2, amount: 150, name: 'ARTFSET_EFFECT_H3_UNDEAD_KING' },
]);
const setLine = setText.split('\r\n').find((l) => l.startsWith('energy')) ?? '';
check('a set is worn, amount, then the members',
  /^energy set 2 150 97 98 99 {3}# /.test(setLine), setLine || '(none)');

// A row that adds nothing must not be written: in game it is indistinguishable
// from a row that was never read, so leaving it in makes the file lie.
const withZero = writeEffects([
  { stat: 'necromancy', artifacts: [97], threshold: 1, amount: 0 },
  { stat: 'necromancy', artifacts: [98], threshold: 1, amount: 4 },
]);
check('a zero amount is dropped', !withZero.includes('97') && withZero.includes('98 4'));
// Only a set whose members did not resolve can be memberless, and counting no
// pieces would fire at any threshold.
check('a row with no members is dropped',
  !writeEffects([{ stat: 'energy', artifacts: [], threshold: 2, amount: 150 }]).includes('energy '));

// --- round trip --------------------------------------------------------------

const back = readEffects(text + setText);
check('it reads back to what was written', back.length === 4
  && back[0]!.artifacts[0] === 97 && back[0]!.amount === 5 && back[2]!.amount === -3,
  JSON.stringify(back));
const set = back[3]!;
check('and a set keeps its members and threshold',
  set.stat === 'energy' && set.threshold === 2 && set.amount === 150
  && set.artifacts.join() === '97,98,99', JSON.stringify(set));
check('comments are not rows', readEffects('# necromancy artifact 1 5\n').length === 0);
check('an unknown stat is ignored', readEffects('luck artifact 1 5\n').length === 0);

// --- from a mod's artifacts and sets -----------------------------------------

const rows = effectsOf([
  { id: 'ARTIFACT_A', number: 97, effects: { necromancy: 5 } },
  { id: 'ARTIFACT_B', number: 98 },
  { id: 'ARTIFACT_C', number: 99, effects: { necromancy: 0 } },
]);
check('only artifacts with an effect produce a row', rows.length === 1 && rows[0]!.artifacts[0] === 97,
  JSON.stringify(rows));
check('and the row carries the id as its comment', rows[0]!.name === 'ARTIFACT_A');

const withSet = effectsOf(
  [{ id: 'ARTIFACT_A', number: 97 }, { id: 'ARTIFACT_B', number: 98 }],
  [{
    effect: 'ARTFSET_EFFECT_OURS',
    artifacts: ['ARTIFACT_A', 'ARTIFACT_B', 'ARTIFACT_NECROMANCER_PENDANT'],
    effects: [{ stat: 'energy', threshold: 2, amount: 150 }],
  }],
  (id) => (id === 'ARTIFACT_NECROMANCER_PENDANT' ? 71 : undefined),
);
check('a set names its members by number, the mod\'s own and the game\'s',
  withSet.length === 1 && withSet[0]!.artifacts.join() === '97,98,71', JSON.stringify(withSet));
check('and it carries the threshold it was given', withSet[0]!.threshold === 2);

// --- a skill, the third subject ------------------------------------------------
//
// It enters the same sums an artifact does and shares their stat names, so the
// C recognises it by the word after the stat. Which is why the two shapes have
// to stay distinguishable at exactly that point, and why this checks the line
// rather than only the round trip.

const skillText = writeEffects([], [], [
  { stat: 'necromancy', skill: 221, amountPerMastery: 5, name: 'HERO_SKILL_TENT_MASTER' },
  { stat: 'energy', skill: 222, amountPerMastery: -2 },
  { stat: 'energy', skill: 223, amountPerMastery: 0 },
]);
const skillLines = skillText.split('\r\n');
check('a skill row is stat, the word, the value, the amount',
  /^necromancy skill 221 5 {3}# HERO_SKILL_TENT_MASTER$/.test(
    skillLines.find((l) => l.startsWith('necromancy skill')) ?? ''),
  skillLines.find((l) => l.startsWith('necromancy skill')) ?? '(none)');
check('a negative amount survives here too', skillLines.includes('energy skill 222 -2'));
check('and one that adds nothing is dropped', !skillText.includes('223'));

const readBack = readSkillEffects(skillText);
check('it reads back to what was written',
  readBack.length === 2 && readBack[0]!.skill === 221 && readBack[0]!.amountPerMastery === 5
  && readBack[1]!.stat === 'energy' && readBack[1]!.amountPerMastery === -2, JSON.stringify(readBack));
// Each reader ignores what it does not understand, which is the only thing
// keeping three grammars in one file honest.
check('the artifact reader passes over skill rows', readEffects(skillText).length === 0);
check('and the skill reader passes over artifact rows', readSkillEffects(text + setText).length === 0);
check('an unknown stat is ignored here too', readSkillEffects('luck skill 1 5\n').length === 0);

const skillRows = skillRowsOf([
  { id: 'HERO_SKILL_A', number: 221, effects: { necromancy: 5, energy: 20 } },
  { id: 'HERO_SKILL_B', number: 222 },
  { id: 'HERO_SKILL_C', number: 223, effects: { necromancy: 0 } },
]);
check('a skill gives one row per stat it adds to',
  skillRows.length === 2 && skillRows.every((r) => r.skill === 221), JSON.stringify(skillRows));
check('and each carries the id as its comment', skillRows[0]!.name === 'HERO_SKILL_A');

// Half a set counted combines early, which is worse than not combining at all.
const unresolved = effectsOf(
  [{ id: 'ARTIFACT_A', number: 97 }],
  [{
    effect: 'ARTFSET_EFFECT_OURS',
    artifacts: ['ARTIFACT_A', 'ARTIFACT_WHO'],
    effects: [{ stat: 'energy', threshold: 2, amount: 150 }],
  }],
);
check('a set with a member that does not resolve produces no row',
  unresolved.length === 0, JSON.stringify(unresolved));

// --- where a shipped member's number comes from ------------------------------
//
// The enum in types.xml, and only that enum: the file holds dozens of
// name→value maps with the same shape, so the reader has to be anchored on the
// type it wants.

const types = `<Types>
  <Item><TypeName>ArtifactClass</TypeName><Entries>
    <Item><Name>ARTF_CLASS_MINOR</Name><Value>0</Value></Item>
  </Entries></Item>
  <Item><TypeName>ArtifactEffect</TypeName><Entries>
    <Item><Name>SWORD_OF_RUINS</Name><Value>1</Value></Item>
    <Item>
      <Name>ARTIFACT_NECROMANCER_PENDANT</Name>
      <Value>71</Value>
    </Item>
  </Entries></Item>
</Types>`;
const numbers = artifactNumbers(types);
check('an artifact id resolves to the number the enum gives it',
  numbers.get('ARTIFACT_NECROMANCER_PENDANT') === 71, String(numbers.get('ARTIFACT_NECROMANCER_PENDANT')));
check('and a name from another enum is not picked up',
  !numbers.has('ARTF_CLASS_MINOR') && numbers.size === 2, String(numbers.size));

console.log(failures ? `\n${failures} failure(s)` : '\nall good');
process.exit(failures ? 1 : 0);
