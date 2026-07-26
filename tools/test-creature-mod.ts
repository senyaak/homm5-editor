// Validates the units mod — the creature registry and the .h5u it builds.
//
//   1. Self-contained (always runs): a mod built over a miniature stand-in for
//      the game's data edits the three files it must, writes one inline object
//      per creature with the stats it was given, and copies the art closure —
//      preserving relative hrefs, repointing absolute ones, and giving copied
//      geometry a fresh uid so the mod cannot edit the original creature's mesh.
//   2. Against the real thing (skipped without data-unpacked): the same over the
//      shipped Sharp Shooter, checking that EVERY href in the built mod resolves,
//      either inside the mod or in the game's data. That invariant is the test
//      that matters: the two bugs this feature actually shipped with were a
//      creature pointing at a visual with no icon, and a copied map-stack still
//      naming the creature it was copied from.
//
// The fixtures below are miniature but not fake: each is the shape of the real
// file, down to the nesting that made `ref_table_num_objs` hard to splice (its
// number sits in a <Data> inside a <Data>).

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import {
  addCreature, buildCreatureMod, creatureLimit, creaturePaths, dataPath, dataReader,
  MOD_MANIFEST, newCreatureMod, packCreatureMod, readCreatureModBuffer, writeCreatureMod,
} from '../src/creature-mod.ts';
import { assets } from '../src/assets.ts';
import { Registry } from '../src/registry.ts';
import type { CreatureMod, DataReader, ModFile } from '../src/creature-mod.ts';
import { blankStats, creatureRoot, readStats, SHIPPED_CREATURES } from '../src/creatures.ts';
import { readEntries } from '../src/pak.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const GEOM_UID = 'AAAAAAAA-1111-2222-3333-444444444444';
const ANIM_UID = 'BBBBBBBB-1111-2222-3333-444444444444';

/** The game's null creature, verbatim — the document every creature starts from. */
const NONE_XDB = `<?xml version="1.0" encoding="UTF-8"?>\r
<Creature ObjectRecordID="2">\r
\t<AttackSkill>0</AttackSkill>\r
\t<DefenceSkill>0</DefenceSkill>\r
\t<Shots>0</Shots>\r
\t<MinDamage>0</MinDamage>\r
\t<MaxDamage>0</MaxDamage>\r
\t<Speed>0</Speed>\r
\t<Initiative>0</Initiative>\r
\t<Flying>false</Flying>\r
\t<Health>0</Health>\r
\t<KnownSpells/>\r
\t<Exp>0</Exp>\r
\t<Power>0</Power>\r
\t<TimeToCommand>7</TimeToCommand>\r
\t<CreatureTier>1</CreatureTier>\r
\t<CreatureTown>TOWN_HEAVEN</CreatureTown>\r
\t<WeeklyGrowth>0</WeeklyGrowth>\r
\t<Cost>\r
\t\t<Wood>0</Wood>\r
\t\t<Ore>0</Ore>\r
\t\t<Mercury>0</Mercury>\r
\t\t<Crystal>0</Crystal>\r
\t\t<Sulfur>0</Sulfur>\r
\t\t<Gem>0</Gem>\r
\t\t<Gold>0</Gold>\r
\t</Cost>\r
\t<MonsterShared/>\r
\t<CombatSize>1</CombatSize>\r
\t<Visual href="/GameMechanics/CreatureVisual/Creatures/None.xdb#xpointer(/CreatureVisual)"/>\r
\t<Range>0</Range>\r
\t<Abilities/>\r
</Creature>`;

