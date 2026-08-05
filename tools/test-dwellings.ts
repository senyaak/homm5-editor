// Validates the dwelling side of a mod — the buildings a hero hires from.
//
// The checks that matter are all comparisons against the game's OWN objects,
// because every convention here was read off them and any of it could have been
// read wrong:
//
//   the tile layout — a footprint reproduces High Cabins, the Sylvan Military
//     Post and, for art with a skirt, the Dragon Utopia, down to the tile;
//   the measurement — a model's bounding box gives the footprint the shipped
//     dwelling that uses it declares (a tile is two world units);
//   the document — its fields are in the order types.xml declares, since that is
//     the order every shipped object is written in, and every href resolves;
//   the mod — a dwellings-only one touches nothing of the game's and needs no
//     patched executable, unlike one with creatures in it.
//
//   node tools/test-dwellings.ts [dataRoot]

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCreatureMod } from '../src/mods/creature-mod.ts';
import { addDwelling, newCreatureMod } from '../src/mods/mod-model.ts';
import { dataReader } from '../src/mods/mod-files.ts';
import { MESSAGE_SLOTS, dwellingPaths, footprintOf, refPath, tilesOf } from '../src/mods/dwellings.ts';
import type { DwellingSpec, Footprint, Tile } from '../src/mods/dwellings.ts';
import { SHIPPED_CREATURES } from '../src/mods/creatures.ts';
import { assets } from '../src/game/assets.ts';
import { findEditorRoot, listPlaceable } from '../src/map/objects.ts';
import { allFields, parseTypeSpec } from '../src/schema/typespec.ts';
import { children, find, parse, text } from '../src/format/xml.ts';
import { dataDir } from './game-dir.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const dataRoot = process.argv[2] ?? dataDir();
if (!existsSync(join(dataRoot, 'types.xml'))) {
  console.log(`no unpacked data at ${dataRoot} — nothing to compare against`);
  process.exit(0);
}
const data = assets([dataRoot]);
const read = dataReader(dataRoot);
const asText = (rel: string): string | null => data.text(rel);

/** The tiles a shipped object declares, as a set of "x,y" and a span. */
function declared(shared: string, field: string): { tiles: Set<string>; span: string; count: number } {
  const xml = asText(shared) ?? '';
  const doc = children(parse(xml)).find((c) => c.name.startsWith('AdvMap'));
  const el = doc ? find(doc, field) : null;
  const pts = el ? children(el).map((i) => children(i).map((c) => Number(text(c)))) : [];
  const xs = pts.map((p) => p[0]!), ys = pts.map((p) => p[1]!);
  const span = pts.length ? `x ${Math.min(...xs)}..${Math.max(...xs)} y ${Math.min(...ys)}..${Math.max(...ys)}` : '';
  return { tiles: new Set(pts.map((p) => `${p[0]},${p[1]}`)), span, count: pts.length };
}

const asSet = (tiles: Tile[]): Set<string> => new Set(tiles.map((t) => `${t.x},${t.y}`));
const same = (a: Set<string>, b: Set<string>): boolean => a.size === b.size && [...a].every((x) => b.has(x));

// ---- 1. the tile convention, against the game's own objects -------------------

console.log('the tile layout, tile for tile');

const HIGH_CABINS = 'MapObjects/Preserve/High_Cabins.(AdvMapDwellingShared).xdb';
const POST = 'MapObjects/Preserve/Preserve_Military_Post.xdb';
const UTOPIA = 'MapObjects/Dragon_Utopia.(AdvMapBuildingShared).xdb';

