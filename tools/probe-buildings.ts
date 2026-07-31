// Build the probe the two open questions of docs/mapPlaceables/buildings/BUILDINGS.md
// need answered IN THE GAME, since no file says either way:
//
//   1. a behaviour whose own class exists, declared on the GENERIC class —
//      `BUILDING_PRISON` on an `AdvMapBuildingShared`. Does the engine run the
//      behaviour off the Type field, or does it need `AdvMapPrisonShared`?
//   2. `BUILDING_NAGA_TEMPLE` (127) — the one enum value no shipped document
//      declares, though its art and its texts both ship. Live, or a stub?
//
// The probe is one mod plus two objects added to a map that already plays. The
// mod holds the definitions — nothing of the game's is touched, both are new
// documents at paths of their own — and the buildings go a few tiles from the
// hero of a working map, so nothing about the probe depends on a map built here
// loading (a fresh one of ours does not yet: the engine refuses it with
// "Player2 has no heroes and no towns", which is its own question).
//
//   node tools/probe-buildings.ts ["<map stem in H5E>"] [dataRoot]
//   node tools/probe-buildings.ts --remove ["<map stem in H5E>"]
//
// Then start the game (bin/H5_Game_H5E.exe, cwd bin/), open that map and walk
// the hero onto each of the two buildings.
//
// BOTH QUESTIONS ARE ANSWERED (2026-07-31; the doc has the answers), so what is
// left here is the apparatus: the probe can be rebuilt if either needs asking
// again, and `--remove` takes it back out of the map it borrowed.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { readEntries, writeArchive } from '../src/format/pak.ts';
import type { ZipEntry } from '../src/format/pak.ts';
import { assets } from '../src/game/assets.ts';
import { modFile } from '../src/game/mod-paths.ts';
import { loadMap } from '../src/map/map.ts';
import { donorFor } from '../src/map/donors.ts';
import { dataReader } from '../src/mods/mod-files.ts';
import { footprintOf, tilesOf } from '../src/mods/dwellings.ts';
import type { Footprint, Tile } from '../src/mods/dwellings.ts';
import { allFields, fieldOrder, parseTypeSpec } from '../src/schema/typespec.ts';
import type { SpecType } from '../src/schema/typespec.ts';

const EOL = '\r\n';

const REPO = join(import.meta.dirname, '..');
const args = process.argv.slice(2);
/** Take the probe back out instead of putting it in. */
const REMOVE = args.includes('--remove');
const rest = args.filter((a) => a !== '--remove');
/** The map the buildings are added to: a `.h5m` in the install's H5E folder. */
const MAP_STEM = rest[0] ?? 'Straker Atk';
const DATA = rest[1] ?? process.env.HOMM5_DATA ?? join(REPO, 'data-unpacked');
/** The install the checkout sits in — where the mod and the map are written. */
const GAME = join(REPO, '..');

/** The class under test: the generic one, the whole point of question 1. */
const CLASS = 'AdvMapBuildingShared';
/** Where the probe's own documents live, clear of anything the game ships. */
const DIR = 'MapObjects/_Probe';

if (!existsSync(join(DATA, 'types.xml'))) {
  console.log(`no unpacked data at ${DATA} — run "npm run unpack-data" first`);
  process.exit(1);
}
const data = assets([DATA]);
const read = dataReader(DATA);
const types = parseTypeSpec(readFileSync(join(DATA, 'types.xml'), 'utf8'));

/** One probe object: what it is made of, and what it is asking. */
interface Probe {
  file: string;
  type: string;
  model: string;
  animSet?: string;
  messages: string[];
  /** Where it stands, and where the hero walks from. */
  at: { x: number; y: number };
  question: string;
}

