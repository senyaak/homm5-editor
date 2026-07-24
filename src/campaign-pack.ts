// Pack a campaign project into a .h5c — the campaign's counterpart of
// packProject (src/project.ts). A .h5c mirrors the game's data root: the
// descriptor and its texts sit under Campaigns/, and every mission's whole map
// folder sits under its own Maps/... path, exactly where the mission's
// MissionTag points. That tag IS the locator: `/Maps/SingleMissions/Foo/
// map-tag.xdb#xpointer(/AdvMapDescTag)` says both where the map lives inside
// the archive and where its folder is found under the data root. Each map's
// map-tag.xdb is regenerated fresh (src/map-tag.ts) so it never ships stale.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { writeArchive, listDirFiles } from './pak.ts';
import type { ZipEntry, PackResult } from './pak.ts';
import { loadMap } from './map.ts';
import { buildMapTag } from './map-tag.ts';
import { loadCampaign } from './campaign.ts';
import { find, children } from './xml.ts';

/** The map folder a MissionTag points at, relative to the data root (posix). */
export function missionMapDir(missionTagHref: string): string {
  return missionTagHref
    .replace(/^\/+/, '')                 // drop the leading slash — it is data-root relative
    .replace(/map-tag\.xdb.*$/i, '')     // drop the tag file and its xpointer
    .replace(/\/+$/, '');                // and the trailing slash, leaving Maps/.../Name
}

/**
 * Pack `campaignDir` (the descriptor + its texts) plus every mission's map into
 * `outPath`. `dataRoot` is where the mission map folders are found — the same
 * unpacked data root the maps were built under.
 */
export function packCampaign(campaignDir: string, dataRoot: string, outPath: string): PackResult {
  const files = listDirFiles(campaignDir).filter((r) => r !== 'project.json');
  const xdbRel = files.find((r) => /\.\(campaign\)\.xdb$/i.test(r));
  if (!xdbRel) throw new Error(`no *.(Campaign).xdb in ${campaignDir}`);
  const root = loadCampaign(readFileSync(join(campaignDir, xdbRel), 'latin1'));

  const entries: ZipEntry[] = [];
  const seen = new Set<string>();
  const add = (name: string, data: Buffer): void => {
    if (seen.has(name)) return;
    seen.add(name);
    entries.push({ name, data });
  };

  // The descriptor and its texts, under Campaigns/.
  for (const rel of files) add(`Campaigns/${rel}`, readFileSync(join(campaignDir, rel)));

  // Each mission's map, under the path its MissionTag names.
  const missions = find(root, 'Missions');
  const items = missions ? children(missions).filter((c) => c.name === 'Item') : [];
  if (!items.length) throw new Error('the campaign has no missions');
  for (const m of items) {
    const href = find(m, 'MissionTag')?.attrs.href ?? '';
    const rel = missionMapDir(href);
    if (!rel) throw new Error('a mission has no MissionTag map');
    const src = join(dataRoot, rel);
    if (!existsSync(join(src, 'map.xdb'))) throw new Error(`mission map not found under the data root: ${rel}`);
    // A fresh tag, then the map folder itself (its own stale tag, if any, skipped).
    add(`${rel}/map-tag.xdb`, Buffer.from(buildMapTag(loadMap(readFileSync(join(src, 'map.xdb'), 'utf8')).desc), 'latin1'));
    for (const f of listDirFiles(src)) {
      if (f === 'project.json' || f === 'map-tag.xdb') continue;
      add(`${rel}/${f}`, readFileSync(join(src, f)));
    }
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));
  const buf = writeArchive(entries);
  writeFileSync(outPath, buf);
  return { entries: entries.length, bytes: buf.length };
}