// Odd and even, tall and square. The even sizes are where a convention read off
// one object goes wrong: a 3x2 does not sit at y -1..0 as symmetry would suggest
// but at y 0..1, with the entrance ON the origin, and four shipped objects agree.
for (const [name, shared, f] of [
  ['High Cabins, 3x3', HIGH_CABINS, { w: 3, h: 3 }],
  ['the Sylvan Military Post, 4x4', POST, { w: 4, h: 4 }],
  ['the Faerie Tree, 3x2', 'MapObjects/Preserve/Fairie_Tree.xdb', { w: 3, h: 2 }],
  ['the Ruined Tower, 3x3', 'MapObjects/Necropolis/Ruined_Tower.xdb', { w: 3, h: 3 }],
  ['the Workshop, 3x2', 'MapObjects/Academy/Workshop.xdb', { w: 3, h: 2 }],
  ['Wood Guard Quarters, 2x2', 'MapObjects/Preserve/Wood_Guard_Quarters.(AdvMapDwellingShared).xdb', { w: 2, h: 2 }],
] as Array<[string, string, Footprint]>) {
  const t = tilesOf(f);
  const b = declared(shared, 'blockedTiles');
  const h = declared(shared, 'holeTiles');
  const a = declared(shared, 'activeTiles');
  check(`${name}: blocked`, same(asSet(t.blocked), b.tiles), `${t.blocked.length} vs ${b.count} at ${b.span}`);
  // Three of the six declare no hole at all — their art brings no ground of its
  // own — so only the ones that do are compared.
  if (h.count) check(`${name}: the hole`, same(asSet(t.hole), h.tiles), `${t.hole.length} vs ${h.count}`);
  check(`${name}: the entrance`, same(asSet(t.active), a.tiles), a.span);
}

// Art with a skirt. The Dragon Utopia is a BUILDING rather than a dwelling, but
// it is the same base type and the only shipped object whose art is much bigger
// than what it blocks — which is exactly the case a measured footprint gets wrong.
{
  const t = tilesOf({ w: 4, h: 4 }, { w: 8, h: 8 });
  const b = declared(UTOPIA, 'blockedTiles');
  const h = declared(UTOPIA, 'holeTiles');
  const a = declared(UTOPIA, 'activeTiles');
  check('the Dragon Utopia: blocks its 4x4 core', same(asSet(t.blocked), b.tiles), `${t.blocked.length} vs ${b.count} at ${b.span}`);
  check('the Dragon Utopia: holes its whole 8x8', same(asSet(t.hole), h.tiles), `${t.hole.length} vs ${h.count} at ${h.span}`);
  // It declares eight entrances, one on each approach; ours is one of them.
  check('its entrance is one of the eight the game gives it',
    [...asSet(t.active)].every((x) => a.tiles.has(x)), `${[...asSet(t.active)].join(' ')} of ${a.span}`);
}

// ---- 2. measuring a model ----------------------------------------------------

console.log('\nmeasuring the art, at two world units to the tile');
for (const [name, shared, want] of [
  ['High Cabins', HIGH_CABINS, '3x3'],
  ['the Sylvan Military Post', POST, '4x4'],
] as Array<[string, string, string]>) {
  const xml = asText(shared) ?? '';
  const doc = children(parse(xml)).find((c) => c.name.startsWith('AdvMap'));
  const model = doc ? find(doc, 'Model')?.attrs.href ?? '' : '';
  const f = footprintOf(model, asText);
  check(`${name} measures ${want}`, Boolean(f) && `${f!.w}x${f!.h}` === want, f ? `${f.w}x${f.h}` : 'not measured');
}

// ---- 3. the document ---------------------------------------------------------

console.log('\nthe document');

const SPEC: DwellingSpec = {
  file: 'TestUnicornGlade',
  creatures: ['CREATURE_UNICORN'],
  guards: ['CREATURE_UNICORN'],
  model: '/_(Model)/Buildings/MisticalGarden.(Model).xdb',
  icon: '/UI/TownHall/preserve/128/d6.xdb',
  type: 'BUILDING_PRESERVE_MILITARY_POST',
  // The game's own name for it, referenced rather than shipped — so the tile and
  // the hire dialog read Russian on a Russian install and English on an English
  // one, without the mod carrying a word of either.
  name: '/Text/Game/TownBuildings/Preserve/Dwelling_5/Name.txt',
  description: '/Text/Game/TownBuildings/Preserve/Dwelling_5/Description.txt',
  firstVisit: 'Вы захватили поляну единорогов.',
};

