// Validates a mod of nothing but artifacts.
//
// Artifacts extend a reference table the way creatures do, so the same four
// things have to happen at once and all four are silent when they do not:
// the enum gains the name, the name→number map gains the number, the table's
// DECLARED size moves, and the Lua constant a script names it by appears. The
// checks below are one per thing, and each names what breaks if it is missing.
//
// Three of them are specific to artifacts and would be got wrong by carrying
// the creature code over unchanged:
//
//   * the artifact table declares MinElements EQUAL to MaxElements, where a
//     creature table leaves the minimum alone as a floor;
//   * the enum runs straight from the last artifact into the abilities, which
//     are numbered from 0 of their own — so inserting must not touch them;
//   * `ARTIFACT_ARTIFACT_EFFECT_COUNT` sits with the constants and is what a
//     script loops to, so it moves as well.
//
// Needs the unpacked data: an artifact's table, enum and script are the game's
// own files, and there is nothing honest to stand in for them.

import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCreatureMod } from '../src/mods/creature-mod.ts';
import { addArtifact, newCreatureMod, removeArtifact } from '../src/mods/mod-model.ts';
import { dataReader } from '../src/mods/mod-files.ts';
import { findArtifactUses } from '../src/mods/artifact-usage.ts';
import { artifactPaths, SHIPPED_ARTIFACTS } from '../src/mods/artifacts.ts';
import { positionsBox } from '../src/scene/geometry.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

// --- what the registry refuses ----------------------------------------------

{
  const mod = newCreatureMod('x');
  const one = { file: 'A', name: 'a', description: 'd', slot: 'FEET', cost: 1, icon: '/x.xdb' } as const;
  addArtifact(mod, { ...one, id: 'ARTIFACT_A' });
  const refuses = (what: string, run: () => unknown): void => {
    try { run(); check(what, false, 'it was accepted'); } catch { check(what, true); }
  };
  refuses('the same id twice is refused', () => addArtifact(mod, { ...one, id: 'ARTIFACT_A', file: 'B' }));
  refuses('the same file twice is refused', () => addArtifact(mod, { ...one, id: 'ARTIFACT_B' }));
  refuses('a name that is not an id is refused', () => addArtifact(mod, { ...one, id: 'Boots', file: 'C' }));
  refuses('an artifact with no picture and no icon is refused',
    () => addArtifact(mod, { ...one, id: 'ARTIFACT_C', file: 'C', icon: undefined }));
  // The number is the thing maps and saves store, so it follows the position.
  check('the first one takes the number after the shipped', mod.artifacts[0]!.number === SHIPPED_ARTIFACTS,
    `got ${mod.artifacts[0]!.number}`);
}

const dataRoot = process.env.HOMM5_DATA ?? join(import.meta.dirname, '..', 'data-unpacked');
if (!existsSync(join(dataRoot, 'types.xml'))) {
  console.log(`no unpacked data at ${dataRoot} — skipping the rest`);
  console.log(failures ? `\n${failures} failure(s)` : '\nall good');
  process.exit(failures ? 1 : 0);
}

// --- a mod of three artifacts and no creatures -------------------------------

/**
 * A picture to build an icon from, written here so the test carries its own
 * fixture: a 2x2 GIF, one colour, spelled out field by field.
 */
const scratch = mkdtempSync(join(tmpdir(), 'homm5-artifacts-'));
const picture = join(scratch, 'test-icon.gif');
writeFileSync(picture, Buffer.from([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // GIF89a
  2, 0, 2, 0,                          // 2x2
  0x80, 0, 0,                          // global table of 2 entries
  0x40, 0x80, 0xc0, 0, 0, 0,           // the two colours
  0x2c, 0, 0, 0, 0, 2, 0, 2, 0, 0x00,  // image descriptor
  // LZW: minimum code size 2, so clear is 4 and end is 5, codes 3 bits wide.
  // clear, 0, 0, 0, 0, end packed low bit first.
  2, 3, 0x04, 0x00, 0x16, 0x00, 0x3b,
]));

const read = dataReader(dataRoot);
const mod = newCreatureMod('test-artifacts');
const ids = ['ARTIFACT_TEST_ONE', 'ARTIFACT_TEST_TWO', 'ARTIFACT_TEST_THREE'];
for (const [i, id] of ids.entries()) {
  addArtifact(mod, {
    id,
    file: `TestArtifact${i + 1}`,
    name: `Test ${i + 1}`,
    description: 'A test.',
    slot: (['FEET', 'SHOULDERS', 'NECK'] as const)[i]!,
    cost: 5000,
    stats: { Knowledge: 1 },
    // No `icon` and no `model`: the mod has to build both, which is the path
    // the port itself uses.
    picture,
    board: { tiles: 1 },
  });
}

