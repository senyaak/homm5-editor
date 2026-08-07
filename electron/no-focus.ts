// Come up out of the way, when the suite asks for it.
//
// A test run launches the editor dozens of times, and every launch used to take
// the foreground — over whatever the person at the keyboard was doing, and over
// a fullscreen game in the worst case, which not-focusing alone does not fix. So
// with `HOMM5_NO_FOCUS=1` the window is shown INACTIVE and parked off the
// desktop: it still exists, still lays out and still draws, it is simply nowhere
// anyone is looking.
//
// IT HAS TO KEEP DRAWING. The specs read the canvas back and time the frame
// loop, and Chromium throttles a window it believes nobody can see — which is
// why the two switches this leans on are already in place for their own reasons:
// `backgroundThrottling: false` on the window, and the occlusion calculation
// disabled in main. Parking it does not add a third thing to remember.
//
// Off by default and set by e2e/launch.ts, so nothing about a real run changes:
// without the variable this file's only effect is the `show()` it would have
// done anyway.

import type { BrowserWindow } from 'electron';

/** Whether the suite asked for a window nobody has to look at. */
export const NO_FOCUS = process.env.HOMM5_NO_FOCUS === '1';

/**
 * Far enough off any real desktop that no arrangement of monitors reaches it,
 * and not so far that the window manager refuses the move.
 */
const PARKED: [number, number] = [-4000, -4000];

/** Show a window: normally, or where nobody is looking. */
export function showQuietly(win: BrowserWindow): void {
  if (!NO_FOCUS) { win.show(); return; }
  win.setPosition(...PARKED);
  win.showInactive();
}
