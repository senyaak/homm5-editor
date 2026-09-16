// The random map generator's channels: what its dialog offers, and a map.
//
// The generator is the game's own, ported (src/rmg, docs/RMG.md): for the
// same order and seed it writes the archive the engine would. So the dialog
// asks for what the game's dialog asks for, in the game's own lists — read
// from the install through `src/rmg/service.ts`, the module's door for an
// application — and a generated map lands exactly as a New Map does: a
// folder, packed into `<game>/H5E/<name>.h5m`, opened from that archive like
// any other.
//
// NOTHING HERE READS THE INSTALL. Every question goes to a child of its own
// (`electron/rmg-worker.ts`, one for the session) that mounts the install
// once and keeps it: the first opening of the dialog costs the read, every
// later one is answered from memory, and the main process — which is the
// window's ability to paint — does none of it. A child that cannot be forked
// falls back to answering here, slower to everyone and correct — the same
// bargain `scene-jobs.ts` makes.

import { app, ipcMain, utilityProcess } from 'electron';
import type { IpcMainInvokeEvent, UtilityProcess } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type {
  RmgChoicesResult, RmgGeneratePayload, RmgGenerateResult, RmgSource, RmgTemplateEntry, RmgTemplateReadPayload,
  RmgTemplateReadResult, RmgTemplateSavePayload, RmgTemplateSaveResult, RmgTemplatesPayload,
} from '#electron/ipc.ts';
import { APP_ROOT, gameData, gameRoot, tmpRoot } from '#electron/paths.ts';
import { landAsArchive, unpackRoot } from '#electron/channels/maps.ts';
import type { RmgWorkerReply } from '#electron/rmg-worker.ts';
import { ensureModDir, modFile } from '#src/game/mod-paths.ts';
import { PATCHED_EXE } from '#src/exe/creature-limit.ts';
import { newGuid } from '#src/rmg/index.ts';
import type { OfferedTemplate } from '#src/rmg/index.ts';
import { answer } from '#src/rmg/service.ts';
import type { RmgAnswers, RmgPaths, RmgRequest } from '#src/rmg/service.ts';
import { deleteUserTemplate, saveUserTemplate, userTemplateRoot } from '#src/rmg/user-templates.ts';

/** Where mounted archives are unpacked to — the tools use the same rule under the OS temp. */
const mountCache = (): string => join(tmpRoot(), 'mounted');

/**
 * Where the install is — what the service mounts: `<game>/H5E/` over the
 * unpacked data by the executable's rule (or the data alone, when the
 * question says no mods), and the executable itself. Ours, unwrapped,
 * because the generator's tables are read out of its image; the shipped
 * one is encrypted and says nothing. In front of the mounted install, the
 * two roots of ours (`ownRoots`): the user's templates, then the
 * application's.
 */
function install(source: RmgSource | undefined): { g: string; paths: RmgPaths } {
  const g = gameRoot();
  if (!g) throw new Error('no game install configured — the generator reads the game\'s data and executable');
  const exe = join(g, PATCHED_EXE);
  if (!existsSync(exe)) {
    throw new Error(`no ${PATCHED_EXE} — this install has not been prepared yet (start the editor with --setup and press Prepare)`);
  }
  return { g, paths: { gameRoot: g, dataRoot: gameData(), cacheDir: mountCache(), exe, ownRoots: ownRoots(g), mods: source?.mods ?? true } };
}

/** The roots in front of the game's, first in front: the install's own templates, then the application's. */
const ownRoots = (g: string): string[] => [userTemplateRoot(g), OWN_ROOT];

/** Which root a listed template came from — the user's folder, the application's, or the game's. */
function withSource(g: string, t: OfferedTemplate): RmgTemplateEntry {
  const under = (root: string): boolean => t.path.toLowerCase().startsWith(join(root, 'RMG').toLowerCase());
  const source: RmgTemplateEntry['source'] = under(userTemplateRoot(g)) ? 'user' : under(OWN_ROOT) ? 'app' : 'game';
  const { path: _path, ...rest } = t;
  return { ...rest, source };
}

