// Spells: the sharpest bargain the editor makes with the executable.
//
// A spell of ours is one entry in the table that holds all 353 the game
// ships — the spells proper, the hero abilities, the creature abilities and the
// effects they leave — plus two ceilings in the executable. That buys a page in
// the spellbook, an icon, a name, a mana cost and a cast the engine will start.
// What it does NOT buy is behaviour: what a spell DOES is chosen by switches on
// its NUMBER, and ours is a number nothing was compiled against.
//
// So the form has two halves that look alike and travel differently. The
// DOCUMENT half — school, level, mana, target, the four damage entries, the
// element, the two reach flags — is read out of the record by the engine's own
// code, identically for any number, and needs nothing from us. The other half —
// which tiles an area covers, which creature kinds the damage passes over — has
// no field in the document at all, and goes to the file the extension reads.
//
// See docs/engineInternals/SPELLS.md.

import { ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import type {
  ModsInstallSpellPayload, ModsInstallSpellResult, ModsRemovePayload, ModsRemoveResult,
  ModsSpellDataResult, ModsUsesResult,
} from '#electron/ipc.ts';
import { buildAndInstall, ourMod } from '#electron/mod-install.ts';
import { enumValues } from '#electron/spec.ts';
import { gameData, gameRoot, isConfigured } from '#electron/paths.ts';
import { join } from 'node:path';
import { assets } from '#src/game/assets.ts';
import { describeUses, findSpellUses } from '#src/mods/artifact-usage.ts';
import { addSpell, removeSpell, updateSpell } from '#src/mods/mod-model.ts';
import { TYPES } from '#src/mods/mod-files.ts';
import { NOT_LIVING, SPELL_MASTERIES, takenSpells } from '#src/mods/spells.ts';
import type { SpellSpec } from '#src/mods/spells.ts';
import { creatureAbilityNames } from '#src/schema/registry.ts';

/**
 * One payload, one spec — as the hero and skill sides do it, and for the reason:
 * two copies of twenty fields is two copies that drift, and the field that stops
 * being carried is always the one nobody remembers to check.
 *
 * Empty is ABSENT here, not zero-length: a `spares` of none and an `area` of
 * none are rows the extension would read as a filter that spares nobody and a
 * shape that covers nothing, which is not what an empty box means.
 */
function spellSpecOf(p: ModsInstallSpellPayload): SpellSpec {
  const amounts = (given: ModsInstallSpellPayload['damage']): SpellSpec['damage'] | undefined => {
    if (!given?.length) return undefined;
    // Four, whatever arrives: the engine reads the list positionally, and a
    // short one would leave the masteries after it at whatever the parser had.
    return Array.from({ length: SPELL_MASTERIES }, (_, i) => {
      const a = given[i] ?? given[given.length - 1]!;
      return { base: Number(a.base) || 0, perPower: Number(a.perPower) || 0 };
    });
  };
  return {
    id: p.id.trim(),
    file: p.file.trim(),
    name: p.name,
    description: p.description,
    level: Number(p.level) || 0,
    school: p.school,
    manaCost: Number(p.manaCost) || 0,
    target: p.target,
    aimed: !!p.aimed,
    areaAttack: !!p.areaAttack,
    ...(p.element ? { element: p.element } : {}),
    ...(amounts(p.damage) ? { damage: amounts(p.damage)! } : {}),
    ...(amounts(p.duration) ? { duration: amounts(p.duration)! } : {}),
    ...(p.visuals?.filter((v) => v.trim()).length
      ? { visuals: p.visuals.filter((v) => v.trim()) } : {}),
    ...(p.icon?.trim() ? { icon: p.icon.trim() } : {}),
    ...(p.picture?.trim() ? { picture: p.picture.trim() } : {}),
    ...(p.spares?.length ? { spares: p.spares } : {}),
    ...(p.area?.length ? { area: p.area.map((t) => ({ x: Number(t.x) | 0, y: Number(t.y) | 0 })) } : {}),
    ...(p.script?.trim() ? { script: p.script } : {}),
  };
}

/**
 * The type those enums are fields of: the DOCUMENT, `Spell`.
 *
 * Not `SpellID`, which is the enum of every spell's name and has no fields at
 * all — the two are one letter apart, and asking the wrong one comes back as
 * three empty lists with no error anywhere.
 */
const SPELL_DOCUMENT = 'Spell';

/** Wire this domain onto ipcMain. Called once, from main. */
export function registerModSpells(): void {
  /** The mod, or a refusal naming which of the two configurations is missing. */
  const openMod = (): { g: string; mod: ReturnType<typeof ourMod> } => {
    const g = gameRoot();
    if (!g) throw new Error('no game install configured — a mod needs a folder to install into');
    if (!isConfigured()) throw new Error('no data root configured');
    return { g, mod: ourMod(g) };
  };

  ipcMain.handle('mods:install-spell', async (_e: IpcMainInvokeEvent, p: ModsInstallSpellPayload): Promise<ModsInstallSpellResult> => {
    const { g, mod } = openMod();
    // Every name the game's own enum holds, so ours cannot shadow one: a
    // duplicate `<Name>` is not an error the game reports, it is a value that
    // resolves to whichever entry the parser saw first.
    const types = assets([gameData()]).text(TYPES) ?? '';
    const spec = addSpell(mod, spellSpecOf(p), takenSpells(types));
    const { installed } = buildAndInstall(g, mod);
    return { archive: installed.archive, number: spec.number };
  });

  ipcMain.handle('mods:update-spell', async (_e: IpcMainInvokeEvent, p: ModsInstallSpellPayload): Promise<ModsInstallSpellResult> => {
    const { g, mod } = openMod();
    const spec = updateSpell(mod, p.id.trim(), spellSpecOf(p));
    const { installed } = buildAndInstall(g, mod);
    return { archive: installed.archive, number: spec.number };
  });

  ipcMain.handle('mods:remove-spell', async (_e: IpcMainInvokeEvent, { id }: ModsRemovePayload): Promise<ModsRemoveResult> => {
    const { g, mod } = openMod();
    const gone = removeSpell(mod, id);
    const { installed } = buildAndInstall(g, mod);
    return { archive: installed.archive, removed: gone.id };
  });

  // Which maps name it — asked BEFORE it is removed, and exact: a map stores the
  // NAME, in a spellbook, a guild's list, the spells it allows or a shrine.
  ipcMain.handle('mods:spell-uses', async (_e: IpcMainInvokeEvent, { id }: ModsRemovePayload): Promise<ModsUsesResult> => {
    const uses = findSpellUses(join(gameData(), 'Maps'), [id]).get(id) ?? [];
    return { uses: describeUses(uses) };
  });

  // What the form's closed lists hold. Read off the game's own type spec rather
  // than written down here: the legal values of a field are a fact about the
  // install, and a list frozen into our source is a second copy of them to drift.
  ipcMain.handle('mods:spell-data', async (): Promise<ModsSpellDataResult> => {
    if (!isConfigured()) throw new Error('no data root configured');
    const enums = enumValues(SPELL_DOCUMENT, ['MagicSchool', 'Target', 'Element']);
    return {
      schools: enums.MagicSchool ?? [],
      targets: enums.Target ?? [],
      elements: enums.Element ?? [],
      abilities: creatureAbilityNames(assets([gameData()])),
      notLiving: [...NOT_LIVING],
    };
  });
}
