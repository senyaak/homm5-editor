// A newly placed object must look like one the ORIGINAL editor placed.
//
//   1. Self-contained (always runs): a donor with a designer's tuning on it —
//      Amount 4, Custom true, a reward artifact, a name — comes out at the
//      measured defaults, with a script handle of its own. Plus the two empty
//      forms the game distinguishes (`href=""` vs no attribute at all), and the
//      rule that a field the donor does not have is never invented.
//   2. Naming: handles are unique, numbered per type, and a requested name that
//      is taken gets suffixed rather than silently replaced.
//   3. Against the measurement (always runs): place one object of every type
//      and diff it field by field against what the ORIGINAL editor wrote. This
//      is the check that catches the schema drifting from the game — the other
//      two only prove the machinery works.
//
//      The reference is tools/fixtures/object-defaults.json, generated from a
//      map made in the original editor for the purpose. It is committed on
//      purpose: keeping the reference in a .h5m on one machine meant this
//      check silently did nothing everywhere else. Re-measure with
//      `npm run object-defaults -- <map.h5m> --fixture`; pass a .h5m here to
//      diff against it directly instead.
//   4. Against the GAME'S OWN SPEC (needs game data): `<data>/types.xml`
//      declares every type's fields and, for some of them, the engine's default
//      value. Two independent sources — one says what the ENGINE expects, the
//      other what the EDITOR writes — and where they overlap they must agree.
//      They never have. The spec covers only a fraction of the fields, which is
//      why it does not replace the measurement; what it declares and our schema
//      does not is listed at the end as work, not as a failure.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadMap } from '../src/map.ts';
import type { HommMap } from '../src/map.ts';
import { applyDefaults, undefaulted } from '../src/defaults.ts';
import { readEntries } from '../src/pak.ts';
import { pickMapRel } from '../src/project.ts';
import { parse, find, childText, serialize } from '../src/xml.ts';
import { objectProps, objectSchema, mapSchema } from '../src/schema.ts';
import type { FieldSchema } from '../src/schema.ts';
import { readTypeSpec, declaredDefaults, typesXmlPath } from '../src/typespec.ts';
import type { XmlElement } from '../src/xml.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

/** An empty map document to place things into. */
function blankMap(): HommMap {
  return loadMap([
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<AdvMapDesc>',
    '\t<objects>',
    '\t</objects>',
    '</AdvMapDesc>',
  ].join('\r\n'));
}

/** A monster as a designer left it: tuned, named, and not what a new one is. */
const TUNED_MONSTER = [
  '<Item href="#n:inline(AdvMapMonster)" id="item_OLD">',
  '\t<AdvMapMonster>',
  '\t\t<Pos><x>9</x><y>9</y><z>0</z></Pos>',
  '\t\t<Rot>3</Rot>',
  '\t\t<Floor>1</Floor>',
  '\t\t<Name>guard_of_the_pass</Name>',
  '\t\t<CombatScript href="fight.lua"/>',
  '\t\t<Shared href="/MapObjects/Old.xdb"/>',
  '\t\t<Custom>true</Custom>',
  '\t\t<Amount>4</Amount>',
  '\t\t<Mood>MONSTER_MOOD_HOSTILE</Mood>',
  '\t\t<ArtifactID>ARTIFACT_TITANS_THUNDER</ArtifactID>',
  '\t\t<Resources><Wood>5</Wood><Ore>5</Ore><Mercury>0</Mercury><Crystal>0</Crystal><Sulfur>0</Sulfur><Gem>0</Gem><Gold>2500</Gold></Resources>',
  '\t\t<MessageFileRef href="msg.txt"/>',
  '\t\t<AllowQuickCombat>false</AllowQuickCombat>',
  '\t</AdvMapMonster>',
  '</Item>',
].join('\r\n');

