// Validates the hero side of a mod — the characters a player commands.
//
// A hero is the cheapest thing this editor adds: no enum, no reference table,
// no ceiling, and nothing of the game's overwritten. So the checks are about
// whether the document we write is a hero the game would recognise, and every
// one of them is measured against the SHIPPED heroes rather than against what
// this file thinks a hero looks like:
//
//   the shape — the fields we write are the fields the shipped heroes carry,
//     in the order types.xml declares them;
//   the preset — everything not asked for stays as the document it was seeded
//     from has it, and the art it names is copied into his own folder;
//   the identity — Class, TownType, Specialization and PrimarySkill are the
//     four the map cannot reach, and they are what a new hero exists for;
//   the racial slot — a hero may hold a non-racial skill there, because the
//     shipped Erasial does;
//   the pools — ScenarioHero decides tavern membership, and the shipped maps
//     say exactly which heroes that is.
//
//   node tools/test-heroes.ts [dataRoot]

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { assets } from '../src/game/assets.ts';
import { buildCreatureMod } from '../src/mods/creature-mod.ts';
import { addHero, newCreatureMod } from '../src/mods/mod-model.ts';
import { dataReader } from '../src/mods/mod-files.ts';
import { artLabels, HERO_CLASS, heroDoc, heroHref, heroInternalName, heroPaths, takenHeroIds } from '../src/mods/heroes.ts';
import type { HeroSpec } from '../src/mods/heroes.ts';
import { allFields, parseTypeSpec } from '../src/schema/typespec.ts';
import { children, find, parse, text } from '../src/format/xml.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const dataRoot = process.argv[2] ?? process.env.HOMM5_DATA ?? join(import.meta.dirname, '..', 'data-unpacked');
if (!existsSync(join(dataRoot, 'types.xml'))) {
  console.log(`no unpacked data at ${dataRoot} — nothing to compare against`);
  process.exit(0);
}
const data = assets([dataRoot]);

const DONOR = 'MapObjects/Preserve/Ossir.(AdvMapHeroShared).xdb';
const donorXml = data.text(DONOR);
if (!donorXml) {
  console.log(`no donor at ${DONOR}`);
  process.exit(1);
}

/** Gem: the pilot of the Heroes III port, and the reason this module exists. */
const GEM: HeroSpec = {
  id: 'H3Gem',
  name: 'Gem',
  biography: 'A sorceress of Enroth, newly come to AvLee.',
  basedOn: DONOR,
  town: 'TOWN_PRESERVE',
  heroClass: 'HERO_CLASS_RANGER',
  specialization: 'HERO_SPEC_ELVES',
  primarySkill: { skill: 'HERO_SKILL_AVENGER', mastery: 'MASTERY_BASIC' },
  stats: { offence: 0, defence: 1, spellpower: 2, knowledge: 2 },
  skills: [{ skill: 'HERO_SKILL_WAR_MACHINES', mastery: 'MASTERY_BASIC' }],
  perks: ['HERO_SKILL_FIRST_AID'],
  spells: ['SPELL_LIGHTNING_BOLT'],
  machines: { firstAidTent: true },
};

const p = heroPaths(GEM);
const built = heroDoc(GEM, donorXml, p);
const root = (() => {
  const doc = parse(built);
  return doc.name === HERO_CLASS ? doc : find(doc, HERO_CLASS)!;
})();
const field = (name: string): string => text(find(root, name));

// ---- 1. the shape, against what types.xml declares ---------------------------

console.log('the document, against the type');

const types = parseTypeSpec(readFileSync(join(dataRoot, 'types.xml'), 'utf8'));
const declared = allFields(types, HERO_CLASS).map((f) => f.name);
const written = children(root).map((c) => c.name);

check('every field we write is declared by the type', written.every((n) => declared.includes(n)),
  written.filter((n) => !declared.includes(n)).join(', ') || `${written.length} fields`);

const order = written.filter((n) => declared.includes(n));
const inOrder = order.every((n, i) => i === 0 || declared.indexOf(order[i - 1]!) <= declared.indexOf(n));
check('the fields keep the order the type declares', inOrder);

