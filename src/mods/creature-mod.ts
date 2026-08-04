// The units mod — creatures the game does not ship with, as a project on disk.
//
// A creature added this way is a mod in `<game>/UserMODs/*.h5u`: the same ZIP
// container a pak is, applied after everything in `data/` including the addon's
// own `a2p1-*`. Nothing goes into `data/` and no `index.bin` is needed.
//
// `UserMODs/` is not the only place it can sit. A `.h5m` or a `.h5c` is mounted
// the same way and for the whole session, so these files can travel inside a
// campaign instead of beside it — see docs/ARCHIVES.md, which also covers why two
// maps that each carry a creature set collide exactly as two mods would.
//
// WHAT A MOD HAS TO CARRY. Three of the game's own files, edited:
//
//   types.xml                          the CREATURE_ enum, the name→number map,
//                                      and the ref table's declared size
//   GameMechanics/RefTables/Creatures.xdb   one entry per creature
//   UI/UIGameRoot.(UIGameRoot).xdb     a camera for the hire dialog
//
// and, per creature, five small files of its own plus its art. The `Creature`
// record itself is written INTO the ref table rather than shipped as a file:
// entries may carry their object inline under `href="#n:inline(Creature)"`, which
// is how the game's own WarMachines.xdb and MicroArtifactEffects.xdb are written.
// One camera entry covers every creature — its `<creatures>` is a list, and the
// game hangs Familiar, Imp and Quasit on one.
//
// What does NOT work, since it looks as though it should: pointing several ids at
// one *file*. The ids in WarMachines.xdb that appear to share a file share only
// the literal string `#n:inline(WarMachine)`, which is a marker and not a path.
// Every id needs its own object and its own ObjectRecordID.
//
// THE ART IS COPIED IN, NOT REFERENCED. A creature could point at the shipped
// model it borrows and be a few kilobytes; instead the whole reachable closure of
// that model — geometry, skeleton, animations, materials, textures, sounds and
// the binaries behind them, about 1.7 MB — is copied under the creature's own
// folder. That is the point: with the art inside, swapping a model or recolouring
// a texture is an edit to the mod and changes nothing else, and the mod stays
// self-contained wherever it goes. Copied geometry, skeletons and animations get
// a FRESH uid too, because their binaries are keyed by uid in `bin/…` and sharing
// one would mean editing our creature's mesh edited the original creature's.
//
// See docs/NEW_CREATURES.md in the port for how the ceiling was found and why the
// first several attempts at a mod were read and silently ignored.
//
// What is here is the BUILD — the creature's own documents, the three game files
// above, and the one pass that collects every other kind of content the mod
// carries. The rest is beside it:
//
//   mod-model.ts     what a mod HAS, and the editor's edits to it
//   mod-files.ts     the reader a build is given and the file set it returns
//   mod-archive.ts   writing it out, packing, installing, finding, reading back
//   mod-art.ts       copying a borrowed model's art in, and repainting it
//   xml-edit.ts      the text surgery every patch below is made of
//   artifact-files.ts · hero-files.ts · dwelling-files.ts
//                    the same job for the other three kinds of content

import { join } from 'node:path';
import { ABILITY_TABLE, EDITOR_ABILITIES, abilityTexts, patchAbilityTable, patchAbilityTypes } from './ability-files.ts';
import { NULL_CREATURE, creatureRoot, setCreatureRefs, writeStats } from './creatures.ts';
import { serialize, setAttr } from '../format/xml.ts';
import { parseTypeSpec } from '../schema/typespec.ts';
import { COMMON_SCRIPT, patchCommonScript, setScriptFiles } from './artifact-scripts.ts';
import {
  COMBAT_STARTUP, combatRuntimeFile, patchCombatStartup, skillCombatScripts, skillMapScripts,
  skillScriptFiles,
} from './skill-scripts.ts';
import { isIdentity } from '../format/recolor.ts';
import { EOL, count, hrefOf, insertAfterLine, insertBeforeLine, once, retune, setHref } from './xml-edit.ts';
import { MOD_MANIFEST, REF_TABLE, TYPES, UI_ROOT, mustRead, utf16 } from './mod-files.ts';
import type { BuildReport, DataReader, ModFile } from './mod-files.ts';
import { ART_FIELD, ART_SLOTS, copyArt, dataPath, repaint, uidFor } from './mod-art.ts';
import type { ArtSlot } from './mod-art.ts';
import { FIRST_RECORD_ID, LAST_SHIPPED, creatureLimit, modIsEmpty } from './mod-model.ts';
import type { CreatureMod, CreatureSpec, ModCreature } from './mod-model.ts';
import {
  ARTIFACT_TABLE, DEFAULT_STATS, STARTUP_SCRIPT, buildArtifacts, buildArtifactSets,
  patchArtifactTable, patchArtifactTypes, patchDefaultStats, patchSetTypes, patchStartupScript,
} from './artifact-files.ts';
import { buildBuildings } from './building-files.ts';
import { buildDwellings } from './dwelling-files.ts';
import { buildHeroes, texturePair } from './hero-files.ts';
import { patchSpecializationTypes } from './specializations.ts';
import {
  CLASS_TABLE, classNameFile, patchClassTable, patchClassTypes, patchSkillPrerequisites,
} from './hero-classes.ts';
import { SKILL_TABLE, patchSkillTable, patchSkillTypes, skillPictures, skillTexts } from './hero-skills.ts';

