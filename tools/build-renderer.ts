// Bundle the renderer (renderer/app.ts -> renderer/app.js) with esbuild.
//
//   node tools/build-renderer.ts [--watch]
//
// A script rather than a line of flags in package.json because two callers need
// the SAME build: `npm start` and the e2e suite's global setup, which must not
// let a test run against a stale bundle. Duplicating the flags is how those two
// drift apart.

import { build, context } from 'esbuild';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = join(import.meta.dirname, '..');

/** The one definition of how the renderer is built. */
export const options = {
  entryPoints: [join(root, 'renderer', 'app.ts')],
  bundle: true,
  format: 'esm' as const,
  target: 'chrome120',
  outfile: join(root, 'renderer', 'app.js'),
  sourcemap: true,
};

/** Build once. Throws if the bundle does not compile. */
export async function buildRenderer(): Promise<void> {
  await build(options);
}

// pathToFileURL, not string surgery: the repo lives under a path with spaces,
// and import.meta.url carries them as %20 while argv[1] has them literal — the
// old endsWith never matched, so `npm start` quietly ran a STALE bundle.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--watch')) {
    const ctx = await context(options);
    await ctx.watch();
    console.log('watching renderer/app.ts');
  } else {
    await buildRenderer();
    console.log('renderer/app.js built');
  }
}