const mod = newCreatureMod('test-dwellings');
addDwelling(mod, SPEC);
const built = buildCreatureMod(mod, read);
const files = new Map(built.files.map((f) => [f.path, f.data]));
const p = dwellingPaths(SPEC);

check('the mod carries the dwelling and its palette entry', files.has(p.shared) && files.has(p.link));
check('a referenced message ships no file of its own', !files.has(p.text.name) && !files.has(p.text.description));
check('a message given as text does ship one', files.has(p.text.firstVisit));
const visit = files.get(p.text.firstVisit);
check('and it is UTF-16 with a byte-order mark, as the game reads text',
  Boolean(visit) && visit![0] === 0xff && visit![1] === 0xfe
  && visit!.toString('utf16le', 2) === SPEC.firstVisit);

const doc = files.get(p.shared)!.toString('latin1');
const order = [...doc.matchAll(/^\t<(\w+)[ />]/gm)].map((m) => m[1]!);
const declaredOrder = allFields(parseTypeSpec(asText('types.xml')!), 'AdvMapDwellingShared').map((f) => f.name);
check('every field types.xml declares is there, in its order',
  order.join(',') === declaredOrder.join(','), `${order.length} of ${declaredOrder.length}`);

// A shipped dwelling for comparison: the same fields, in the same order.
const shippedOrder = [...(asText(HIGH_CABINS) ?? '').matchAll(/^\t<(\w+)[ />]/gm)].map((m) => m[1]!);
check('which is the order the shipped High Cabins is written in', order.join(',') === shippedOrder.join(','));

// THE invariant: nothing in the document points at nothing.
{
  const dangling: string[] = [];
  for (const m of doc.matchAll(/href="([^"]+)"/g)) {
    const rel = refPath(m[1]!);
    if (!rel) continue;
    if (files.has(rel) || data.exists(rel)) continue;
    dangling.push(m[1]!);
  }
  check('every reference resolves', dangling.length === 0, dangling.join(' '));
}
// A dwelling with its one entrance blocked is a dwelling nobody can visit.
{
  const tiles = (field: string): Set<string> => {
    const body = new RegExp(`<${field}>([\\s\\S]*?)</${field}>`).exec(doc)?.[1] ?? '';
    return new Set([...body.matchAll(/<x>(-?\d+)<\/x>\s*<y>(-?\d+)<\/y>/g)].map((m) => `${m[1]},${m[2]}`));
  };
  const active = tiles('activeTiles');
  const blocked = tiles('blockedTiles');
  check('it has exactly one entrance and it is not blocked',
    active.size === 1 && [...active].every((t) => !blocked.has(t)), [...active].join(' '));
}

// ---- 3b. baking a town building ----------------------------------------------
//
// The town screen is where the art for tiers 4 to 7 actually is, and it cannot be
// used as it lies: 2 to 3 times map scale, positioned where it stands in the town
// scene, and mounted on a pedestal the town's landscape hides. All three have to
// be undone, and the geometry is the only place any of it lives.