/** The camera the hire dialog uses. CREATURE_UNKNOWN already sits on this one. */
const HIRE_CAMERA = '/Cameras/Interface/HireCreatures.(Camera).xdb#xpointer(/Camera)';

/**
 * Where the editor's object palette looks for its entries.
 *
 * One tiny file per entry, and it ships in the paks — so a mod that drops one
 * here gains a palette entry, which is how the expansion added its own monsters.
 * Under `Monsters/` because the Filter dropdown's groups are folder prefixes read
 * from `Editor/MapFilters.xml`, a loose file no mod can add to: land outside a
 * known prefix and the entry is filed under "Other" instead of with the monsters.
 */
const LINK_DIR = 'MapObjects/_(AdvMapObjectLink)/Monsters/Units';

/** Where a creature's own files sit inside the mod. */
export function creaturePaths(c: CreatureSpec): {
  dir: string; art: string; link: string;
  visual: string; monster: string; name: string; description: string; abilities: string;
} {
  const dir = `Units/${c.file}`;
  return {
    dir,
    link: `${LINK_DIR}/${c.file}.xdb`,
    // The art keeps its original directory structure under here, so every
    // relative href inside it resolves exactly as it did in the game's data.
    art: `${dir}/art`,
    visual: `${dir}/${c.file}.(CreatureVisual).xdb`,
    monster: `${dir}/${c.file}.(AdvMapMonsterShared).xdb`,
    name: `${dir}/${c.file}_Name.txt`,
    description: `${dir}/${c.file}_Desc.txt`,
    abilities: `${dir}/${c.file}_Abils.txt`,
  };
}

/**
 * Build the whole mod: the three edited game files, and each creature's own five
 * plus its art.
 *
 * Nothing here touches the filesystem — `read` supplies the game's data and the
 * result is a file set, so the same code serves a project folder, an archive and
 * a test.
 */