/** A stand-in data root: the three files a mod edits, a creature to copy, and art. */
function miniature(): Map<string, Buffer> {
  const files: Record<string, string> = {
    'types.xml': `<?xml version="1.0" encoding="UTF-8"?>\r
<TypeSystem>\r
\t<Enums>\r
\t\t<Item>\r
\t\t\t<Name>CreatureType</Name>\r
\t\t\t<Values>\r
\t\t\t\t<Item>CREATURE_UNKNOWN</Item>\r
\t\t\t\t<Item>CREATURE_CYCLOP_BLOODEYED</Item>\r
\t\t\t</Values>\r
\t\t</Item>\r
\t</Enums>\r
\t<Values>\r
\t\t<Item>\r
\t\t\t<Name>CREATURE_UNKNOWN</Name>\r
\t\t\t<Value>0</Value>\r
\t\t</Item>\r
\t\t<Item>\r
\t\t\t<Name>CREATURE_CYCLOP_BLOODEYED</Name>\r
\t\t\t<Value>1</Value>\r
\t\t</Item>\r
\t</Values>\r
\t<Tables>\r
\t\t<Item>\r
\t\t\t<TypeName>Table_Creature_CreatureType</TypeName>\r
\t\t\t<MaxElements>2</MaxElements>\r
\t\t\t<MinElements>2</MinElements>\r
\t\t\t<Params>\r
\t\t\t\t<Item>\r
\t\t\t\t\t<Key>ref_table_num_objs</Key>\r
\t\t\t\t\t<Data>\r
\t\t\t\t\t\t<Data>2</Data>\r
\t\t\t\t\t</Data>\r
\t\t\t\t</Item>\r
\t\t\t</Params>\r
\t\t</Item>\r
\t</Tables>\r
</TypeSystem>`,

    'GameMechanics/RefTables/Creatures.xdb': `<?xml version="1.0" encoding="UTF-8"?>\r
<Table_Creature_CreatureType>\r
\t<objects>\r
\t\t<Item>\r
\t\t\t<ID>CREATURE_UNKNOWN</ID>\r
\t\t\t<Obj href="/GameMechanics/Creature/Creatures/None.xdb#xpointer(/Creature)"/>\r
\t\t</Item>\r
\t\t<Item>\r
\t\t\t<ID>CREATURE_CYCLOP_BLOODEYED</ID>\r
\t\t\t<Obj href="/GameMechanics/Creature/Creatures/Cyclop.xdb#xpointer(/Creature)"/>\r
\t\t</Item>\r
\t</objects>\r
</Table_Creature_CreatureType>`,

    'UI/UIGameRoot.(UIGameRoot).xdb': `<?xml version="1.0" encoding="UTF-8"?>\r
<UIGameRoot>\r
\t<creaturesCameras>\r
\t\t<Item>\r
\t\t\t<Camera href="/Cameras/Interface/HireCreatures.(Camera).xdb#xpointer(/Camera)"/>\r
\t\t\t<creatures>\r
\t\t\t\t<Item>CREATURE_UNKNOWN</Item>\r
\t\t\t</creatures>\r
\t\t</Item>\r
\t</creaturesCameras>\r
</UIGameRoot>`,

    'GameMechanics/Creature/Creatures/None.xdb': NONE_XDB,

    // The pair a new creature copies: a visual and a map-stack definition.
    'GameMechanics/CreatureVisual/Creatures/Elf.(CreatureVisual).xdb': `<?xml version="1.0" encoding="UTF-8"?>\r
<CreatureVisual>\r
\t<CreatureNameFileRef href="/Text/Elf_Name.txt"/>\r
\t<CreatureAbilitiesFileRef href="/Text/Elf_Abils.txt"/>\r
\t<DescriptionFileRef href="/Text/Elf_Desc.txt"/>\r
\t<Icon128 href="/Icons/Ico.(Texture).xdb#xpointer(/Texture)"/>\r
\t<AnimCharacter href="/Art/Char.(Character).xdb#xpointer(/Character)"/>\r
\t<AnimShot href="/GameMechanics/Shot/Arrow.xdb#xpointer(/Shot)"/>\r
</CreatureVisual>`,

    'MapObjects/Elf.(AdvMapMonsterShared).xdb': `<?xml version="1.0" encoding="UTF-8"?>\r
<AdvMapMonsterShared>\r
\t<Model href="/Art/Char.xdb#xpointer(/Model)"/>\r
\t<AnimSet href="/Anim/Set.xdb#xpointer(/AnimSet)"/>\r
\t<messagesFileRef>\r
\t\t<Item href="/Text/Elf_Name.txt"/>\r
\t</messagesFileRef>\r
\t<Type>MONSTER_SPECIFIC</Type>\r
\t<Creature>CREATURE_HIGH_ELF</Creature>\r
</AdvMapMonsterShared>`,

    // The art. Relative hrefs within a folder, one absolute href across folders,
    // and two documents whose data lives in bin/ keyed by uid.
    'Art/Char.(Character).xdb': `<?xml version="1.0" encoding="UTF-8"?>\r
<Character>\r
\t<Model href="Char.xdb#xpointer(/Model)"/>\r
</Character>`,
    'Art/Char.xdb': `<?xml version="1.0" encoding="UTF-8"?>\r
<Model>\r
\t<Materials>\r
\t\t<Item href="Char.(Material).xdb#xpointer(/Material)"/>\r
\t</Materials>\r
\t<Geometry href="Char-geom.xdb#xpointer(/Geometry)"/>\r
</Model>`,
    'Art/Char-geom.xdb': `<?xml version="1.0" encoding="UTF-8"?>\r
<Geometry>\r
\t<SrcName href="/H5A2/Creatures/Elf/Models/Elf.mb"/>\r
\t<uid>${GEOM_UID}</uid>\r
</Geometry>`,
    'Art/Char.(Material).xdb': `<?xml version="1.0" encoding="UTF-8"?>\r
<Material>\r
\t<Texture href="Skin.(Texture).xdb#xpointer(/Texture)"/>\r
</Material>`,
    'Art/Skin.(Texture).xdb': `<?xml version="1.0" encoding="UTF-8"?>\r
<Texture>\r
\t<SrcName href="/H5A2/Creatures/Elf/Textures/skin.tga"/>\r
\t<DestName href="Skin.(Texture).dds"/>\r
\t<Format>TF_DXT3</Format>\r
</Texture>`,
    'Anim/Set.xdb': `<?xml version="1.0" encoding="UTF-8"?>\r
<AnimSet>\r
\t<animations>\r
\t\t<Item>\r
\t\t\t<Kind>move</Kind>\r
\t\t\t<Anim href="/Anim/Clip.xdb#xpointer(/BasicSkelAnim)"/>\r
\t\t</Item>\r
\t</animations>\r
</AnimSet>`,
    'Anim/Clip.xdb': `<?xml version="1.0" encoding="UTF-8"?>\r
<BasicSkelAnim>\r
\t<uid>${ANIM_UID}</uid>\r
</BasicSkelAnim>`,
    'Icons/Ico.(Texture).xdb': `<?xml version="1.0" encoding="UTF-8"?>\r
<Texture>\r
\t<DestName href="Ico.(Texture).dds"/>\r
</Texture>`,
  };

  const data = new Map<string, Buffer>();
  for (const [path, text] of Object.entries(files)) data.set(path, Buffer.from(text, 'latin1'));
  data.set('Art/Skin.(Texture).dds', Buffer.alloc(64, 7));
  data.set('Icons/Ico.(Texture).dds', Buffer.alloc(32, 3));
  data.set(`bin/Geometries/${GEOM_UID}`, Buffer.alloc(128, 1));
  data.set(`bin/animations/${ANIM_UID}`, Buffer.alloc(96, 2));
  return data;
}

