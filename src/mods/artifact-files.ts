// The files a mod ships for its artifacts and artifact sets.
//
// An artifact costs the game two global things — an entry in the artifact
// reference table and the enum in types.xml that names it — plus a board to
// stand on the map. A SET costs a third: the effect enum, the default-stats
// thresholds it is read from, and (when it carries Lua) a script the game's
// own startup file is patched to load.
//
// Every patch here is applied to text the caller read, and returned as text:
// the mod ships one copy of types.xml however many patches touched it.

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { readGif } from '../format/gif.ts';
import { fitSquare, textureDoc, writeDDS } from '../format/texture.ts';
import { placeGeometry, positionsBox } from '../scene/geometry.ts';
import { parseTypeSpec } from '../schema/typespec.ts';
import {
  SHIPPED_ARTIFACTS, artifactLink, artifactPaths, artifactRecord, artifactSharedDoc, boardMaterial,
  boardModel,
} from './artifacts.ts';
import { refPath } from './dwellings.ts';
import { uidFor } from './mod-art.ts';
import { TYPES, mustRead, mustReadBytes, utf16 } from './mod-files.ts';
import { SHIPPED_SET_EFFECTS } from './mod-model.ts';
import { retuneBox } from './model-box.ts';
import { EOL, count, indentOf, insertAfterLine, insertBeforeLine, once, retune } from './xml-edit.ts';
import type { SpecType } from '../schema/typespec.ts';
import type { DataReader, ModFile } from './mod-files.ts';
import type { ModArtifact, ModArtifactSet } from './mod-model.ts';

/** And the two an artifact adds. */
export const ARTIFACT_TABLE = 'GameMechanics/RefTables/Artifacts.xdb';
/**
 * The script the game loads on every adventure map, and where the `ARTIFACT_*`
 * numbers Lua addresses artifacts by are declared. A mod that adds an artifact
 * and not its constant leaves it unnameable from a script.
 */
export const STARTUP_SCRIPT = 'scripts/advmap-startup.lua';

/**
 * The same anchor for artifacts, and the two type names their table goes by.
 *
 * `ARTIFACT_PRINCESS` is number 96 and the enum runs straight on into
 * `ABILITY_NONE` — which looks alarming, because inserting into a POSITIONAL
 * enum would renumber every ability after it. It is not positional: both
 * `ARTIFACT_NONE` and `ABILITY_NONE` are 0 in the name→number map, so the list
 * is one set of allowed strings covering two independent numberings, and
 * inserting after the last artifact disturbs nothing.
 */
const LAST_SHIPPED_ARTIFACT = 'ARTIFACT_PRINCESS';
const ARTIFACT_TABLE_TYPE = 'Table_DBArtifact_ArtifactEffect';
const ARTIFACT_RECORD_TYPE = 'DBArtifact';
/** And the Lua constant that says how many there are. */
const ARTIFACT_COUNT_CONST = 'ARTIFACT_ARTIFACT_EFFECT_COUNT';

/**
 * Artifact sets: the file they live in, the enum they extend, and its last
 * shipped member.
 *
 * `ArtifactSetEffect` is an ordinary enum in types.xml — explicit `<Name>` and
 * `<Value>` pairs — so appending to it is as cheap as appending an artifact,
 * and it is why a set of ours can be OURS rather than a shipped one borrowed.
 * `ARTFSET_EFFECT_CUSTOM` (0) is the developers' own "no predefined effect"
 * slot; we leave it alone, along with everything else already there.
 */
export const DEFAULT_STATS = 'GameMechanics/RPGStats/DefaultStats.xdb';
const SET_EFFECT_TYPE = 'ArtifactSetEffect';
const SET_TEXT_DIR = 'GameMechanics/RPGStats/ArtifactSets';
const LAST_SHIPPED_SET_EFFECT = 'ARTFSET_EFFECT_DEMONIC';

/**
 * The geometry a board borrows: one of the game's developer posters.
 *
 * A poster is the only thing shipped that is a bare quad — `Size` 1.43 x 0 x
 * 1.43, one mesh, one material — so a board can reference it and carry nothing
 * of its own but a material and a texture. Which poster does not matter; this
 * one is a rectangle like the rest.
 */
const BOARD_GEOMETRY = '_(Model)/Buildings/Posters/Gudkov-geom.xdb';

/**
 * The files every artifact contributes.
 *
 * Four always — the map object, the palette entry and its two texts — plus the
 * icon when the mod builds one from a picture, plus a board when the artifact
 * has no model of its own.
 */