console.log('\nbaking a town building down to the map');
{
  const spec: DwellingSpec = {
    file: 'TestTownGlade',
    creatures: ['CREATURE_UNICORN'],
    model: '/Arenas/Town/Rampart/UnicornGlade_u1r0.xdb',
    bake: { tiles: 4 },
    name: '/Text/Game/TownBuildings/Preserve/Dwelling_5/Name.txt',
    description: '/Text/Game/TownBuildings/Preserve/Dwelling_5/Description.txt',
  };
  const baked = buildCreatureMod((() => {
    const m = newCreatureMod('test-bake');
    addDwelling(m, spec);
    return m;
  })(), read);
  const mine = new Map(baked.files.map((f) => [f.path, f.data]));
  const bp = dwellingPaths(spec);
  const readMine = (rel: string): string | null => {
    const own = mine.get(rel);
    return own ? own.toString('latin1') : asText(rel);
  };

  const sharedDoc = mine.get(bp.shared)!.toString('latin1');
  const model = /<Model href="([^"]+)"/.exec(sharedDoc)?.[1] ?? '';
  check('the mod carries its own copy of the model', mine.has(refPath(model)), refPath(model).slice(0, 60));
  check('and its own geometry, under a uid of its own',
    [...mine.keys()].some((k) => k.startsWith('bin/Geometries/')));

  const f = footprintOf(model, readMine);
  check('which measures the size that was asked for', f?.w === 4 || f?.h === 4, f ? `${f.w}x${f.h}` : 'not measured');

  // Centred on the tile that placed it, and standing ON the ground: the town
  // original is centred at (280, 328) and its pedestal hangs 20 units below.
  const geomHref = /<Geometry href="([^"]+)"/.exec(readMine(refPath(model)) ?? '')?.[1] ?? '';
  const geomPath = geomHref.startsWith('/')
    ? refPath(geomHref)
    : `${refPath(model).split('/').slice(0, -1).join('/')}/${refPath(geomHref)}`;
  const geom = readMine(geomPath) ?? '';
  const num = (tag: string): [number, number, number] => {
    const m = new RegExp(`<${tag}>\\s*<x>([^<]*)</x>\\s*<y>([^<]*)</y>\\s*<z>([^<]*)</z>`).exec(geom);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [NaN, NaN, NaN];
  };
  const centre = num('Center');
  const size = num('Size');
  check('centred on the tile that places it', Math.abs(centre[0]) < 0.01 && Math.abs(centre[1]) < 0.01,
    `(${centre[0].toFixed(2)}, ${centre[1].toFixed(2)})`);
  const bottom = centre[2] - size[2] / 2, top = centre[2] + size[2] / 2;
  check('standing on the ground, with its pedestal under the map', bottom < 0 && top > 0,
    `z ${bottom.toFixed(2)}..${top.toFixed(2)}`);
  check('so it cuts no hole in the terrain — the hole would show the pedestal',
    /<holeTiles\/>/.test(sharedDoc));

  // The game's own file must be exactly as it was: the copy is what changed.
  const original = asText('Arenas/Town/Rampart/UnicornGlade_u1r0-geom.xdb') ?? '';
  check('the game\'s own geometry is untouched', /<Center>\s*<x>280/.test(original));

  // A second dwelling may stand on art the first one baked — the same building
  // hiring something else, or an upgraded name over the same model — and baking it
  // twice would put the same megabyte in the mod twice.
  {
    const shared = newCreatureMod('test-share');
    addDwelling(shared, spec);
    addDwelling(shared, { ...spec, file: 'TestSameArt', bake: undefined, model, creatures: ['CREATURE_WAR_UNICORN'] });
    const both = buildCreatureMod(shared, read);
    const geometries = both.files.filter((f) => f.path.startsWith('bin/Geometries/')).length;
    const second = both.files.find((f) => f.path === dwellingPaths({ ...spec, file: 'TestSameArt' }).shared);
    check('a second dwelling can stand on the first one\'s baked model',
      Boolean(second) && second!.data.toString('latin1').includes(refPath(model)) && geometries === 1,
      `${geometries} geometry binar${geometries === 1 ? 'y' : 'ies'} for two dwellings`);
  }

  const dangling: string[] = [];
  for (const m of sharedDoc.matchAll(/href="([^"]+)"/g)) {
    const r = refPath(m[1]!);
    if (r && !mine.has(r) && !data.exists(r)) dangling.push(m[1]!);
  }
  for (const [path, bytes] of mine) {
    if (!path.endsWith('.xdb')) continue;
    for (const m of bytes.toString('latin1').matchAll(/href="([^"]+)"/g)) {
      const raw = m[1]!.split('#')[0]!;
      // Authoring sources — the .tga a texture was built from, the .mb scene a
      // model was modelled in — were never shipped, and the copy leaves those
      // hrefs pointing where they pointed. The creature mod reports the same.
      if (!raw || /^\/?[A-Za-z]:/.test(raw) || /\.(mb|tga|max|psd)$/i.test(raw)) continue;
      const r = raw.startsWith('/')
        ? refPath(raw)
        : `${path.split('/').slice(0, -1).join('/')}/${raw}`;
      if (!mine.has(r) && !data.exists(r) && !baked.missing.includes(r)) dangling.push(`${path} → ${m[1]}`);
    }
  }
  check('every reference in the baked art resolves', dangling.length === 0, dangling.slice(0, 3).join('; '));
}

