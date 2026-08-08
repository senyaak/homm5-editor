// A spell of ours, as the mod writes it — the three declarations and the files.
//
// The spell table is the strictest of the five: its size is stated by
// `ref_table_num_objs`, by `MinElements` AND by `MaxElements` (which are equal,
// as the artifact table's are and unlike the creature table's), and then twice
// more inside the executable. Getting any one of them wrong is silent — the game
// loads and the spell is simply not there — so each is checked by itself.
//
// Needs the unpacked data: types.xml and the spell table are the game's own.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildCreatureMod } from '../src/mods/creature-mod.ts';
import { addSpell, newCreatureMod, removeSpell, updateSpell } from '../src/mods/mod-model.ts';
import { dataReader } from '../src/mods/mod-files.ts';
import { readTableLimit, patchTableLimit, SPELL_TABLE } from '../src/exe/table-limit.ts';
import {
  NOT_LIVING, SHIPPED_SPELLS, SPELL_TABLE_FILE, spellPaths, takenSpells,
} from '../src/mods/spells.ts';
import { abilityNumbers } from '../src/mods/ability-files.ts';
import { readSpellRows, spellRowsOf, writeEffects } from '../src/mods/artifact-effects.ts';
import { dataDir, gameDirIfAny } from './game-dir.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const dataRoot = dataDir();
if (!existsSync(join(dataRoot, 'types.xml'))) {
  console.log(`skipping — no unpacked data at ${dataRoot}`);
  process.exit(0);
}

console.log('a spell of ours, built over the shipped data');
const read = dataReader(dataRoot);
const mod = newCreatureMod('test-spells');
const spell = addSpell(mod, {
  id: 'SPELL_TEST_DEATH_RIPPLE',
  file: 'TestDeathRipple',
  name: 'Волна смерти',
  description: 'Наносит урон всем живым существам на поле боя.',
  level: 2,
  manaCost: 6,
  school: 'MAGIC_SCHOOL_DARK',
  target: 'TARGET_NEUTRAL',
  damage: [
    { base: 10, perPower: 10 },
    { base: 15, perPower: 15 },
    { base: 20, perPower: 20 },
    { base: 25, perPower: 25 },
  ],
  picture: join(import.meta.dirname, '..', 'assets', 'spells', 'death-ripple.png'),
  // BOTH, because this one reaches the whole field. The first plays where the
  // cast happens, the second on every stack it touches — see the rule below.
  visuals: [
    '/GameMechanics/Spell/Combat_Spells/DarkMagic/Plague.(SpellVisual).xdb#xpointer(/SpellVisual)',
    '/GameMechanics/Spell/Combat_Spells/DarkMagic/Unholy_Word_Hit.(SpellVisual).xdb#xpointer(/SpellVisual)',
  ],
});
check('it took the first value past the shipped ones', spell.number === SHIPPED_SPELLS,
  `${spell.number}`);

const built = buildCreatureMod(mod, read);
const files = new Map(built.files.map((f) => [f.path, f.data]));
const text = (path: string): string => files.get(path)?.toString('latin1') ?? '';
const p = spellPaths(spell);

// --- the three numbers in types.xml -------------------------------------------

const types = text('types.xml');
check('the enum gained the spell', types.includes(`<Item>${spell.id}</Item>`));
check('the name→number map gained it',
  new RegExp(`<Name>${spell.id}</Name>\\r?\\n\\s*<Value>${SHIPPED_SPELLS}</Value>`).test(types));
// All three sizes, each looked for where it lives rather than as a loose number:
// the table's own block, so a `354` elsewhere in the file cannot pass for one.
const at = types.indexOf('<TypeName>Table_Spell_SpellID</TypeName>');
const block = types.slice(at, at + 4000);
check('ref_table_num_objs was retuned', /<Data>354<\/Data>/.test(block));
check('MinElements was retuned', block.includes('<MinElements>354</MinElements>'));
check('MaxElements was retuned', block.includes('<MaxElements>354</MaxElements>'));
check('and 353 is gone from the block', !/<Data>353<\/Data>|Elements>353</.test(block));

// --- the table and the document ------------------------------------------------

const table = text(SPELL_TABLE_FILE);
check('the table has shipped + ours', (table.match(/<ID>SPELL_\w+<\/ID>/g) ?? []).length === SHIPPED_SPELLS + 1);
check('our entry points at the document the mod carries',
  table.includes(`<Obj href="/${p.document}#xpointer(/Spell)"/>`) && files.has(p.document));

