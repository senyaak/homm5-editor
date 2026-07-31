// Bundle the whole editor into build/ — the tree that gets packaged into an exe.
//
//   node tools/build-app.ts
//
// Running from the repo, Electron reads electron/main.ts straight off disk and
// Node strips the types. A packaged app cannot rely on that: the entry point
// has to be plain JavaScript, and everything it imports (../src, three, the
// schemas) has to come with it, because node_modules is not shipped.
//
// The layout deliberately mirrors the repo — main.js at the root with electron/
// and renderer/ beside it — so every path the app builds at runtime is the same
// string in both worlds (see electron/paths.ts).

import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildRenderer } from './build-renderer.ts';

const root = join(import.meta.dirname, '..');
const out = join(root, 'build');

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  name: string; version: string; description: string;
};

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'electron'), { recursive: true });
mkdirSync(join(out, 'renderer'), { recursive: true });

// The renderer first: its bundle is an input to this one, not a step beside it.
await buildRenderer();

await build({
  entryPoints: [join(root, 'electron', 'main.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  // Electron 43 runs Node 22; nothing here needs newer syntax lowered.
  target: 'node22',
  // Provided by the runtime, not by us. Node's own builtins are external by
  // virtue of platform: 'node'.
  external: ['electron'],
  outfile: join(out, 'main.js'),
  sourcemap: true,
});

// The preloads stay as they are: Electron's preload loader takes plain CommonJS
// and does not strip types, which is why they are .cjs in the first place.
for (const f of ['preload.cjs', 'setup-preload.cjs']) {
  cpSync(join(root, 'electron', f), join(out, 'electron', f));
}

// The UI: two entry pages and the renderer bundle. index.html is the ASSEMBLED
// page (buildRenderer wrote it above from renderer/page.html and parts/), so
// the parts themselves do not ship — but the stylesheets it links do. The
// dev-only pages (harness, scene-view, terrain-view) are not part of the app.
for (const f of ['index.html', 'setup.html', 'app.js', 'app.js.map', 'style']) {
  cpSync(join(root, 'renderer', f), join(out, 'renderer', f), { recursive: true });
}

// The manifest Electron reads on startup. `type: module` because main.js is
// ESM; the name matches the repo's so the packaged app and a dev run share one
// settings file, which makes the packaged build testable without re-answering
// setup.
writeFileSync(join(out, 'package.json'), `${JSON.stringify({
  name: pkg.name,
  version: pkg.version,
  description: pkg.description,
  type: 'module',
  main: 'main.js',
}, null, 2)}\n`);

console.log(`built ${out}`);