let built;
try {
  built = buildCreatureMod(mod, read);
} catch (e) {
  check('a mod of only artifacts builds', false, (e as Error).message);
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}

check('a mod of only artifacts builds', true, `${built.files.length} files`);
check('and needs no creature ceiling above the shipped one', built.limit === 180, `limit ${built.limit}`);

const file = (suffix: string): string | null => {
  const f = built.files.find((x) => x.path.endsWith(suffix));
  return f ? f.data.toString('latin1') : null;
};

// --- types.xml, all three edits ----------------------------------------------

const types = file('types.xml')!;
check('the enum gains every id', ids.every((id) => types.includes(`<Item>${id}</Item>`)));
check('the map gives them consecutive numbers',
  ids.every((id, i) => new RegExp(`<Name>${id}</Name>\\s*<Value>${SHIPPED_ARTIFACTS + i}</Value>`).test(types)));

{
  const at = types.indexOf('<TypeName>Table_DBArtifact_ArtifactEffect</TypeName>');
  const want = SHIPPED_ARTIFACTS + ids.length;
  const after = types.slice(at);
  const min = /<MinElements>(\d+)<\/MinElements>/.exec(after)?.[1];
  const max = /<MaxElements>(\d+)<\/MaxElements>/.exec(after)?.[1];
  // Both, and this is the one that differs from creatures.
  check('the table declares its new size', min === String(want) && max === String(want), `min ${min}, max ${max}`);
}

// The abilities share the enum list and are numbered from 0 of their own. If
// inserting had shifted them this is what would have moved.
check('the abilities are left alone', /<Name>ABILITY_NONE<\/Name>\s*<Value>0<\/Value>/.test(types));

// --- the table and the script ------------------------------------------------

const table = file('GameMechanics/RefTables/Artifacts.xdb')!;
check('the table holds the shipped ones and ours',
  (table.match(/<ID>\w+<\/ID>/g) ?? []).length === SHIPPED_ARTIFACTS + ids.length);