const doc = text(p.document);
check('the document is a Spell', doc.startsWith('<?xml') && doc.includes('<Spell>'));
check('with the school and level it was given',
  doc.includes('<MagicSchool>MAGIC_SCHOOL_DARK</MagicSchool>') && doc.includes('<Level>2</Level>'));
// Four entries, always: the engine reads them positionally, so a spell given
// three masteries has to repeat one rather than come out short.
check('four damage entries, in order',
  (doc.match(/<Base>\d+<\/Base>/g) ?? []).slice(0, 4).join() === '<Base>10</Base>,<Base>15</Base>,<Base>20</Base>,<Base>25</Base>');
// THE MANA, under the game's own misleading name for it. `TrainedCost` reads
// like a price at a guild and is what a cast costs: Magic Arrow 4, Plague 6,
// Fireball 10. Written as zero — which is what this did at first — the book
// offers a free spell, and nothing anywhere says so.
check('the mana it costs is in TrainedCost', doc.includes('<TrainedCost>6</TrainedCost>'));
// A cast with nothing to show may be a cast the engine will not start, so the
// list is written when the spec gives one — and written ABSOLUTE, since the
// shipped lists are relative to each spell's own folder and ours sits elsewhere.
//
// EVERY entry, not the list's shape: this spell reaches the whole field and so
// carries two, and a check written around exactly one `<Item>` said nothing
// about either once the second arrived.
const listed = [...doc.matchAll(/<visuals>([\s\S]*?)<\/visuals>/g)]
  .flatMap((m) => [...m[1]!.matchAll(/href="([^"]+)"/g)].map((h) => h[1]!));
check('the visuals it borrows are listed absolute',
  listed.length === 2
    && listed.every((h) => /^\/GameMechanics\/Spell\/.+#xpointer\(\/SpellVisual\)$/.test(h)),
  listed.join(' ') || 'none listed');
check('it names texts the mod carries',
  doc.includes(`href="/${p.name}"`) && files.has(p.name) && files.has(p.description));
// Art of its own: the document points at a texture the mod carries, and both
// halves of that texture are in it — an xdb naming a .dds that is not there is
// a spell page with a hole in it, which looks exactly like no spell at all.
check('its icon is the mod\'s own, in both halves',
  doc.includes(`<Texture href="/${p.icon}#xpointer(/Texture)"/>`)
  && files.has(p.icon) && files.has(p.iconDDS));
check('and the texture is the size the game draws a spell at',
  files.get(p.iconDDS)?.readUInt32LE(12) === 128 && files.get(p.iconDDS)?.readUInt32LE(16) === 128,
  `${files.get(p.iconDDS)?.readUInt32LE(16)}x${files.get(p.iconDDS)?.readUInt32LE(12)}`);
check('and those texts are the game\'s own UTF-16',
  files.get(p.name)?.toString('utf16le', 2) === 'Волна смерти');

// --- what the game already answers to ------------------------------------------

const taken = takenSpells(readFileSync(join(dataRoot, 'types.xml'), 'latin1'));
check('the shipped spell names read back', taken.size === SHIPPED_SPELLS, `${taken.size}`);
check('and ours is not one of them', !taken.has(spell.id));
let refused = false;
try { addSpell(newCreatureMod('x'), { ...spell, id: 'SPELL_ARMAGEDDON' }, taken); } catch { refused = true; }
check('a spell named after one of the game\'s own is refused', refused);

// --- what its damage passes over ------------------------------------------------
//
// The only part of a spell that lives OUTSIDE the archive. The engine has no
// case for a number of ours in the one function that works out what a spell does
// to a stack, so the kinds it must spare travel in the config file the extension
// reads — and a row that fails to resolve is a Death Ripple that damages the
// undead, in game, quietly.

const abilities = abilityNumbers(readFileSync(join(dataRoot, 'types.xml'), 'latin1'));
check('the shipped abilities read back with their numbers', abilities.size > 150, `${abilities.size}`);
check('and the three kinds are the numbers the engine compares against',
  NOT_LIVING.map((a) => abilities.get(a)).join(',') === '10,12,9',
  NOT_LIVING.map((a) => `${a}=${abilities.get(a)}`).join(' '));

const filters = spellRowsOf(
  [{ id: spell.id, number: spell.number, spares: NOT_LIVING }], (a) => abilities.get(a));
check('a spell that spares the three kinds writes one row', filters.length === 1);
check('  by ability NUMBER, which is what the engine is asked',
  filters[0]?.spares.join(' ') === '10 12 9', filters[0]?.spares.join(' '));
check('a name types.xml does not know writes NOTHING rather than half a filter',
  spellRowsOf([{ id: spell.id, number: spell.number, spares: ['ABILITY_UNDEAD', 'ABILITY_NOPE'] }],
    (a) => abilities.get(a)).length === 0);
check('and a spell that spares nothing writes no row either',
  spellRowsOf([{ id: spell.id, number: spell.number }], (a) => abilities.get(a)).length === 0);

const written = writeEffects([], [], [], filters);
check('the file states it in the grammar the C parser reads',
  new RegExp(`^spell ${spell.number} spares 10 12 9`, 'm').test(written), written.trim().split(/\r?\n/).pop());
const back = readSpellRows(written);
check('and it reads back the same', back.length === 1 && back[0]!.spell === spell.number
  && back[0]!.spares.join(' ') === '10 12 9');
check('the other three kinds of row are not read as spell rows',
  readSpellRows(writeEffects([{ stat: 'necromancy', artifacts: [97], threshold: 1, amount: 30 }])).length === 0);

// --- and the tiles it covers ----------------------------------------------------
//
// The other half of the same row, and the other thing the engine decides by a
// switch on the number: `IsAreaAttack` says a spell hits an area and never says
// which, and the default a number of ours lands on covers nothing at all. So the
// shape travels here too — and it is not chosen from a menu, since the engine
// builds its own lists by pushing one tile at a time.

const CROSS = [
  { x: 0, y: 0 }, { x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 1 },
];
const shaped = spellRowsOf([{ id: spell.id, number: spell.number, area: CROSS }],
  (a) => abilities.get(a));
check('a spell that names its tiles writes a row for them', shaped.length === 1);
const shapedText = writeEffects([], [], [], shaped);
check('  as pairs, with the comma a person reads it by',
  new RegExp(`^spell ${spell.number} area 0,0 -1,0 1,0 0,-1 0,1`, 'm').test(shapedText),
  shapedText.trim().split(/\r?\n/).pop());
check('  and they read back, negatives and all',
  JSON.stringify(readSpellRows(shapedText)[0]?.area) === JSON.stringify(CROSS));
// Two lines about one spell are one row: they are two grammars because either
// may be absent, not because they are two things.
const bothText = writeEffects([], [], [],
  spellRowsOf([{ id: spell.id, number: spell.number, spares: NOT_LIVING, area: CROSS }],
    (a) => abilities.get(a)));
const both = readSpellRows(bothText);
check('a spell that says both writes two lines and reads back as one row',
  both.length === 1 && both[0]!.spares.length === 3 && both[0]!.area.length === 5,
  `${(bothText.match(/^spell /gm) ?? []).length} lines, ${both.length} row(s)`);

// --- what the form cannot be allowed to leave out -------------------------------
//
// `IsAreaAttack` says a spell hits an AREA and never says which: the shape is a
// switch on the spell's number with one case per shipped spell, and the default
// a number of ours lands on covers nothing. So an area spell with no tiles is a
// cast that plays, spends its mana and touches nobody — which in game is
// indistinguishable from a spell that does not work at all. The window says so
// before the press; this is the rule underneath, because the window is not the
// only door (the e2e fixtures and tools/write-effects.ts come in through here).

const areaSpec = {
  ...spell, id: 'SPELL_TEST_AREA', file: 'TestArea', aimed: true, areaAttack: true,
};
/** Why it was refused, not merely that it was — every id here is a fresh one. */
const refusal = (work: () => void): string => {
  try { work(); return ''; } catch (e) { return e instanceof Error ? e.message : String(e); }
};
const noTiles = refusal(() => addSpell(newCreatureMod('x'), areaSpec));
check('an area spell with no tiles is refused', /tiles/.test(noTiles), noTiles || 'accepted');
const withTiles = newCreatureMod('x');
addSpell(withTiles, { ...areaSpec, area: [{ x: 0, y: 0 }, { x: 1, y: 0 }] });
check('and one that names its tiles is not', (withTiles.spells ?? []).length === 1);
const emptied = refusal(() => updateSpell(withTiles, 'SPELL_TEST_AREA', areaSpec));
check('changing one to cover nothing is refused too — the same rule, the other door',
  /tiles/.test(emptied), emptied || 'accepted');

// --- and the second visual, which cost three runs in the game -------------------
//
// `<visuals>` is read BY INDEX and the two entries are different jobs: the first
// plays ONCE where the cast happens — the middle of the field for a spell that
// aims at nobody — and the second plays on EVERY stack the spell touches. Every
// shipped spell that reaches more than one carries both: `Armageddon` +
// `Armageddon_Hit`, `Unholy_Word` + `Unholy_Word_Hit`.
//
// With only the first, a spell of the mod's killed eight stacks while showing
// one effect in the middle of the screen and nothing on any of them. From the
// player's chair that is a spell that does not work, and it took three launches
// to tell the two apart. This is the rule that ends that, one layer under the
// window — which is not the only door.

const CAST_VISUAL = '/GameMechanics/Spell/Combat_Spells/DarkMagic/Plague.(SpellVisual).xdb#xpointer(/SpellVisual)';
const HIT_VISUAL = '/GameMechanics/Spell/Combat_Spells/DarkMagic/Unholy_Word_Hit.(SpellVisual).xdb#xpointer(/SpellVisual)';

const fieldOneVisual = refusal(() => addSpell(newCreatureMod('x'),
  { ...spell, id: 'SPELL_TEST_FIELD_1V', file: 'TestField1V', visuals: [CAST_VISUAL] }));
check('a whole-field spell with only the cast visual is refused',
  /Hit|BOTH/.test(fieldOneVisual), fieldOneVisual || 'accepted');

const areaOneVisual = refusal(() => addSpell(newCreatureMod('x'), {
  ...areaSpec, id: 'SPELL_TEST_AREA_1V', file: 'TestArea1V',
  area: [{ x: 0, y: 0 }], visuals: [CAST_VISUAL],
}));
check('  and so is an area one — the rule is "more than one stack", not "the field"',
  /Hit|BOTH/.test(areaOneVisual), areaOneVisual || 'accepted');

// THE ONE SHAPE THAT NEEDS ONLY ONE, and it is why the rule asks about reach
// rather than about visuals alone: a spell aimed at a single stack has its first
// visual land on that stack — the engine's single-target branch asks for index 0.
const oneStack = newCreatureMod('x');
addSpell(oneStack, {
  ...spell, id: 'SPELL_TEST_ONE_STACK', file: 'TestOneStack',
  aimed: true, areaAttack: false, visuals: [CAST_VISUAL],
});
check('  a spell aimed at ONE stack needs only the one — its first visual is the hit',
  (oneStack.spells ?? []).length === 1);

const withHit = newCreatureMod('x');
addSpell(withHit, {
  ...spell, id: 'SPELL_TEST_FIELD_2V', file: 'TestField2V',
  visuals: [CAST_VISUAL, HIT_VISUAL],
});
check('  and a whole-field spell that names both is not refused',
  (withHit.spells ?? []).length === 1);
const hitTakenAway = refusal(() => updateSpell(withHit, 'SPELL_TEST_FIELD_2V',
  { ...spell, id: 'SPELL_TEST_FIELD_2V', file: 'TestField2V', visuals: [CAST_VISUAL] }));
check('  taking the hit away later is refused too — the other door',
  /Hit|BOTH/.test(hitTakenAway), hitTakenAway || 'accepted');

// SABOTAGE, because a rule that cannot fail is not a rule: the fixture the whole
// file is built on reaches the whole field, so if the check above were blind it
// would have accepted the one-visual version of THAT too.
const sabotage = refusal(() => addSpell(newCreatureMod('x'),
  { ...spell, id: 'SPELL_TEST_SABOTAGE', file: 'TestSabotage', visuals: [] }));
check('  a spell with NO visuals at all is refused by the same rule',
  /Hit|BOTH/.test(sabotage), sabotage || 'accepted');

// AND THE OTHER HALF OF THE RULE, which the first version left out and a
// five-minute e2e run found: `IsAimed` false means "aims at NOBODY", and an
// ADVENTURE spell says that too. Train Sharpshooters costs gold and trains
// elves, and it was refused for having no hit animation for the stacks it never
// touches. A spell with no damage cannot have a hit.
const adventure = newCreatureMod('x');
addSpell(adventure, {
  ...spell, id: 'SPELL_TEST_ADVENTURE', file: 'TestAdventure',
  school: 'MAGIC_SCHOOL_ADVENTURE', aimed: false, areaAttack: false,
  damage: [
    { base: 0, perPower: 0 }, { base: 0, perPower: 0 },
    { base: 0, perPower: 0 }, { base: 0, perPower: 0 },
  ],
  visuals: [],
});
check('  a spell that DEALS NO DAMAGE needs neither — the rule asks about damage first',
  (adventure.spells ?? []).length === 1);
// And the same spell with damage put back is refused again, so the "no damage"
// door cannot be walked through by a spell that does hurt.
const damaged = refusal(() => addSpell(adventure, {
  ...spell, id: 'SPELL_TEST_ADVENTURE_2', file: 'TestAdventure2', visuals: [],
}));
check('    but one that does is, with the same fixture one field apart',
  /Hit|BOTH/.test(damaged), damaged || 'accepted');

// --- taking one out -------------------------------------------------------------
//
// The numbers behind the ones left have to close up, because the value is the
// position: a mod whose second spell was removed and whose third kept its old
// number would declare a table with a hole in it.
//
// And removing is NEVER REFUSED. Something you cannot delete because something
// else names it is a trap, not a safeguard — so what the mod itself owns is
// edited (a hero stops knowing it, a class stops preferring it) and what it does
// not own is a map, which the window names in the question it asks first.

const shelf = newCreatureMod('x');
for (const id of ['SPELL_TEST_A', 'SPELL_TEST_B', 'SPELL_TEST_C']) {
  addSpell(shelf, { ...spell, id, file: id });
}
removeSpell(shelf, 'SPELL_TEST_B');
check('removing one closes the gap behind it',
  (shelf.spells ?? []).map((s) => `${s.id}=${s.number}`).join(' ')
    === `SPELL_TEST_A=${SHIPPED_SPELLS} SPELL_TEST_C=${SHIPPED_SPELLS + 1}`,
  (shelf.spells ?? []).map((s) => `${s.id}=${s.number}`).join(' '));
shelf.heroes = [{ id: 'H', name: 'H', basedOn: '', town: '', heroClass: '', biography: '',
  spells: ['SPELL_TEST_C', 'SPELL_ARMAGEDDON'] }];
shelf.classes = [{ id: 'C', number: 9, name: 'C', skills: [],
  attributes: { offence: 25, defence: 25, spellpower: 25, knowledge: 25 },
  preferredSpells: ['SPELL_TEST_C'] }];
const took = removeSpell(shelf, 'SPELL_TEST_C');
check('one a hero of the mod knows comes out anyway',
  (shelf.spells ?? []).map((s) => s.id).join(',') === 'SPELL_TEST_A',
  `${(shelf.spells ?? []).map((s) => s.id).join(',') || 'none'} left`);
check('  and it leaves his book rather than dangling in it',
  shelf.heroes[0]!.spells?.join(',') === 'SPELL_ARMAGEDDON',
  shelf.heroes[0]!.spells?.join(',') ?? 'none');
check('  the class stops preferring it too', !shelf.classes[0]!.preferredSpells?.length);
check('  and it says whom it touched, since nobody can work that out afterwards',
  took.heroes.join(',') === 'H' && took.classes.join(',') === 'C',
  `heroes ${took.heroes.join(',')}, classes ${took.classes.join(',')}`);

// --- the executable's two numbers ---------------------------------------------

const gameRoot = gameDirIfAny();
if (!gameRoot) {
  console.log('  skip  the executable — pass --game <dir> or set HOMM5_GAME');
} else {
  const exe = join(gameRoot, 'bin', 'H5_Game_H5E.exe');
  if (existsSync(exe)) {
    const buf = readFileSync(exe);
    const before = readTableLimit(buf, SPELL_TABLE);
    check('the executable states a spell count', before.limit !== null, `${before.limit}`);
    // In memory only — this test never writes a game file.
    const patched = patchTableLimit(buf, SPELL_TABLE, (before.limit ?? SHIPPED_SPELLS) + 1);
    check('raising it moves the registration',
      readTableLimit(patched.data, SPELL_TABLE).limit === (before.limit ?? SHIPPED_SPELLS) + 1);
    check('and the live accessor beside it — the half a table can lose silently',
      patched.accessor !== null
      && patched.data.readUInt32LE(patched.accessor.at) === (before.limit ?? SHIPPED_SPELLS) + 1,
      patched.accessor ? `0x${patched.accessor.address.toString(16)}, ${patched.accessor.callers} caller(s)` : 'none');
  }
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
