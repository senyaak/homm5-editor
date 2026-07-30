// What it takes to start the game from inside the editor.
//
// WHICH EXECUTABLE. Ours, `bin/H5_Game_H5E.exe`, and never the shipped one
// beside it: that copy is what reads `H5E/`, so it is the only one that can show
// what the editor makes. The shipped executable reads none of it and is the off
// switch, which is not something a Play button should offer by accident.
//
// WHICH ENVIRONMENT — the reason this file exists. Started from the editor the
// game broke; started by hand, the same executable was fine. What differs is
// what a child process inherits. Explorer hands a program the USER's
// environment; the editor's process is that plus three layers of our own:
//
//   HOMM5_*                  the paths the editor itself runs on
//   npm_*, NODE_*, INIT_CWD  what `npm run` exports around a script, including a
//                            PATH with every node_modules/.bin bolted on front
//   ELECTRON_*, CHROME_*     what Electron and Chromium set for themselves
//
// A 2007 executable has no business seeing any of that, so it is removed — and
// only that. A BLOCKLIST rather than an allowlist on purpose: everything else in
// there is the user's own environment, the same block Explorer would pass, and a
// game that cannot find `LOCALAPPDATA` or its graphics vendor's variable fails in
// ways far harder to read than a variable too many.

import { join } from 'node:path';

/** Our copy of the game, relative to the install. */
export const GAME_EXE = join('bin', 'H5_Game_H5E.exe');

/** Variables this process was given by us, npm, Node or Electron. */
const OURS = /^(HOMM5_|NODE_|npm_|ELECTRON_|PW_|CHROME_|GOOGLE_API|INIT_CWD$|DEBUG$)/i;

/** Does `node_modules/.bin` appear in this PATH entry? `npm run` puts it there. */
const NPM_BIN = /node_modules[\\/]\.bin/i;

/**
 * The environment the game should get: this machine's, without what we put in it.
 *
 * Takes the environment rather than reading `process.env`, so it can be checked
 * without one.
 */
export function cleanEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || OURS.test(key)) continue;
    // PATH is not dropped — the game needs it — but the entries npm prepended
    // are, because they are ours and they come first.
    if (key.toUpperCase() === 'PATH') {
      out[key] = value.split(';').filter((p) => p && !NPM_BIN.test(p)).join(';');
      continue;
    }
    out[key] = value;
  }
  return out;
}
