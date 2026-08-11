// What is inside a Pandora's Box — read, priced, and written back.
//
// The contents are the PLACEMENT's, so everything here is keyed by an object
// id the window already has: the selection asks whether what it is holding is a
// box, gets its contents and what they are worth, and hands back an edited set.
//
// TWO WRITES, ONE ACT. Saving contents writes the sidecar (src/map/
// pandora-store.ts) AND repoints the placement at the tier its value earns,
// because the glow IS the contents said out loud. The second half goes through
// record() so undo takes the colour back with the contents rather than leaving
// a red box holding a handful of gold.
//
// What is NOT here is the script: a map's generated block is written when the
// map is saved, from the sidecar, by electron/channels/save.ts. Writing it on
// every keystroke of a form would put a Lua rewrite behind a spinner.

import { ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { record } from '#electron/edits.ts';
import type { PandoraGetPayload, PandoraGetResult, PandoraSetPayload, PandoraSetResult } from '#electron/ipc.ts';
import { gameData, mountedAssets } from '#electron/paths.ts';
import { findObject, need } from '#electron/state.ts';
import type { Session } from '#electron/state.ts';
import { find, setAttr } from '#src/format/xml.ts';
import {
  findPandoraBox, readPandoraBoxes, setPandoraBox, writePandoraBoxes,
} from '#src/map/pandora-store.ts';
import { PANDORA_TIERS, boxTier, pandoraValue } from '#src/mods/pandora-contents.ts';
import type { PandoraContents, PandoraPrices } from '#src/mods/pandora-contents.ts';
import { isPandoraShared, pandoraSharedHref, pandoraTierOfShared } from '#src/mods/pandora-files.ts';
import { pandoraPrices } from '#src/mods/pandora-prices.ts';

/**
 * The price list, built once per session.
 *
 * It reads reference tables through the mounted chain, so it already answers
 * for a creature a mod added — and it caches per id, so a box with a dozen
 * stacks costs one read each rather than one table scan each.
 */
let prices: PandoraPrices | null = null;
function priceList(): PandoraPrices {
  prices ??= pandoraPrices(mountedAssets(gameData()));
  return prices;
}

/** Contents as the window should see them: never null, always named after the
 *  placement, so a box that has never been filled in still edits. */
function contentsOf(s: Session, name: string): PandoraContents {
  return findPandoraBox(readPandoraBoxes(s.mapDir), name) ?? { name };
}

/** Point a placement at a tier's shared document. */
function wearTier(s: Session, id: string, tier: string): void {
  const obj = findObject(s, id);
  const el = find(obj.el, 'Shared');
  if (!el) throw new Error('this placement has no <Shared> to point anywhere');
  // setAttr, not `attrs.href = …`: the writer only re-serialises an element's
  // attributes when they are marked dirty, so a plain assignment changes what
  // the editor SHOWS and nothing that gets saved. The probe map caught this by
  // asking the file rather than the channel that had just been written to.
  record(s, 'box glow', { map: true }, () => { setAttr(el, 'href', pandoraSharedHref(tier)); });
}

export function registerPandora(): void {
  /**
   * Is the selected object a box, and what does it hold?
   *
   * Answers for ANY object rather than throwing on the ordinary ones: the
   * inspector asks about whatever is selected, and "no, that is a windmill" is
   * the answer that keeps the panel simple.
   */
  ipcMain.handle('pandora:get', (_e: IpcMainInvokeEvent, { id }: PandoraGetPayload): PandoraGetResult => {
    const session = need();
    const obj = findObject(session, id);
    if (!isPandoraShared(obj.shared)) return { isBox: false };
    const name = obj.name;
    const contents = contentsOf(session, name);
    const value = pandoraValue(contents, priceList());
    return {
      isBox: true,
      name,
      contents,
      value: value.total,
      parts: value.parts,
      tier: boxTier(contents, priceList()).key,
      // What the placement is WEARING, which is the tier until something has
      // gone out of step — a map hand-edited, a sidecar restored from a backup.
      worn: pandoraTierOfShared(obj.shared) ?? '',
      tiers: PANDORA_TIERS.map((t) => ({ key: t.key, from: t.from })),
    };
  });

  /**
   * Put the contents back, and dress the box in what they are worth.
   *
   * The name comes from the PLACEMENT, not from the form: it is the trigger's
   * handle, the inspector is where it is renamed, and a form that could set it
   * would be a second way to break the link between the two.
   */
  ipcMain.handle('pandora:set', (_e: IpcMainInvokeEvent, { id, contents }: PandoraSetPayload): PandoraSetResult => {
    const session = need();
    const obj = findObject(session, id);
    if (!isPandoraShared(obj.shared)) throw new Error('this object is not a Pandora\'s Box');
    const name = obj.name;
    if (!name) throw new Error('an unnamed box cannot be triggered — name the placement first');
    const box: PandoraContents = { ...contents, name };
    writePandoraBoxes(session.mapDir, setPandoraBox(readPandoraBoxes(session.mapDir), box));
    session.watch.resync();

    const tier = boxTier(box, priceList());
    if (pandoraTierOfShared(obj.shared) !== tier.key) wearTier(session, id, tier.key);
    const value = pandoraValue(box, priceList());
    return { ok: true, value: value.total, parts: value.parts, tier: tier.key };
  });
}
