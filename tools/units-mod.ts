// The units mod from the command line — build one, or say what is installed.
//
//   node tools/units-mod.ts list [game]              what our mod folder adds, and what
//                                                    the executable is set to
//   node tools/units-mod.ts show <archive.h5u>       one mod's creatures
//   node tools/units-mod.ts build <project> [--install <game>]
//
// A project is a folder holding units.json — the registry. `build` reads it,
// generates the mod's tree beside it in `packed/` and packs the .h5u.
//
// `--install` also sets the creature ceiling in `bin/H5_Game_H5E.exe`, because the
// ceiling has to equal the mod's creature count exactly and a mod installed
// without it is read and ignored. Adding or removing a creature and re-installing
// is all there is to it — see src/creature-limit.ts.
//
// Not the only way any more: the window's **Units…** and **Artifacts…** dialogs
// build and install through the same functions (docs/UNITS_AND_ARTIFACTS.md).
// This stays because a batch belongs on a command line — a project's units.json
// declares a whole creature set at once, which is how the Heroes III port ships
// its own (Maps/sod/tools/build-creature-slots.ts), and `list` answers "what is
// installed" without opening the editor. Dwellings are still CLI-only.
//
// Either way the UI READS what is installed: mountedAssets() layers every
// installed .h5u over the data, so a mod's creatures are in the army picker and
// its dwellings in the object palette.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { MOD_DIR, modDir } from '../src/mod-paths.ts';
import {
  buildCreatureMod, creatureLimit, dataReader, findCreatureMods, installCreatureMod, MOD_MANIFEST,
  packCreatureMod, readCreatureMod, writeCreatureMod,
} from '../src/creature-mod.ts';
import type { CreatureMod } from '../src/creature-mod.ts';
import { PATCHED_EXE, readExe } from '../src/creature-limit.ts';
import { SHIPPED_CREATURES } from '../src/creatures.ts';

const args = process.argv.slice(2);
const command = args[0];
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const positional = args.slice(1).filter((a, i, all) => !a.startsWith('--') && !all[i - 1]?.startsWith('--'));

const here = resolve(import.meta.dirname, '..');
/** The install this editor sits in, when it sits in one. */
const defaultGame = resolve(here, '..');

function usage(): never {
  console.error(`usage:
  units-mod list [game]
  units-mod show <archive.h5u>
  units-mod build <project> [--install <game>] [--data <unpacked data root>]`);
  process.exit(2);
}

/** Print a mod's creatures, one line each. */
function report(mod: CreatureMod, reconstructed = false): void {
  console.log(`  ${mod.creatures.length} creature(s), ids ${mod.first}..${creatureLimit(mod) - 1}`);
  if (reconstructed) console.log('  (no manifest — read back from types.xml and the ref table)');
  for (const c of mod.creatures) {
    const s = c.stats;
    console.log(`    ${String(c.number).padStart(3)}  ${c.id.padEnd(28)} ${c.name || '—'}`);
    console.log(`         tier ${s.tier}, ${s.gold} gold, ${s.attack}/${s.defence}, ${s.minDamage}-${s.maxDamage} dmg, ${s.health} hp, speed ${s.speed}, init ${s.initiative}`);
  }
}

if (command === 'list') {
  const game = positional[0] ?? defaultGame;
  const found = findCreatureMods(game);
  if (!found.length) {
    console.log(`no creature mods in ${modDir(game)} — the game holds its shipped ${SHIPPED_CREATURES}`);
    process.exit(0);
  }
  for (const f of found) {
    console.log(`\n${f.path}`);
    report(f.mod, f.reconstructed);
  }
  // Ids are global and each mod carries a whole copy of the registry, so two of
  // them do not add up — the game reads one and the other's creatures vanish.
  if (found.length > 1) {
    console.log(`\n${found.length} creature mods installed. They CONFLICT: each carries its own copy of`);
    console.log('types.xml and the creature table, so whichever the game reads last wins outright.');
  }

  // What the executable actually says, rather than what it ought to. The two
  // drift only if something was installed by hand, and this is where that shows.
  const needed = found.length === 1 ? found[0]!.limit : null;
  const exe = join(game, PATCHED_EXE);
  if (!existsSync(exe)) {
    console.log(`\n${PATCHED_EXE} is not there, so no ceiling is raised and every mod creature is ignored.`);
    if (needed) console.log(`build with --install to create it at ${needed}.`);
  } else {
    const r = readExe(readFileSync(exe));
    console.log(`\n${PATCHED_EXE}  ${r.build?.name ?? '?'}  ceiling ${r.limit ?? '?'}`);
    for (const p of r.problems) console.log(`  ${p}`);
    if (needed && r.limit !== null && r.limit !== needed) {
      console.log(`  MISMATCH: the mod needs ${needed}. Re-run build --install, or creature-limit.ts --set ${needed}.`);
    }
  }
  process.exit(0);
}

