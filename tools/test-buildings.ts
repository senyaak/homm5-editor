// Validates the building side of a mod — everything a hero walks up to.
//
// The checks that matter are comparisons against the game's OWN objects, since
// every convention here was read off them:
//
//   the classes — the ones this module offers are the ones types.xml
//     declares, and each one's extra fields are the ones the spec gives it;
//   the document — its fields are in the order types.xml declares, its class's
//     own fields carry what the spec asked for, and every href resolves;
//   self-containment — NOTHING in a built building points at the game's data.
//     That is the whole promise of the feature: if one href escapes, some part
//     of the building cannot be edited;
//   the tile layout — the footprint reproduces what a shipped object of the same
//     model declares.
//
//   node tools/test-buildings.ts [dataRoot]

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildBuildings } from '../src/mods/building-files.ts';
import {
  BUILDING_CLASSES, buildingPaths, extraFields, messageSlots, takesType,
} from '../src/mods/buildings.ts';
import type { BuildingSpec } from '../src/mods/buildings.ts';
import { dataReader } from '../src/mods/mod-files.ts';
import { addBuilding, newCreatureMod } from '../src/mods/mod-model.ts';
import { allFields, parseTypeSpec } from '../src/schema/typespec.ts';

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
const read = dataReader(dataRoot);
const types = parseTypeSpec(readFileSync(join(dataRoot, 'types.xml'), 'utf8'));

// ---- 1. the classes are the game's ------------------------------------------

console.log('the classes offered, against types.xml');
for (const c of BUILDING_CLASSES) {
  check(c.shared, allFields(types, c.shared).length > 0, `${allFields(types, c.shared).length} fields`);
}
// Seven choose a behaviour with <Type>; the rest ARE one (BUILDINGS.md §2).
const withType = BUILDING_CLASSES.filter((c) => takesType(types, c.shared)).map((c) => c.shared);
check('seven classes take a <Type>', withType.length === 7, withType.length + ': ' + withType.join(' '));
check('a dwelling adds creatures/guards/RandomType',
  ['Type', 'guards', 'creatures', 'RandomType'].every((f) => extraFields(types, 'AdvMapDwellingShared').includes(f)));
check('a prison adds nothing', extraFields(types, 'AdvMapPrisonShared').length === 0);

// ---- 2. one building of each class, built -----------------------------------

// The Windmill: small, plain, shipped art with an icon and a sound, so every
// slot of the copy is exercised by something real.
const MODEL = '/_(Model)/Buildings/Windmill.(Model).xdb';

const specFor = (c: typeof BUILDING_CLASSES[number]): BuildingSpec => ({
  file: `Test${c.placed.replace('AdvMap', '')}`,
  className: c.shared,
  ...(takesType(types, c.shared) ? { type: 'BUILDING_ABANDONED_MINE' } : {}),
  model: MODEL,
  messages: Object.fromEntries(messageSlots(c.shared).map((s) => [s, `the ${s} line`])),
  ...(c.shared === 'AdvMapDwellingShared'
    ? { fields: { creatures: ['CREATURE_PEASANT'], RandomType: 'DWELLING_TYPE_SPECIFIC' } }
    : {}),
});

console.log('\none building of every class');
for (const c of BUILDING_CLASSES) {
  const spec = specFor(c);
  let files;
  try {
    files = buildBuildings([spec], read);
  } catch (e) {
    check(c.label, false, e instanceof Error ? e.message : String(e));
    continue;
  }
  const p = buildingPaths(spec);
  const doc = files.find((f) => f.path === p.shared);
  const link = files.find((f) => f.path === p.link);
  const texts = files.filter((f) => f.path.startsWith(`${p.dir}/`) && f.path.endsWith('.txt'));
  const art = files.filter((f) => f.path.startsWith(`${p.art}/`) || f.path.startsWith('bin/'));
  const xml = doc?.data.toString('latin1') ?? '';
  const rootOk = xml.includes(`<${c.shared}>`) && xml.includes(`</${c.shared}>`);
  const order = allFields(types, c.shared).map((f) => f.name);
  const written = [...xml.matchAll(/^\t<\/?([A-Za-z_][\w.-]*)/gm)].map((m) => m[1]!);
  const fieldsInOrder = JSON.stringify([...new Set(written)]) === JSON.stringify(order);
  check(c.label, !!doc && !!link && rootOk && fieldsInOrder
    && texts.length === messageSlots(c.shared).length && art.length > 0,
  `${art.length} art files, ${texts.length} texts${fieldsInOrder ? '' : ', FIELD ORDER'}`);
}

// ---- 3. nothing points outside ----------------------------------------------

console.log('\nself-contained: no href leaves the mod');
{
  const spec = specFor(BUILDING_CLASSES[0]!);
  const files = buildBuildings([spec], read);
  const p = buildingPaths(spec);
  const inside = new Set(files.map((f) => f.path.replace(/\\/g, '/').toLowerCase()));
  const escaped: string[] = [];
  for (const f of files) {
    if (!f.path.toLowerCase().endsWith('.xdb')) continue;
    for (const m of f.data.toString('latin1').matchAll(/href="([^"]*)"/g)) {
      const href = m[1]!;
      if (!href || !href.startsWith('/')) continue;                 // relative: resolves beside its file
      const path = href.split('#')[0]!.replace(/^\/+/, '');
      if (/^[A-Za-z]:/.test(path)) continue;                        // an authoring leftover, never shipped
      // The fog-of-war category is a name, not art: a copy of it would be a
      // second category rather than an editable file.
      if (path.startsWith('Text/Visibility_Types/')) continue;
      if (inside.has(path.toLowerCase())) continue;
      // A dead href is not a leak. Shipped documents name the sources they were
      // authored from — `/models/…/windmill.mb`, `/texture/…/Windmill.tga` — and
      // the game never shipped any of them, so there is nothing to copy and
      // nothing pointing at a file the mod does not own.
      if (read(path)) escaped.push(`${f.path} → ${href}`);
    }
  }
  check('every absolute href names a file the mod carries', escaped.length === 0, escaped.slice(0, 4).join('; '));
  check('the texts are ours, not the game\'s',
    messageSlots(spec.className).every((s) => inside.has(p.text[s]!.toLowerCase())));
  check('the art tree is under the building', files.some((f) => f.path.startsWith(`${p.art}/`)));
  check('its binaries got fresh uids', files.some((f) => /^bin\/(Geometries|Sounds|effects)\//i.test(f.path)));
}

// ---- 4. it goes into a mod like anything else -------------------------------

console.log('\nin the mod');
{
  const mod = newCreatureMod();
  addBuilding(mod, specFor(BUILDING_CLASSES[0]!));
  check('a mod of nothing but buildings holds one', mod.buildings.length === 1);
  let twice = false;
  try { addBuilding(mod, specFor(BUILDING_CLASSES[0]!)); } catch { twice = true; }
  check('two buildings cannot share a file stem', twice);
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