function testOverDonor(): void {
  console.log('\nDEFAULTS OVER A TUNED DONOR');
  const map = blankMap();
  const { object } = map.addObject({
    type: 'AdvMapMonster', shared: '/MapObjects/New.xdb', x: 1, y: 2, donor: TUNED_MONSTER,
  });
  const f = (n: string): string => childText(object.el, n);
  check('Amount is 0, not the donor’s 4', f('Amount') === '0', f('Amount'));
  check('Custom is false', f('Custom') === 'false', f('Custom'));
  check('Mood is back to aggressive', f('Mood') === 'MONSTER_MOOD_AGGRESSIVE', f('Mood'));
  check('the donor’s reward artifact is gone', f('ArtifactID') === 'ARTIFACT_NONE', f('ArtifactID'));
  check('AllowQuickCombat is true', f('AllowQuickCombat') === 'true', f('AllowQuickCombat'));

  const res = find(object.el, 'Resources')!;
  check('the donor’s reward resources are zeroed',
    ['Wood', 'Ore', 'Gold'].every((k) => childText(res, k) === '0'), childText(res, 'Gold'));

  // The two empty forms, both measured off the original.
  check('an href-carrying ref empties to href=""',
    find(object.el, 'MessageFileRef')!.attrs.href === '', serialize(find(object.el, 'MessageFileRef')!));
  check('a bare ref loses the attribute entirely',
    find(object.el, 'CombatScript')!.attrs.href === undefined, serialize(find(object.el, 'CombatScript')!));

  // Fields the donor does not carry are not invented: this donor has no
  // DoesNotGrow, and the schema's default must not add one.
  check('a field the donor lacks is not created', find(object.el, 'DoesNotGrow') === null);

  // And the placement's own values survive the defaults pass.
  check('position is the placement’s, not the donor’s',
    object.pos?.x === 1 && object.pos?.y === 2, JSON.stringify(object.pos));
  check('shared is the placement’s', object.shared === '/MapObjects/New.xdb', String(object.shared));
}

function testNaming(): void {
  console.log('\nNAMING');
  const map = blankMap();
  const place = (type: string, name?: string): string =>
    map.addObject({ type, shared: '/x.xdb', x: 0, y: 0, donor: TUNED_MONSTER.replace(/AdvMapMonster/g, type), ...(name ? { name } : {}) }).object.name;

  check('a new object is never nameless', place('AdvMapMonster') === 'MONSTER_001');
  check('numbering continues per type', place('AdvMapMonster') === 'MONSTER_002');
  const hut = place('AdvMapSeerHut');
  check('the prefix is upper-snake', hut === 'SEER_HUT_001', hut);
  check('a requested name is honoured', place('AdvMapMonster', 'boss') === 'boss');
  check('a taken name is suffixed, not replaced', place('AdvMapMonster', 'boss') === 'boss_2');
  const names = map.namesInUse();
  check('every handle on the map is unique', names.size === map.objects.length, `${names.size} of ${map.objects.length}`);

  // Documented limit, pinned so a change to it is a decision and not a
  // surprise: numbering counts what is IN USE, so deleting MONSTER_002 puts
  // that handle back in circulation — and a script still naming it will then
  // address a different object. See HommMap.nextName.
  map.remove(map.objectsOfType('AdvMapMonster')[1]!);
  check('a deleted object’s handle is reused (known limit)', place('AdvMapMonster') === 'MONSTER_002');
}

/** The committed measurement: one default body per type. */
function fixtureBodies(): Map<string, XmlElement> {
  const file = join(import.meta.dirname, 'fixtures', 'object-defaults.json');
  const { types } = JSON.parse(readFileSync(file, 'utf8')) as { types: Record<string, string> };
  const out = new Map<string, XmlElement>();
  // Stored as the body's CONTENTS, so it reads as a diff of fields rather than
  // of one long line; the element around it is the type, as on a real map.
  for (const [type, body] of Object.entries(types)) {
    out.set(type, find(parse(`<${type}>${body}</${type}>`), type)!);
  }
  return out;
}

/** The same, read straight from a map the original editor saved. */
function referenceBodies(archive: string): Map<string, XmlElement> {
  const entries = readEntries(readFileSync(archive));
  const rel = pickMapRel(entries.map((e) => e.name));
  const xml = entries.find((e) => e.name === rel)!.data.toString('latin1');
  const out = new Map<string, XmlElement>();
  const doc = parse(xml);
  const objects = find(find(doc, 'AdvMapDesc')!, 'objects')!;
  for (const item of objects.children) {
    if (item.type !== 'element') continue;
    const body = item.children.find((c): c is XmlElement => c.type === 'element');
    if (body && !out.has(body.name)) out.set(body.name, body);
  }
  return out;
}

/**
 * Place one of every type the reference map has, and compare field by field.
 *
 * Only the fields the schema declares are compared, and only as text: the point
 * is whether our defaults match the original's, not whether our XML is its XML.
 */
