// The fill tool's main-process half: the presets on this machine, and running
// one over a painted area.
//
// The planning itself is in src/fill/plan.ts and knows nothing about Electron
// or the map — everything decided here is about the INSTALLATION: which presets
// exist, which of their candidates the mounted data can actually resolve, and
// what a random group expands to. The placements the plan comes back with go
// down through the same model call a click on the palette makes.
//
// One `record()` for the whole fill, so a wood is one undo step. Placing a
// hundred objects as a hundred steps would be technically correct and useless:
// the gesture was one click.

import { ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { record } from '#electron/edits.ts';
import type { FillApplyPayload, FillApplyResult, FillPresetInfo, FillPresetsResult } from '#electron/ipc.ts';
import { APP_ROOT, editorRoot, gameData, mountedAssets } from '#electron/paths.ts';
import { need } from '#electron/state.ts';

import { orderFor } from '#electron/spec.ts';
import { rosterFor } from '#electron/channels/objects.ts';
import { donorFor } from '#src/map/donors.ts';
import { groupMembers } from '#src/map/objects.ts';
import { planFill } from '#src/fill/plan.ts';
import type { FillVariant } from '#src/fill/plan.ts';
import { readFillPresets } from '#src/fill/preset.ts';
import type { FillObject, FillPreset } from '#src/fill/preset.ts';
import type { Assets } from '#src/game/assets.ts';

/**
 * Where presets are read from, in the order they are listed.
 *
 * Ours first because they are the ones a map wants; the game's nine "(test)"
 * presets come after, and both are the same format, so a preset moved between
 * the two files behaves identically. A file that is not there is simply not a
 * source — an install without the editor folder still has presets.
 */
function sources(): Array<{ file: string; label: string }> {
  const out = [{ file: join(APP_ROOT, 'assets', 'fill-presets.xml'), label: 'assets/fill-presets.xml' }];
  const editor = editorRoot();
  if (editor) out.push({ file: join(editor, 'FillPresets.xml'), label: 'Editor/FillPresets.xml' });
  return out.filter((s) => existsSync(s.file));
}

/** Every preset this machine has. Re-read per call: the files are hand-edited. */
function presets(): FillPreset[] {
  const out: FillPreset[] = [];
  for (const s of sources()) {
    try { out.push(...readFillPresets(readFileSync(s.file, 'utf8'), s.label)); }
    // A broken file loses its own presets, not everybody's: the game's copy is
    // outside this repo and nothing stops it being edited into invalid XML.
    catch (e) { console.warn(`[fill] ${s.label}: ${e instanceof Error ? e.message : String(e)}`); }
  }
  return out;
}

/** Does the mounted data hold what this candidate names? */
function present(data: Assets, o: FillObject): boolean {
  return data.text(o.shared.split('#')[0]!.replace(/^\//, '')) !== null;
}

/**
 * What a candidate can be placed as.
 *
 * A plain shared reference is itself. One naming an `AdvMapSharedGroup` is
 * every member of that group, so a fill scatters across them — which is the one
 * thing the palette cannot do, since it stands in the first member and places
 * that one every time.
 */
function expander(data: Assets): (o: FillObject) => FillVariant[] {
  const cache = new Map<string, FillVariant[]>();
  return (o) => {
    if (o.type !== 'AdvMapSharedGroup' && !/SharedGroup\)$/i.test(o.shared)) return [];
    const hit = cache.get(o.shared);
    if (hit) return hit;
    const members = groupMembers(data, o.shared);
    cache.set(o.shared, members);
    return members;
  };
}

/**
 * A donor object of each type, looked up once for the whole fill.
 *
 * `donorFor` reads the game's own maps to find an object to copy the
 * type-specific fields from — cheap once, and a fill places hundreds.
 */
function donors(): (type: string) => ReturnType<typeof donorFor> {
  const cache = new Map<string, ReturnType<typeof donorFor>>();
  return (type) => {
    if (!cache.has(type)) cache.set(type, donorFor(gameData(), type));
    return cache.get(type)!;
  };
}

/** Wire this domain onto ipcMain. Called once, from main. */
export function registerFill(): void {
  // The presets, with each candidate marked for whether the data has it. A
  // preset naming a file this installation does not carry places nothing where
  // that candidate came up, and the panel is the only place that can say so
  // before the click rather than after.
  ipcMain.handle('fill:presets', async (): Promise<FillPresetsResult> => {
    const data = mountedAssets(gameData());
    const list = presets().map((p): FillPresetInfo => ({
      name: p.name,
      source: p.source,
      layers: p.layers.map((l) => ({
        dispersion: l.dispersion,
        width: l.width,
        objects: l.objects.map((o) => ({
          id: o.id, size: o.size, probability: o.probability, present: present(data, o),
        })),
      })),
    }));
    return { presets: list, sources: sources().map((s) => s.label) };
  });

  // Run one over the painted tiles.
  ipcMain.handle('fill:apply', async (_e: IpcMainInvokeEvent, p: FillApplyPayload): Promise<FillApplyResult> => {
    const session = need();
    const preset = presets()[p.preset];
    if (!preset) throw new Error(`no fill preset ${p.preset}`);
    if (!p.cells.length) throw new Error('nothing is painted — drag on the map first');
    const data = mountedAssets(gameData());
    const plan = planFill(p.cells, preset, p.seed, { expand: expander(data) });

    // Resolved BEFORE the edit, because a model that cannot be decoded is not
    // an object to place and finding that out halfway through would leave the
    // step half applied. The resolver caches, so the same tree costs one decode
    // however many of it the fill plants.
    const before = session.resolver.geoms.length;
    const ready: Array<{ gi: number; type: string; shared: string; x: number; y: number; r: number }> = [];
    let unresolved = 0;
    for (const placement of plan.placements) {
      const gi = session.resolver.resolve(placement.shared);
      if (gi < 0) { unresolved++; continue; }
      ready.push({ gi, type: placement.type, shared: placement.shared, x: placement.x, y: placement.y, r: placement.r });
    }

    const placed: FillApplyResult['placed'] = [];
    const donorOf = donors();
    const roster = rosterFor(session);
    // A fill plants many copies of a few models: the mesh travels with the
    // first placement that needs it and the rest name the index it registered.
    const sent = new Set<number>();
    record(session, `fill: ${preset.name}`, { map: true }, () => {
      for (const r of ready) {
        const donor = donorOf(r.type);
        const { object } = session.map.addObject({
          type: r.type, shared: r.shared, x: r.x, y: r.y, floor: p.floor, r: r.r,
          roster,
          order: orderFor(r.type),
          ...(donor ? { donor } : {}),
        });
        const geomData = session.resolver.geoms[r.gi];
        const fresh = r.gi >= before && !!geomData && !sent.has(r.gi);
        if (fresh) sent.add(r.gi);
        placed.push({
          instance: {
            id: object.id, type: object.type, g: r.gi, shared: r.shared.split('#')[0]!,
            x: r.x, y: r.y, z: 0, r: r.r,
          },
          geom: fresh ? { index: r.gi, data: geomData! } : null,
        });
      }
    });
    return { placed, considered: plan.report.considered, unresolved };
  });
}