/**
 * The application's own documents in front of the game's: `assets/rmg`
 * holds the templates of ours (`.h5et` — the game's format plus our fields,
 * see `src/rmg/template.ts`), which the dialog then lists beside the game's.
 */
const OWN_ROOT = join(APP_ROOT, 'assets', 'rmg');

// --- the child ---------------------------------------------------------------

/** The child's entry point: TypeScript from the repo, JavaScript from a build. */
const workerFile = (): string =>
  join(APP_ROOT, 'electron', app.isPackaged ? 'rmg-worker.js' : 'rmg-worker.ts');

/**
 * Force every answer back into this process.
 *
 * For proving the child is doing anything: with it set, the same measurement
 * has to show the app going deaf for the length of a read (e2e/rmg.spec.ts).
 */
const INLINE_ONLY = (): boolean => process.env.HOMM5_RMG_INLINE === '1';

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

let child: UtilityProcess | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

/** Give up on the child: everything waiting on it fails, and the next request forks again. */
function drop(why: string): void {
  child = null;
  for (const [, p] of pending) p.reject(new Error(why));
  pending.clear();
}

function ensureChild(): UtilityProcess | null {
  if (INLINE_ONLY()) return null;
  if (child) return child;
  try {
    const proc = utilityProcess.fork(workerFile(), [], { serviceName: 'homm5-rmg', stdio: 'pipe' });
    proc.stdout?.on('data', (b: Buffer) => process.stdout.write(`[rmg-worker] ${b}`));
    proc.stderr?.on('data', (b: Buffer) => process.stderr.write(`[rmg-worker] ${b}`));
    proc.on('message', (m: RmgWorkerReply) => {
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.ok) p.resolve(m.result);
      else p.reject(new Error(m.error ?? 'the generator failed without saying why'));
    });
    proc.on('exit', (code) => drop(`the generator stopped (exit ${code})`));
    child = proc;
    return proc;
  } catch (e) {
    console.warn('[rmg] no background generator:', e instanceof Error ? e.message : String(e));
    return null;
  }
}

/** An answer, and where it came from — the result of `rmg:generate` reports the latter. */
interface Answered<K extends RmgRequest['kind']> {
  answer: RmgAnswers[K];
  where: 'child' | 'main';
}

/**
 * One request, answered in the child when there is one.
 *
 * A request that FAILED fails the same way here — the fallback is for a
 * child that could not run it, not for an order the generator refuses, and
 * re-running a genuine refusal inline would cost the same read to be told
 * the same thing. So it only catches a dead child.
 */
async function askWhere<R extends RmgRequest>(req: R): Promise<Answered<R['kind']>> {
  const proc = ensureChild();
  if (!proc) return { answer: answer(req), where: 'main' };
  const id = nextId++;
  try {
    const got = await new Promise<RmgAnswers[R['kind']]>((resolve, reject) => {
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      proc.postMessage({ id, req });
    });
    return { answer: got, where: 'child' };
  } catch (e) {
    if (child) throw e;
    console.warn('[rmg] answering in the main process:', e instanceof Error ? e.message : String(e));
    return { answer: answer(req), where: 'main' };
  }
}

const ask = async <R extends RmgRequest>(req: R): Promise<RmgAnswers[R['kind']]> => (await askWhere(req)).answer;

/** Stop the child. Called when the app quits, so no orphan outlives the window. */
export function stopRmg(): void {
  child?.kill();
  drop('the app is closing');
}

// --- the channels ------------------------------------------------------------