/** A mod over the miniature data: two shipped creatures, so ids start at 2. */
function miniatureMod(): CreatureMod {
  const mod = newCreatureMod('test-units');
  mod.first = 2;
  addCreature(mod, {
    id: 'CREATURE_TEST_SNIPER',
    file: 'TestSniper',
    name: 'Снайперы',
    description: 'a test',
    abilitiesText: 'Shooter',
    stats: {
      ...blankStats(),
      attack: 12, defence: 10, minDamage: 8, maxDamage: 10, health: 15,
      speed: 9, initiative: 12, shots: 32, range: -1, weeklyGrowth: 4,
      gold: 400, tier: 4, exp: 82, power: 940,
      abilities: ['ABILITY_NO_RANGE_PENALTY', 'ABILITY_PIERCING_ARROW'],
    },
    visualSource: 'GameMechanics/CreatureVisual/Creatures/Elf.(CreatureVisual).xdb',
    monsterSource: 'MapObjects/Elf.(AdvMapMonsterShared).xdb',
  });
  return mod;
}

const byPath = (files: ModFile[]): Map<string, Buffer> => new Map(files.map((f) => [f.path, f.data]));
const asText = (files: Map<string, Buffer>, path: string): string => files.get(path)?.toString('latin1') ?? '';

// ---- 1. the miniature build --------------------------------------------------

console.log('\nbuilding over a miniature data root');
const data = miniature();
const mod = miniatureMod();
const built = buildCreatureMod(mod, (rel) => data.get(rel) ?? null);
const files = byPath(built.files);
const c = mod.creatures[0]!;
const p = creaturePaths(c);

check('the ceiling is exactly shipped + added', built.limit === 3, `${built.limit}`);
check('the creature took the next id', c.number === 2, `${c.number}`);
check('a manifest is shipped inside the mod', files.has(MOD_MANIFEST));
for (const path of [p.visual, p.monster, p.name, p.description, p.abilities]) {
  check(`generated ${path.replace(`${p.dir}/`, '')}`, files.has(path));
}