// ---- 4. what a dwellings-only mod costs the game ------------------------------

console.log('\na mod of nothing but dwellings');
check('needs no ceiling — the shipped count stands', built.limit === SHIPPED_CREATURES, `${built.limit}`);
for (const owned of ['types.xml', 'GameMechanics/RefTables/Creatures.xdb', 'UI/UIGameRoot.(UIGameRoot).xdb']) {
  check(`does not carry the game's ${owned}`, !files.has(owned));
}
// One entry is one stack, so a repeat is how the format asks for more guard —
// it must survive into the document rather than being tidied away.
{
  const many = newCreatureMod('test-guards');
  addDwelling(many, { ...SPEC, file: 'TestGuarded', guards: ['CREATURE_UNICORN', 'CREATURE_UNICORN', 'CREATURE_UNICORN'] });
  const doc = buildCreatureMod(many, read).files
    .find((f) => f.path === dwellingPaths({ ...SPEC, file: 'TestGuarded' }).shared)!.data.toString('latin1');
  const guards = /<guards>([\s\S]*?)<\/guards>/.exec(doc)?.[1] ?? '';
  const items = [...guards.matchAll(/<Item>([^<]*)<\/Item>/g)].map((m) => m[1]);
  check('a creature named three times is written three times', items.length === 3
    && items.every((c) => c === 'CREATURE_UNICORN'), items.join(', '));
}

check('two dwellings cannot share a file name', (() => {
  try {
    addDwelling(mod, { ...SPEC });
    return false;
  } catch {
    return true;
  }
})());
check('a dwelling that hires nothing is refused', (() => {
  try {
    addDwelling(newCreatureMod('x'), { ...SPEC, file: 'Other', creatures: [] });
    return false;
  } catch {
    return true;
  }
})());

// ---- 5. what the editor shows -------------------------------------------------

console.log('\nmounted over the game data');
const mounted = mkdtempSync(join(tmpdir(), 'homm5-dwellings-'));
try {
  for (const f of built.files) {
    const at = join(mounted, f.path);
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(join(at, '..'), { recursive: true });
    writeFileSync(at, f.data);
  }
  const chain = assets([mounted, dataRoot]);
  const editorDir = findEditorRoot(dataRoot) ?? '';
  const palette = listPlaceable(chain, editorDir);
  const shipped = listPlaceable(dataRoot, editorDir);
  const entry = palette.objects.find((o) => o.path === p.link);
  check('the palette lists it', Boolean(entry), entry?.path ?? '(none)');
  check('as a dwelling', entry?.type === 'AdvMapDwelling', entry?.type ?? '');
  if (palette.groups.length) {
    check('filed with the dwellings', entry?.group === '. Dwellings', entry?.group ?? '');
  } else {
    console.log('  --    filed with the dwellings — skipped, no MapFilters.xml near the data');
  }
  // Labelled by the name it REFERENCES, which is the game's own text: the palette's
  // own name source is the icon cache, and no mod can write to that.
  check('labelled with the name the game gives it', entry?.label === 'Поляна единорогов', entry?.label ?? '');
  check('mounting adds entries and removes none',
    palette.objects.length === shipped.objects.length + 1
    && shipped.objects.every((o) => palette.objects.some((x) => x.path === o.path)),
    `${shipped.objects.length} → ${palette.objects.length}`);
  const iconOf = (o: typeof entry): string => o?.iconFile ?? '';
  check('its tile names a texture that is really there', chain.exists(refPath(iconOf(entry))), iconOf(entry));
} finally {
  rmSync(mounted, { recursive: true, force: true });
}

// The six messages are a fixed list in a fixed order; the document's own order
// has to be that one, or a dwelling's description turns up as its name.
check('the messages are in the order a dwelling reads them',
  MESSAGE_SLOTS.join(',') === 'name,description,firstVisit,secondVisit,firstVisitNoHire,secondVisitNoHire');

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
