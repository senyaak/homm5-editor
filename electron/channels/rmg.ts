// The random map generator's channels: what its dialog offers, and a map.
//
// The generator is the game's own, ported (src/rmg, docs/RMG.md): for the
// same order and seed it writes the archive the engine would. So the dialog
// asks for what the game's dialog asks for, in the game's own lists — read
// from the install through `src/rmg/index.ts`, the module's one door — and a
// generated map lands exactly as a New Map does: a folder, packed into
// `<game>/H5E/<name>.h5m`, opened from that archive like any other.
//
// The run itself happens in a child (`electron/rmg-worker.ts`), one per
// generation: a large map is minutes of arithmetic, and the main process has
// nothing to do with them but wait. A child that cannot be forked falls back
// to running here, slower to everyone and correct — the same bargain
// `scene-jobs.ts` makes.

import { app, ipcMain, utilityProcess } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { RmgChoicesResult, RmgGeneratePayload, RmgGenerateResult, RmgTemplateEntry, RmgTemplatesPayload } from '#electron/ipc.ts';
import { APP_ROOT, gameData, gameRoot, tmpRoot } from '#electron/paths.ts';
import { landAsArchive, unpackRoot } from '#electron/channels/maps.ts';
import type { RmgWorkerReply } from '#electron/rmg-worker.ts';
import { mountArchives } from '#src/game/mounted.ts';
import { ensureModDir, modFile } from '#src/game/mod-paths.ts';
import { PATCHED_EXE } from '#src/exe/creature-limit.ts';
import { allTemplates, dialogChoices, newGuid, templatesOffered } from '#src/rmg/index.ts';
import type { RmgInstall } from '#src/rmg/index.ts';
import { runRmgJob } from '#src/rmg/job.ts';
import type { RmgJob, RmgJobResult } from '#src/rmg/job.ts';

/** Where mounted archives are unpacked to — the tools use the same rule under the OS temp. */
const mountCache = (): string => join(tmpRoot(), 'mounted');

/**
 * The install the generator reads: `<game>/H5E/` mounted over the unpacked
 * data by the executable's rule, and the executable itself. Ours, unwrapped,
 * because the generator's tables are read out of its image; the shipped one
 * is encrypted and says nothing.
 */
function install(): { g: string; install: RmgInstall } {
  const g = gameRoot();
  if (!g) throw new Error('no game install configured — the generator reads the game\'s data and executable');
  const exe = join(g, PATCHED_EXE);
  if (!existsSync(exe)) {
    throw new Error(`no ${PATCHED_EXE} — this install has not been prepared yet (start the editor with --setup and press Prepare)`);
  }
  return { g, install: { data: mountArchives(g, mountCache(), gameData()), exe } };
}

/** The child's entry point: TypeScript from the repo, JavaScript from a build. */
const workerFile = (): string =>
  join(APP_ROOT, 'electron', app.isPackaged ? 'rmg-worker.js' : 'rmg-worker.ts');

const INLINE_ONLY = (): boolean => process.env.HOMM5_RMG_INLINE === '1';

/** One generation in a child of its own; null when no child could be forked. */
function generateInChild(job: RmgJob): Promise<RmgJobResult> | null {
  if (INLINE_ONLY()) return null;
  let proc;
  try {
    proc = utilityProcess.fork(workerFile(), [], { serviceName: 'homm5-rmg', stdio: 'pipe' });
  } catch (e) {
    console.warn('[rmg] no background generator:', e instanceof Error ? e.message : String(e));
    return null;
  }
  proc.stdout?.on('data', (b: Buffer) => process.stdout.write(`[rmg-worker] ${b}`));
  proc.stderr?.on('data', (b: Buffer) => process.stderr.write(`[rmg-worker] ${b}`));
  return new Promise<RmgJobResult>((resolve, reject) => {
    let answered = false;
    proc.on('message', (m: RmgWorkerReply) => {
      answered = true;
      if (m.ok && m.result) resolve(m.result);
      else reject(new Error(m.error ?? 'the generator failed without saying why'));
      proc.kill();
    });
    proc.on('exit', (code) => {
      if (!answered) reject(new Error(`the generator stopped (exit ${code})`));
    });
    proc.postMessage({ id: 1, job });
  });
}

export function registerRmg(): void {
  ipcMain.handle('rmg:choices', async (): Promise<RmgChoicesResult> => {
    const { install: inst } = install();
    return { ...dialogChoices(inst), templates: allTemplates(inst) };
  });

  ipcMain.handle('rmg:templates', async (_e: IpcMainInvokeEvent, p: RmgTemplatesPayload): Promise<RmgTemplateEntry[]> => {
    const { install: inst } = install();
    return templatesOffered(inst, p.sizeIndex, p.underground);
  });

  // Generate, then land it as a new map. The name doubles as the archive's
  // file name and the working folder's, so it must survive being both; the
  // folder inside the archive is `Maps/RMG/<guid>`, which is where the game's
  // own generator puts every map it makes.
  ipcMain.handle('rmg:generate', async (_e: IpcMainInvokeEvent, p: RmgGeneratePayload): Promise<RmgGenerateResult> => {
    const name = p.mapName.trim();
    if (!name) throw new Error('the map needs a name');
    if (/[\\/:*?"<>|]/.test(name)) throw new Error('the name cannot contain \\ / : * ? " < > |');
    const { g, install: inst } = install();
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

    const job: RmgJob = {
      gameRoot: g, dataRoot: gameData(), cacheDir: mountCache(), exe: inst.exe, mapDir,
      order: {
        seed, guid, template: p.template, sizeIndex: p.sizeIndex, underground: p.underground,
        water: p.water, players: p.players, monsterLevel: p.monsterLevel,
        resourceMultiplier: p.resourceMultiplier, expMultiplier: p.expMultiplier,
        grail: p.grail, randomTowns: p.randomTowns, minimap: p.minimap, mapName: name,
      },
    };
    const started = performance.now();
    let where: RmgGenerateResult['where'] = 'child';
    let r: RmgJobResult;
    const inChild = generateInChild(job);
    if (inChild) {
      r = await inChild;
    } else {
      where = 'main';
      r = runRmgJob(job);
    }
    landAsArchive(g, mapDir, archive, prefix);
    const ms = Math.round(performance.now() - started);
    console.log(`[rmg] ${archive} · ${p.template} seed ${seed} · ${r.draws} draws, ${r.objects} objects · ${r.ms}ms in the ${where}, ${ms}ms in all`);
    return { mapPath: join(mapDir, 'map.xdb'), mapDir, archive, seed, draws: r.draws, objects: r.objects, where, ms };
  });
}