const PROBES: Probe[] = [
  {
    file: 'PrisonGeneric',
    type: 'BUILDING_PRISON',
    model: '/_(Model)/Buildings/Prison.(Model).xdb',
    animSet: '/_(AnimSet)/Buildings/Prison.(AnimSet).xdb',
    // The shipped Prison's own five, in its own order. A generic building reads
    // four; which of them the engine shows is part of the answer.
    messages: [
      '/Text/Game/Buildings/Prison/Name.txt',
      '/Text/Game/Buildings/Prison/Description.txt',
      '/Text/Game/Buildings/Prison/PrisonEmpty.txt',
      '/Text/Game/Buildings/Prison/PrisonCantHire.txt',
      '/Text/Game/Buildings/Prison/NoExit.txt',
    ],
    at: { x: 30, y: 44 },
    question: 'does BUILDING_PRISON run without AdvMapPrisonShared?',
  },
  {
    file: 'NagaTempleProbe',
    type: 'BUILDING_NAGA_TEMPLE',
    model: '/_(Model)/Buildings/NagaTemple.(Model).xdb',
    // The strings that ship for it and nothing points at, plus the common
    // "already visited" every bank uses — the same four MagiVault lists.
    messages: [
      '/Text/Game/Buildings/NagaTemple/Name.txt',
      '/Text/Game/Buildings/NagaTemple/desc.txt',
      '/Text/Game/Buildings/NagaTemple/FirstVisit.txt',
      '/Text/Game/BuildingsCommon/AlreadyVisited.txt',
    ],
    at: { x: 36, y: 46 },
    question: 'is BUILDING_NAGA_TEMPLE a behaviour, or a dead id?',
  },
  {
    // The CONTROL for the one above: same art, same texts, same class, and a
    // Type that means nothing (fourteen documents declare ABANDONED_MINE just to
    // have something in the field). If this one is a bank too, the bank came
    // from the model or the strings; if it is inert, the bank is the Type.
    file: 'NagaTempleControl',
    type: 'BUILDING_ABANDONED_MINE',
    model: '/_(Model)/Buildings/NagaTemple.(Model).xdb',
    messages: [
      '/Text/Game/Buildings/NagaTemple/Name.txt',
      '/Text/Game/Buildings/NagaTemple/desc.txt',
      '/Text/Game/Buildings/NagaTemple/FirstVisit.txt',
      '/Text/Game/BuildingsCommon/AlreadyVisited.txt',
    ],
    at: { x: 32, y: 48 },
    question: 'the same building without the Type — bank, or nothing?',
  },
];

// ---- the two definitions -----------------------------------------------------

/** `<Field href="…#xpointer(/Type)"/>`, or an empty field when there is nothing. */
function href(field: string, value: string | undefined, type: string): string {
  if (!value) return `<${field}/>`;
  return `<${field} href="${value.includes('#') ? value : `${value}#xpointer(/${type})`}"/>`;
}

function list(field: string, items: string[]): string {
  if (!items.length) return `<${field}/>`;
  return [`<${field}>`, ...items.map((i) => `\t\t${i}`), `\t</${field}>`].join(EOL);
}

const tileXml = (t: Tile): string =>
  ['<Item>', `\t\t\t<x>${t.x}</x>`, `\t\t\t<y>${t.y}</y>`, '\t\t</Item>'].join(EOL);

/**
 * The document, written in the field order types.xml declares — the order every
 * shipped object is in, and the one dwellings.ts already writes by.
 */