export function buildArtifacts(artifacts: readonly ModArtifact[], read: DataReader): ModFile[] {
  if (!artifacts.length) return [];
  const files: ModFile[] = [];
  const types = parseTypeSpec(mustRead(read, TYPES));

  for (const a of artifacts) {
    const p = artifactPaths(a);

    // The icon first: a board is made OF it, so it has to exist by then.
    if (a.picture) {
      const source = readFileSync(a.picture);
      const image = fitSquare(readGif(source), 64);
      files.push({ path: p.iconDDS, data: writeDDS(image) });
      files.push({
        path: p.icon,
        data: Buffer.from(textureDoc({
          dds: basename(p.iconDDS),
          width: image.width,
          height: image.height,
          // The NAME of the picture, not the path to it. `SrcName` is where a
          // texture came from and nothing reads it at run time; writing the
          // author's own filesystem into a shipped file helps nobody, and the
          // manifest keeps the full path where it belongs.
          source: basename(a.picture),
        }), 'latin1'),
      });
    }

    if (!a.model) {
      const geometry = mustRead(read, BOARD_GEOMETRY);
      const uid = /<uid>([0-9A-Fa-f-]{36})<\/uid>/.exec(geometry)?.[1];
      if (!uid) throw new Error(`${a.file}: ${BOARD_GEOMETRY} names no uid`);
      const bin = mustReadBytes(read, `bin/Geometries/${uid.toUpperCase()}`);

      // The poster hangs in the air where it stood on its post; an artifact lies
      // on the tile it is on. So the mesh is MOVED — its own centre to the
      // origin, its foot to the ground — and scaled to the width asked for.
      // A copy needs a fresh uid as well: the binaries are keyed by it, so a
      // copy that kept the poster's would edit the poster's mesh.
      const box = positionsBox(bin);
      if (!box) throw new Error(`${a.file}: cannot read the board geometry's extent`);
      const tiles = a.board?.tiles ?? 1;
      const scale = (tiles * 2) / Math.max(box.sx, box.sz, 1e-6);
      // The shift is in the SOURCE's units, not the result's: placeGeometry adds
      // it BEFORE scaling. Scaling it too puts the board a long way underground,
      // and further the bigger it is.
      const placed = placeGeometry(bin, {
        scale,
        shift: [-box.cx, -box.cy, -(box.cz - box.sz / 2)],
      });
      if (!placed) throw new Error(`${a.file}: the board geometry could not be moved`);

      const ownUid = uidFor(`board:${a.id}`);
      const doc = retuneBox(geometry, placed.bbox, { scale, shift: [0, 0, 0] })
        .replace(/<uid>[0-9A-Fa-f-]{36}<\/uid>/, `<uid>${ownUid}</uid>`)
        // The AI geometry describes where the walls are for pathing. A flat
        // board has none worth keeping, and a stale one would disagree with the
        // mesh we just moved.
        .replace(/<AIGeometry[^>]*\/>/, '<AIGeometry/>')
        .replace(/<AIGeometry[^>]*>[\s\S]*?<\/AIGeometry>/, '<AIGeometry/>');
      const geomPath = `${p.dir}/${a.file}_Board-geom.xdb`;
      files.push({ path: geomPath, data: Buffer.from(doc, 'latin1') });
      files.push({ path: `bin/Geometries/${ownUid}`, data: placed.data });
      files.push({
        path: p.boardMaterial,
        data: Buffer.from(boardMaterial(`/${a.icon ? refPath(a.icon) : p.icon}`), 'latin1'),
      });
      files.push({
        path: p.board,
        data: Buffer.from(boardModel(`/${p.boardMaterial}`, `/${geomPath}`), 'latin1'),
      });
    }

    files.push({ path: p.shared, data: Buffer.from(artifactSharedDoc(a, p, types), 'latin1') });
    files.push({ path: p.link, data: Buffer.from(artifactLink(p, `/${a.icon ? refPath(a.icon) : p.icon}`), 'latin1') });
    files.push({ path: p.name, data: utf16(a.name) });
    files.push({ path: p.description, data: utf16(a.description) });
  }
  return files;
}

/**
 * The texts a set names: its own, and one per number of worn pieces.
 *
 * Both go where the shipped sets keep theirs, because `NameFileRef` and the
 * rest are hrefs RELATIVE to `DefaultStats.xdb` — a mod that puts them under
 * its own folder writes a path the game resolves against `RPGStats/` and does
 * not find, and the tooltip comes out blank rather than wrong.
 */