// types.xml — the enum, the map, and the two numbers.
const types = asText(files, 'types.xml');
check('the enum gained the creature', types.includes('<Item>CREATURE_TEST_SNIPER</Item>'));
check('the name→number map gained it', /<Name>CREATURE_TEST_SNIPER<\/Name>\r?\n\s*<Value>2<\/Value>/.test(types));
check('ref_table_num_objs was retuned', types.includes('<Data>3</Data>'));
check('MaxElements was retuned', types.includes('<MaxElements>3</MaxElements>'));
check('MinElements was left alone (it is a floor)', types.includes('<MinElements>2</MinElements>'));

// The ref table — one entry per creature, each with its own inline object.
const table = asText(files, 'GameMechanics/RefTables/Creatures.xdb');
check('the table has shipped + added entries', [...table.matchAll(/<ID>CREATURE_/g)].length === 3);
check('the object is inline, not a file', table.includes('href="#n:inline(Creature)"'));
check('it carries an ObjectRecordID', /<Creature ObjectRecordID="1001000">/.test(table));

const inline = table.slice(table.indexOf('<Creature ObjectRecordID='), table.lastIndexOf('</Creature>') + 11);
const stats = readStats(creatureRoot(inline));
check('stats round-trip through the record', JSON.stringify(stats) === JSON.stringify(c.stats),
  `${stats.attack}/${stats.defence} ${stats.minDamage}-${stats.maxDamage}, ${stats.gold}g, init ${stats.initiative}`);
check('abilities came across', stats.abilities.join() === c.stats.abilities.join());
check('the record points at our visual', inline.includes(`/${p.visual}#xpointer(/CreatureVisual)`));
check('and at our map-stack definition', inline.includes(`/${p.monster}#xpointer(/AdvMapMonsterShared)`));

// The camera. One entry covers every creature the mod adds.
const ui = asText(files, 'UI/UIGameRoot.(UIGameRoot).xdb');
check('one camera entry lists the creature', [...ui.matchAll(/<Camera href=/g)].length === 2
  && ui.includes('<Item>CREATURE_TEST_SNIPER</Item>'));

// The map stack. This one line is the whole of which creature a stack is.
const monster = asText(files, p.monster);
check('the map stack names OUR creature, not the one it was copied from',
  monster.includes('<Creature>CREATURE_TEST_SNIPER</Creature>') && !monster.includes('CREATURE_HIGH_ELF'));
check('its message text is ours', monster.includes(`<Item href="/${p.name}"/>`));

// The visual. Texts repointed, art repointed, everything else left alone.
const visual = asText(files, p.visual);
check('the visual names our texts', visual.includes(`href="/${p.name}"`) && visual.includes(`href="/${p.description}"`));
check('an unrelated ref was left alone', visual.includes('/GameMechanics/Shot/Arrow.xdb'));

// ---- the art ----------------------------------------------------------------

console.log('\nthe art copy');
check('the icon was copied', files.has(`${p.art}/Icons/Ico.(Texture).xdb`));
check('and the .dds beside it', files.has(`${p.art}/Icons/Ico.(Texture).dds`));
check('the whole model chain came across',
  ['Art/Char.(Character).xdb', 'Art/Char.xdb', 'Art/Char-geom.xdb', 'Art/Char.(Material).xdb',
    'Art/Skin.(Texture).xdb', 'Art/Skin.(Texture).dds', 'Anim/Set.xdb', 'Anim/Clip.xdb']
    .every((f) => files.has(`${p.art}/${f}`)));
check('the visual points at the copy, not the original',
  visual.includes(`/${p.art}/Art/Char.(Character).xdb#xpointer(/Character)`));
check('a relative href needed no rewriting', asText(files, `${p.art}/Art/Char.xdb`).includes('href="Char-geom.xdb#xpointer(/Geometry)"'));
check('an absolute href was repointed into the mod',
  asText(files, `${p.art}/Anim/Set.xdb`).includes(`href="/${p.art}/Anim/Clip.xdb#xpointer(/BasicSkelAnim)"`));
check('an href naming nothing shipped was left alone',
  asText(files, `${p.art}/Art/Skin.(Texture).xdb`).includes('/H5A2/Creatures/Elf/Textures/skin.tga'));