if (command === 'show') {
  const path = positional[0];
  if (!path) usage();
  const found = readCreatureMod(resolve(path));
  if (!found) {
    console.log(`${path} says nothing about creatures`);
    process.exit(1);
  }
  console.log(path);
  report(found.mod, found.reconstructed);
  console.log(`\nthis mod needs the executable's creature ceiling at ${found.limit}`);
  process.exit(0);
}

if (command === 'build') {
  const project = positional[0] ? resolve(positional[0]) : usage();
  const manifest = join(project, MOD_MANIFEST);
  if (!existsSync(manifest)) {
    console.error(`${manifest} is not there — a units-mod project is a folder holding ${MOD_MANIFEST}`);
    process.exit(1);
  }
  const mod = JSON.parse(readFileSync(manifest, 'utf8')) as CreatureMod;
  const data = flag('data') ?? process.env.HOMM5_DATA ?? join(here, 'data-unpacked');
  if (!existsSync(data)) {
    console.error(`no unpacked game data at ${data} — point at one with --data or HOMM5_DATA`);
    process.exit(1);
  }

  const report_ = buildCreatureMod(mod, dataReader(data));
  const out = join(project, 'packed');
  mkdirSync(out, { recursive: true });
  writeCreatureMod(join(out, mod.stem), report_);
  const archive = join(out, `${mod.stem}.h5u`);
  writeFileSync(archive, packCreatureMod(report_));

  console.log(`${report_.files.length} files, ceiling ${mod.first} → ${report_.limit}`);
  for (const [id, n] of Object.entries(report_.art)) console.log(`  ${id}: ${n} art files copied`);
  if (report_.missing.length) {
    // Authoring sources, almost always — .mb scenes and .tga originals that were
    // never shipped. Listed rather than hidden, because a missing texture would
    // look exactly the same here.
    console.log(`  ${report_.missing.length} reference(s) resolved to nothing:`);
    for (const m of report_.missing.slice(0, 8)) console.log(`    ${m}`);
    if (report_.missing.length > 8) console.log(`    … and ${report_.missing.length - 8} more`);
  }

  // The manifest the build wrote records the art each slot resolved to; keep it,
  // so the project and the shipped mod say the same thing.
  writeFileSync(manifest, `${JSON.stringify(mod, null, 2)}\n`);

  const game = flag('install');
  if (!game) {
    console.log(`\nbuilt  ${archive}`);
    console.log(`--install <game> to put it in ${MOD_DIR} and set the ceiling to ${report_.limit}`);
    process.exit(0);
  }

  // The ceiling goes with it. Installing the archive alone would leave the game
  // reading a mod it then ignores, which looks exactly like a broken mod.
  let done;
  try {
    done = installCreatureMod(game, mod, readFileSync(archive));
  } catch (e) {
    console.error(`\nnot installed — the creature ceiling could not be set:\n${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
  console.log(`\ninstalled  ${done.archive}`);
  if (done.exe) {
    const how = done.exe.created ? `created and patched to ${done.exe.to}`
      : done.exe.changed ? `ceiling ${done.exe.from} → ${done.exe.to}` : `ceiling already ${done.exe.to}`;
    console.log(`           ${done.exe.path} — ${how}`);
    console.log(`\nlaunch that executable: ids ${SHIPPED_CREATURES}..${done.exe.to - 1} exist only there.`);
  } else {
    console.log('           the executable is untouched — this mod adds no creature');
  }
  process.exit(0);
}

usage();
