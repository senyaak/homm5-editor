// Validates the Pandora's Box build — the object every gameplay-mod install ships.
//
// What is checked, and why it is enough to trust the box without a game run:
//
//   the cube — the geometry WE WRITE decodes to exactly a cube: one group,
//     twenty-four vertices, twelve triangles wound OUTWARD (a flipped winding
//     comes out as a negative volume, which is the check catching it), one
//     texture square per face, clear of the ground;
//   the spin — our own skeleton and our own clip, posed through the same code
//     the editor animates with: a quarter of the clip must be a quarter turn
//     about the box's own axis, and nothing may dip into the ground;
//   the documents — all four tiers parse, their fields resolve inside the mod
//     (self-containment, same promise as buildings), and the palette link names
//     the poorest tier;
//   the tiers — the value-to-glow mapping is monotonic and starts at Blue;
//   the texture — painted, not copied: the image is non-uniform and the .dds
//     documents describe what writeDDS produced.
//
//   node tools/test-pandora.ts [dataRoot]

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  PANDORA_CLASS, PANDORA_LINK,
  buildPandora, pandoraShared, pandoraTexture,
} from '../src/mods/pandora-files.ts';
import {
  PANDORA_RATES, PANDORA_TIERS, boxTier, isEmptyBox, pandoraTier, pandoraValue,
} from '../src/mods/pandora-contents.ts';
import type { PandoraStack } from '../src/mods/pandora-contents.ts';
import { pandoraPrices, talismanLadder } from '../src/mods/pandora-prices.ts';
import { singleRoot } from '../src/game/assets.ts';
import { buildGameplayArchive } from '../src/mods/gameplay.ts';
import {
  PANDORA_BLOCK_BEGIN, PANDORA_GUARDS_TEXT, pandoraBehaviourLua, pandoraMapBlock, withPandoraBlock,
} from '../src/mods/pandora-scripts.ts';
import { luaDiagnostics } from '../src/script/lua-lint.ts';
import { dataReader } from '../src/mods/mod-files.ts';
import { readEntries } from '../src/format/pak.ts';
import { extractMeshesStructured } from '../src/scene/geometry.ts';
import { GrannyFile } from '../src/format/gr2.ts';
import { readAnimations, readSkeletons, skinMatrices, skinPositions } from '../src/scene/animation.ts';
import { writeDXT1 } from '../src/format/texture.ts';
import { decodeDDSBuffer } from '../src/format/dds.ts';
import { readObjectGroups } from '../src/map/objects.ts';
import { dataDir, gameDirIfAny } from './game-dir.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const dataRoot = process.argv[2] ?? dataDir();
if (!existsSync(join(dataRoot, 'types.xml'))) {
  console.log(`no unpacked data at ${dataRoot} — nothing to build from`);
  process.exit(0);
}
const read = dataReader(dataRoot);

console.log('the build');
const files = buildPandora(read);
const byPath = new Map(files.map((f) => [f.path.toLowerCase(), f.data]));
check('produces files', files.length > 10, `${files.length}`);

// ---- the box ----------------------------------------------------------------

console.log('the box');
const shared0 = byPath.get(pandoraShared(PANDORA_TIERS[0]!.key).toLowerCase())?.toString('latin1') ?? '';
const modelHref = /<Model href="\/([^"#]+)/.exec(shared0)?.[1] ?? '';
const modelDoc = byPath.get(modelHref.toLowerCase())?.toString('latin1') ?? '';

/** Follow an href the way the engine does, and hand back what is there. */
const follow = (doc: string, field: string): string => {
  const href = new RegExp(`<${field} href="\\/([^"#]+)`).exec(doc)?.[1] ?? '';
  return byPath.get(href.toLowerCase())?.toString('latin1') ?? '';
};