function buildingDoc(p: Probe, spec: Map<string, SpecType>, foot: Footprint): string {
  const t = tilesOf(foot);
  const values: Record<string, string[]> = {
    Model: [href('Model', p.model, 'Model')],
    AnimSet: [href('AnimSet', p.animSet, 'AnimSet')],
    blockedTiles: [list('blockedTiles', t.blocked.map(tileXml))],
    holeTiles: [list('holeTiles', t.hole.map(tileXml))],
    activeTiles: [list('activeTiles', t.active.map(tileXml))],
    passableTiles: ['<passableTiles/>'],
    PossessionMarkerTile: [`<PossessionMarkerTile>${EOL}\t\t<x>0</x>${EOL}\t\t<y>0</y>${EOL}\t</PossessionMarkerTile>`],
    messagesFileRef: [list('messagesFileRef', p.messages.map((h) => `<Item href="${h}"/>`))],
    WaterBased: ['<WaterBased>false</WaterBased>'],
    ApplyHeroTrace: ['<ApplyHeroTrace>false</ApplyHeroTrace>'],
    SoundEffect: ['<SoundEffect href="/Sounds/_(Sound)/Interface/Ingame/Interact.xdb#xpointer(/Sound)"/>'],
    flybyMessageFileRef: ['<flybyMessageFileRef href=""/>'],
    ObjectTypeFileRef: ['<ObjectTypeFileRef href="/Text/Visibility_Types/Buildings.txt"/>'],
    TerrainAligned: ['<TerrainAligned>false</TerrainAligned>'],
    FlyPassable: ['<FlyPassable>true</FlyPassable>'],
    AdventureSoundEffect: ['<AdventureSoundEffect/>'],
    RazedStatic: ['<RazedStatic/>'],
    Icon128: ['<Icon128/>'],
    Type: [`<Type>${p.type}</Type>`],
  };

  const fields = allFields(spec, CLASS);
  if (!fields.length) throw new Error(`types.xml declares no ${CLASS}`);
  const body: string[] = [];
  for (const f of fields) body.push(...(values[f.name] ?? [`<${f.name}/>`]));
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<${CLASS}>`,
    ...body.map((l) => `\t${l}`),
    `</${CLASS}>`,
  ].join(EOL) + EOL;
}

const entries: ZipEntry[] = [];
/** The document's path — inside the map's own archive, at its data-root path. */
const docOf = (p: Probe): string => `/${DIR}/${p.file}.(${CLASS}).xdb`;
/**
 * What a placement points at — path AND xpointer.
 *
 * Every object the game ships names its definition with the fragment, and the
 * palette adds it when the editor places one. Without it the editor still shows
 * the object and the game shows nothing at all.
 */
const sharedOf = (p: Probe): string => `${docOf(p)}#xpointer(/${CLASS})`;

for (const p of PROBES) {
  if (REMOVE) continue;
  // Measured, not guessed: the footprint has to match the art or the hero walks
  // through the building, or can never reach its entrance (dwellings.ts).
  const foot = footprintOf(p.model, (rel) => data.text(rel) ?? (read(rel)?.toString('latin1') ?? null));
  if (!foot) throw new Error(`cannot measure ${p.model} — no geometry`);
  console.log(`${p.file}: ${p.type}, ${foot.w}x${foot.h} tiles at ${p.at.x}:${p.at.y} — ${p.question}`);
  entries.push({ name: docOf(p).slice(1), data: Buffer.from(buildingDoc(p, types, foot), 'latin1') });
}

// ---- the buildings, added to a map that plays --------------------------------

// The definitions ride INSIDE the map. An archive is mounted whole and its
// members are visible to the whole game whatever kind of archive it is
// (docs/ARCHIVES.md), and this map already carries a hero definition of its own
// — so one file holds the probe and there is no second thing to install.
//
// Rewritten member for member for the same reason: rebuilding the archive from
// the map folder alone would drop everything else it holds.
const archive = modFile(GAME, 'map', MAP_STEM);
if (!existsSync(archive)) throw new Error(`no map at ${archive}`);
const members = readEntries(readFileSync(archive));
const mapEntry = members.find((e) => e.name.replace(/\\/g, '/').endsWith('/map.xdb'));
if (!mapEntry) throw new Error(`${archive} holds no map.xdb`);

const map = loadMap(mapEntry.data.toString('latin1'));
// Idempotent: a second run replaces its own buildings rather than stacking a
// new pair on top of them.
const ours = new Set(PROBES.map(docOf));
for (const o of map.objects) if (o.shared && ours.has(o.shared.split('#')[0]!)) map.remove(o);
const taken = new Map(map.objects.map((o) => [`${o.pos?.x},${o.pos?.y}`, o.type]));

for (const p of PROBES) {
  if (REMOVE) continue;
  // A tile somebody already stands on is the one way this can quietly ruin the
  // map it borrows, so it is checked rather than hoped for.
  const held = taken.get(`${p.at.x},${p.at.y}`);
  if (held) throw new Error(`${p.file} would land on the ${held} at ${p.at.x}:${p.at.y}`);
  const { complete } = map.addObject({
    type: 'AdvMapBuilding',
    shared: sharedOf(p),
    x: p.at.x, y: p.at.y,
    donor: donorFor(DATA, 'AdvMapBuilding') ?? undefined,
    order: fieldOrder(types, 'AdvMapBuilding') ?? undefined,
    name: p.file,
  });
  if (!complete) throw new Error('no donor for AdvMapBuilding — the object would be a skeleton');
}

// Its own documents go out with it: removing the placements and leaving the
// files behind would leave the map carrying objects nothing on it names, and an
// archive's members are mounted for the whole game whether anything uses them.
const ourNames = new Set([...entries.map((e) => e.name), ...PROBES.map((p) => docOf(p).slice(1))]);
const rewritten: ZipEntry[] = [
  ...members
    .filter((e) => !ourNames.has(e.name.replace(/\\/g, '/')))
    .map((e) => (e === mapEntry ? { name: e.name, data: Buffer.from(map.save(), 'latin1') } : e)),
  ...entries,
];
writeFileSync(archive, writeArchive(rewritten));
if (REMOVE) {
  console.log(`map  → ${archive} (probe taken out, ${rewritten.length} members)`);
} else {
  console.log(`map  → ${archive} (+${PROBES.length} buildings, ${rewritten.length} members)`);
  for (const p of PROBES) console.log(`       ${p.file} at ${p.at.x}:${p.at.y}`);
}