// The donor's own shape is the reference: we replace values, never structure.
const donorFields = children(parse(donorXml).name === HERO_CLASS
  ? parse(donorXml) : find(parse(donorXml), HERO_CLASS)!).map((c) => c.name);
check('the document has the donor\'s fields, no more and no fewer',
  written.length === donorFields.length && written.every((n, i) => n === donorFields[i]),
  `${written.length} vs ${donorFields.length}`);

// ---- 2. the identity — the four a map cannot reach ---------------------------

console.log('\nwho he is');

check('Class is ours', field('Class') === GEM.heroClass, field('Class'));
check('TownType is ours', field('TownType') === GEM.town, field('TownType'));
check('Specialization is ours', field('Specialization') === GEM.specialization, field('Specialization'));
check('InternalName is the identifier — a campaign carries him by it',
  field('InternalName') === GEM.id && heroInternalName(built) === GEM.id);

const slot = find(root, 'PrimarySkill')!;
check('the racial slot holds the skill asked for',
  text(find(slot, 'SkillID')) === 'HERO_SKILL_AVENGER' && text(find(slot, 'Mastery')) === 'MASTERY_BASIC');

// A hero of a faction whose racial skill he does NOT hold is legal: Erasial is
// a Demon Lord with Logistics in the slot, so the module must not "correct" it.
const odd = heroDoc({ ...GEM, primarySkill: { skill: 'HERO_SKILL_LOGISTICS', mastery: 'MASTERY_BASIC' } }, donorXml, p);
const oddSlot = find(parse(odd).name === HERO_CLASS ? parse(odd) : find(parse(odd), HERO_CLASS)!, 'PrimarySkill')!;
check('a non-racial skill in the racial slot is kept, as Erasial has it',
  text(find(oddSlot, 'SkillID')) === 'HERO_SKILL_LOGISTICS');

const erasial = data.text('MapObjects/Inferno/Erasial.(AdvMapHeroShared).xdb') ?? '';
const erasialRoot = find(parse(erasial), HERO_CLASS) ?? parse(erasial);
check('...which is what the shipped Erasial really does',
  text(find(find(erasialRoot, 'PrimarySkill')!, 'SkillID')) === 'HERO_SKILL_LOGISTICS'
  && text(find(erasialRoot, 'Class')) === 'HERO_CLASS_DEMON_LORD');

// ---- 3. the donor — what we did not ask for is his --------------------------

console.log('\nwhat the donor keeps');

const donorRoot = find(parse(donorXml), HERO_CLASS) ?? parse(donorXml);
const donorOf = (name: string): string => {
  const el = find(donorRoot, name);
  return el ? (el.attrs.href ?? text(el)) : '';
};
const oursOf = (name: string): string => {
  const el = find(root, name);
  return el ? (el.attrs.href ?? text(el)) : '';
};

// heroDoc() alone names the preset's files; the mod build then copies them in
// and repoints these fields at the copies (checked further down). What matters
// here is that the document asked for the right art in the first place.
for (const art of ['Model', 'AnimSet', 'HeroCharacterArena', 'HeroCharacterAdventure', 'CombatVisual', 'Selection', 'Trace']) {
  check(`${art} is the preset's, before the build copies it in`, oursOf(art) === donorOf(art) && !!donorOf(art));
}
check('the portrait is the donor\'s until one is given', oursOf('FaceTexture') === donorOf('FaceTexture'));

// ---- 4. our own texts -------------------------------------------------------

console.log('\nhis own words');

const editable = find(root, 'Editable')!;
check('the name points at our file', find(editable, 'NameFileRef')?.attrs.href === `/${p.name}`,
  find(editable, 'NameFileRef')?.attrs.href);
check('the biography points at our file', find(editable, 'BiographyFileRef')?.attrs.href === `/${p.biography}`);
check('stats are ours', [
  text(find(editable, 'Offence')), text(find(editable, 'Defence')),
  text(find(editable, 'Spellpower')), text(find(editable, 'Knowledge')),
].join(',') === '0,1,2,2');

const skills = children(find(editable, 'skills')!);
check('the starting skill is ours, as a skill/mastery pair',
  skills.length === 1 && text(find(skills[0]!, 'SkillID')) === 'HERO_SKILL_WAR_MACHINES'
  && text(find(skills[0]!, 'Mastery')) === 'MASTERY_BASIC');
