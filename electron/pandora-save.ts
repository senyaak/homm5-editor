// Turning the boxes a map holds into what the GAME can read, at save time.
//
// The sidecar is the editor's memory; the game's copy is a generated block in
// the map's Lua and one text file per talking box. Both are written here, on
// the way to disk, for two reasons: a Lua rewrite per keystroke of a form is
// waste, and the block has to reflect what is on the map at the moment it is
// packed — including the boxes deleted since the contents were typed.
//
// A MAP WITH BOXES GETS A SCRIPT, whether or not the author wanted one. The
// behaviour is a touch trigger; without a `MapScript` there is nothing to hook
// it in, and a box that cannot be opened is not a box. The script is created
// exactly as "new script" creates one — a `.lua` and the `.xdb` wrapper that
// names it — and the author's own code, if it arrives later, sits below our
// fenced block untouched.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { record } from '#electron/edits.ts';
import { readScriptFileName, readSidecarText, sidecarPath, writeSidecarText } from '#electron/sidecar.ts';
import type { Session } from '#electron/state.ts';
import { setPath } from '#src/schema/tree.ts';
import {
  pandoraMessageFile, pandoraMessageRef, prunePandoraBoxes, readPandoraBoxes, writePandoraBoxes,
} from '#src/map/pandora-store.ts';
import type { PandoraContents } from '#src/mods/pandora-contents.ts';
import { isPandoraShared } from '#src/mods/pandora-files.ts';
import { PANDORA_RATES } from '#src/mods/pandora-contents.ts';
import { pandoraPrices } from '#src/mods/pandora-prices.ts';
import { withPandoraBlock } from '#src/mods/pandora-scripts.ts';

/** The default script a map gains when its boxes need one. */
const SCRIPT_STEM = 'MapScript';

/** The placements on the map that ARE boxes, by name. */
function placedBoxes(s: Session): string[] {
  return s.map.objects.filter((o) => isPandoraShared(o.shared)).map((o) => o.name).filter(Boolean);
}

/**
 * The `.lua` this map runs, made if it has none.
 *
 * Answers the path relative to the map folder, which is what both the wrapper
 * and the sidecar writer speak.
 */
function mapScriptFile(s: Session): string {
  const ref = s.map.mapScript;
  if (ref) {
    const named = readScriptFileName(readSidecarText(s, ref));
    if (named) return named;
  }
  // None yet: make the pair, and point the map at the wrapper.
  const lua = `${SCRIPT_STEM}.lua`;
  const wrapper = `${SCRIPT_STEM}.xdb`;
  const wrapperPath = sidecarPath(s, wrapper);
  if (wrapperPath && !existsSync(wrapperPath)) {
    writeSidecarText(s, wrapper,
      '<?xml version="1.0" encoding="UTF-8"?>\n<Script>\n'
      + `\t<FileName href="${lua}"/>\n\t<ScriptText/>\n</Script>\n`);
  }
  // INSIDE A RECORDED STEP, because this is the one thing here that touches
  // map.xdb. Saving used to sync the tile set the same way and it was the one
  // place the document moved behind the undo stack's back — every patch on the
  // stack had been taken from bytes that no longer existed, and the next Ctrl+Z
  // answered "patch does not fit" for good. A step costs an entry in the
  // history and keeps the stack whole.
  //
  // Through setPath, which knows a `<MapScript/>` is a REFERENCE: an empty one
  // carries no href to copy the shape from, and an attribute assigned by hand
  // is not marked dirty and never reaches the file.
  record(s, 'bind a script for the boxes', { map: true }, () =>
    setPath(s.map.desc, ['MapScript'], `${wrapper}#xpointer(/Script)`, true));
  return lua;
}

/**
 * Write the boxes into the map: the block in its script, a text per message.
 *
 * `archivePrefix` is where the map sits inside its archive, because a message
 * ref is addressed the way the GAME addresses files — from the data root, not
 * from the map folder.
 *
 * Returns how many boxes were written, for the save log.
 */
export function writePandoraForMap(s: Session, archivePrefix: string): number {
  const stored = readPandoraBoxes(s.mapDir);
  const boxes = prunePandoraBoxes(stored, placedBoxes(s));
  // Contents whose placement is gone stop being the map's — written back so
  // the sidecar and the map agree from here on rather than at the next save.
  if (boxes.length !== stored.length) writePandoraBoxes(s.mapDir, boxes);

  const luaFile = boxes.length ? mapScriptFile(s) : scriptFileIfAny(s);
  if (!luaFile) return 0;
  const luaPath = sidecarPath(s, luaFile);
  if (!luaPath) return 0;

  // The author's words, and only those: the block can point at a file, so the
  // file has to exist first.
  for (const box of boxes) {
    if (box.message) writeSidecarText(s, pandoraMessageFile(box.name), box.message);
  }

  const before = existsSync(luaPath) ? readFileSync(luaPath, 'utf8') : '';
  const after = withPandoraBlock(before, boxes, {
    said: (b: PandoraContents) => (b.message ? pandoraMessageRef(archivePrefix, b.name) : undefined),
    // What a spell is worth to a hero who cannot hold it: the valuer's own rate
    // for a spell level, so the box pays exactly what it was priced at.
    spellExp: (id) => pandoraPrices(s.assets).spellLevel(id) * PANDORA_RATES.spellLevel
      * PANDORA_RATES.exp,
  });
  // Only when it changed: an untouched .lua keeps its timestamp, and the
  // watcher keeps quiet.
  if (after !== before) {
    writeFileSync(luaPath, after, 'utf8');
    s.watch.resync();
  }
  return boxes.length;
}

/**
 * The map's script if it already has one — for the case with no boxes left,
 * where the block has to be REMOVED from a script rather than a script made to
 * hold nothing.
 */
function scriptFileIfAny(s: Session): string | null {
  const ref = s.map.mapScript;
  if (!ref) return null;
  const named = readScriptFileName(readSidecarText(s, ref));
  if (!named) return null;
  return existsSync(join(s.mapDir, named)) ? named : null;
}
