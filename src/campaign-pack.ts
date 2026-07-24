// Pack a campaign project into a .h5c — the campaign's counterpart of
// packProject (src/project.ts).
//
// The shape below is not a guess: it is what the game's own editor produces,
// and what the game's Modifications menu loads. A user campaign is
//
//   UserCampaigns/<name>/campaign.xdb   <- the descriptor, named exactly that
//   UserCampaigns/<name>/*.txt          <- its texts, flat beside it
//
// where <name> is the .h5c's own base name. Two things are easy to get wrong:
//
//   * The archive holds NO map. A mission names its map by an absolute
//     data-root path (/Maps/SingleMissions/Foo/map-tag.xdb#xpointer(...)), and
//     the game's VFS merges every archive by path — so the map travels in its
//     own .h5m (packProject writes one, map-tag included) and the two meet at
//     load time. Bundling the map here produces an archive the game ignores.
//   * The text refs stay relative and flat, because they resolve beside the
//     descriptor inside UserCampaigns/<name>/.
//
// Texts are UTF-16LE with a BOM (the game's text format); they are copied
// byte-for-byte, so whoever wrote them owns that.

import { readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { writeArchive, listDirFiles } from './pak.ts';
import type { ZipEntry, PackResult } from './pak.ts';
import { loadCampaign } from './campaign.ts';
import { find, children } from './xml.ts';
import type { XmlElement } from './xml.ts';

/** The descriptor's name inside the archive — the game looks for this exactly. */
const DESCRIPTOR = 'campaign.xdb';

/** The map folder a MissionTag points at, relative to the data root (posix). */
export function missionMapDir(missionTagHref: string): string {
  return missionTagHref
    .replace(/^\/+/, '')                 // drop the leading slash — it is data-root relative
    .replace(/map-tag\.xdb.*$/i, '')     // drop the tag file and its xpointer
    .replace(/\/+$/, '');                // and the trailing slash, leaving Maps/.../Name
}

/**
 * Every map a campaign's missions reference, data-root relative, in play order.
 *
 * The packer does not ship these — this is for the caller that has to pack (or
 * check) the matching .h5m files.
 */
export function campaignMaps(campaignDir: string): string[] {
  return missionTags(loadDescriptor(campaignDir).root).map(missionMapDir);
}

/**
 * Pack `campaignDir` — the descriptor plus its text files — into `outPath`.
 *
 * The maps are NOT packed: each one ships as its own .h5m (see packProject).
 * Returns the entry/byte count, as packProject does.
 */
export function packCampaign(campaignDir: string, outPath: string): PackResult {
  const { root, file } = loadDescriptor(campaignDir);

  // Every mission must actually name a map, or the campaign lists but cannot start.
  const tags = missionTags(root);
  if (!tags.length) throw new Error('the campaign has no missions');
  const blank = tags.findIndex((href) => !missionMapDir(href));
  if (blank >= 0) throw new Error(`mission ${blank + 1} has no map (its MissionTag is empty)`);

  // <name> comes from the .h5c itself, mirroring the editor-made archives.
  const name = basename(outPath).replace(/\.h5c$/i, '');
  const prefix = `UserCampaigns/${name}/`;

  const entries: ZipEntry[] = [];
  for (const rel of listDirFiles(campaignDir)) {
    if (rel === 'project.json') continue;
    // The descriptor is renamed on the way in; everything else keeps its name,
    // which is what the descriptor's relative text refs expect.
    const at = rel === file ? DESCRIPTOR : rel;
    entries.push({ name: prefix + at, data: readFileSync(join(campaignDir, rel)) });
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));
  const buf = writeArchive(entries);
  writeFileSync(outPath, buf);
  return { entries: entries.length, bytes: buf.length };
}

/** The campaign document in `campaignDir`, with the file name it was read from. */
function loadDescriptor(campaignDir: string): { root: XmlElement; file: string } {
  const files = listDirFiles(campaignDir);
  // Either name works on disk: what a project holds, or what a packed one is called.
  const file = files.find((r) => r === DESCRIPTOR) ?? files.find((r) => /\.\(campaign\)\.xdb$/i.test(r));
  if (!file) throw new Error(`no ${DESCRIPTOR} or *.(Campaign).xdb in ${campaignDir}`);
  return { root: loadCampaign(readFileSync(join(campaignDir, file), 'latin1')), file };
}

/** Each mission's MissionTag href, in order. */
function missionTags(root: XmlElement): string[] {
  const missions = find(root, 'Missions');
  const items = missions ? children(missions).filter((c) => c.name === 'Item') : [];
  return items.map((m) => find(m, 'MissionTag')?.attrs.href ?? '');
}