export function buildArtifactSets(sets: readonly ModArtifactSet[]): ModFile[] {
  const files: ModFile[] = [];
  for (const s of sets) {
    files.push({ path: `${SET_TEXT_DIR}/${s.file}_Name.txt`, data: utf16(s.name) });
    files.push({ path: `${SET_TEXT_DIR}/${s.file}_Desc.txt`, data: utf16(s.description) });
    s.artifacts.forEach((_, i) => {
      const text = s.perCount?.[i];
      if (text) files.push({ path: `${SET_TEXT_DIR}/${s.file}_Desc${i + 1}.txt`, data: utf16(text) });
    });
  }
  return files;
}

/** types.xml, the set half: one enum entry per set of ours, appended. */
export function patchSetTypes(types: string, sets: readonly ModArtifactSet[]): string {
  const at = once(types, `<TypeName>${SET_EFFECT_TYPE}</TypeName>`, 'types.xml artifact-set enum');
  const last = types.indexOf(`<Name>${LAST_SHIPPED_SET_EFFECT}</Name>`, at);
  if (last < 0) throw new Error(`types.xml: ${SET_EFFECT_TYPE} does not end at ${LAST_SHIPPED_SET_EFFECT}`);
  const itemEnd = types.indexOf('</Item>', last);
  if (itemEnd < 0) throw new Error('types.xml artifact-set enum: the last entry has no </Item>');
  return insertAfterLine(types, itemEnd, sets.flatMap((s) => [
    '<Item>', `\t<Name>${s.effect}</Name>`, `\t<Value>${s.number}</Value>`, '</Item>',
  ]));
}

/**
 * DefaultStats.xdb: one `<Item>` per set, appended inside `<Sets>`.
 *
 * The per-count array is read POSITIONALLY and holds one entry per member,
 * indexed from ONE piece worn — not from none. Every shipped set leaves that
 * first entry blank, which makes it look like a "nothing worn" slot; it is not,
 * and reading it that way shifts every description one piece early, so a set
 * appears to combine sooner than it does.
 */
export function patchDefaultStats(stats: string, sets: readonly ModArtifactSet[]): string {
  const had = count(stats, /<Effect>ARTFSET_EFFECT_\w+<\/Effect>/g);
  if (had !== SHIPPED_SET_EFFECTS - 1) {
    throw new Error(`${DEFAULT_STATS}: ${had} sets, expected ${SHIPPED_SET_EFFECTS - 1}`);
  }
  const close = once(stats, '</Sets>', `${DEFAULT_STATS} sets`);
  return insertBeforeLine(stats, close, sets.flatMap((s) => [
    '<Item>',
    `\t<Effect>${s.effect}</Effect>`,
    '\t<Artifacts>',
    ...s.artifacts.flatMap((id) => [
      '\t\t<Item>',
      `\t\t\t<Artifact>${id}</Artifact>`,
      '\t\t\t<CombinesAtPuton>true</CombinesAtPuton>',
      '\t\t\t<CombinesAtBackpack>false</CombinesAtBackpack>',
      '\t\t</Item>',
    ]),
    '\t</Artifacts>',
    `\t<NameFileRef href="ArtifactSets/${s.file}_Name.txt"/>`,
    `\t<DescriptionFileRef href="ArtifactSets/${s.file}_Desc.txt"/>`,
    '\t<CombinedDescriptionsFileRefs>',
    ...s.artifacts.map((_, i) => {
      const text = s.perCount?.[i];
      return `\t\t<Item href="${text ? `ArtifactSets/${s.file}_Desc${i + 1}.txt` : ''}"/>`;
    }),
    '\t</CombinedDescriptionsFileRefs>',
    '\t<CombinedHeroClassBonusesDescs/>',
    '\t<CombinedIcons/>',
    '</Item>',
  ]));
}

/**
 * types.xml, the artifact half: the enum, the name→number map, and the size the
 * table is declared to hold.
 *
 * The size is where artifacts differ from creatures, and the difference is easy
 * to carry over wrongly. A creature table declares `ref_table_num_objs` and a
 * `MaxElements`, with `MinElements` left alone because it is a floor the new
 * count clears. The artifact table declares no `ref_table_num_objs` at all, and
 * its `MinElements` EQUALS its `MaxElements` — so both have to move, and a mod
 * that raises only the maximum leaves the table declaring it holds exactly 97
 * while carrying 100.
 */