// The SHAPE the shipped entries use, read off them rather than asserted from
// memory. This is the check that would have caught writing them the creature
// table's way — an `<obj href="#n:inline(DBArtifact)">` the game cannot
// resolve, which leaves the record empty and the artifact unpickable while
// everything else about it looks right.
{
  // `<obj>` exactly, or `<obj …>` with attributes — but not `<objects>`.
  const shipped = new Set((table.match(/<obj(?:\s[^>]*)?>/g) ?? []).slice(0, SHIPPED_ARTIFACTS));
  check('the shipped entries all use one shape', shipped.size === 1, [...shipped].join(' '));
  const shape = [...shipped][0]!;
  check('and ours use the same one', ids.every((id) =>
    new RegExp(`<ID>${id}</ID>\\s*${shape.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(table)),
    `shipped write ${shape}`);
}
// The line that decides which artifact is lying on the ground.
const shared = file('TestArtifact1.(AdvMapArtifactShared).xdb')!;
check('the map object names its own artifact', shared.includes(`<ArtifactID>${ids[0]}</ArtifactID>`));

const lua = file('scripts/advmap-startup.lua')!;
check('a script can name every one of them',
  ids.every((id, i) => lua.includes(`${id} = ${SHIPPED_ARTIFACTS + i}`)));
check('and the count moves with them',
  lua.includes(`ARTIFACT_ARTIFACT_EFFECT_COUNT = ${SHIPPED_ARTIFACTS + ids.length}`),
  /ARTIFACT_ARTIFACT_EFFECT_COUNT = \d+/.exec(lua)?.[0] ?? 'not found');

// --- the icon and the board --------------------------------------------------

const p = artifactPaths({ file: 'TestArtifact1' });
const dds = built.files.find((x) => x.path === p.iconDDS);
check('it carries a 64x64 icon', !!dds && dds.data.length === 128 + 64 * 64 * 4,
  dds ? `${dds.data.length} bytes` : 'missing');
check('with an xdb beside it', !!built.files.find((x) => x.path === p.icon));

{
  const bin = built.files.find((x) => x.path.startsWith('bin/Geometries/'));
  const box = bin ? positionsBox(bin.data) : null;
  // A tile is two world units. The board must be centred on the tile it stands
  // on and STAND on it — the poster it is made from hangs three units up, and a
  // shift applied in the wrong units puts it under the map instead.
  check('the board is one tile wide', !!box && Math.abs(box.sx - 2) < 0.01, box ? box.sx.toFixed(2) : 'no geometry');
  check('centred on the tile', !!box && Math.abs(box.cx) < 0.01 && Math.abs(box.cy) < 0.01,
    box ? `${box.cx.toFixed(2)},${box.cy.toFixed(2)}` : '');
  check('and standing on the ground', !!box && Math.abs(box.cz - box.sz / 2) < 0.01,
    box ? `bottom at ${(box.cz - box.sz / 2).toFixed(2)}` : '');
  // A copy keeping the poster's uid would edit the poster's own mesh.
  check('the copied geometry has a uid of its own',
    !!bin && !bin.path.includes('E8D086B4-C8AB-460C-AB55-811C3477DF23'));
}

// Every href the mod writes must resolve — inside the mod or in the game's data.
{
  const inMod = new Set(built.files.map((f) => f.path.toLowerCase()));
  const missing: string[] = [];
  for (const f of built.files) {
    if (!f.path.endsWith('.xdb') || f.path === 'types.xml') continue;
    if (f.path.startsWith('GameMechanics/')) continue;
    const text = f.data.toString('latin1');
    for (const m of text.matchAll(/<(\w+)[^>]*href="([^"#]+)/g)) {
      const [, field, raw] = m as unknown as [string, string, string];
      // `SrcName` is where a picture came from — an authoring file the game
      // never shipped. Every shipped texture has one that resolves to nothing.
      if (field === 'SrcName' || !raw || raw.endsWith('.mb')) continue;
      const rel = raw.startsWith('/')
        ? raw.slice(1)
        : `${f.path.slice(0, f.path.lastIndexOf('/') + 1)}${raw}`;
      if (inMod.has(rel.toLowerCase()) || read(rel)) continue;
      missing.push(`${f.path} → ${raw}`);
    }
  }
  check('every reference resolves', missing.length === 0, missing.slice(0, 3).join('; '));
}

rmSync(scratch, { recursive: true, force: true });
// --- taking one out again ----------------------------------------------------
//
// A map names an artifact by its enum NAME, never by its number — checked in a
// shipped map.xdb, not assumed. So the numbers may close up; what a removal
// breaks is a map that names the artifact, which is found by searching for it.

{
  const mod = newCreatureMod('x');
  const one = { name: 'a', description: 'd', slot: 'FEET', cost: 1, icon: '/x.xdb' } as const;
  for (const id of ['ARTIFACT_A', 'ARTIFACT_B', 'ARTIFACT_C']) {
    addArtifact(mod, { ...one, id, file: id.slice(-1) });
  }
  const first = mod.artifacts[0]!.number;

  removeArtifact(mod, 'ARTIFACT_A');
  check('it is gone', mod.artifacts.map((a) => a.id).join() === 'ARTIFACT_B,ARTIFACT_C');
  // The point of closing the gap rather than leaving a dead entry: the table has
  // no holes, and nothing pretends to be an artifact that is not one.
  check('the numbers close up', mod.artifacts.map((a) => a.number).join() === `${first},${first + 1}`,
    mod.artifacts.map((a) => a.number).join());

  try { removeArtifact(mod, 'ARTIFACT_NOPE'); check('removing what is not there is refused', false); }
  catch { check('removing what is not there is refused', true); }
}

// What a removal would break, found by name.
{
  const uses = findArtifactUses(join(dataRoot, 'Maps'), ['UNICORN_HORN_BOW', 'ARTIFACT_NEVER_SHIPPED']);
  check('a shipped artifact is found in the maps that name it', (uses.get('UNICORN_HORN_BOW') ?? []).length > 0,
    `${(uses.get('UNICORN_HORN_BOW') ?? []).length} map(s)`);
  check('one nothing names is found nowhere', !uses.has('ARTIFACT_NEVER_SHIPPED'));
  // `ARTIFACT_RING` is a prefix of `ARTIFACT_RING_OF_DEATH`; a warning naming
  // the wrong artifact is worse than no warning.
  check('a prefix is not a match', !findArtifactUses(join(dataRoot, 'Maps'), ['ARTIFACT_RING']).has('ARTIFACT_RING'));
}

console.log(failures ? `\n${failures} failure(s)` : '\nall good');
process.exit(failures ? 1 : 0);