check('and reported as unresolved', built.missing.includes('H5A2/Creatures/Elf/Textures/skin.tga'));

// The uid rewrite. Its whole point: the binary is keyed by uid, so a copy that
// kept the original's uid would put OUR mesh where the shipped creature reads its.
const geom = asText(files, `${p.art}/Art/Char-geom.xdb`);
const freshGeom = /<uid>([0-9A-F-]{36})<\/uid>/.exec(geom)?.[1] ?? '';
check('copied geometry got a fresh uid', Boolean(freshGeom) && freshGeom !== GEOM_UID, freshGeom);
check('its binary was copied under the new uid', files.has(`bin/Geometries/${freshGeom}`));
check('and the shipped uid was NOT overwritten', !files.has(`bin/Geometries/${GEOM_UID}`));
const freshAnim = /<uid>([0-9A-F-]{36})<\/uid>/.exec(asText(files, `${p.art}/Anim/Clip.xdb`))?.[1] ?? '';
check('the animation too', Boolean(freshAnim) && freshAnim !== ANIM_UID && files.has(`bin/animations/${freshAnim}`));

// A rebuild has to produce the same bytes, or every install is a fresh download.
const again = byPath(buildCreatureMod(miniatureMod(), (rel) => data.get(rel) ?? null).files);
check('a rebuild is byte-identical', [...files].every(([path, bytes]) => again.get(path)?.equals(bytes)));

// ---- the archive -------------------------------------------------------------

console.log('\nthe archive');
const archive = packCreatureMod(built);
const entries = readEntries(archive);
check('every file is a member', entries.length === built.files.length, `${entries.length}`);

// The trap that cost the most: members dated 1980 lose to the game's own 2007
// copies, because given one path in several archives the game takes the newest.
const stamped = (() => {
  const eocd = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let at = archive.readUInt32LE(eocd + 16);
  const year = 1980 + (archive.readUInt16LE(at + 14) >> 9);
  return year;
})();
check('members carry a real date, not the ZIP epoch', stamped >= 2020, `${stamped}`);

const reopened = readCreatureModBuffer(archive);
check('the registry reads back out of the archive', reopened?.creatures.length === 1
  && reopened.creatures[0]!.id === c.id && reopened.creatures[0]!.number === 2);

// Without our manifest a mod is still readable — that is how somebody else's reads.
const stripped = packCreatureMod({ ...built, files: built.files.filter((f) => f.path !== MOD_MANIFEST) });
const guessed = readCreatureModBuffer(stripped);
check('and without the manifest, reconstructed from the game\'s own formats',
  guessed?.creatures.length === 1 && guessed.creatures[0]!.number === 2
  && guessed.creatures[0]!.stats.attack === 12 && guessed.creatures[0]!.stats.gold === 400);

// ---- the rules the registry keeps -------------------------------------------

console.log('\nthe registry');
const twice = miniatureMod();
check('the same id cannot be added twice', throws(() => addCreature(twice, { ...twice.creatures[0]! })));
check('nor two creatures with one file name', throws(() => addCreature(twice, {
  ...twice.creatures[0]!, id: 'CREATURE_OTHER',
})));
check('a bad id is refused', throws(() => addCreature(twice, { ...twice.creatures[0]!, id: 'sniper', file: 'x' })));
const grown = miniatureMod();
addCreature(grown, { ...grown.creatures[0]!, id: 'CREATURE_TEST_TWO', file: 'TestTwo' });
check('a second creature takes the next id and raises the ceiling',
  grown.creatures[1]!.number === 3 && creatureLimit(grown) === 4);
check('an empty mod is refused (there is nothing to open a slot for)',
  throws(() => buildCreatureMod(newCreatureMod(), () => null)));

// ---- 2. against the real Sharp Shooter ---------------------------------------