export function buildCreatureMod(mod: CreatureMod, read: DataReader): BuildReport {
  if (modIsEmpty(mod)) throw new Error('the mod is empty');
  const limit = creatureLimit(mod);
  const files: ModFile[] = [];
  const art: Record<string, number> = {};
  const missing: string[] = [];

  for (const c of mod.creatures) {
    const p = creaturePaths(c);
    let visual = mustRead(read, c.visualSource);
    let monster = mustRead(read, c.monsterSource);

    // Resolve each art slot: the spec's override, else whatever the source
    // document already points at. Recorded on the creature either way — the
    // manifest is where provenance lives.
    const sources: Partial<Record<ArtSlot, string>> = {};
    for (const slot of ART_SLOTS) {
      const at = ART_FIELD[slot];
      const found = c.art?.[slot] ?? hrefOf(at.doc === 'visual' ? visual : monster, at.field);
      if (found) sources[slot] = dataPath(found);
    }
    if (!sources.icon) throw new Error(`${c.id}: no icon — a creature without one stops the game at startup`);
    c.from = sources as Record<ArtSlot, string>;

    const copied = copyArt(Object.values(sources), p.art, read, c.id);
    // The paint, if this creature carries any. Applied to the COPIES, so the
    // game's own textures are untouched and a rebuild reproduces the same
    // creature — which is the whole reason it is written down rather than done
    // to the archive afterwards.
    if (c.recolor && !isIdentity(c.recolor)) repaint(copied.files, c.recolor);
    for (const [path, data] of copied.files) files.push({ path, data });
    missing.push(...copied.missing);
    art[c.id] = copied.files.size;

    // Point the two documents at our copies and at our texts.
    for (const slot of ART_SLOTS) {
      const src = sources[slot];
      if (!src) continue;
      const to = copied.at.get(src);
      if (!to) throw new Error(`${c.id}: ${slot} art ${src} is not in the game's data`);
      const at = ART_FIELD[slot];
      const value = `/${to}#xpointer(/${at.type})`;
      if (at.doc === 'visual') visual = setHref(visual, at.field, value, c.visualSource);
      else monster = setHref(monster, at.field, value, c.monsterSource);
    }

    files.push({ path: p.visual, data: Buffer.from(creatureVisual(visual, p, c.visualSource), 'latin1') });
    files.push({ path: p.monster, data: Buffer.from(monsterShared(monster, p, c), 'latin1') });
    // The palette entry. Its icon names the creature's own 128px texture, which
    // the art copy already put in the mod: the editor's thumbnail cache is keyed
    // by link path and a mod has no entry in it, so without this the tile is
    // blank among 185 that are not.
    files.push({ path: p.link, data: Buffer.from(objectLink(p, copied.at.get(sources.icon!) ?? ''), 'latin1') });
    files.push({ path: p.name, data: utf16(c.name) });
    files.push({ path: p.description, data: utf16(c.description) });
    // The line the hire dialog prints, built from the abilities the creature
    // HAS rather than typed beside them — so it cannot promise something the
    // creature cannot do. A spec that carries its own words still wins.
    files.push({ path: p.abilities, data: utf16(c.abilitiesText || abilityLine(read, c.stats.abilities)) });
  }

  files.push(...buildDwellings(mod.dwellings, read));
  files.push(...buildBuildings(mod.buildings ?? [], read));
  files.push(...buildArtifacts(mod.artifacts ?? [], read));
  files.push(...buildArtifactSets(mod.sets ?? []));
  files.push(...buildHeroes(mod.heroes ?? [], read, mod.specializations ?? []));

  // Only creatures need the game's own files touched: the enum and the id→number
  // map in types.xml, the reference table the ceiling indexes, and the hire
  // screen. A mod of nothing but dwellings edits nothing of the game's and needs
  // no patched executable — so it must not carry these at all.
  //
  // Artifacts extend a reference table too, so they touch types.xml as well —
  // but only the artifact half of it, and never the executable. The two patches
  // are applied to the SAME text, in one pass, because a mod that carried both
  // would otherwise ship two types.xml and the second would win whole.
  const artifacts = mod.artifacts ?? [];
  const sets = mod.sets ?? [];
  const specializations = mod.specializations ?? [];
  // A class and a skill are reference tables like the creatures': the size is
  // declared three times in types.xml and once in the executable, and all four
  // move together or the game reads a table it will not use.
  const classes = mod.classes ?? [];
  const skills = mod.skills ?? [];
  if (mod.creatures.length || artifacts.length || sets.length || specializations.length
    || classes.length || skills.length) {
    let types = mustRead(read, TYPES);
    if (mod.creatures.length) types = patchTypes(types, mod, limit);
    if (artifacts.length) types = patchArtifactTypes(types, artifacts);
    if (sets.length) types = patchSetTypes(types, sets);
    // A specialization is one enum entry and nothing else — no table to extend,
    // no size to retune, and no executable to patch. It is the whole of what
    // the data can say about one; what it DOES comes from the extension.
    if (specializations.length) types = patchSpecializationTypes(types, specializations);
    if (classes.length) types = patchClassTypes(types, classes);
    if (skills.length) types = patchSkillTypes(types, skills);
    // The editor's own creature abilities — tags, which do nothing until
    // something asks about them. Shipped with any mod that has creatures, so
    // that the id a creature's record names always exists in the table beside
    // it. See ability-files.ts.
    if (mod.creatures.length) types = patchAbilityTypes(types, EDITOR_ABILITIES);
    files.push({ path: TYPES, data: Buffer.from(types, 'latin1') });
  }
  if (mod.creatures.length) {
    files.push({
      path: ABILITY_TABLE,
      data: Buffer.from(patchAbilityTable(mustRead(read, ABILITY_TABLE), EDITOR_ABILITIES), 'latin1'),
    });
    files.push(...abilityTexts(EDITOR_ABILITIES));
  }
  if (classes.length) {
    files.push({
      path: CLASS_TABLE,
      data: Buffer.from(patchClassTable(mustRead(read, CLASS_TABLE), classes), 'latin1'),
    });
    for (const c of classes) files.push({ path: classNameFile(c).path, data: utf16(c.name) });
  }
  // ONE Skills.xdb, however many reasons there are to edit it: a mod that
  // shipped two copies would keep whichever the archive listed last, and the
  // other edit would be gone without a word. Ours are appended first, then the
  // shipped perks our classes were allowed are opened to them.
  if (skills.length || classes.some((c) => c.allowedPerks?.length)) {
    let table = mustRead(read, SKILL_TABLE);
    if (skills.length) table = patchSkillTable(table, skills);
    table = patchSkillPrerequisites(table, classes);
    files.push({ path: SKILL_TABLE, data: Buffer.from(table, 'latin1') });
    for (const s of skills) {
      for (const f of skillTexts(s)) files.push({ path: f.path, data: utf16(f.text) });
      // Its own icons, built from the drawings the same way a hero's face is.
      for (const drawn of skillPictures(s)) {
        files.push(...texturePair(drawn.picture, 64, drawn.file.dds, drawn.file.xdb));
      }
    }
  }
  if (mod.creatures.length) {
    files.push({ path: REF_TABLE, data: Buffer.from(patchRefTable(mustRead(read, REF_TABLE), mod, read), 'latin1') });
    files.push({ path: UI_ROOT, data: Buffer.from(patchUiRoot(mustRead(read, UI_ROOT), mod), 'latin1') });
  }
  if (artifacts.length) {
    const spec = parseTypeSpec(mustRead(read, TYPES));
    files.push({
      path: ARTIFACT_TABLE,
      data: Buffer.from(patchArtifactTable(mustRead(read, ARTIFACT_TABLE), artifacts, spec), 'latin1'),
    });
    files.push({
      path: STARTUP_SCRIPT,
      data: Buffer.from(patchStartupScript(mustRead(read, STARTUP_SCRIPT), artifacts), 'latin1'),
    });
  }
  if (sets.length) {
    files.push({
      path: DEFAULT_STATS,
      data: Buffer.from(patchDefaultStats(mustRead(read, DEFAULT_STATS), sets), 'latin1'),
    });
  }

  // Lua, from whatever in the mod carries any: a set that reacts to something, a
  // skill whose content is an event rather than a number. Each contributes its
  // own file, and the game's global script gets a line loading it — but only
  // when there is something to load, because a mod that replaces
  // advmap-common.lua for nothing is a mod that can only break something.
  //
  // Two global scripts, not one, and they are not interchangeable: the adventure
  // map's runs on every map, the battle's inside every battle, and a skill can
  // want both halves (src/mods/skill-scripts.ts).
  const scripts = [...setScriptFiles(sets), ...skillScriptFiles(skills)];
  for (const f of scripts) files.push({ path: f.path, data: Buffer.from(f.text, 'latin1') });
  const onTheMap = skillMapScripts(skills);
  if (setScriptFiles(sets).length || onTheMap.length) {
    files.push({
      path: COMMON_SCRIPT,
      data: Buffer.from(patchCommonScript(mustRead(read, COMMON_SCRIPT), sets, onTheMap), 'latin1'),
    });
  }
  // Carried for the trigger runtime as well as for the scripts: a skill may want
  // a moment inside a battle without carrying a file of its own, and the
  // vocabulary that lets it say so lives in this file's tail.
  if (skillCombatScripts(skills).length || skills.length) {
    // Two files: the game's own with one line added, and ours behind that line.
    // Separate chunks — see COMBAT_RUNTIME in src/mods/skill-scripts.ts for what
    // sharing one chunk with the game cost.
    const runtime = combatRuntimeFile(skills);
    files.push({
      path: COMBAT_STARTUP,
      data: Buffer.from(patchCombatStartup(mustRead(read, COMBAT_STARTUP), skills), 'latin1'),
    });
    files.push({ path: runtime.path, data: Buffer.from(runtime.text, 'latin1') });
  }

  // Last, so it records the art each slot actually resolved to.
  files.unshift({ path: MOD_MANIFEST, data: Buffer.from(`${JSON.stringify(mod, null, 2)}\n`, 'utf8') });

  return { files, limit, art, missing };
}

