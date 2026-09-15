// The install a generation runs against — the two things the generator reads
// and nothing else: the data as the game mounts it, and the game's executable.
//
// Everything in `src/rmg` used to reach for the game folder through the
// tools' `--game` flag whenever an option was left out, which was fine for a
// test and wrong for an application: the editor knows which install it is
// pointed at and says so. So the pair is an argument, carried through the
// chain, the run and the emitter, and the tools build it once from the flag.

import type { RmgExeTables } from '../exe/rmg-tables.ts';
import type { DataRoot } from './data.ts';
import { exeTables } from './exe.ts';

export interface RmgInstall {
  /** The data as the game reads it — the mounted chain, or a plain folder. */
  data: DataRoot;
  /** The game's UNWRAPPED executable — the generator's tables come out of it, and the sine table. */
  exe: string;
}

/** The executable's tables, read once per process (`exe.ts` memoizes by path). */
export function installTables(install: RmgInstall): RmgExeTables {
  return exeTables(install.exe);
}
