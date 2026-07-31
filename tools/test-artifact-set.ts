// Validates a mod that declares an artifact set of its own.
//
// A set is the cheapest half of "our own artifact effects": two data edits and
// the game will count our worn pieces, name the set and draw its tooltip. What
// it will NOT do is act on them — every shipped set's behaviour is compiled
// against its enum value and ours is a value the executable never heard of, so
// the effect itself needs native code (docs/ENGINE_INTERNALS.md).
//
// Three things have to be right and all three are silent when they are not:
//
//   * the enum gains our value AFTER the shipped eleven — `<Effect>` is written
//     by name and stored as a number, and the necromancy sum asks for set 5 by
//     that number, so inserting ahead of it repoints the game's own sets;
//   * `DefaultStats.xdb` gains a row that names our artifacts;
//   * the texts land under `RPGStats/ArtifactSets/`, because the hrefs are
//     relative to DefaultStats and a path elsewhere resolves to nothing.
//
// Needs the unpacked data: the enum and the sets table are the game's own files.

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { buildCreatureMod } from '../src/mods/creature-mod.ts';
import { addArtifactSet, newCreatureMod } from '../src/mods/mod-model.ts';
import { dataReader } from '../src/mods/mod-files.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

// --- what the registry refuses ----------------------------------------------

{
  const mod = newCreatureMod('x');
  const one = {
    artifacts: ['ARTIFACT_A', 'ARTIFACT_B'], file: 'S', name: 'S', description: 'd',
  };
  addArtifactSet(mod, { ...one, effect: 'ARTFSET_EFFECT_A' });
  const refuses = (what: string, run: () => unknown): void => {
    try { run(); check(what, false, 'it was accepted'); } catch { check(what, true); }
  };
  refuses('the same effect twice is refused',
    () => addArtifactSet(mod, { ...one, effect: 'ARTFSET_EFFECT_A', file: 'T' }));
  refuses('the same file twice is refused',
    () => addArtifactSet(mod, { ...one, effect: 'ARTFSET_EFFECT_B' }));
  refuses('a name that is not an effect id is refused',
    () => addArtifactSet(mod, { ...one, effect: 'Undead', file: 'U' }));
  // The one that matters: taking a shipped effect is what "build on top, do not
  // replace" rules out, and it would also be silent — the set would work and
  // the game's own would quietly stop.
  refuses("the game's own effect is refused",
    () => addArtifactSet(mod, { ...one, effect: 'ARTFSET_EFFECT_NECROMANCERS', file: 'V' }));
  refuses('a set of one artifact is refused',
    () => addArtifactSet(mod, { ...one, effect: 'ARTFSET_EFFECT_C', file: 'W', artifacts: ['ARTIFACT_A'] }));
  check('the first one takes the value after the shipped', mod.sets[0]!.number === 11,
    `got ${mod.sets[0]!.number}`);
}

const dataRoot = process.env.HOMM5_DATA ?? join(import.meta.dirname, '..', 'data-unpacked');
if (!existsSync(join(dataRoot, 'types.xml'))) {
  console.log(`no unpacked data at ${dataRoot} — skipping the rest`);
  console.log(failures ? `\n${failures} failure(s)` : '\nall good');
  process.exit(failures ? 1 : 0);
}

// --- a mod of one set and nothing else ---------------------------------------

// Members are SHIPPED artifacts on purpose. The set and the artifacts are
// independent edits, and proving the set alone means nothing else can be what
// broke or what worked.
const read = dataReader(dataRoot);
const mod = newCreatureMod('test-artifact-set');
addArtifactSet(mod, {
  effect: 'ARTFSET_EFFECT_TEST',
  artifacts: ['ARTIFACT_NECROMANCER_PENDANT', 'CLOAK_OF_MOURNING', 'STAFF_OF_VEXINGS'],
  file: 'TestSet',
  name: 'Test Set',
  description: 'A set that exists only to be counted.',
  perCount: ['', 'Two pieces.', 'Three pieces.'],
});

