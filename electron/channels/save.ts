// Save, pack, and export.
//
// Save means "put my work back where I got it": for an archive-backed project
// that is the archive itself, repacked at the path the map has to sit at inside
// it, because the workspace is a folder the user never chose and will never look
// in. Packing is the same thing to a path of their choosing, and exporting is
// packing with one language baked in.

import { dialog, ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { readLoc } from '#electron/channels/loc.ts';
import { saveHistory } from '#electron/edits.ts';
import type { LocExportPayload, MapPackResult, MapSaveResult } from '#electron/ipc.ts';
import { gameData, gameRoot } from '#electron/paths.ts';
import { need, saveTerrain, state, syncMapTiles } from '#electron/state.ts';
import type { Session } from '#electron/state.ts';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { readManifest , status} from '#src/project.ts';
import { buildMapTag } from '#src/map-tag.ts';
import { MOD_EXT, modFile } from '#src/mod-paths.ts';
import { exportLocalized, packProject, writeManifest } from '#src/project.ts';

/**
 * Where this map has to sit inside its .h5m.
 *
 * The game addresses files in an archive by their path under its data root, so
 * a map packed at the archive root is a map the game never finds. A project
 * opened from an archive remembers the path it came with; anything else — a
 * map we created, or a loose folder someone points us at — is placed by where
 * it sits under the data root, which is the same thing said another way.
 */
function archivePrefixFor(mapDir: string): string {
  const stored = readManifest(mapDir).archivePrefix;
  if (stored != null) return stored; // '' is a real answer: packed at the root
  const rel = relative(gameData(), mapDir);
  if (rel && !rel.startsWith('..') && !isAbsolute(rel)) return rel.split(sep).join('/');
  // Outside the data root. Take everything from the last Maps/ segment on, and
  // failing that assume a single-scenario map of that folder's name.
  const parts = mapDir.split(sep);
  const i = parts.lastIndexOf('Maps');
  return i >= 0 ? parts.slice(i).join('/') : `Maps/SingleMissions/${basename(mapDir)}`;
}

/**
 * Write the map's `map-tag.xdb` — the lobby index — into the map folder, fresh
 * from the current map.xdb, so the pack that follows includes it. Without this
 * tag the game never lists the map in its single-scenario / custom-game menus:
 * the browser indexes tags, not maps (see src/map-tag.ts).
 */
function writeMapTag(s: Session): void {
  writeFileSync(join(s.mapDir, 'map-tag.xdb'), buildMapTag(s.map.desc), 'latin1');
}

/**
 * Where the Pack dialog opens: our folder in the install, under this name.
 *
 * The game our build is — the patched executable — reads `H5E/*.h5m` and nothing
 * in `Maps/`, so a map packed anywhere else is a map it will not list
 * (src/mod-paths.ts). Without an install configured there is nowhere to offer,
 * and the map's own folder is the honest fallback.
 */
function packDefault(name: string, mapDir: string): string {
  const root = gameRoot();
  return root ? modFile(root, 'map', name) : `${mapDir}.${MOD_EXT.map}`;
}

/** Wire this domain onto ipcMain. Called once, from main. */
export function registerSave(): void {
  // --- IPC: save map.xdb (latin1 preserves the original bytes) ---
  ipcMain.handle('map:save', async (): Promise<MapSaveResult> => {
    const session = need();
    // The folder the session points at must still be a map. If it is not — it was
    // deleted, or the session outlived a workspace rebuild — then writing and
    // repacking would put a stub where the user's map was.
    if (!existsSync(dirname(session.mapPath))) throw new Error(`${session.mapDir} is gone — reopen the map before saving`);
    // Last chance to keep the derived tile set honest. add-layer already does it,
    // but a map whose layers predate that — ours did — would otherwise carry an
    // empty <tiles> forever, and nothing else would ever notice.
    const tilesAdded = syncMapTiles(session, session.layerPaths);
    if (tilesAdded) console.log(`[save] tile set: named ${tilesAdded} tile(s) the terrain paints with`);
    writeFileSync(session.mapPath, session.map.save(), 'latin1');
    saveTerrain(session);
    // Our own write — fold it into the watcher's baseline so it isn't reported
    // back to us as somebody else's edit.
    session.watch.resync();
    // The bytes just changed on disk, so the hash the history is keyed by has
    // moved with them. Rewriting it here is what keeps undo usable across a
    // save-and-quit, which is the case worth having.
    saveHistory(session);

    // A map opened from an archive is edited in a workspace the user never chose
    // and will never look in, so writing the files there is not saving in any
    // sense they would recognise. Save means "put my work back where I got it":
    // for an archive-backed project that is the archive itself, repacked at the
    // path the map has to sit at inside it. For a loose map folder — one we
    // created, or one someone points us at — the files ARE the map, and writing
    // them is the whole of it.
    const src = readManifest(session.mapDir).source;
    if (src && existsSync(src.path)) {
      // preserveFrom: the archive can hold more than the map (the original packs
      // its scene-property template along), and the project is only the map folder.
      const res = packProject(session.mapDir, src.path,
        { prefix: archivePrefixFor(session.mapDir), preserveFrom: src.path });
      console.log(`[save] ${session.mapDir} → ${src.path} · ${res.entries} entries`);
      // The archive just changed, so the workspace's record of what it was opened
      // from has to move with it, or the next open would call the workspace stale
      // and unpack over the work still sitting in it.
      const m = readManifest(session.mapDir);
      m.source = { path: src.path, hash: createHash('sha1').update(readFileSync(src.path)).digest('hex') };
      writeManifest(session.mapDir, m);
      return { ok: true, output: src.path, status: status(session.mapDir) };
    }
    return { ok: true, status: status(session.mapDir) };
  });

  // --- IPC: pack the map folder into a .h5m ---
  ipcMain.handle('map:pack', async (): Promise<MapPackResult> => {
    const session = need();
    // A localized map has no plain name.txt on disk — the game would find tagged
    // files and the sidecar and no text at all. Export bakes one language in.
    if (readLoc(session)) throw new Error('this map is localized — use Localize → “export .h5m” to pack a single language');
    const opts = {
      title: 'Pack map to .h5m',
      defaultPath: packDefault(basename(session.mapDir), session.mapDir),
      filters: [{ name: 'HoMM5 map', extensions: ['h5m'] }],
    };
    // Electron treats a null parent as "no parent"; pick the overload to match.
    const parent = state.win;
    const r = await (parent ? dialog.showSaveDialog(parent, opts) : dialog.showSaveDialog(opts));
    if (r.canceled) return { canceled: true };
    // Save pending edits first so the archive reflects them.
    writeFileSync(session.mapPath, session.map.save(), 'latin1');
    saveTerrain(session);
    writeMapTag(session);
    session.watch.resync();
    // A copy of the map should be as complete as the original it came from, so it
    // carries over whatever the source archive held outside the map folder too.
    const from = readManifest(session.mapDir).source?.path;
    // Our folder may not be there yet on a fresh install, and the dialog does not
    // make one for a path it only suggested.
    mkdirSync(dirname(r.filePath), { recursive: true });
    const res = packProject(session.mapDir, r.filePath,
      { prefix: archivePrefixFor(session.mapDir), preserveFrom: from });
    return { ok: true, output: r.filePath, entries: res.entries, bytes: res.bytes, status: status(session.mapDir) };
  });

  /**
   * Export a single-language `.h5m` from a localized map.
   *
   * The game reads one language: this bakes the chosen one into the plain `.txt`
   * files the map references (falling back to the base where a translation is
   * missing) and packs an ordinary map — the tagged sources and the sidecar do not
   * ship. `output` skips the dialog (a test, or a caller that knows the path).
   */
  ipcMain.handle('loc:export', async (_e: IpcMainInvokeEvent, { lang, output }: LocExportPayload): Promise<MapPackResult> => {
    const session = need();
    const cfg = readLoc(session);
    if (!cfg) throw new Error('localization is not enabled for this map');
    if (!cfg.languages.includes(lang)) throw new Error(`the map has no ${lang} texts`);
    let out = output;
    if (!out) {
      const opts = {
        title: `Export ${lang} map to .h5m`,
        defaultPath: packDefault(`${basename(session.mapDir)}.${lang}`, `${session.mapDir}.${lang}`),
        filters: [{ name: 'HoMM5 map', extensions: ['h5m'] }],
      };
      const w = state.win;
      const r = await (w ? dialog.showSaveDialog(w, opts) : dialog.showSaveDialog(opts));
      if (r.canceled || !r.filePath) return { canceled: true };
      out = r.filePath;
    }
    // Save pending edits so the export reflects them.
    writeFileSync(session.mapPath, session.map.save(), 'latin1');
    saveTerrain(session);
    writeMapTag(session);
    session.watch.resync();
    mkdirSync(dirname(out), { recursive: true });
    const res = exportLocalized(session.mapDir, out, lang, cfg.base, { prefix: archivePrefixFor(session.mapDir) });
    return { ok: true, output: out, entries: res.entries, bytes: res.bytes, status: status(session.mapDir) };
  });
}