function testAgainstReference(ref: Map<string, XmlElement>, what: string): void {
  console.log(`\nAGAINST ${what}`);
  check('there are objects to compare', ref.size > 0, `${ref.size} types`);

  // Placement, not defaults. spellIDs is the installation's roster (x-defaultAll)
  // and is not in the fixture; the app resolves it from the registry.
  const skip = new Set(['Pos', 'Rot', 'Floor', 'Name', 'Shared', 'spellIDs']);
  for (const [type, refBody] of [...ref].sort()) {
    const map = blankMap();
    const donor = `<Item href="#n:inline(${type})">${serialize(refBody)}</Item>`;
    const { object } = map.addObject({ type, shared: '/x.xdb', x: 0, y: 0, donor });
    // The reference object was placed and left alone, so donor === expected.
    const diffs: string[] = [];
    for (const name of Object.keys(objectProps(type))) {
      if (skip.has(name)) continue;
      const mine = find(object.el, name);
      const theirs = find(refBody, name);
      if (!mine || !theirs) continue;
      const a = serialize(mine).replace(/\s+/g, ' ').trim();
      const b = serialize(theirs).replace(/\s+/g, ' ').trim();
      if (a !== b) diffs.push(`${name}: ours ${a.slice(0, 60)} vs theirs ${b.slice(0, 60)}`);
    }
    check(type, diffs.length === 0, diffs.slice(0, 3).join(' | '));
    const missing = undefaulted(type).filter((n) => !skip.has(n) && find(refBody, n));
    if (missing.length) console.log(`        (no measured default, donor kept: ${missing.join(', ')})`);
  }
}

testOverDonor();
testNaming();

/**
 * Against the GAME'S OWN SPEC — `<data>/types.xml`, which declares every type's
 * fields and, for some of them, the engine's default value.
 *
 * This is the check that does not depend on a map at all. It covers only the 17
 * fields the spec gives a default for, which is why it does not replace the
 * measurement — but where the two overlap they must agree, and a schema default
 * that contradicts the engine is a bug however good the map it came from.
 */
function testAgainstSpec(dataRoot: string): void {
  const path = typesXmlPath(dataRoot);
  if (!path) { console.log(`\n(no types.xml under ${dataRoot} — skipping the spec check)`); return; }
  console.log(`\nAGAINST THE GAME'S SPEC ${path}`);
  const spec = readTypeSpec(path);
  let checked = 0;
  const missing: string[] = [];

  const compare = (specName: string, ours: Record<string, FieldSchema>, label = specName): void => {
    const t = spec.get(specName);
    if (!t) { check(`${label} is in the spec`, false); return; }
    for (const [name, value] of declaredDefaults(t)) {
      const mine = ours[name]?.default;
      if (mine === undefined) { missing.push(`${label}.${name} = ${value}`); continue; }
      checked++;
      check(`${label}.${name}`, String(mine).toLowerCase() === value.toLowerCase(),
        `spec ${value}, ours ${String(mine)}`);
    }
  };

  for (const type of Object.keys(objectSchema.types)) compare(type, objectProps(type));
  // The map header and the entities it embeds are described by the same spec.
  compare('AdvMapDesc', mapSchema.properties);
  for (const [name, def] of Object.entries(mapSchema.$defs ?? {})) {
    if (spec.has(name) && def.properties) compare(name, def.properties);
  }

  check(`the spec confirms ${checked} of our defaults`, checked > 0, `${checked} confirmed`);
  // Not a failure: a default we have not declared yet is work, not a wrong
  // answer. Listed by name so it is a list to work through rather than a count.
  if (missing.length) {
    console.log(`\n  ${missing.length} default(s) the spec declares and our schema does not:`);
    for (const m of missing) console.log(`      ${m}`);
  }
}

// The committed measurement always; a live map too, when one is pointed at —
// which is how a drift between the fixture and the map that made it would show.
testAgainstReference(fixtureBodies(), 'the measured fixture');
testAgainstSpec(process.env.HOMM5_DATA || join(import.meta.dirname, '..', 'data-unpacked'));
const refMap = process.env.HOMM5_DEFAULTS_MAP || process.argv[2];
if (refMap && existsSync(refMap)) testAgainstReference(referenceBodies(refMap), refMap);

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