/**
 * The files every dwelling in the mod contributes: its document, its palette
 * entry, and a text file for each message given as text rather than a reference.
 *
 * The model is REFERENCED, not copied — the opposite of a creature's art, and for
 * a reason: a creature's art is copied so the mod can recolour or replace it
 * without touching the original, while a dwelling stands on a shipped building
 * every install already has. Copying one would add megabytes for nothing. A
 * dwelling that wants art of its own can point at a model the mod carries; the
 * href is the href either way.
 */
/** What ends a game text: they are NUL-terminated, padding included. */
const TEXT_END = String.fromCharCode(0);

/**
 * A creature's abilities in the words a player reads, joined as the game joins
 * them.
 *
 * `CombatAbilities.xdb` pairs every `ABILITY_…` with the text files the game
 * prints, so the hire dialog's line can be DERIVED from what the creature has.
 * Read through the same DataReader as the rest of the build, so a mod shipping
 * its own texts is honoured exactly as the game would honour it.
 */
function abilityLine(read: DataReader, abilities: readonly string[]): string {
  if (!abilities.length) return '';
  const table = read('GameMechanics/RefTables/CombatAbilities.xdb')?.toString('utf8') ?? '';
  const named = new Map<string, string>();
  for (const m of table.matchAll(/<ID>(ABILITY_[A-Z0-9_]+)<\/ID>[\s\S]*?<NameFileRef href="([^"]*)"/g)) {
    if (!m[2]) continue;
    const bytes = read(m[2].replace(/^\/+/, ''));
    if (!bytes || !bytes.length) continue;
    const raw = bytes[0] === 0xff && bytes[1] === 0xfe ? bytes.toString('utf16le', 2) : bytes.toString('utf8');
    const text = raw.split(TEXT_END)[0]!.trim();
    if (text) named.set(m[1]!, text);
  }
  // An id the table does not name keeps its id: a line with ABILITY_SOMETHING
  // in it is ugly and true, which beats a line that quietly drops an ability.
  return abilities.map((id) => named.get(id) ?? id).join(', ');
}