const dataRoot = process.env.HOMM5_DATA ?? join(import.meta.dirname, '..', 'data-unpacked');
if (!existsSync(join(dataRoot, 'types.xml'))) {
  console.log(`\nskipping the real-data checks — no unpacked data at ${dataRoot}`);
} else {
  console.log('\nover the shipped Sharp Shooter');
  const read = dataReader(dataRoot);
  const real = newCreatureMod();
  const rc = addCreature(real, {
    id: 'CREATURE_TEST_H3_SHARPSHOOTER',
    file: 'TestSharpshooter',
    name: 'Снайперы', description: 'test', abilitiesText: 'Shooter',
    stats: { ...blankStats(), attack: 12, shots: 32, range: -1, tier: 4, gold: 400 },
    visualSource: 'GameMechanics/CreatureVisual/Creatures/Preserve/3rd/SharpShooter.(CreatureVisual).xdb',
    monsterSource: 'MapObjects/Preserve/Alt_upgrade/Sharpshooter.(AdvMapMonsterShared).xdb',
  });
  const realBuilt = buildCreatureMod(real, read);
  const realFiles = byPath(realBuilt.files);
  check('the ceiling is the shipped count plus one', realBuilt.limit === SHIPPED_CREATURES + 1);
  check('the art came across whole', (realBuilt.art[rc.id] ?? 0) > 20, `${realBuilt.art[rc.id]} files`);
  check('the icon it borrowed is a real texture',
    dataPath(rc.from.icon).endsWith('.xdb') && read(dataPath(rc.from.icon)) !== null, rc.from.icon);

  // THE invariant. Every reference in a file the mod AUTHORS OR COPIES has to
  // land on something — a file the mod itself carries, or one the game already
  // has. The icon bug and the wrong-creature bug were both a reference that
  // pointed nowhere useful.
  //
  // The three files the mod edits are excluded: they are the game's own, and
  // UIGameRoot alone carries a dozen references to screens that were cut. What
  // we splice into them is checked above, by name.
  //
  // What the build itself reported as unresolved is excluded too — those are
  // authoring leftovers (.mb scenes, .tga originals, a clip FOLDER) that were
  // never shipped, and the build leaves them pointing where they pointed.
  const ours = new Set(['types.xml', 'GameMechanics/RefTables/Creatures.xdb', 'UI/UIGameRoot.(UIGameRoot).xdb']);
  const known = new Set(realBuilt.missing);
  const dangling: string[] = [];
  for (const f of realBuilt.files) {
    if (ours.has(f.path) || !f.path.toLowerCase().endsWith('.xdb')) continue;
    for (const m of f.data.toString('latin1').matchAll(/href="([^"]*)"/g)) {
      const href = m[1]!;
      const [raw] = href.split('#');
      if (!raw || /^\/?[A-Za-z]:/.test(raw)) continue;
      const rel = raw.startsWith('/')
        ? posix.normalize(raw).replace(/^\/+/, '')
        : posix.normalize(posix.join(posix.dirname(f.path), raw));
      if (realFiles.has(rel) || known.has(rel) || read(rel)) continue;
      dangling.push(`${f.path} → ${href}`);
    }
  }
  check('every reference in the mod resolves', dangling.length === 0, dangling.slice(0, 4).join('; '));

  // A creature with no icon is the one thing the startup check will not forgive.
  const realVisual = asText(realFiles, creaturePaths(rc).visual);
  check('the creature has an icon', /<Icon128 href="[^"]+"/.test(realVisual));

  // What the editor sees. Building the mod is not enough: until the editor reads
  // the mod the way the GAME does — layered over the data — the creature does not
  // exist for it. The army picker offered the shipped 180 and a map that placed
  // one of ours dropped the object from the scene, which is how this was found.
  console.log('\nmounted over the game data');
  const mounted = mkdtempSync(join(tmpdir(), 'homm5-units-'));
  try {
    writeCreatureMod(mounted, realBuilt);
    const chain = assets([mounted, dataRoot]);
    const roster = new Registry(chain).creatures();
    check('the roster grew by the mod\'s creatures', roster.length === SHIPPED_CREATURES + 1, `${roster.length}`);
    check('and it lists ours', roster.some((r) => r.id === rc.id));
    check('the shipped roster is unchanged without the mod',
      new Registry(dataRoot).creatures().length === SHIPPED_CREATURES);
    check('the map-stack definition resolves through the chain',
      chain.text(creaturePaths(rc).monster)?.includes(`<Creature>${rc.id}</Creature>`) === true);
    check('so does the art it points at',
      chain.exists(dataPath(hrefIn(asText(realFiles, creaturePaths(rc).monster), 'Model'))));
  } finally {
    rmSync(mounted, { recursive: true, force: true });
  }
}

/** An element's href in a document, for following one in a test. */
function hrefIn(text: string, field: string): string {
  return new RegExp(`<${field}\\s+href="([^"]*)"`).exec(text)?.[1] ?? '';
}

function throws(fn: () => unknown): boolean {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
