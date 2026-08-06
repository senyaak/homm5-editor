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
import { addSpell, newCreatureMod } from '../src/mods/mod-model.ts';
import { dataReader } from '../src/mods/mod-files.ts';
import { readTableLimit, patchTableLimit, SPELL_TABLE } from '../src/exe/table-limit.ts';
import {
  SHIPPED_SPELLS, SPELL_TABLE_FILE, spellPaths, takenSpells,
} from '../src/mods/spells.ts';
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
  visuals: ['/GameMechanics/Spell/Combat_Spells/DarkMagic/Plague.(SpellVisual).xdb#xpointer(/SpellVisual)'],
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
check('the visuals it borrows are listed absolute',
  /<visuals>\s*<Item href="\/GameMechanics\/Spell\/[^"]+#xpointer\(\/SpellVisual\)"\/>\s*<\/visuals>/.test(doc));
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
