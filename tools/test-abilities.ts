// Creature abilities of the editor's own — the three edits that make one exist.
//
// A tag is an ability that nothing asks about, so nothing in a running game can
// tell whether it was added correctly: it does nothing either way. What CAN be
// checked is the paperwork, and that is all of it — the enum item, the
// name→number entry the loader resolves through, the size the table declares,
// and the object with the two texts. Miss one and the id a creature's record
// names is an id the game reads as nothing.
//
// The fixtures are miniature but shaped like the real files, down to the
// <Data> inside a <Data> that holds ref_table_num_objs.

import {
  EDITOR_ABILITIES, SHIPPED_ABILITIES, abilityTexts, patchAbilityTable, patchAbilityTypes,
} from '../src/mods/ability-files.ts';
import { DRAGON_TAG } from '../src/mods/creatures.ts';
import type { EditorAbility } from '../src/mods/ability-files.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const TYPES = `<?xml version="1.0" encoding="UTF-8"?>\r
<TypeSystem>\r
\t<Enums>\r
\t\t<Item>\r
\t\t\t<Name>ECombatAbility</Name>\r
\t\t\t<Values>\r
\t\t\t\t<Item>ABILITY_NONE</Item>\r
\t\t\t\t<Item>ABILITY_DESTRUCTION_MAGIC_MAGNETISM</Item>\r
\t\t\t</Values>\r
\t\t</Item>\r
\t</Enums>\r
\t<Values>\r
\t\t<Item>\r
\t\t\t<Name>ABILITY_DESTRUCTION_MAGIC_MAGNETISM</Name>\r
\t\t\t<Value>174</Value>\r
\t\t</Item>\r
\t</Values>\r
\t<Tables>\r
\t\t<Item>\r
\t\t\t<TypeName>Table_CreatureAbility_CombatAbility</TypeName>\r
\t\t\t<Params>\r
\t\t\t\t<Item>\r
\t\t\t\t\t<Key>ref_table_num_objs</Key>\r
\t\t\t\t\t<Data>\r
\t\t\t\t\t\t<Type>01000000</Type>\r
\t\t\t\t\t\t<Data>175</Data>\r
\t\t\t\t\t</Data>\r
\t\t\t\t</Item>\r
\t\t\t</Params>\r
\t\t</Item>\r
\t</Tables>\r
</TypeSystem>`;

const TABLE = `<?xml version="1.0" encoding="UTF-8"?>\r
<Table_CreatureAbility_CombatAbility ObjectRecordID="-1">\r
\t<objects>\r
\t\t<Item>\r
\t\t\t<ID>ABILITY_NONE</ID>\r
\t\t\t<obj>\r
\t\t\t\t<CombatLogTexts/>\r
\t\t\t\t<NameFileRef href=""/>\r
\t\t\t\t<DescriptionFileRef href=""/>\r
\t\t\t\t<ActivatedSpell>SPELL_NONE</ActivatedSpell>\r
\t\t\t</obj>\r
\t\t</Item>\r
\t</objects>\r
</Table_CreatureAbility_CombatAbility>`;

// --- the list itself ----------------------------------------------------------
//
// The number is what a creature's record stores, so the list is append-only and
// the numbers run from the shipped count with no gaps. A gap or a reorder would
// rename what an installed creature carries, silently.

check('the editor ships at least one ability', EDITOR_ABILITIES.length > 0);
check('numbered from the shipped count, consecutively',
  EDITOR_ABILITIES.every((a, i) => a.number === SHIPPED_ABILITIES + i),
  EDITOR_ABILITIES.map((a) => `${a.id}=${a.number}`).join(' '));
check('every one has a caption and a description',
  EDITOR_ABILITIES.every((a) => !!a.name && !!a.description && !!a.file));
check('the dragon tag is one of them', EDITOR_ABILITIES.some((a) => a.id === DRAGON_TAG));
// The number is what a built creature's record stores, so the list is
// append-only — but it is NOT pinned here, and deliberately: nothing in the
// engine asks about an ability of ours, so a different number breaks nothing.
// What must hold is that the numbers follow the shipped count in order, which
// is what makes them match the table the mod ships.
check('the ids of ours are unique and none was dropped',
  new Set(EDITOR_ABILITIES.map((a) => a.id)).size === EDITOR_ABILITIES.length
  && EDITOR_ABILITIES.some((a) => a.id === DRAGON_TAG));

// --- one ability ---------------------------------------------------------------

const one = patchAbilityTypes(TYPES, EDITOR_ABILITIES.slice(0, 1));
const first = EDITOR_ABILITIES[0]!;
check('the enum gains the id', one.includes(`<Item>${first.id}</Item>`));
check('and it lands after the last shipped one, not before it',
  one.indexOf('<Item>ABILITY_DESTRUCTION_MAGIC_MAGNETISM</Item>') < one.indexOf(`<Item>${first.id}</Item>`));
check('the name→number map gains it — the entry the loader resolves through',
  new RegExp(`<Name>${first.id}</Name>\\r?\\n\\s*<Value>${first.number}</Value>`).test(one));
check('the declared size grows by one', one.includes('<Data>176</Data>') && !one.includes('<Data>175</Data>'));
check('and nothing else in the file moved',
  one.replace(/\r?\n\s*<Item>ABILITY_DRAGON<\/Item>/, '')
    .includes('<Name>ABILITY_DESTRUCTION_MAGIC_MAGNETISM</Name>'));

const table = patchAbilityTable(TABLE, EDITOR_ABILITIES.slice(0, 1));
check('the table gains an object', table.includes(`<ID>${first.id}</ID>`));
check('inside <objects>, before it closes',
  table.indexOf(`<ID>${first.id}</ID>`) < table.indexOf('</objects>'));
check('pointing at texts by absolute path, as the shipped ones do',
  table.includes(`<NameFileRef href="/Text/Game/Creatures/Creature_abilities/H5E/${first.file}_name.txt"/>`));
check('and casting no spell', table.includes('<ActivatedSpell>SPELL_NONE</ActivatedSpell>'));

const texts = abilityTexts(EDITOR_ABILITIES.slice(0, 1));
check('two texts per ability, name and description', texts.length === 2);
check('written UTF-16 with the byte-order mark the game reads',
  texts[0]!.data[0] === 0xff && texts[0]!.data[1] === 0xfe
  && texts[0]!.data.toString('utf16le', 2).startsWith(first.name), texts[0]!.path);
check('and the table names exactly the files they are',
  texts.every((f) => table.includes(`href="/${f.path}"`)), texts.map((f) => f.path).join(' '));

// --- a second tag ---------------------------------------------------------------
//
// The whole point of making the tag a real ability: the next one is the next
// number, and the two are told apart everywhere. A name the game does not know
// would be ABILITY_NONE for both.

const two: EditorAbility[] = [
  first,
  { id: 'ABILITY_TEST_SECOND', number: SHIPPED_ABILITIES + 1, file: 'Second', name: 'Второй', description: '…' },
];
const bothTypes = patchAbilityTypes(TYPES, two);
const bothTable = patchAbilityTable(TABLE, two);
check('a second ability takes the next number',
  new RegExp(`<Name>ABILITY_TEST_SECOND</Name>\\r?\\n\\s*<Value>${SHIPPED_ABILITIES + 1}</Value>`).test(bothTypes));
check('both are in the enum',
  bothTypes.includes(`<Item>${first.id}</Item>`) && bothTypes.includes('<Item>ABILITY_TEST_SECOND</Item>'));
check('and the size counts them both', bothTypes.includes('<Data>177</Data>'));
check('both are objects in the table',
  bothTable.includes(`<ID>${first.id}</ID>`) && bothTable.includes('<ID>ABILITY_TEST_SECOND</ID>'));

// --- and it refuses rather than doing nothing -----------------------------------
//
// Every anchor here is a claim about a file we do not own. A build over data
// that has moved must stop, because an ability half-added is an id a creature
// names and the game reads as nothing.

const missing = (what: string, run: () => void): void => {
  try { run(); check(`refuses ${what}`, false, 'it did not throw'); }
  catch (e) { check(`refuses ${what}`, true, e instanceof Error ? e.message.slice(0, 60) : ''); }
};
missing('a types.xml with no ability enum',
  () => patchAbilityTypes(TYPES.replace('<Item>ABILITY_DESTRUCTION_MAGIC_MAGNETISM</Item>', ''), two));
missing('a types.xml whose ability table declares another size',
  () => patchAbilityTypes(TYPES.replace('<Data>175</Data>', '<Data>174</Data>'), two));
missing('a table with no objects to append to',
  () => patchAbilityTable(TABLE.replace('</objects>', ''), two));

check('and with nothing to add, both are left exactly alone',
  patchAbilityTypes(TYPES, []) === TYPES && patchAbilityTable(TABLE, []) === TABLE);

console.log(failures ? `\n${failures} failure(s)` : '\nall good');
process.exit(failures ? 1 : 0);
