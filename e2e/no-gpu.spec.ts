// The machine with no 3D: does the editor say so, or just sit there?
//
// A user reported "I press the buttons and nothing happens", with a map list
// stuck on "loading…". The cause was three.js failing to create a WebGL context
// at the top level of the renderer bundle, which stops the module — so the
// toolbar and the picker stayed on screen as static markup, wired to nothing,
// and the app never said a word. Reproduced here by denying Chromium both the
// GPU and its software fallback, which is as close to that machine as this one
// gets. The editor cannot work without a 3D context; it can explain itself.

import { test, expect } from '@playwright/test';
import { launchEditor } from './launch.ts';

test('explains itself when the machine has no WebGL', { tag: '@nodata' }, async () => {
  // --disable-gpu alone is not enough: Chromium falls back to SwiftShader and
  // WebGL still works, which is the fallback the second switch removes.
  const ed = await launchEditor({}, ['--disable-gpu', '--disable-software-rasterizer']);
  try {
    const fatal = ed.page.locator('#fatal');
    await expect(fatal).toBeVisible();
    // Name the cause and offer the repair — a stack trace alone leaves the person
    // who needs this no better off than the silence did. The repair is a button
    // because the affected machines run a packaged build, started by
    // double-clicking it, with no command line to pass a switch on.
    await expect(fatal).toContainText('WebGL');
    await expect(fatal.locator('#fatal-soft')).toBeVisible();
    // Deliberately not clicked: it writes softwareRendering into the settings
    // file, which dev and packaged builds share, and would leave this machine's
    // editor rendering in software long after the test ended.
    // The diagnostics block, filled from the main process: which GPU features
    // Chromium turned off on this machine. Without it, "no WebGL" has a dozen
    // indistinguishable causes.
    await expect(fatal.locator('pre')).toContainText(/disabled GPU features|GPU features/);
    // And this is the wreckage the smoke test now looks for. Asserted here
    // rather than trusted, because a guard nobody has seen fail is a guard that
    // might be checking nothing: these two are false exactly when the renderer
    // died, and true in every healthy launch.
    expect(ed.errors.join('\n')).toContain('WebGL');
    expect(await ed.page.evaluate(() => window.__booted === true)).toBe(false);
  } finally {
    await ed.app.close();
  }
});
