// Serves renderer/ over HTTP so the harness page can run.
//
// A file:// page cannot load an ES module, and the preview pane renders local
// files as static snapshots, so the harness needs a real origin. Node's own
// http module is enough — no dependency for something this small.

import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'renderer');
const PORT = Number(process.env.PORT) || 8123;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
};

createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  // normalize() collapses `..`, and the prefix check keeps a crafted path from
  // reaching outside renderer/ — this serves a directory, not the whole disk.
  const rel = normalize(decodeURIComponent(url === '/' ? '/harness.html' : url));
  const file = join(ROOT, rel);
  if (!file.startsWith(ROOT) || !existsSync(file)) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
    return;
  }
  res.writeHead(200, {
    'content-type': TYPES[extname(file)] || 'application/octet-stream',
    'cache-control': 'no-store', // the harness is rebuilt constantly
  });
  res.end(readFileSync(file));
}).listen(PORT, () => console.log(`harness on http://localhost:${PORT}/harness.html`));
