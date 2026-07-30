// The text and Lua a map carries: reading it, writing it, and what the script
// editor completes from.
//
// These files are documents of their own, not part of map.xdb, so they are
// written straight to disk (see sidecar.ts for where a reference lands and in
// which encoding).

import { ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import type { ApiFn, MapFilesPayload, MapFilesResult, ObjectEditResult, ReadFilePayload, ReadFileResult, ScriptContextResult, ScriptNewPayload, ScriptNewResult, ScriptResolvePayload, ScriptResolveResult, SpecNewPayload, SpecNewResult, WriteFilePayload } from '#electron/ipc.ts';
import { need, state } from '#electron/state.ts';
import { readSidecarText, sidecarPath, writeSidecarText } from '#electron/sidecar.ts';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { listDirFiles } from '#src/pak.ts';
import { children, find, text } from '#src/xml.ts';
import { TOWN_BONUS_IDS } from '#src/town-bonuses.ts';
import type { XmlElement } from '#src/xml.ts';
import scriptApi from '#src/script-api.json' with { type: 'json' };

/** The `href` of a Script wrapper's `<FileName>` — the `.lua` it runs. */
function readScriptFileName(xml: string): string | null {
  return /<FileName\s+href="([^"]*)"/i.exec(xml)?.[1] ?? null;
}

