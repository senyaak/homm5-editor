// The exterior of a faction's town — `TownSpec.exterior` applied by the town
// copier to Haven's shared document:
//
//   another town's whole exterior: its ten stage models, effects and gate;
//   a mix: a town per stage, the donor's at the stages left out, the gate
//     named separately;
//   Stronghold's exterior, a document of its own, is inlined like the rest;
//   every model a part names is copied into the faction's tree;
//   every refusal names what it refuses.
//
//   node tools/test-town-exterior.ts [dataRoot]

// needs: data
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataReader } from '../src/mods/mod-files.ts';
import { EXTERIOR_STAGES, buildTown, townPaths } from '../src/mods/town-files.ts';
import type { TownBuild, TownSpec } from '../src/mods/town-files.ts';
import { dataDir } from './game-dir.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}
function throws(name: string, f: () => unknown, mentions: string): void {
  try { f(); check(name, false, 'did not throw'); } catch (e) {
    const msg = (e as Error).message;
    check(name, msg.includes(mentions), msg);
  }
}

const dataRoot = process.argv[2] ?? dataDir();
if (!existsSync(join(dataRoot, 'types.xml'))) {
  console.log(`no unpacked data at ${dataRoot} — nothing to compare against`);
  process.exit(0);
}
const read = dataReader(dataRoot);
const HEAVEN = 3;
const base: TownSpec = { file: 'Test', type: 'TOWN_TEST', donor: 'TOWN_HEAVEN', name: 'Testburg' };
const build = (exterior: TownSpec['exterior']): TownBuild => buildTown({ ...base, exterior }, HEAVEN, read);
const shared = (t: TownBuild): string => {
  const f = t.files.find((x) => x.path === townPaths(base).shared);
  if (!f) throw new Error('no shared document in the copy');
  return f.data.toString('latin1');
};
/** The stage models the copy's exterior names, by file stem, in order. */
const models = (doc: string): string[] => {
  const s = doc.indexOf('<upgrades>'), e = doc.indexOf('</upgrades>');
  return [...doc.slice(s, e).matchAll(/<Model href="([^"]*)"/g)].map((m) => m[1]!.replace(/#.*$/, '').split('/').pop()!.replace(/\.xdb$/, ''));
};
const gates = (doc: string): string => /<Gates[^>]*>/.exec(doc)?.[0] ?? '';