const report = buildCreatureMod(mod, read);
const at = (path: string): string | undefined =>
  report.files.find((f) => f.path === path)?.data.toString('latin1');

const types = at('types.xml');
check('types.xml is in the mod', !!types);
if (types) {
  check('our effect is in the enum', types.includes('<Name>ARTFSET_EFFECT_TEST</Name>'));
  check('it holds the value after the shipped eleven',
    /<Name>ARTFSET_EFFECT_TEST<\/Name>\s*[\r\n]+\s*<Value>11<\/Value>/.test(types));
  // The shipped eleven have to come out untouched — this is the whole "build on
  // top" rule, and the one failure here that would look like success in game
  // until a necromancer noticed his set had stopped working.
  const shipped = [...types.matchAll(/<Name>(ARTFSET_EFFECT_\w+)<\/Name>\s*[\r\n]+\s*<Value>(\d+)<\/Value>/g)];
  check('the enum has twelve entries', shipped.length === 12, `got ${shipped.length}`);
  check('NECROMANCERS is still 5', shipped.find((m) => m[1] === 'ARTFSET_EFFECT_NECROMANCERS')?.[2] === '5');
  check('DEMONIC is still 10', shipped.find((m) => m[1] === 'ARTFSET_EFFECT_DEMONIC')?.[2] === '10');
}

const stats = at('GameMechanics/RPGStats/DefaultStats.xdb');
check('DefaultStats.xdb is in the mod', !!stats);
if (stats) {
  check('our set is in the table', stats.includes('<Effect>ARTFSET_EFFECT_TEST</Effect>'));
  check('it names all three members',
    ['ARTIFACT_NECROMANCER_PENDANT', 'CLOAK_OF_MOURNING', 'STAFF_OF_VEXINGS']
      .every((id) => stats.includes(`<Artifact>${id}</Artifact>`)));
  check('the shipped ten are still there',
    (stats.match(/<Effect>ARTFSET_EFFECT_\w+<\/Effect>/g) ?? []).length === 11);
  // The array is indexed from ONE piece worn and holds one entry per member.
  // Getting either wrong shifts every description a piece early, which reads as
  // a set that combines too soon rather than as a broken file.
  const refs = stats.slice(stats.indexOf('<Effect>ARTFSET_EFFECT_TEST</Effect>'));
  const block = refs.slice(refs.indexOf('<CombinedDescriptionsFileRefs>'), refs.indexOf('</CombinedDescriptionsFileRefs>'));
  const items = block.match(/<Item href="[^"]*"\/>/g) ?? [];
  check('the per-count array is one entry per member', items.length === 3, `got ${items.length}`);
  check('one piece is blank', items[0] === '<Item href=""/>', items[0]);
  check('two pieces points at our text', !!items[1]?.includes('ArtifactSets/TestSet_Desc2.txt'), items[1]);
  check('three pieces points at our text', !!items[2]?.includes('ArtifactSets/TestSet_Desc3.txt'), items[2]);
}

const texts = report.files.filter((f) => f.path.startsWith('GameMechanics/RPGStats/ArtifactSets/'));
check('the texts sit beside the game\'s own', texts.length === 4, `got ${texts.length}: ${texts.map((f) => f.path.split('/').pop()).join(', ')}`);
// UTF-16LE with a BOM is what the game reads; UTF-8 comes out as mojibake.
check('a text is UTF-16', texts[0]?.data[0] === 0xff && texts[0]?.data[1] === 0xfe);

// A set costs the executable nothing — no table is indexed by it and no ceiling
// counts it, unlike a creature.
check('the mod needs no raised creature ceiling', report.limit === 0 || !mod.creatures.length);
check('nothing else of the game is touched',
  !report.files.some((f) => f.path === 'GameMechanics/RefTables/Artifacts.xdb'));

console.log(failures ? `\n${failures} failure(s)` : '\nall good');
process.exit(failures ? 1 : 0);