// --- the creature's own two documents ----------------------------------------

/** Our copy of a shipped `CreatureVisual`: same art, our name and description. */
function creatureVisual(visual: string, p: ReturnType<typeof creaturePaths>, source: string): string {
  let t = visual;
  for (const [field, path] of [
    ['CreatureNameFileRef', p.name],
    ['CreatureAbilitiesFileRef', p.abilities],
    ['DescriptionFileRef', p.description],
  ] as Array<[string, string]>) {
    t = setHref(t, field, `/${path}`, source);
  }
  return t;
}

/**
 * The palette entry: a link file pointing at our map-stack definition.
 *
 * `IconFile` is where this departs from the shipped links. Theirs name a `.tga`
 * under an authoring tree that was never shipped — that file BUILT
 * `Editor/IconCache`, and the editor reads the cache, keyed by link path. A mod
 * cannot add to the cache, so ours names the creature's own 128px texture, which
 * the art copy already placed in the mod, and the icon handler falls back to it.
 */
function objectLink(p: ReturnType<typeof creaturePaths>, icon: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<AdvMapObjectLink>',
    `\t<Link href="/${p.monster}#xpointer(/AdvMapMonsterShared)"/>`,
    '\t<RndGroup/>',
    `\t<IconFile>${icon}</IconFile>`,
    '\t<HideInEditor>false</HideInEditor>',
    '</AdvMapObjectLink>',
  ].join(EOL) + EOL;
}

/**
 * Our copy of a shipped `AdvMapMonsterShared` — and the one line that matters.
 *
 * `<Creature>` at the end of the file is the ONLY thing deciding which creature a
 * stack on the map is: an `AdvMapMonster` object carries no creature field of its
 * own, just a reference to one of these. Copy one without changing that line and
 * the map places the creature you copied from, with its stats and its name,
 * however new everything else about the definition is.
 */