console.log('the exterior');
{
  const plain = build(undefined);
  const donors = models(shared(plain));
  check('the donor keeps its ten', donors.length === 10 && donors.every((m, i) => m === `Heaven-${EXTERIOR_STAGES[i]}`), donors.join(' '));

  const necro = build('TOWN_NECROMANCY');
  const doc = shared(necro);
  const theirs = models(doc);
  check("another town's whole exterior: its ten models", theirs.every((m, i) => m === `Necromancy-${EXTERIOR_STAGES[i]}`), theirs.join(' '));
  check('inline, with an id', /<Exterior href="#n:inline\(AdvMapTownExterior\)" id="item_[0-9a-f-]+">/.test(doc) && doc.includes('</AdvMapTownExterior>'));
  check('its models point into the tree', [...doc.slice(doc.indexOf('<upgrades>'), doc.indexOf('</upgrades>')).matchAll(/<Model href="([^"]*)"/g)].every((m) => m[1]!.startsWith('/Factions/Test/town/')));
  check('and are in the copy', necro.files.some((f) => /Necromancy-capital_mg_wall2\.xdb$/.test(f.path)) && !necro.files.some((f) => /Heaven-town\.xdb$/.test(f.path)));
  check('its effects are its own', doc.includes('/TownsGlobalMap/Necropolis/') && !doc.includes('/TownsGlobalMap/Haven/'));
  check('its gate too', gates(doc).includes('#n:inline(AIGeometry)') && !doc.includes('Heaven_Gate_AI'));
  check('the donor is still the donor elsewhere', doc.includes('<Type>TOWN_TEST</Type>') && doc.includes('/Arenas/Town/NewHaven/'));

  const mixed = build({ stages: { town: 'TOWN_DUNGEON', capital_mg_wall2: 'TOWN_ACADEMY' }, gates: 'TOWN_DUNGEON' });
  const mix = shared(mixed);
  const stages = models(mix);
  check('a mix: the named stages', stages[0] === 'Dungeon-town' && stages[9] === 'Academy-capital_mg_wall2', stages.join(' '));
  check('the rest the donor\'s', stages.slice(1, 9).every((m, i) => m === `Heaven-${EXTERIOR_STAGES[i + 1]}`));
  check('the gate named', gates(mix).includes('#n:inline(AIGeometry)') && mix.includes('/models/TownsGlobalMap/Dungeon/Dungeon.mb'));
  check('every part copied', ['Dungeon-town.xdb', 'Academy-capital_mg_wall2.xdb', 'Heaven-town_wall1.xdb'].every((n) => mixed.files.some((f) => f.path.endsWith(n))));

  const orc = build('TOWN_STRONGHOLD');
  const orcDoc = shared(orc);
  check("Stronghold's exterior, a document of its own, inlined", models(orcDoc).every((m, i) => m === `Orc_Stronghold-${EXTERIOR_STAGES[i]}`) && orcDoc.includes('</AdvMapTownExterior>') && !orcDoc.includes('(AdvMapTownExterior).xdb'));
  check('with its gate document copied', orc.files.some((f) => f.path.endsWith('Orc_Stronghold_Gate_AI.xdb')));

  // A model of OUR OWN at a stage: Necropolis's first stage as a folder on
  // disk — the model, its geometry, materials and hull beside each other, the
  // binaries under bin/ as the game keys them — named by its path where a
  // town's type would go. The walk copies it under the town like any model
  // the exterior names; the stage keeps the donor's effect.
  const dir = join(import.meta.dirname, '..', '_tmp', 'own-exterior-test', 'necro');
  rmSync(join(dir, '..'), { recursive: true, force: true });
  mkdirSync(join(dir, 'bin', 'Geometries'), { recursive: true });
  mkdirSync(join(dir, 'bin', 'AIGeometries'), { recursive: true });
  for (const f of ['Necromancy-town.xdb', 'Necromancy-town-geom.xdb', 'Necromancy-town_AI.xdb',
    'Necromancy-town-Podlojka1.(Material).xdb', 'Necromancy-town-lambert7.(Material).xdb', 'Necromancy-town-lambert8.(Material).xdb']) {
    writeFileSync(join(dir, f), read(`MapObjects/${f}`)!);
  }
  const uidIn = (f: string): string => /<uid>([0-9A-F-]{36})<\/uid>/i.exec(read(`MapObjects/${f}`)!.toString('latin1'))![1]!.toUpperCase();
  writeFileSync(join(dir, 'bin', 'Geometries', uidIn('Necromancy-town-geom.xdb')), read(`bin/Geometries/${uidIn('Necromancy-town-geom.xdb')}`)!);
  writeFileSync(join(dir, 'bin', 'AIGeometries', uidIn('Necromancy-town_AI.xdb')), read(`bin/AIGeometries/${uidIn('Necromancy-town_AI.xdb')}`)!);
  const own = build({ stages: { town: join(dir, 'Necromancy-town.xdb'), town_mg: 'TOWN_DUNGEON' } });
  const ownDoc = shared(own);
  const ownStages = models(ownDoc);
  check('a model of ours at the first stage, under the mounted folder', /<Model href="\/Factions\/Test\/town\/own\/necro\/Necromancy-town\.xdb#xpointer\(\/Model\)"\/>/.test(ownDoc), ownStages[0]);
  check('the other stages as before', ownStages[3] === 'Dungeon-town_mg' && ownStages.slice(1, 3).every((m, i) => m === `Heaven-${EXTERIOR_STAGES[i + 1]}`), ownStages.join(' '));
  check('its geometry, materials and hull copied with it', ['own/necro/Necromancy-town-geom.xdb', 'own/necro/Necromancy-town-lambert7.(Material).xdb', 'own/necro/Necromancy-town_AI.xdb'].every((n) => own.files.some((f) => f.path.endsWith(n))));
  const ownGeom = own.files.find((f) => f.path.endsWith('own/necro/Necromancy-town-geom.xdb'))!.data.toString('latin1');
  const ownUid = /<uid>([0-9A-F-]{36})<\/uid>/i.exec(ownGeom)![1]!.toUpperCase();
  check('with a uid of its own and the binary from the folder', ownUid !== uidIn('Necromancy-town-geom.xdb') && own.files.some((f) => f.path === `bin/Geometries/${ownUid}` && f.data.equals(read(`bin/Geometries/${uidIn('Necromancy-town-geom.xdb')}`)!)));
  const firstItem = /<upgrades>\s*<Item>([\s\S]*?)<\/Item>/.exec(ownDoc)![1]!;
  check("the stage keeps the donor's effect", firstItem.includes('/TownsGlobalMap/Haven/'));
  throws('a file that is not there', () => build({ stages: { town: join(dir, 'nothing.xdb') } }), 'no such file');
  rmSync(join(dir, '..'), { recursive: true, force: true });

  throws('a stage that is not one', () => build({ stages: { village: 'TOWN_DUNGEON' } as never }), 'no exterior stage village');
  throws('a town that is not one', () => build('TOWN_ATLANTIS'), 'no shipped town of type TOWN_ATLANTIS');
}

console.log(failures ? `${failures} FAILED` : 'all good');
process.exit(failures ? 1 : 0);
