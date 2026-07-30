// Campaign projects.
//
// A campaign project is a folder under <data>/Campaigns holding campaign.xdb
// and its texts — the same layout that goes into UserCampaigns/<name>/ inside
// the .h5c, so packing is a copy. The maps are NOT part of it: a mission names
// its map by an absolute data-root path and the game's VFS finds it in whatever
// .h5m ships it, which is why picking a map here only records a path.

// --- IPC: campaigns ---------------------------------------------------------
//
// A campaign project is a folder under <data>/Campaigns holding campaign.xdb
// and its texts — the same layout that goes into UserCampaigns/<name>/ inside
// the .h5c, so packing is a copy. The maps are NOT part of it: a mission names
// its map by an absolute data-root path and the game's VFS finds it in whatever
// .h5m ships it, which is why picking a map here only records a path.

import { dialog, ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import type { CampaignDirPayload, CampaignDoc, CampaignListEntry, CampaignListResult, CampaignPackResult, MapHeroesPayload, MapHeroesResult, NewCampaignPayload, SaveCampaignPayload } from '#electron/ipc.ts';
import { gameData, gameRoot } from '#electron/paths.ts';
import { state } from '#electron/state.ts';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { missionMapDir, packCampaign } from '#src/campaign-pack.ts';
import { CAMPAIGN_TEXTS, addMission, buildNewCampaignProject, handOnTo, hasEntryPoint, heroScriptName, loadCampaignProject, missionTexts, missions, placedHeroes, readBonuses, readHeroesPool, readProjectText, removeMission, saveCampaignProject, writeBonuses, writeHeroesPool, writeProjectText } from '#src/campaign-project.ts';
import { modFile } from '#src/mod-paths.ts';
import { childText, find, setText } from '#src/xml.ts';

/** Where campaign projects live, mirroring <data>/Maps for map projects. */
const campaignsDir = (): string => join(gameData(), 'Campaigns');

/** The map-tag href a mission uses to name the map at `rel` under Maps. */
const missionTagFor = (mapRel: string): string =>
  mapRel ? `/Maps/${mapRel}/map-tag.xdb#xpointer(/AdvMapDescTag)` : '';

/** And back: the path under Maps a mission's tag names. */
const mapRelOf = (href: string): string => {
  const dir = missionMapDir(href);           // Maps/SingleMissions/Foo
  return dir.replace(/^Maps\//i, '');
};

/** Read a campaign project into the document the dialogs edit. */
function readCampaignDoc(dir: string): CampaignDoc {
  const root = loadCampaignProject(dir);
  const doc: CampaignDoc = {
    dir,
    name: basename(dir),
    internalName: childText(root, 'InternalName'),
    summary: readProjectText(dir, CAMPAIGN_TEXTS.NameCommentFileRef!),
    description: readProjectText(dir, CAMPAIGN_TEXTS.DescriptionFileRef!),
    missions: [],
  };
  missions(root).forEach((m, i) => {
    const texts = missionTexts(i);
    doc.missions.push({
      mapRel: mapRelOf(find(m, 'MissionTag')?.attrs.href ?? ''),
      name: readProjectText(dir, texts.NameFileRef!),
      description: readProjectText(dir, texts.NameCommentFileRef!),
      heroes: readHeroesPool(m).map((h) => ({
        scriptName: h.scriptName, targetCampaign: h.targetCampaign, targetMission: h.targetMission,
      })),
      bonuses: readBonuses(m),
    });
  });
  return doc;
}

/** Write one back: the descriptor's missions, then every text file it names. */
function writeCampaignDoc(doc: CampaignDoc): void {
  const root = loadCampaignProject(doc.dir);

  // The mission list is rebuilt to match the document, so a reorder in the UI
  // lands as a reorder here — and campaign-project renumbers the handovers.
  while (missions(root).length) removeMission(root, 0);
  for (const m of doc.missions) addMission(root, missionTagFor(m.mapRel));

  missions(root).forEach((el, i) => {
    const m = doc.missions[i]!;
    writeHeroesPool(el, m.heroes.map((h) => ({
      scriptName: h.scriptName,
      targetCampaign: h.targetCampaign || '',
      // Only an explicit destination survives; the rest follow the play order.
      targetMission: h.targetCampaign ? (h.targetMission ?? 0) : handOnTo(i),
    })));
    writeBonuses(el, m.bonuses);
    const texts = missionTexts(i);
    writeProjectText(doc.dir, texts.NameFileRef!, m.name);
    writeProjectText(doc.dir, texts.NameCommentFileRef!, m.description);
  });

  const internal = find(root, 'InternalName');
  if (internal) setText(internal, doc.internalName || doc.name);
  saveCampaignProject(doc.dir, root);

  writeProjectText(doc.dir, CAMPAIGN_TEXTS.NameFileRef!, doc.name);
  writeProjectText(doc.dir, CAMPAIGN_TEXTS.FullNameFileRef!, doc.name);
  writeProjectText(doc.dir, CAMPAIGN_TEXTS.NameCommentFileRef!, doc.summary);
  writeProjectText(doc.dir, CAMPAIGN_TEXTS.DescriptionFileRef!, doc.description);
}

/** Wire this domain onto ipcMain. Called once, from main. */
export function registerCampaigns(): void {
  ipcMain.handle('campaign:list', async (): Promise<CampaignListResult> => {
    if (!existsSync(campaignsDir())) return { campaigns: [] };
    const campaigns: CampaignListEntry[] = [];
    for (const e of readdirSync(campaignsDir())) {
      const dir = join(campaignsDir(), e);
      if (!existsSync(join(dir, 'campaign.xdb'))) continue;
      try {
        campaigns.push({ name: e, dir, missions: missions(loadCampaignProject(dir)).length });
      } catch { /* not a campaign we can read — leave it out of the list */ }
    }
    return { campaigns };
  });

  ipcMain.handle('campaign:new', async (_e: IpcMainInvokeEvent, p: NewCampaignPayload): Promise<CampaignDoc> => {
    const name = p.name.trim();
    if (!name) throw new Error('the campaign needs a name');
    if (/[\/:*?"<>|]/.test(name)) throw new Error('the name cannot contain \ / : * ? " < > |');
    const dir = join(campaignsDir(), name);
    if (existsSync(dir)) throw new Error(`${dir} already exists`);
    mkdirSync(dir, { recursive: true });
    for (const f of buildNewCampaignProject(name)) writeFileSync(join(dir, f.path), f.data);
    return readCampaignDoc(dir);
  });

  ipcMain.handle('campaign:open', async (_e: IpcMainInvokeEvent, p: CampaignDirPayload): Promise<CampaignDoc> =>
    readCampaignDoc(p.dir));

  ipcMain.handle('campaign:save', async (_e: IpcMainInvokeEvent, p: SaveCampaignPayload): Promise<CampaignDoc> => {
    writeCampaignDoc(p.doc);
    return readCampaignDoc(p.doc.dir);
  });

  // Which heroes a mission on this map can hand on.
  //
  // A hero travels under his CHARACTER's name — the <InternalName> of the
  // AdvMapHeroShared he is an instance of — not under whatever the object on the
  // map is called. So each placed hero is resolved through its shared document;
  // one that cannot be read offers nothing rather than a name that would match no
  // character and silently never travel.
  ipcMain.handle('campaign:map-heroes', async (_e: IpcMainInvokeEvent, p: MapHeroesPayload): Promise<MapHeroesResult> => {
    const xdb = join(gameData(), 'Maps', ...p.mapRel.split('/'), 'map.xdb');
    if (!existsSync(xdb)) return { heroes: [], entryPoint: false };
    const xml = readFileSync(xdb, 'latin1');
    const heroes: string[] = [];
    for (const h of placedHeroes(xml)) {
      const file = join(gameData(), ...h.shared.replace(/#.*$/, '').replace(/^\/+/, '').split('/'));
      if (!existsSync(file)) continue;
      const name = heroScriptName(readFileSync(file, 'latin1'));
      if (name && !heroes.includes(name)) heroes.push(name);
    }
    return { heroes, entryPoint: hasEntryPoint(xml) };
  });

  ipcMain.handle('campaign:pack', async (_e: IpcMainInvokeEvent, p: CampaignDirPayload): Promise<CampaignPackResult> => {
    // Our build reads campaigns out of our own folder, not <game>/UserCampaigns,
    // so offer that when there is an install to offer it in. That is the game
    // folder, NOT the parent of the data root — an unpacked tree can live
    // anywhere, including inside this checkout.
    const root = gameRoot();
    const name = basename(p.dir);
    const opts = {
      title: 'Pack campaign to .h5c',
      defaultPath: root ? modFile(root, 'campaign', name) : join(p.dir, `${name}.h5c`),
      filters: [{ name: 'HoMM5 campaign', extensions: ['h5c'] }],
    };
    const parent = state.win;
    const r = await (parent ? dialog.showSaveDialog(parent, opts) : dialog.showSaveDialog(opts));
    if (r.canceled || !r.filePath) return { canceled: true };
    mkdirSync(dirname(r.filePath), { recursive: true });
    const res = packCampaign(p.dir, r.filePath);
    return { ok: true, output: r.filePath, entries: res.entries, bytes: res.bytes };
  });
}
