// Read the original editor's defaults for a freshly placed object.
//
// The way to learn what a new object should look like is not to reason about
// it: place one in the original editor, save, and read what it wrote. Objects
// dropped and left alone are byte-identical apart from Pos/Rot/Shared, so a
// type whose bodies collapse to ONE variant is a default template — that is
// the signal to look for in the output. Two variants mean something was edited
// afterwards (or the placements genuinely differ), and the diff says what.
//
//   npm run object-defaults -- <map.xdb|map.h5m> [Type …]
//
// With no types, every type on the map is summarised. See docs/OBJECT_DEFAULTS.md
// for what this produced, and MAP_PROPERTIES.md for the map-level equivalent.

import { readFileSync } from 'node:fs';
import { readEntries } from '../src/pak.ts';
import { pickMapRel } from '../src/project.ts';

function loadMapXdb(path: string): string {
  if (/\.xdb$/i.test(path)) return readFileSync(path, 'utf8');
  const entries = readEntries(readFileSync(path));
  // Not just any map.xdb: an archive can hold the builder's template too.
  const rel = pickMapRel(entries.map((e) => e.name));
  const entry = rel ? entries.find((e) => e.name === rel) : undefined;
  if (!entry) throw new Error(`${path} holds no map.xdb`);
  return entry.data.toString('utf8');
}

/** Bodies of every <Type>…</Type> in the document, outermost first. */
function bodiesOf(xml: string, type: string): string[] {
  return [...xml.matchAll(new RegExp(`<${type}>([\\s\\S]*?)</${type}>`, 'g'))].map((m) => m[1]!);
}

/** What makes one placement differ from another rather than one default differ. */
function normalise(body: string): string {
  return body
    .replace(/<Pos>[\s\S]*?<\/Pos>/, '<Pos/>')
    .replace(/<Rot>[^<]*<\/Rot>/, '<Rot/>')
    .replace(/<Shared href="[^"]*"\/>/, '<Shared/>')
    .replace(/\r?\n\s*/g, '\n')
    .trim();
}

const [path, ...wanted] = process.argv.slice(2);
if (!path) {
  console.error('usage: npm run object-defaults -- <map.xdb|map.h5m> [Type …]');
  process.exit(2);
}

const xml = loadMapXdb(path);
const types = wanted.length
  ? wanted
  : [...new Set([...xml.matchAll(/href="#n:inline\(([A-Za-z]+)\)"/g)].map((m) => m[1]!))].sort();

for (const type of types) {
  const bodies = bodiesOf(xml, type);
  const variants = new Map<string, number>();
  for (const b of bodies) {
    const k = normalise(b);
    variants.set(k, (variants.get(k) ?? 0) + 1);
  }
  console.log(`\n### ${type} — ${bodies.length} placed, ${variants.size} distinct`);
  if (variants.size === 1) console.log('(one variant: this is the untouched default)');
  let n = 0;
  for (const [body, count] of variants) {
    console.log(`\n--- variant ${++n} (x${count}) ---\n${body}`);
  }
}