/** Wire this domain onto ipcMain. Called once, from main. */
export function registerText(): void {
  // --- IPC: everything the script editor completes from ---
  //
  // Three sources, and none of them is "the words already in the buffer": the
  // engine's API (extracted from the manuals the game ships — src/script-api.json,
  // see tools/script-api.ts), the functions and constants the game's own scripts
  // declare, and the names THIS map defines. The last is the one that matters
  // most: `GetObjectPosition("Isabel")` for a hero called `Isabell` fails silently
  // inside the game, and a list of the map's actual names is the fix.
  ipcMain.handle('script:context', async (): Promise<ScriptContextResult> => {
    const api = scriptApi as ApiFn[];
    const helpers = new Set<string>();
    const constants = new Set<string>();
    // The game's own Lua: helpers a mission is expected to call, and the constants
    // they define. Read from the data root, so it follows the installation.
    const { session } = state;
    const scripts = session ? join(session.assetRoot, 'scripts') : null;
    if (scripts && existsSync(scripts)) {
      for (const f of readdirSync(scripts)) {
        if (!/\.lua$/i.test(f)) continue;
        let src: string;
        try { src = readFileSync(join(scripts, f), 'latin1'); } catch { continue; }
        for (const m of src.matchAll(/^\s*function\s+([A-Za-z_]\w*)/gm)) helpers.add(m[1]!);
        for (const m of src.matchAll(/^([A-Z][A-Z0-9_]{2,})\s*=/gm)) constants.add(m[1]!);
      }
    }
    // The ID rosters: a script says CREATURE_PEASANT and SPELL_MAGIC_ARROW, and
    // those come from the installation rather than from any document.
    if (session) {
      for (const e of [...session.registry.creatures(), ...session.registry.spells(),
        ...session.registry.artifacts(), ...session.registry.skills()]) {
        if (/^[A-Z][A-Z0-9_]*$/.test(e.id)) constants.add(e.id);
      }
    }
    const names = { object: [] as string[], region: [] as string[], objective: [] as string[] };
    if (session) {
      for (const o of session.map.objects) { const n = text(find(o.el, 'Name')); if (n && !names.object.includes(n)) names.object.push(n); }
      const regions = find(session.map.desc, 'regions');
      for (const item of regions ? children(regions) : []) { const n = text(find(item, 'Name')); if (n) names.region.push(n); }
      const collect = (el: XmlElement): void => {
        for (const c of children(el)) {
          if (c.name === 'Item') { const n = text(find(c, 'Name')); if (n && !names.objective.includes(n)) names.objective.push(n); }
          collect(c);
        }
      };
      for (const c of ['ScenarioInformation', 'Objectives']) { const el = find(session.map.desc, c); if (el) collect(el); }
    }
    return {
      api,
      helpers: [...helpers].sort(),
      constants: [...constants].sort(),
      names: {
        object: names.object.sort(), region: names.region.sort(), objective: names.objective.sort(),
      },
    };
  });

  /** Every file in the map folder the script editor can open — its Lua and texts. */
  ipcMain.handle('map:files', async (_e: IpcMainInvokeEvent, { exts }: MapFilesPayload): Promise<MapFilesResult> => {
    const session = need();
    const want = exts.map((e) => e.toLowerCase());
    const files = listDirFiles(session.mapDir)
      .filter((rel) => want.some((e) => rel.toLowerCase().endsWith(e)))
      .sort();
    return { files };
  });

  // --- IPC: read/write a text file the map references (name.txt, a rumour…) ---
  // The original's "Edit" button on a text ref opens a plain-text editor on the
  // referenced file; these back that. Written straight to disk (the file is its
  // own document, not part of map.xdb), with the watcher resynced.
  ipcMain.handle('map:read-file', async (_e: IpcMainInvokeEvent, { href }: ReadFilePayload): Promise<ReadFileResult> => {
    const session = need();
    const file = sidecarPath(session, href);
    return { text: readSidecarText(session, href), exists: !!file && existsSync(file) };
  });

  ipcMain.handle('map:write-file', async (_e: IpcMainInvokeEvent, { href, text }: WriteFilePayload): Promise<ObjectEditResult> => {
    const session = need();
    if (!writeSidecarText(session, href, text)) throw new Error(`cannot write ${href}`);
    return { ok: true };
  });

  /**
   * Create a script and its wrapper, or adopt them if they are already there.
   *
   * A map script is two files: the `.lua` the engine runs, and a `.xdb` wrapper
   * that names it — the wrapper is what `MapScript` and a hero's `CombatScript`
   * reference, never the `.lua` directly. "New script" therefore makes both and
   * hands back the wrapper's xpointer to store in the ref.
   *
   * If a wrapper of that name exists it is adopted, not overwritten: it may name a
   * `.lua` that already holds a mission's script, and pointing at it is the intent.
   * The `.lua` is only created when missing, for the same reason `map:write-file`
   * does not clobber an existing text.
   */
  ipcMain.handle('script:new', async (_e: IpcMainInvokeEvent, { base }: ScriptNewPayload): Promise<ScriptNewResult> => {
    const session = need();
    const clean = base.trim().replace(/\.(lua|xdb)$/i, '');
    if (!clean || /[/\\]/.test(clean)) throw new Error('a script name has no path or extension');
    const luaName = `${clean}.lua`;
    const wrapper = `${clean}.xdb`;
    const wrapperPath = sidecarPath(session, wrapper);
    if (!wrapperPath) throw new Error(`cannot create ${wrapper}`);
    let lua = luaName;
    if (existsSync(wrapperPath)) {
      // Adopt: keep whatever .lua the existing wrapper already names.
      lua = readScriptFileName(readSidecarText(session, wrapper)) ?? luaName;
    } else {
      const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<Script>\n'
        + `\t<FileName href="${luaName}"/>\n\t<ScriptText/>\n</Script>\n`;
      if (!writeSidecarText(session, wrapper, xml)) throw new Error(`cannot write ${wrapper}`);
    }
    const luaPath = sidecarPath(session, lua);
    if (luaPath && !existsSync(luaPath)) writeSidecarText(session, lua, '');
    return { href: `${wrapper}#xpointer(/Script)`, lua };
  });

  /** The `.lua` a Script wrapper names — so "Edit" opens the script, not the wrapper. */
  ipcMain.handle('script:resolve', async (_e: IpcMainInvokeEvent, { href }: ScriptResolvePayload): Promise<ScriptResolveResult> => {
    const session = need();
    const lua = readScriptFileName(readSidecarText(session, href));
    if (!lua) throw new Error(`${href} names no script file`);
    return { lua };
  });

  // --- IPC: create a map-local town specialization and return its ref ---
  // A specialization is a named town bonus. The shipped ones live in the game's
  // GameMechanics/, but there is nothing special about that folder — a map can
  // carry its own, packed beside map.xdb and referenced by a relative href, the
  // same way scripts and texts are. RandomTown is TOWN_SCRIPT_ONLY: this is a
  // named specialization for a placed town, not a member of the random pool.
  ipcMain.handle('spec:new', async (_e: IpcMainInvokeEvent, { base, bonus, townType, name }: SpecNewPayload): Promise<SpecNewResult> => {
    const session = need();
    const clean = base.trim().replace(/\.xdb$/i, '');
    if (!clean || /[/\\]/.test(clean)) throw new Error('a specialization name has no path or extension');
    if (!TOWN_BONUS_IDS.has(bonus)) throw new Error(`unknown bonus ${bonus}`);
    const file = `${clean}.xdb`;
    // A display name, when given, is a sibling text file the spec points at — a
    // localizable ref like every other name in the map.
    let nameRef = '';
    if (name && name.trim()) {
      const nameFile = `${clean}-name.txt`;
      if (!writeSidecarText(session, nameFile, name.trim())) throw new Error(`cannot write ${nameFile}`);
      nameRef = nameFile;
    }
    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<TownSpecialization>\n'
      + `\t<NameFileRef href="${nameRef}"/>\n`
      + '\t<BiographyFileRef href=""/>\n'
      + `\t<Bonus>${bonus}</Bonus>\n`
      + '\t<BonusDescriptionFileRef href=""/>\n'
      + `\t<TownType>${townType}</TownType>\n`
      + '\t<RandomTown>TOWN_SCRIPT_ONLY</RandomTown>\n'
      + '</TownSpecialization>\n';
    if (!writeSidecarText(session, file, xml)) throw new Error(`cannot write ${file}`);
    return { href: `${file}#xpointer(/TownSpecialization)`, file };
  });
}