// AN INLINE REFERENCE WITHOUT AN ID TAKES THE GAME DOWN. `#n:inline(Material)`
// resolves through the element's `id`, and all 4385 inline references the game
// ships carry one; ours carried none, the lookup answered null, and the engine
// dereferenced it on map load. Our own documents avoid the form entirely — the
// copied glow effects are the game's own and keep their ids — so the rule that
// covers both is: wherever the form appears, an id follows it.
{
  const naked = files.filter((f) => [...f.data.toString('latin1').matchAll(/#n:inline\([^)]*\)"([^>]*)>/g)]
    .some((m) => !/\bid="/.test(m[1]!)));
  check('every inline reference carries the id it resolves through',
    naked.length === 0, naked.map((f) => f.path).join(', '));
}

// EVERY HREF OF OURS RESOLVES. Not just the shared documents' — the whole
// chain, model to geometry to skeleton to clip. A path that leads nowhere is
// how an object comes to draw nothing at all, and it costs a game run to find
// that way round; here it costs nothing.
{
  const dangling: string[] = [];
  for (const f of files) {
    if (!f.path.endsWith('.xdb')) continue;
    const doc = f.data.toString('latin1');
    if (!doc.startsWith('<?xml')) continue;
    // `SrcName` and the `Exp*` fields name the AUTHORING original — a Maya
    // scene, a .tga nobody ships — and every shipped document carries one that
    // leads nowhere. They are a record, not a reference.
    const AUTHORING = /^(SrcName|ExpSrcClip|ExpSrcScene|ExpSrcClipFolder|ExpSettingsFile)$/;
    for (const [, field, href] of doc.matchAll(/<(\w+) href="([^"]*)"/g)) {
      if (AUTHORING.test(field!)) continue;
      const path = href!.split('#')[0]!;
      if (!path || path.startsWith('#')) continue;      // inline, or an empty slot
      if (path.startsWith('/Text/')) continue;          // the game's own texts
      const at = path.startsWith('/') ? path.slice(1) : `${f.path.replace(/[^/]+$/, '')}${path}`;
      if (!byPath.has(at.toLowerCase())) dangling.push(`${f.path} -> ${href}`);
    }
  }
  check('every href of ours lands on a file we ship', dangling.length === 0,
    dangling.slice(0, 4).join(' · '));
}

// AND THE BINARIES BEHIND THE UIDS. A document naming a uid whose file is not
// in the build is the same failure with one more step in it.
{
  const missing: string[] = [];
  for (const f of files) {
    if (!f.path.endsWith('.xdb')) continue;
    const doc = f.data.toString('latin1');
    const uid = /<uid>([0-9A-Fa-f-]{36})<\/uid>/.exec(doc)?.[1];
    if (!uid) continue;
    const dir = doc.includes('<Skeleton>') ? 'bin/Skeletons'
      : doc.includes('<BasicSkelAnim>') ? 'bin/animations'
      : doc.includes('<Geometry>') ? 'bin/Geometries' : null;
    if (dir && !byPath.has(`${dir}/${uid.toUpperCase()}`.toLowerCase())) missing.push(`${f.path} -> ${dir}/${uid}`);
  }
  check('every uid of ours has its binary', missing.length === 0, missing.join(' · '));
}

// THE ROOT OF A SKINNED MODEL IS A BONE, NOT A MESH. `RootMesh` names the NODE:
// of the 1090 shipped models with a skeleton, 887 give it the same value as
// `RootJoint` and 197 leave it empty, and in none of them is it the first entry
// of `MeshNames`. Ours said the mesh name once, and the box vanished entirely —
// no model, no shadow, only the glow.
// THE BOX IS OURS, built by src/scene/geometry-write.ts rather than sculpted
// out of a donor. So what is asked of it is what we asked the writer for: one
// group, a closed cube of the right size, turned, floating, wound outward, and
// one whole copy of the texture on each face.
const geomDoc = follow(modelDoc, 'Geometry');
const materialDoc = follow(modelDoc, 'Item');
check('the model reaches its geometry and its material', !!geomDoc && !!materialDoc);
const boxUid = /<uid>([0-9A-Fa-f-]{36})<\/uid>/.exec(geomDoc)?.[1] ?? '';
const boxBin = byPath.get(`bin/geometries/${boxUid.toUpperCase()}`.toLowerCase());
check('the box has a mesh of its own', !!boxBin, boxUid);
if (boxBin) {
  const groups = extractMeshesStructured(Buffer.from(boxBin)) ?? [];
  check('one group, as the document declares', groups.length === 1, `${groups.length}`);
  const g = groups[0];
  if (g) {
    check('twenty-four vertices, twelve triangles', g.vertexCount === 24 && g.triCount === 12,
      `${g.vertexCount} / ${g.triCount}`);
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < g.vertexCount; i++) for (let k = 0; k < 3; k++) {
      const v = g.positions[i * 3 + k]!;
      if (v < lo[k]!) lo[k] = v;
      if (v > hi[k]!) hi[k] = v;
    }
    const side = [0, 1, 2].map((k) => hi[k]! - lo[k]!);
    // TILTED, so the extents are the turned cube's: square-ish on every axis,
    // inside a tile, and off the ground.
    const span = Math.max(...side), thin = Math.min(...side);
    check('it is a cube, turned', span - thin < 0.3 && span < 1.9, side.map((s) => s.toFixed(2)).join(' x '));
    check('smaller than a tile, and clear of the ground', span < 1.8 && lo[2]! > 0.2,
      `bottom at z ${lo[2]!.toFixed(2)}`);
    let uvOk = true;
    for (let i = 0; i < g.vertexCount * 2; i++) { const t = g.uvs![i]!; if (t < -0.01 || t > 1.01) uvOk = false; }
    check('one texture square per face', uvOk);
    // Wound outward: a closed body seen from outside has positive signed volume,
    // and a flipped winding is exactly what a single-sided material would cull.
    let volume = 0;
    const c = [(lo[0]! + hi[0]!) / 2, (lo[1]! + hi[1]!) / 2, (lo[2]! + hi[2]!) / 2];
    for (let t = 0; t < g.indices.length; t += 3) {
      const P = [0, 1, 2].map((k) => {
        const o = g.indices[t + k]! * 3;
        return [g.positions[o]! - c[0]!, g.positions[o + 1]! - c[1]!, g.positions[o + 2]! - c[2]!];
      });
      volume += (P[0]![0]! * (P[1]![1]! * P[2]![2]! - P[1]![2]! * P[2]![1]!)
        - P[0]![1]! * (P[1]![0]! * P[2]![2]! - P[1]![2]! * P[2]![0]!)
        + P[0]![2]! * (P[1]![0]! * P[2]![1]! - P[1]![1]! * P[2]![0]!)) / 6;
    }
    // A cube's signed volume is its side cubed when it is wound outward, and
    // NEGATIVE when it is not — which is what a single-sided material culls.
    // A turned cube fills between 1/3√3 and all of the box it spans, so that is
    // the honest window; what the check is really for is the SIGN, which is
    // negative when the winding is inside out and a single-sided material culls
    // every face.
    const across = Math.max(...[0, 1, 2].map((k) => hi[k]! - lo[k]!));
    check('wound outward', volume > 0.19 * across ** 3 && volume < across ** 3,
      `signed volume ${volume.toFixed(3)} inside a ${across.toFixed(2)} box`);
  }
}
check('the material is a solid object’s, not a backdrop’s',
  materialDoc.includes('<AlphaMode>AM_OPAQUE</AlphaMode>')
  && materialDoc.includes('<LightingMode>L_NORMAL</LightingMode>')
  && !materialDoc.includes('AM_OVERLAY') && !materialDoc.includes('L_SELFILLUM'));

// ---- the documents ----------------------------------------------------------

console.log('the documents');
for (const tier of PANDORA_TIERS) {
  const doc = byPath.get(pandoraShared(tier.key).toLowerCase())?.toString('latin1');
  check(`${tier.key} parses`, !!doc && doc.includes(`<${PANDORA_CLASS}>`));
  check(`${tier.key} is a chest with all four messages`, !!doc && doc.includes('<Type>TREASURE_CHEST</Type>')
    && (doc.match(/<Item href="\/Buildings\/PandoraBox\/[^"]*\.txt"\/>/g) ?? []).length === 4);
  if (!doc) continue;
  // every absolute href points inside the build
  const outside = [...doc.matchAll(/href="\/([^"#]+)/g)]
    .map((h) => h[1]!)
    .filter((h) => !byPath.has(h.toLowerCase()) && !h.startsWith('Text/'));
  check(`${tier.key} is self-contained`, outside.length === 0, outside.join(', '));
  check(`${tier.key} is active on its tile`, /<activeTiles>[\s\S]*?<x>0<\/x>[\s\S]*?<\/activeTiles>/.test(doc));
  check(`${tier.key} carries its glow`, doc.includes(`/art/${tier.effect.replace(/\\/g, '/')}`)
    || /<Effect href="\/[^"]+"/.test(doc));
}

const link = byPath.get(PANDORA_LINK.toLowerCase())?.toString('latin1') ?? '';
check('the palette link names the poorest tier', link.includes(pandoraShared(PANDORA_TIERS[0]!.key)));

// ---- the spin ---------------------------------------------------------------

console.log('the spin');
// Three things have to line up for the box to turn: a bone binding in the mesh,
// a skeleton on the model, and an AnimSet on the object. Any one alone does
// nothing, so all three are checked together — and the rig is a ONE-BONE one,
// so "bound to bone 0" is the whole binding rather than a static stand-in.
const BONE0_ENTRY = '0000803f000000000000000000000000ff00000000000000';
const countHex = (buf: Buffer, hex: string): number => {
  const needle = Buffer.from(hex, 'hex');
  let n = 0;
  for (let at = buf.indexOf(needle); at >= 0; at = buf.indexOf(needle, at + 1)) n++;
  return n;
};
check('every tier plays our idle clip', PANDORA_TIERS.every((t) =>
  /<AnimSet href="[^"]+"/.test(byPath.get(pandoraShared(t.key).toLowerCase())?.toString('latin1') ?? '')));
check('every one of the box’s eight positions rides the bone',
  !!boxBin && countHex(Buffer.from(boxBin), BONE0_ENTRY) === 8);
const skelDoc = follow(modelDoc, 'Skeleton');
check('the model names a skeleton of ours', !!skelDoc && skelDoc.includes('<RootJoint>PandoraBox</RootJoint>'));
const skelUid = /<uid>([0-9A-Fa-f-]{36})<\/uid>/.exec(skelDoc)?.[1] ?? '';
check('and the bones are in the build', byPath.has(`bin/skeletons/${skelUid.toUpperCase()}`.toLowerCase()), skelUid);
check('the geometry hangs from the same joint', geomDoc.includes('<RootJoint>PandoraBox</RootJoint>'));

// AND IT ACTUALLY TURNS. Documents lining up is not motion: the rig is loaded
// the way the editor loads one — skeleton binary, the clip the AnimSet names,
// the box's own skin binding — and the cube is posed at two times. A quarter of
// the way through the clip every corner must have swung 90° about the vertical
// through the box, and the box must not have wandered off it.
{
  const setDoc = follow(byPath.get(pandoraShared(PANDORA_TIERS[0]!.key).toLowerCase())?.toString('latin1') ?? '', 'AnimSet');
  const clipDoc = follow(setDoc, 'Anim');
  const clipUid = /<uid>([0-9A-Fa-f-]{36})<\/uid>/.exec(clipDoc)?.[1] ?? '';
  const clipBin = byPath.get(`bin/animations/${clipUid.toUpperCase()}`.toLowerCase());
  const boneBin = byPath.get(`bin/skeletons/${skelUid.toUpperCase()}`.toLowerCase());
  check('the clip and the bones are both in the build', !!clipBin && !!boneBin, clipUid);
  if (clipBin && boneBin && boxBin) {
    const skeleton = readSkeletons(GrannyFile.open(Buffer.from(boneBin))!)[0]!;
    const clip = readAnimations(GrannyFile.open(Buffer.from(clipBin))!)[0]!;
    const mesh = extractMeshesStructured(Buffer.from(boxBin), { skin: true })![0]!;
    const at = (t: number): Float32Array =>
      skinPositions(mesh.positions, mesh.skin!, skinMatrices(skeleton, clip, t));
    const rest = at(0), quarter = at(clip.duration / 4);
    // Every corner turned a quarter turn about the vertical axis through 0,0.
    let worst = 0, drift = 0;
    for (let i = 0; i < rest.length; i += 3) {
      const want = [-rest[i + 1]!, rest[i]!];
      worst = Math.max(worst, Math.hypot(quarter[i]! - want[0]!, quarter[i + 1]! - want[1]!));
      drift = Math.max(drift, Math.abs(Math.hypot(quarter[i]!, quarter[i + 1]!) - Math.hypot(rest[i]!, rest[i + 1]!)));
    }
    check('a quarter of the clip is a quarter turn about its own axis', worst < 0.05,
      `worst corner off by ${worst.toFixed(4)}`);
    check('and nothing drifts off the axis', drift < 1e-3, `${drift.toFixed(5)}`);
    check('the clip is ours: one full turn', Math.abs(clip.duration - 7.5) < 0.01,
      `${clip.duration}s`);
    // The same clip lifts and drops by ±0.198, so "floating" has to survive the
    // bottom of the bob rather than only the pose it was authored in.
    let low = Infinity;
    for (let f = 0; f < 1; f += 0.05) {
      const p = at(clip.duration * f);
      for (let i = 2; i < p.length; i += 3) low = Math.min(low, p[i]!);
    }
    check('and never dips into the ground while it bobs', low > 0.05, `lowest corner at z ${low.toFixed(3)}`);
  }
}
void 0;

// ---- the tiers --------------------------------------------------------------

console.log('the tiers');
check('empty is Blue', pandoraTier(0).key === 'Blue');
check('5000 is Green', pandoraTier(5000).key === 'Green');
check('15000 is Gold', pandoraTier(15000).key === 'Gold');
check('a fortune is Red', pandoraTier(1e6).key === 'Red');
let last = -1, monotonic = true;
for (const t of PANDORA_TIERS) { if (t.from <= last) monotonic = false; last = t.from; }
check('thresholds ascend', monotonic);

// ---- what the contents are worth --------------------------------------------
//
// The rule this section exists for: a creature costs what a creature costs,
// whichever side of the fight it is on. A box holding ten archangels holds
// them whether it hands them over or sets them on the hero, so both spellings
// land on the same glow — anything else would let an author dodge the colour
// by making the same box a fight.

console.log('what the contents are worth');
{
  const prices = {
    creature: (id: string | number) => (id === 'CREATURE_ARCHANGEL' ? 4000 : 15),
    artifact: (id: string | number) => (id === 'ARTIFACT_TITANS_THUNDER' ? 25000 : 1000),
    spellLevel: (id: string | number) => (id === 'SPELL_ARMAGEDDON' ? 5 : 1),
  };
  const angels: PandoraStack[] = [{ creature: 'CREATURE_ARCHANGEL', count: 10 }];
  const given = pandoraValue({ name: 'A', creatures: angels }, prices);
  const fought = pandoraValue({ name: 'B', guards: angels }, prices);
  check('ten archangels given are worth ten archangels fought',
    given.total === fought.total && given.total === 40000, `${given.total} vs ${fought.total}`);
  check('and both wear the same glow',
    boxTier({ name: 'A', creatures: angels }, prices).key === boxTier({ name: 'B', guards: angels }, prices).key,
    boxTier({ name: 'A', creatures: angels }, prices).key);

  const mixed = pandoraValue({
    name: 'C', gold: 1000, wood: 4, gem: 2, exp: 500,
    artifacts: ['ARTIFACT_TITANS_THUNDER'], spells: ['SPELL_ARMAGEDDON'],
  }, prices);
  const expected = 1000 + 4 * PANDORA_RATES.common + 2 * PANDORA_RATES.rare
    + 500 * PANDORA_RATES.exp + 25000 + 5 * PANDORA_RATES.spellLevel;
  check('every kind of content adds up', mixed.total === expected, `${mixed.total} vs ${expected}`);
  check('and each says where it came from',
    mixed.parts.map((p) => p.what).join(',') === 'gold,wood,gem,experience,artifacts,spells',
    mixed.parts.map((p) => p.what).join(','));
  check('nothing worth nothing is listed', pandoraValue({ name: 'D' }, prices).parts.length === 0);

  // The override is the author's, and it survives the contents changing under
  // it — a box deliberately made to look poor stays looking poor.
  check('an override beats the contents',
    boxTier({ name: 'E', gold: 1e6, tier: 'Blue' }, prices).key === 'Blue');
  check('an unknown override falls back to what the contents earn',
    boxTier({ name: 'F', gold: 1e6, tier: 'Puce' }, prices).key === 'Red');
  check('an empty box is empty, a message alone is not',
    isEmptyBox({ name: 'G' }) && !isEmptyBox({ name: 'H', message: 'boo' }));

  // And the prices the window will actually use come off the game's tables —
  // hand-written numbers above prove the arithmetic, these prove the reading.
  const real = pandoraPrices(singleRoot(dataRoot));
  const angel = real.creature('CREATURE_ARCHANGEL');
  const peasant = real.creature('CREATURE_PEASANT');
  check('a creature costs what the game charges for it',
    angel === 3500 && peasant === 15, `archangel ${angel}, peasant ${peasant}`);
  // Both spellings, because the box's contents use the script one and the
  // reference table keys on the bare name.
  const bare = real.artifact('TITANS_TRIDENT');
  check('an artifact costs its CostOfGold', bare > 0, `${bare}`);
  check('and the script spelling finds the same artifact',
    real.artifact('ARTIFACT_TITANS_TRIDENT') === bare, `${real.artifact('ARTIFACT_TITANS_TRIDENT')}`);
  check('a spell knows its level',
    real.spellLevel('SPELL_ARMAGEDDON') === 5 && real.spellLevel('SPELL_MAGIC_ARROW') === 1,
    `${real.spellLevel('SPELL_ARMAGEDDON')} / ${real.spellLevel('SPELL_MAGIC_ARROW')}`);
  // THE LADDER, off the game's own table rather than a list written here: it is
  // what a box splits its spells by, and the shipped one ends on Town Portal.
  const ladderNow = talismanLadder(singleRoot(dataRoot));
  check('the talisman ladder is read from the game',
    ladderNow.length === 4 && ladderNow[0] === 'SPELL_SUMMON_BOAT'
    && ladderNow[3] === 'SPELL_TOWN_PORTAL', ladderNow.join(' · '));
  // And each rung is a spell the game actually has — a typo in the table would
  // otherwise ride into a box's `adventure` list and be handed to nobody.
  check('and every rung is a spell the game knows',
    ladderNow.every((id) => real.spellLevel(id) > 0), ladderNow.join(' · '));
  check('and an id nobody knows is worth nothing, quietly',
    real.creature('CREATURE_NOT_A_THING') === 0 && real.artifact('ARTIFACT_NOT_A_THING') === 0
    && real.spellLevel('SPELL_NOT_A_THING') === 0);
}

// ---- the texture ------------------------------------------------------------

console.log('the texture');
const img = pandoraTexture();
const seen = new Set<number>();
for (let i = 0; i < img.rgba.length; i += 4) seen.add((img.rgba[i]! << 16) | (img.rgba[i + 1]! << 8) | img.rgba[i + 2]!);
check('is painted, not flat', seen.size > 100, `${seen.size} colours`);
const dds = files.find((f) => f.path === 'Buildings/PandoraBox/PandoraBox.dds');
check('the painted face ships as a dds', !!dds && dds.data.length === 128 + img.width * img.height * 4);
// The model wears OUR texture: our document, our pixels, DXT1 with a mip
// chain. An uncompressed surface under a document that says DXT1 is what made
// the box a transparent ghost, so the two are checked against each other.
const modelTexDocs = [...materialDoc.matchAll(/<Texture href="([^"]+)"/g)]
  .map((m) => m[1]!.replace(/^\//, '').split('#')[0]!);
check('the model names one texture, and it is ours', modelTexDocs.length === 1
  && byPath.has(modelTexDocs[0]!.toLowerCase()), modelTexDocs.join(', '));
check('the pixels are ours, as DXT1 with mips', modelTexDocs.every((t) => {
  const d = byPath.get(t.toLowerCase())?.toString('latin1') ?? '';
  if (!d.includes('<Format>TF_DXT1</Format>') || !d.includes('<IsDXT>true</IsDXT>')) return false;
  const dest = /<DestName href="([^"]+)"/.exec(d)?.[1] ?? '';
  const dds = byPath.get(t.replace(/[^/]+$/, dest).toLowerCase());
  return !!dds && dds.toString('latin1', 84, 88) === 'DXT1' && dds.readUInt32LE(28) > 1;
}));
// And the encoding is faithful: decoded back, it is the picture that went in.
{
  const encoded = writeDXT1(img);
  const back = decodeDDSBuffer(encoded);
  let sum = 0, opaque = 0;
  for (let i = 0; i < img.rgba.length; i += 4) {
    for (let k = 0; k < 3; k++) sum += Math.abs(img.rgba[i + k]! - back.rgba[i + k]!);
    if (back.rgba[i + 3] === 255) opaque++;
  }
  const mean = sum / (img.rgba.length / 4 * 3);
  check('DXT1 round-trips within a few levels', mean < 6, `mean channel error ${mean.toFixed(2)}`);
  check('and every texel is opaque', opaque === img.rgba.length / 4);
}

// ---- the scripts ------------------------------------------------------------

console.log('the scripts');
{
  const lua = pandoraBehaviourLua();
  check('the behaviour lints clean', luaDiagnostics(lua).length === 0,
    luaDiagnostics(lua).map((d) => `${d.from}: ${d.message}`).join('; '));

  // WHO THE BOX STOPS, and the rule paid for by a play-through: the computer
  // announced its own reward on the human's screen. `GetCurrentPlayer` is the
  // player whose TURN it is — on the AI's turn it IS the AI, so an owner check
  // alone lets it through. Every window that must be ANSWERED asks whether the
  // owner is human first, and none may be reached without that.
  for (const popup of ['QuestionBox(', `MessageBox("/${PANDORA_GUARDS_TEXT}")`]) {
    const at = lua.indexOf(popup);
    check(`${popup.slice(0, 24)} is reached only past the human check`, at > 0
      && lua.lastIndexOf('H5E_PandoraIsHuman', at) > lua.lastIndexOf('function H5E_Pandora', at));
  }
  check('and the check reads every shape IsAIPlayer could answer with',
    // nil and 0, and NOT `false` — which this Lua does not have at all. The
    // linter is what refuses the word now (it is an error there, and the
    // behaviour lints clean above); this only pins the shape of the answer.
    ['ai == nil', 'ai == 0'].every((s) => lua.includes(s)));
  // The author's own words are NOT a window: a flying sign says them without
  // stopping the map, and it is addressed, so it needs no gate at all.
  check('the box says its message with a flying sign, not a window',
    lua.includes('ShowFlyingSign(box.said, H5E_PandoraHero, player, 6)')
    && !lua.includes('MessageBox(box.said)'));
  // And a map that wants a window has the door for it — DECLARED at load, so
  // that asking about it is not the engine's red "Value was NIL when getting
  // global with name 'H5E_PandoraOnOpen'".
  check('and a map can hang its own code on the opening',
    lua.includes('H5E_PandoraOnOpen = 0;')
    && lua.includes('if H5E_PandoraOnOpen ~= 0 then H5E_PandoraOnOpen(H5E_PandoraHero, H5E_PandoraObj); end'));

  const boxes = [
    { name: 'Pandora01', exp: 1000, gold: 2500, wood: 5, artifacts: ['ARTIFACT_ENDLESS_BAG_OF_GOLD'] },
    { name: 'Pandora02', spells: [5, 17], creatures: [{ creature: 'CREATURE_PEASANT', count: 20 }] },
    { name: 'Pandora03', gold: 50000, guards: [{ creature: 'CREATURE_ARCHDEVIL', count: 4 }, { creature: 'CREATURE_DEVIL', count: 8 }] },
  ];
  const block = pandoraMapBlock(boxes);
  check('the block lints clean', luaDiagnostics(block).length === 0,
    luaDiagnostics(block).map((d) => `${d.from}: ${d.message}`).join('; '));
  // The doFile comes last: a trigger resolves its handler when it FIRES, so
  // the hooks must already be bound if the behaviour file fails to load.
  check('the block loads the behaviour last', block.indexOf('doFile') > block.lastIndexOf('Trigger(OBJECT_TOUCH_TRIGGER'));
  check('a guarded box fights before it opens',
    block.includes('StartCombat(hero, nil, 2, CREATURE_ARCHDEVIL, 4, CREATURE_DEVIL, 8, nil, "H5E_PandoraWon")'));
  check('every box is hooked', boxes.every((b) => block.includes(`Trigger(OBJECT_TOUCH_TRIGGER, "${b.name}", "H5E_PandoraTouch")`)));

  const authored = '-- mine\r\nfunction DayOne() end;\r\n';
  const withBlock = withPandoraBlock(authored, boxes);
  check('the block goes above the author\'s code', withBlock.startsWith(PANDORA_BLOCK_BEGIN) && withBlock.endsWith(authored));
  const updated = withPandoraBlock(withBlock, boxes.slice(0, 1));
  check('a rewrite replaces, not stacks', updated.split(PANDORA_BLOCK_BEGIN).length === 2 && !updated.includes('Pandora03'));
  check('no boxes takes the block away', withPandoraBlock(withBlock, []) === authored);
  let refused = false;
  try { pandoraMapBlock([{ name: 'bad name' }]); } catch { refused = true; }
  check('a bad placement name is refused', refused);

  // ADVENTURE MAGIC GOES DOWN ITS OWN PATH, and the ladder is what says which
  // spells those are. A barbarian is refused every school but war cries, so a
  // box hands him a talisman step instead — and the split has to happen where
  // the ladder is known, which is here and not in Lua.
  const ladder = ['SPELL_SUMMON_BOAT', 'SPELL_TOWN_PORTAL'];
  const mixed = [{ name: 'Pandora04', spells: ['SPELL_FIREBALL', 'SPELL_TOWN_PORTAL'] }];
  const split = pandoraMapBlock(mixed, { ladder });
  check('the block lists a ladder spell apart from a taught one',
    split.includes('spells = { SPELL_FIREBALL }') && split.includes('adventure = { SPELL_TOWN_PORTAL }'),
    split.split('\n').filter((l) => l.includes('spells') || l.includes('adventure')).join(' | '));
  check('and the split block lints clean', luaDiagnostics(split).length === 0,
    luaDiagnostics(split).map((d) => `${d.from}: ${d.message}`).join('; '));
  // WITHOUT A LADDER NOTHING CHANGES — a test with no data root, or an install
  // whose table cannot be read, writes what a box has always written.
  check('no ladder means every spell is taught',
    pandoraMapBlock(mixed).includes('spells = { SPELL_FIREBALL, SPELL_TOWN_PORTAL }')
    && !pandoraMapBlock(mixed).includes('adventure ='));
  // And the behaviour that reads the list: the step first, teaching only when
  // the step says the talisman is not this hero's.
  check('the behaviour takes the talisman step before teaching',
    lua.includes('local step = H5ETalismanStep(hero);')
    && lua.indexOf('H5ETalismanStep(hero)') < lua.indexOf('TeachHeroSpell(hero, s);', lua.indexOf('box.adventure')));

  // A MESSAGE IS A FILE, not a string: MessageBox takes a text ref. A box that
  // says something and has nowhere for it to be read from is a box that would
  // open in silence, so the block refuses to be written rather than dropping
  // the line the author typed.
  // THE NAMES THE ENGINE KNOWS. Its ids are globals declared in
  // `scripts/advmap-startup.lua` (`ARTIFACT_BOOTS_OF_SPEED = 24`), while the
  // reference tables key on the BARE name — so a list built from a table asked
  // Lua for a global that does not exist. The game answered with six red
  // warnings and handed over nil, which GiveArtefact takes without complaint:
  // no artifacts, no error. Measured in a run on 12.08.2026.
  const bare = pandoraMapBlock([{
    name: 'PandoraBare',
    artifacts: ['BOOTS_OF_SPEED', 'ARTIFACT_ANGEL_WINGS', 24],
    spells: ['FIREBALL', 'SPELL_ARMAGEDDON'],
    creatures: [{ creature: 'PEASANT', count: 3 }],
    guards: [{ creature: 'ARCHER', count: 2 }],
  }]);
  check('a bare artifact name gets the prefix its global carries',
    bare.includes('artifacts = { ARTIFACT_BOOTS_OF_SPEED, ARTIFACT_ANGEL_WINGS, 24 }'),
    /artifacts = \{[^}]*\}/.exec(bare)?.[0]);
  check('and so do spells, creatures and guards',
    bare.includes('spells = { SPELL_FIREBALL, SPELL_ARMAGEDDON }')
    && bare.includes('creatures = { {CREATURE_PEASANT, 3} }')
    && bare.includes('CREATURE_ARCHER, 2'),
    /spells = \{[^}]*\}/.exec(bare)?.[0]);
  check('a number is left alone', bare.includes('24'));

  const talker = [{ name: 'PandoraSays', message: 'Something stirs inside.' }];
  let silent = false;
  try { pandoraMapBlock(talker); } catch { silent = true; }
  check('a message with nowhere to live is refused', silent);
  const said = pandoraMapBlock(talker, { said: (b) => `/Maps/Probe/${b.name}.txt` });
  check('and points at the file when there is one',
    said.includes('said = "/Maps/Probe/PandoraSays.txt"'));
  check('the talking block lints clean', luaDiagnostics(said).length === 0,
    luaDiagnostics(said).map((d) => `${d.from}: ${d.message}`).join('; '));

  // AND NOTHING ELSE IS SAID. The box used to fly a receipt of what it handed
  // over; the game announces its own gains, so that was a second line under
  // every one of them. What the game leaves silent is being given the ENGINE's
  // announcement (native/qol/pandora-notify.c), not a caption of ours.
  const paying = pandoraMapBlock([{ name: 'PandoraPays', gold: 500 }]);
  check('a box that gives something says nothing about it',
    !paying.includes('report') && !pandoraBehaviourLua().includes('box.report'));
  // The author's words belong between "yes" and whatever comes out — and for a
  // guarded box that means BEFORE the fight, not after it.
  const behaviour = pandoraBehaviourLua();
  check('the box speaks before the fight starts',
    behaviour.indexOf('ShowFlyingSign(box.said') < behaviour.indexOf('fight(H5E_PandoraHero)'));
  check('and taunts whoever opened a guarded one',
    behaviour.includes(`MessageBox("/${PANDORA_GUARDS_TEXT}")`)
    && behaviour.indexOf(PANDORA_GUARDS_TEXT) < behaviour.indexOf('fight(H5E_PandoraHero)'));
}

// ---- the archive ------------------------------------------------------------

console.log('the archive');
const archive = buildGameplayArchive(read);
const names = new Set(readEntries(archive).map((e) => e.name));
check('round-trips as a zip', names.size === files.length, `${names.size} of ${files.length}`);
check('carries the palette link', names.has(PANDORA_LINK));
// The probe twins are gone: what they asked is answered and written down
// (docs/engineInternals/PANDORA_OBJECT.md), so the archive carries the box and
// nothing that only looks like one.
// Matched on the DOCUMENTS, not on the name: `PandoraBox_ArtifactFound.txt` is
// the message slot a chest shows when it hands over an artifact, and a wider
// pattern flagged it as a leftover twin.
check('carries no probe twins',
  ![...names].some((n) => /PandoraBox_(Mill|Still|Boned|Clipped|Artifact)\.\(/.test(n)));

// ---- the palette group ------------------------------------------------------
//
// Which group the box lists under is decided by WHERE ITS LINK SITS: the
// Objects tab's filters are folder prefixes read out of the game's own
// `Editor/MapFilters.xml`, which no mod can add to. So the check is against
// that file rather than against a name we chose — a link moved back out of
// Treasures/ would otherwise pass every other test in this suite and quietly
// list the box among the scenery again.

const gameRoot = gameDirIfAny();
if (gameRoot && existsSync(join(gameRoot, 'Editor', 'MapFilters.xml'))) {
  console.log('the palette group');
  const groups = readObjectGroups(join(gameRoot, 'Editor'));
  const covering = groups.filter((g) => !g.separator
    && g.prefixes.some((p) => PANDORA_LINK.toLowerCase().startsWith(p.toLowerCase())));
  check('the box lists under exactly one group', covering.length === 1,
    covering.map((g) => g.name).join(', ') || 'none');
  check('and that group is the treasures', /treasure/i.test(covering[0]?.name ?? ''),
    covering[0]?.name ?? '');
}

console.log(failures ? `\n${failures} FAILED` : '\nall good');
process.exit(failures ? 1 : 0);