check('the perk is ours', children(find(editable, 'perkIDs')!).map((i) => text(i)).join() === 'HERO_SKILL_FIRST_AID');
check('the spell is ours', children(find(editable, 'spellIDs')!).map((i) => text(i)).join() === 'SPELL_LIGHTNING_BOLT');
check('the first aid tent is ours', text(find(editable, 'FirstAidTent')) === 'true');
check('a machine not asked for is the donor\'s',
  text(find(editable, 'Ballista')) === text(find(find(donorRoot, 'Editable')!, 'Ballista')));

// ---- 5. the pools -----------------------------------------------------------

console.log('\nwhere he turns up');

check('a new hero is a person, not a fixture', field('ScenarioHero') === 'false');
check('asking for a fixture gives one',
  (() => {
    const x = heroDoc({ ...GEM, scenarioHero: true }, donorXml, p);
    const r = find(parse(x), HERO_CLASS) ?? parse(x);
    return text(find(r, 'ScenarioHero')) === 'true';
  })());

// The claim ScenarioHero rests on: the heroes a fully-checked map lists are
// exactly the non-scenario ones. Read it off the game rather than trust it.
const shippedHeroes: string[] = [];
(function walk(dir: string): void {
  for (const e of readdirSync(join(dataRoot, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel);
    else if (e.name.endsWith(`.(${HERO_CLASS}).xdb`)) shippedHeroes.push(rel);
  }
})('MapObjects');

const nonScenario = new Set(shippedHeroes.filter((f) =>
  (data.text(f) ?? '').includes('<ScenarioHero>false</ScenarioHero>')));
const listed = new Set([...(data.text('Maps/Multiplayer/A1L10/map.xdb') ?? '')
  .matchAll(/<AvailableHeroes>([\s\S]*?)<\/AvailableHeroes>/g)]
  .flatMap((m) => [...m[1]!.matchAll(/href="\/([^"#]+)/g)].map((h) => h[1]!)));

check('a fully-listed map offers exactly the non-scenario heroes',
  listed.size === nonScenario.size && [...listed].every((f) => nonScenario.has(f)),
  `${listed.size} listed, ${nonScenario.size} non-scenario, of ${shippedHeroes.length} shipped`);

check('the href a pool points at is the one we generate',
  heroHref(p) === `/Heroes/H3Gem/H3Gem.(AdvMapHeroShared).xdb#xpointer(/AdvMapHeroShared)`, heroHref(p));

// ---- 6. the paths -----------------------------------------------------------

console.log('\nwhere his files go');

check('everything is under his own folder', [p.shared, p.name, p.biography].every((f) => f.startsWith('Heroes/H3Gem/')));
check('nothing of the game\'s is overwritten',
  [p.shared, p.name, p.biography].every((f) => !existsSync(join(dataRoot, f))));

// ---- 6b. labels a person can choose between ---------------------------------

console.log('\nthe appearance dropdowns');

// Every Selection model in the game is called Symbol; the folder is what says
// whose it is. A label that stopped at the file name gave eight identical rows.
const selections = [...new Set(shippedHeroes
  .map((f) => /<Selection href="([^"]*)"/.exec(data.text(f) ?? '')?.[1] ?? '')
  .filter(Boolean).map((h) => h.split('#')[0]!))];
const labels = artLabels(selections);
check('every Selection is called Symbol, so the file name alone cannot do',
  selections.every((h) => /\/Symbol(\.\([^)]*\))?\.xdb$/i.test(h)), `${selections.length} of them`);
check('...and the labels tell them apart anyway',
  new Set(labels.values()).size === selections.length,
  [...labels.values()].slice(0, 3).join(', '));
check('...without the library folder in the way',
  [...labels.values()].every((l) => !l.includes('_(')), [...labels.values()][0]);

// Traces differ by file name, so they stay short — the label grows only as far
// as it has to.
const traces = [...new Set(shippedHeroes
  .map((f) => /<Trace href="([^"]*)"/.exec(data.text(f) ?? '')?.[1] ?? '')
  .filter(Boolean).map((h) => h.split('#')[0]!))];
const traceLabels = artLabels(traces);
check('a slot that differs by file name keeps one-word labels',
  [...traceLabels.values()].every((l) => !l.includes('/')),
  [...traceLabels.values()].sort().join(', '));

// ---- 7. the mod he ships in -------------------------------------------------

console.log('\nthe mod, built');

const mod = newCreatureMod();
addHero(mod, GEM);
const files = buildCreatureMod(mod, dataReader(dataRoot)).files;
const paths = files.map((f) => f.path);

// His own four — document, name, biography, and the art copied in beside them —
// plus the palette entry, which sits with the other palette entries.
check('the document is his', paths.includes(p.shared));
check('his texts are beside it', paths.includes(p.name) && paths.includes(p.biography));

// The art, copied into his folder rather than referenced. It is what lets a
// hero be recoloured or re-modelled without the shipped hero changing too —
// the same bargain a creature makes, and the reason it is megabytes not
// kilobytes.
const art = paths.filter((f) => f.startsWith(`${p.dir}/art/`));
check('his art is copied into his own folder', art.length > 50, `${art.length} files`);
check('...the model among it', art.some((f) => /Ranger_LOD-geom\.xdb$/.test(f)));
check('...and its textures', art.some((f) => f.endsWith('.dds')));

// And the document points at the COPIES: art copied in but still referenced
// where it came from would be megabytes bought for nothing.
const heroXml = files.find((f) => f.path === p.shared)!.data.toString('latin1');
check('the document points at the copies, not the shipped files',
  /<Model href="\/Heroes\/H3Gem\/art\//.test(heroXml),
  /<Model href="([^"]*)"/.exec(heroXml)?.[1]);

// Binaries are keyed by uid, so a copy needs one of its own — sharing the
// donor's would mean editing our mesh edited the shipped hero's.
const bins = paths.filter((f) => f.startsWith('bin/'));
check('its binaries got fresh uids', bins.length > 0
  && bins.every((f) => !existsSync(join(dataRoot, f))), `${bins.length} binaries`);
check('and a palette entry, so he can be placed on a map', paths.includes(p.link), p.link);
check('the entry points at him', (() => {
  const link = files.find((f) => f.path === p.link)!.data.toString('latin1');
  return link.includes(`<Link href="${heroHref(p)}"/>`);
})());

// The point of the whole exercise: unlike a creature or an artifact, a hero
// extends nothing, so a heroes-only mod must carry not one file of the game's.
const shipped = paths.filter((f) => existsSync(join(dataRoot, f)));
check('a heroes-only mod touches nothing of the game\'s', shipped.length === 0, shipped.join(', '));
check('...not even types.xml, which creatures and artifacts must edit',
  !paths.includes('types.xml'));

// The texts the game reads are UTF-16, like every other name in a mod.
const nameFile = files.find((f) => f.path === p.name)!;
check('his name is UTF-16 with a BOM, as the game reads texts',
  nameFile.data[0] === 0xff && nameFile.data[1] === 0xfe
  && nameFile.data.toString('utf16le').slice(1) === 'Gem');

// The identifier is the one thing that must be his alone — in the mod, and in
// the game, whose own 118 are just as much in the way.
check('a second hero of the same identifier is refused', (() => {
  try { addHero(mod, GEM); return false; } catch { return true; }
})());
check('an identifier a shipped hero already answers to is refused', (() => {
  const taken = takenHeroIds(shippedHeroes.map((f) => ({ id: `/${f}` })), (rel) => data.text(rel));
  try { addHero(mod, { ...GEM, id: 'Ossir' }, taken); return false; } catch { return true; }
})());
check('...and the set it checks against holds both halves of what a hero answers to',
  (() => {
    const taken = takenHeroIds(shippedHeroes.map((f) => ({ id: `/${f}` })), (rel) => data.text(rel));
    // Ossir is his file stem AND his InternalName; Biara_Saint_Isabel is a file
    // whose document calls him something else, so the set must hold both.
    return taken.has('Ossir') && taken.size > shippedHeroes.length;
  })(), 'file stems and internal names');

console.log(failures ? `\n${failures} failure(s)` : '\nall good');
process.exit(failures ? 1 : 0);