export function patchArtifactTypes(types: string, artifacts: readonly ModArtifact[]): string {
  let t = types;
  const last = LAST_SHIPPED_ARTIFACT;

  const enumAt = once(t, `<Item>${last}</Item>`, 'types.xml artifact enum');
  t = insertAfterLine(t, enumAt, artifacts.map((a) => `<Item>${a.id}</Item>`));

  const mapAt = once(t, `<Name>${last}</Name>`, 'types.xml artifact name→number map');
  const itemEnd = t.indexOf('</Item>', mapAt);
  if (itemEnd < 0) throw new Error('types.xml artifact map: the last entry has no </Item>');
  t = insertAfterLine(t, itemEnd, artifacts.flatMap((a) => [
    '<Item>', `\t<Name>${a.id}</Name>`, `\t<Value>${a.number}</Value>`, '</Item>',
  ]));

  const table = once(t, `<TypeName>${ARTIFACT_TABLE_TYPE}</TypeName>`, 'types.xml artifact table');
  const to = SHIPPED_ARTIFACTS + artifacts.length;
  t = retune(t, table, 'MaxElements', SHIPPED_ARTIFACTS, to, 'types.xml artifact MaxElements');
  return retune(t, table, 'MinElements', SHIPPED_ARTIFACTS, to, 'types.xml artifact MinElements');
}

/** Artifacts.xdb: one `<Item>` per artifact, each carrying its inline object. */
export function patchArtifactTable(
  table: string, artifacts: readonly ModArtifact[], types: Map<string, SpecType>,
): string {
  const had = count(table, /<ID>\w+<\/ID>/g);
  if (had !== SHIPPED_ARTIFACTS) throw new Error(`${ARTIFACT_TABLE}: ${had} entries, expected ${SHIPPED_ARTIFACTS}`);
  const close = once(table, '</objects>', `${ARTIFACT_TABLE} objects`);
  return insertBeforeLine(table, close, artifacts.flatMap((a) => {
    const p = artifactPaths(a);
    return [
      '<Item>',
      `\t<ID>${a.id}</ID>`,
      // A BARE `<obj>`, which is what all 97 shipped entries are. The creature
      // table looks similar and is not: there the object is a reference, either
      // to a file or with `#n:inline(Creature)` as the marker for one written in
      // place. Carrying that marker over here gives an href the game cannot
      // resolve, and the record comes out EMPTY — the artifact exists by name,
      // has no data behind it, and the game says it cannot be picked up.
      '\t<obj>',
      ...artifactRecord(a, p, types).map((l) => `\t\t${l}`),
      '\t</obj>',
      '</Item>',
    ];
  }));
}

/**
 * The Lua constants a script names our artifacts by, and the count beside them.
 *
 * The count is not decoration: `ARTIFACT_ARTIFACT_EFFECT_COUNT` sits right
 * after the last artifact and is what a script loops to. Left at 97 it stops
 * one short of every artifact the mod added, which is the kind of miss that
 * shows up as "the set never completes" rather than as an error.
 */
export function patchStartupScript(script: string, artifacts: readonly ModArtifact[]): string {
  const anchor = once(script, `${LAST_SHIPPED_ARTIFACT} = `, 'advmap-startup.lua artifact constants');
  const eol = script.indexOf('\n', anchor);
  if (eol < 0) throw new Error('advmap-startup.lua: the last artifact constant is on the last line');
  const indent = indentOf(script, anchor);
  const lines = artifacts.map((a) => `${indent}${a.id} = ${a.number}`);
  const withIds = `${script.slice(0, eol + 1)}${lines.join(EOL)}${EOL}${script.slice(eol + 1)}`;

  const countAt = once(withIds, `${ARTIFACT_COUNT_CONST} = `, 'advmap-startup.lua artifact count');
  const to = SHIPPED_ARTIFACTS + artifacts.length;
  const line = /^(.*=\s*)(\d+)(.*)$/m.exec(withIds.slice(countAt + ARTIFACT_COUNT_CONST.length));
  if (!line) throw new Error('advmap-startup.lua: the artifact count has no number');
  const from = countAt + ARTIFACT_COUNT_CONST.length;
  return withIds.slice(0, from) + withIds.slice(from).replace(
    new RegExp(`^(\\s*=\\s*)${SHIPPED_ARTIFACTS}\\b`), `$1${to}`,
  );
}