export function registerRmg(): void {
  ipcMain.handle('rmg:choices', async (_e: IpcMainInvokeEvent, p?: RmgSource): Promise<RmgChoicesResult> => {
    const { g, paths } = install(p);
    const c = await ask({ kind: 'choices', paths });
    return { ...c, templates: c.templates.map((t) => withSource(g, t)) };
  });

  ipcMain.handle('rmg:templates', async (_e: IpcMainInvokeEvent, p: RmgTemplatesPayload): Promise<RmgTemplateEntry[]> => {
    const { g, paths } = install(p);
    return (await ask({ kind: 'offered', paths, sizeIndex: p.sizeIndex, underground: p.underground })).map((t) => withSource(g, t));
  });

  // The template editor's three doors. A template is read through the same
  // chain the generator reads — the user's file first, then the app's, then
  // the game's — and saved as the user's, whichever it was: the game's
  // templates are not written to, they are copied into the user's folder
  // under whatever name the editor asks, and a copy under the SAME name
  // shadows the original the way a mod's file does. A save or a removal is
  // the one change the service's list cannot see for itself, so it is told.
  ipcMain.handle('rmg:template-read', async (_e: IpcMainInvokeEvent, p: RmgTemplateReadPayload): Promise<RmgTemplateReadResult> => {
    const { g, paths } = install(p);
    const { template, entry } = await ask({ kind: 'template', paths, file: p.file });
    return { file: p.file, template, source: withSource(g, entry).source };
  });
  ipcMain.handle('rmg:template-save', async (_e: IpcMainInvokeEvent, p: RmgTemplateSavePayload): Promise<RmgTemplateSaveResult> => {
    const { g, paths } = install(undefined);
    const path = saveUserTemplate(g, p.file, p.template);
    await ask({ kind: 'forget-templates', paths });
    return { path };
  });
  ipcMain.handle('rmg:template-delete', async (_e: IpcMainInvokeEvent, file: string): Promise<boolean> => {
    const { g, paths } = install(undefined);
    const gone = deleteUserTemplate(g, file);
    if (gone) await ask({ kind: 'forget-templates', paths });
    return gone;
  });

  // Generate, then land it as a new map. The name doubles as the archive's
  // file name and the working folder's, so it must survive being both; the
  // folder inside the archive is `Maps/RMG/<guid>`, which is where the game's
  // own generator puts every map it makes.
  ipcMain.handle('rmg:generate', async (_e: IpcMainInvokeEvent, p: RmgGeneratePayload): Promise<RmgGenerateResult> => {
    const name = p.mapName.trim();
    if (!name) throw new Error('the map needs a name');
    if (/[\\/:*?"<>|]/.test(name)) throw new Error('the name cannot contain \\ / : * ? " < > |');
    const { g, paths } = install(p);
    const archive = modFile(g, 'map', name);
    if (existsSync(archive)) throw new Error(`${archive} already exists`);
    // The seed the way the game's dialog fills it in when nobody typed one: a
    // positive 31-bit number, which is what the engine's generator takes.
    const seed = p.seed ?? (1 + Math.floor(Math.random() * 2147483646));
    const guid = newGuid();
    const prefix = `Maps/RMG/${guid}`;
    const mapDir = join(unpackRoot(archive).root, prefix);
    if (existsSync(mapDir)) throw new Error(`${mapDir} already exists`);
    ensureModDir(g);

    const { mapName: _name, seed: _seed, minimap, mods: _mods, ...wish } = p;
    const started = performance.now();
    const { answer: r, where: ran } = await askWhere({ kind: 'generate', paths, wish, seed, guid, mapName: name, minimap, mapDir });
    landAsArchive(g, mapDir, archive, prefix);
    const ms = Math.round(performance.now() - started);
    const { order } = r;
    console.log(`[rmg] ${archive} · ${order.template} ${order.tiles}×${order.tiles}${order.underground ? ' two-level' : ''}, ${order.players} players, seed ${seed}`
      + `${paths.mods ? '' : ' · the data alone, no mods'} · ${r.draws} draws, ${r.objects} objects · ${r.ms}ms in the ${ran}, ${ms}ms in all`);
    for (const w of r.warnings) console.warn(`[rmg] ${w}`);
    return {
      mapPath: join(mapDir, 'map.xdb'), mapDir, archive, seed, order, draws: r.draws, objects: r.objects, where: ran, ms,
      warnings: r.warnings, playerRaces: r.playerRaces, heroes: r.heroes,
    };
  });
}