function monsterShared(monster: string, p: ReturnType<typeof creaturePaths>, c: ModCreature): string {
  let t = monster;
  const messages = /<messagesFileRef>[\s\S]*?<\/messagesFileRef>/;
  if (!messages.test(t)) throw new Error(`${c.monsterSource}: no <messagesFileRef>`);
  t = t.replace(messages, `<messagesFileRef>${EOL}\t\t<Item href="/${p.name}"/>${EOL}\t</messagesFileRef>`);

  const creature = /<Creature>CREATURE_[A-Z0-9_]+<\/Creature>/;
  if (!creature.test(t)) throw new Error(`${c.monsterSource}: no <Creature> naming the stack's creature`);
  return t.replace(creature, `<Creature>${c.id}</Creature>`);
}

// --- the game's three files ---------------------------------------------------

/** types.xml: the enum, the name→number map, and the ref table's declared size. */
function patchTypes(types: string, mod: CreatureMod, limit: number): string {
  let t = types;

  const enumAt = once(t, `<Item>${LAST_SHIPPED}</Item>`, 'types.xml enum');
  t = insertAfterLine(t, enumAt, mod.creatures.map((c) => `<Item>${c.id}</Item>`));

  // The name→number map. Numbers are what maps and saves store, so this is the
  // part that must never be reshuffled — see addCreature.
  const mapAt = once(t, `<Name>${LAST_SHIPPED}</Name>`, 'types.xml name→number map');
  const itemEnd = t.indexOf('</Item>', mapAt);
  if (itemEnd < 0) throw new Error('types.xml name→number map: the last entry has no </Item>');
  t = insertAfterLine(t, itemEnd, mod.creatures.flatMap((c) => [
    '<Item>', `\t<Name>${c.id}</Name>`, `\t<Value>${c.number}</Value>`, '</Item>',
  ]));

  // How many objects the table is declared to hold. MinElements stays where it
  // is: it is a floor, and the new count clears it.
  const table = once(t, '<TypeName>Table_Creature_CreatureType</TypeName>', 'types.xml creature table');
  const numObjs = t.indexOf('<Key>ref_table_num_objs</Key>', table);
  if (numObjs < 0) throw new Error('types.xml creature table: no ref_table_num_objs');
  t = retune(t, numObjs, 'Data', mod.first, limit, 'types.xml ref_table_num_objs');
  return retune(t, table, 'MaxElements', mod.first, limit, 'types.xml MaxElements');
}

/** Creatures.xdb: one entry per creature, each carrying its own inline object. */
function patchRefTable(table: string, mod: CreatureMod, read: DataReader): string {
  const had = count(table, /<ID>CREATURE_/g);
  if (had !== mod.first) throw new Error(`${REF_TABLE}: ${had} entries, expected ${mod.first}`);

  const nul = mustRead(read, NULL_CREATURE);
  const close = once(table, '</objects>', `${REF_TABLE} objects`);
  const t = insertBeforeLine(table, close, mod.creatures.flatMap((c, i) => {
    const p = creaturePaths(c);
    const creature = creatureRoot(nul);
    writeStats(creature, c.stats);
    setCreatureRefs(creature, `/${p.visual}`, `/${p.monster}`);
    setAttr(creature, 'ObjectRecordID', String(FIRST_RECORD_ID + i));
    return [
      '<Item>',
      `\t<ID>${c.id}</ID>`,
      // The id has to be unique across the table and nothing appears to read it,
      // so it is derived from the creature — which keeps a rebuild byte-identical.
      `\t<Obj href="#n:inline(Creature)" id="item_${uidFor(`obj:${c.id}`).toLowerCase()}">`,
      ...serialize(creature).split(/\r?\n/).map((l) => `\t\t${l}`),
      '\t</Obj>',
      '</Item>',
    ];
  }));

  const now = count(t, /<ID>CREATURE_/g);
  if (now !== creatureLimit(mod)) throw new Error(`${REF_TABLE}: ended with ${now} entries, expected ${creatureLimit(mod)}`);
  return t;
}

/** UIGameRoot: one camera entry, listing every creature we added. */
function patchUiRoot(ui: string, mod: CreatureMod): string {
  const close = once(ui, '</creaturesCameras>', `${UI_ROOT} cameras`);
  return insertBeforeLine(ui, close, [
    '<Item>',
    `\t<Camera href="${HIRE_CAMERA}"/>`,
    '\t<creatures>',
    ...mod.creatures.map((c) => `\t\t<Item>${c.id}</Item>`),
    '\t</creatures>',
    '</Item>',
  ]);
}
