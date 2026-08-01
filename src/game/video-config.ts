// The game's own video settings — which are NOT in the install.
//
// WHERE THEY REALLY LIVE. `<install>/profiles/default_profile/user_a2.cfg` looks
// like the file and is not: it is the template a new profile is stamped from.
// What a running game reads and writes is under the user's Documents —
//
//   Documents/My Games/Heroes of Might and Magic V …/Profiles/<profile>/user_a2.cfg
//
// — one folder per profile, beside `global_a2.cfg`. This was established by
// setting `gfx_fullscreen = 0` in the install's copy, watching the game start
// fullscreen anyway, and finding the Documents file written to the second the
// game exited. It is worth knowing for more than this feature: settings, saves
// and profiles are the USER's, shared by every install on the machine, so a
// second copy of the game isolates its binaries and its data and not these.
//
// WHY THIS IS HERE AT ALL. Borderless is a window's frame, and exclusive
// fullscreen has no window to speak of — Direct3D takes the display and the
// style is beside the point. So half of that feature is a variable of the
// game's, and a panel that ticks the box without setting it would be a switch
// that does nothing on most installs.

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The settings file inside one profile's folder. */
const USER_CFG = 'user_a2.cfg';

/**
 * The game's folder under `My Games`, whatever it is called in this install.
 *
 * Matched rather than spelled out: the name carries the game's full title with
 * an em dash in it, and it differs between the original and the expansions.
 * Anything starting with the series' name is ours to look in.
 */
export function profilesRoot(documents: string): string | null {
  const myGames = join(documents, 'My Games');
  if (!existsSync(myGames)) return null;
  for (const name of readdirSync(myGames)) {
    if (!/^Heroes of Might and Magic V/i.test(name)) continue;
    const profiles = join(myGames, name, 'Profiles');
    if (existsSync(profiles)) return profiles;
  }
  return null;
}

/** Every profile's settings file under that root. */
export function userConfigs(profiles: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(profiles, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const cfg = join(profiles, entry.name, USER_CFG);
    if (existsSync(cfg)) out.push(cfg);
  }
  return out;
}

/**
 * Set one `setvar` in one file, in place.
 *
 * Only a line that is already there is changed. The game writes the whole file
 * on exit from its own list of variables, so a name it does not know would be
 * dropped at the next launch anyway — and a file we appended to would read as
 * ours rather than as the game's. A profile with no such line is left alone and
 * said so, rather than being repaired into something that was never there.
 */
function setVar(file: string, name: string, value: string): boolean {
  const before = readFileSync(file, 'utf8');
  const line = new RegExp(`^([ \\t]*setvar[ \\t]+${name}[ \\t]*=[ \\t]*).*$`, 'm');
  if (!line.test(before)) return false;
  const after = before.replace(line, `$1${value}`);
  if (after !== before) writeFileSync(file, after, 'utf8');
  return true;
}

export interface WindowedResult {
  /** The files that now say what was asked. */
  changed: string[];
  /** Profiles with no such setting to change — reported, never repaired. */
  skipped: string[];
}

/**
 * What the game should RENDER at, which borderless makes a real question.
 *
 * A borderless window is the size of the screen whatever the engine draws into
 * it: with the shipped 1024x768 the picture is simply stretched over the whole
 * display, which looks like a broken mod rather than like a setting. So the two
 * belong together — the frame comes off and the render size follows the window.
 *
 * Written in the game's own `WIDTHxHEIGHT` form, and only over a line that is
 * already there, like every other setting here.
 */
export function setResolution(profiles: string, width: number, height: number): WindowedResult {
  const changed: string[] = [];
  const skipped: string[] = [];
  for (const cfg of userConfigs(profiles)) {
    if (setVar(cfg, 'gfx_resolution', `${width}x${height}`)) changed.push(cfg);
    else skipped.push(cfg);
  }
  return { changed, skipped };
}

/**
 * Windowed mode, in every profile the user has.
 *
 * EVERY profile, because the panel cannot know which one will be played, and a
 * borderless window that appears for one profile and not another is a bug
 * report nobody can reproduce. It is the same setting the game's own options
 * screen writes, so nothing here is a setting the game would not have made.
 *
 * A game that is RUNNING will overwrite this on exit from what it has in
 * memory. That is the game's file and its habit; the panel says so rather than
 * fighting it.
 */
export function setWindowed(profiles: string, on: boolean): WindowedResult {
  const changed: string[] = [];
  const skipped: string[] = [];
  for (const cfg of userConfigs(profiles)) {
    if (setVar(cfg, 'gfx_fullscreen', on ? '0' : '1')) changed.push(cfg);
    else skipped.push(cfg);
  }
  return { changed, skipped };
}
