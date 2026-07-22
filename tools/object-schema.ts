// What every object type actually carries, measured across the shipped maps.
//
// The property panel needs to know more than "this object has a field called
// Mood": it needs to know that Mood is one of a short list of values, that
// Amount is a number, that AvailableResources is a structure and not a string.
// None of that is written down anywhere in the game's data — but all of it is
// observable, because 109 shipped maps contain tens of thousands of correct
// examples.
//
// So the schema is measured, not hand-written. A hand-written table would be 21
// types of guesswork that goes stale; this re-derives itself from whatever
// installation is present, and says how sure it is by reporting how many
// examples each field was seen in.
//
//   node tools/object-schema.ts [dataRoot] [--md] [--type=AdvMapMonster]
//                               [--paks=<dir>] [--only-shipped]
//
// Default output is a summary; --md emits docs/OBJECT_FIELDS.md.
//
// --paks reads maps straight out of .pak/.h5u archives, without unpacking them.
// That matters for evidence: the All_campaigns mod carries the 15 original
// HoMM5 campaign maps, which the extracted sample set does not have at all, and
// they are a DIFFERENT game version — exactly where a field set is most likely
// to differ. Nothing is copied to disk, so nothing copyrighted lands in the
// repo; point it at the game folder and it reads what is installed.

import { readFileSync, readdirSync, statSync, existsSync, openSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { loadMap } from '../src/map.ts';
import { children, text } from '../src/xml.ts';
import { readEntries, readIndex } from '../src/pak.ts';

const args = process.argv.slice(2);
const root = args.find((a) => !a.startsWith('--')) ?? 'data-unpacked';
const asMarkdown = args.includes('--md');
const onlyType = /^--type=(\w+)$/.exec(args.find((a) => a.startsWith('--type=')) ?? '')?.[1];

/** Every map.xdb under the data root. */
function mapFiles(dir: string, out: string[] = []): string[] {
  let ents: string[];
  try { ents = readdirSync(dir); } catch { return out; }
  for (const e of ents) {
    const full = join(dir, e);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) mapFiles(full, out);
    else if (e === 'map.xdb') out.push(full);
  }
  return out;
}

/** What a field looks like across every example of it. */
interface FieldStat {
  /** How many objects carried it. */
  seen: number;
  /** Distinct values, capped — an enum has few, a name has thousands. */
  values: Map<string, number>;
  /** True where the field was ever seen holding elements rather than text. */
  container: boolean;
  /** True where the field was ever seen carrying an href. */
  href: boolean;
}

const types = new Map<string, Map<string, FieldStat>>();
/** Beyond this a field is free text, not an enum, and the values stop mattering. */
const VALUE_CAP = 40;

function stat(type: string, field: string): FieldStat {
  let fields = types.get(type);
  if (!fields) { fields = new Map(); types.set(type, fields); }
  let s = fields.get(field);
  if (!s) { s = { seen: 0, values: new Map(), container: false, href: false }; fields.set(field, s); }
  return s;
}

/** Every map.xdb inside the archives under `dir`, as { where, xml }. */
function mapsInPaks(dir: string): { where: string; xml: string }[] {
  const out: { where: string; xml: string }[] = [];
  let ents: string[];
  try { ents = readdirSync(dir); } catch { return out; }
  for (const e of ents) {
    if (!/\.(pak|h5u|h5m|h5c)$/i.test(e)) continue;
    const full = join(dir, e);
    try {
      for (const entry of readEntries(readFileSync(full))) {
        if (!/(^|\/)map\.xdb$/i.test(entry.name)) continue;
        out.push({ where: `${e}:${entry.name}`, xml: entry.data.toString('latin1') });
      }
    } catch { /* an archive we cannot read is not a reason to stop */ }
  }
  return out;
}

/**
 * The map paths the game's archives carry, read from their indexes.
 *
 * The unpacked tree is a WORKING folder: the editor creates maps in it and
 * unpacks archives there, so "every map.xdb under the data root" quietly grows
 * to include our own output — and a document headed "measured across the
 * shipped maps" would then be measuring us. That happened: a hand-made test map
 * and an RMG probe had joined the count.
 *
 * Two filters were tried and rejected as defaults:
 *
 *   * "skip folders carrying our project.json" — wrong, because opening a map
 *     is what writes that file, and eight SHIPPED maps have one.
 *   * membership in an archive, on by default — wrong here for a different
 *     reason: in this install only 43 of the 126 unpacked maps are in any
 *     `.pak`/`.h5u`. The combat arenas, campaign and single missions came from
 *     somewhere no longer present. Filtering on it discards real evidence.
 *
 * So it is `--only-shipped`, opt-in, for when the tree's provenance is in
 * doubt: it says how many it dropped, and the count in the generated document
 * says what the measurement actually covered.
 */
function shippedMapPaths(dir: string): Set<string> | null {
  let ents: string[];
  try { ents = readdirSync(dir); } catch { return null; }
  const paks = ents.filter((e) => /\.(pak|h5u|h5c)$/i.test(e));
  if (!paks.length) return null;
  const out = new Set<string>();
  for (const e of paks) {
    const fd = openSync(join(dir, e), 'r');
    try {
      for (const entry of readIndex(fd, statSync(join(dir, e)).size)) {
        if (/(^|\/)map\.xdb$/i.test(entry.name)) out.add(entry.name.replace(/\\/g, '/').toLowerCase());
      }
    } catch { /* an unreadable archive is not a reason to stop */ } finally { closeSync(fd); }
  }
  return out.size ? out : null;
}

// The game install is the folder above the editor, unless told otherwise.
const onlyShipped = args.includes('--only-shipped');
const paksDir = process.env.HOMM5_PAKS
  || (args.find((a) => a.startsWith('--paks='))?.slice('--paks='.length) ?? join(import.meta.dirname, '..', '..', 'data'));
const shipped = onlyShipped ? shippedMapPaths(paksDir) : null;

const sources: { where: string; xml: string }[] = [];
let skipped = 0;
for (const f of mapFiles(join(root, 'Maps'))) {
  if (shipped) {
    const rel = f.slice(root.length + 1).replace(/\\/g, '/').toLowerCase();
    if (!shipped.has(rel)) { skipped++; continue; }
  }
  try { sources.push({ where: f, xml: readFileSync(f, 'latin1') }); } catch { /* skip */ }
}
if (skipped) console.error(`skipped ${skipped} map(s) under ${root} that no .pak carries — not shipped content`);
for (const a of args.filter((x) => x.startsWith('--paks='))) {
  sources.push(...mapsInPaks(a.slice('--paks='.length)));
}

const files = sources;
for (const src of sources) {
  const xml = src.xml;
  let map;
  // A map that will not parse is one map's worth of missing evidence, not a
  // reason to abandon the scan.
  try { map = loadMap(xml); } catch { continue; }
  for (const obj of map.objects) {
    if (onlyType && obj.type !== onlyType) continue;
    // DIRECT children only: the <x> inside <Pos> is not a field of the object.
    // Walking the parsed tree rather than matching tags is what makes that
    // reliable — a regex has to track nesting and gets it wrong on the first
    // object whose body contains another object's tag name.
    for (const c of children(obj.el)) {
      const st = stat(obj.type, c.name);
      st.seen++;
      if (c.attrs.href !== undefined) st.href = true;
      if (children(c).length) st.container = true;
      else if (st.values.size <= VALUE_CAP) {
        const v = text(c);
        st.values.set(v, (st.values.get(v) ?? 0) + 1);
      }
    }
  }
}

/** Enum, number, bool or free text, decided by the values seen. */
function kindOf(s: FieldStat): string {
  if (s.container) return 'structure';
  if (s.href) return 'reference';
  const vals = [...s.values.keys()].filter((v) => v !== '');
  if (!vals.length) return 'empty';
  if (vals.every((v) => v === 'true' || v === 'false')) return 'bool';
  if (vals.every((v) => /^-?\d+(\.\d+)?$/.test(v))) return 'number';
  if (s.values.size <= VALUE_CAP && vals.every((v) => /^[A-Z][A-Z0-9_]{2,}$/.test(v))) return 'enum';
  return 'text';
}

const sorted = [...types].sort((a, b) => b[1].size - a[1].size);

if (asMarkdown) {
  const out: string[] = [
    '# Object fields, measured',
    '',
    `Generated by \`node tools/object-schema.ts --md\` from ${files.length} shipped maps.`,
    'Do not edit by hand — re-run it instead.',
    '',
    'Kinds are inferred from the values seen: `enum` is a short closed set and is',
    'listed in full, `structure` has element children, `reference` carries an href.',
    '',
    // The caveats live here, not in the .md: the file says "do not edit by hand"
    // and a regeneration would silently drop anything added there.
    '**The enum lists are a lower bound, not the legal set**, and more maps do not',
    'fix it. The sample grew three ways — the 15 original-campaign maps from the',
    "All_campaigns mod, the maps inside the game's own paks, and two 320x320 maps",
    'from the random generator, which places objects designers never chose. That',
    'took the monster sample from 3247 to 6377 and produced **not one new enum**',
    '**value**.',
    '',
    '**Where the real lists are.** That caveat used to end with "those would have',
    "to come from the game's own definitions\". They exist: `data/types.xml`",
    'declares 97 enum types with all their members, and an object\'s enum field',
    'points at one — see `docs/TYPE_SPEC.md`. `AttackType` is `ATTACK_ANY` on all',
    '6377 monsters ever shipped; the type also has `ATTACK_RANGE` and',
    '`ATTACK_MELEE`. Treat the lists below as what designers used, and the spec as',
    'what is legal.',
    '',
    '**Field sets vary within a type.** `DoesNotDependOnDifficulty` is missing from',
    'the oldest monsters, which predate it. A new object is still built by cloning',
    'a real one (`src/donors.ts`) — a donor carries the file\'s own formatting and',
    'is correct by construction — but a field the donor predates is now added back',
    'from the spec, in the position the spec puts it. See `docs/TYPE_SPEC.md`.',
    '',
  ];
  for (const [type, fields] of sorted) {
    out.push(`## ${type}`, '');
    out.push('| field | kind | seen | values |', '| --- | --- | --- | --- |');
    for (const [name, s] of [...fields].sort((a, b) => b[1].seen - a[1].seen)) {
      const kind = kindOf(s);
      const vals = kind === 'enum'
        ? [...s.values.keys()].filter(Boolean).sort().join(', ')
        : kind === 'number' || kind === 'bool'
          ? `${s.values.size} distinct`
          : '';
      out.push(`| \`${name}\` | ${kind} | ${s.seen} | ${vals} |`);
    }
    out.push('');
  }
  process.stdout.write(out.join('\n'));
} else {
  console.log(`maps scanned: ${files.length}`);
  console.log(`object types: ${types.size}`);
  for (const [type, fields] of sorted) {
    const enums = [...fields].filter(([, s]) => kindOf(s) === 'enum').length;
    const structs = [...fields].filter(([, s]) => kindOf(s) === 'structure').length;
    console.log(`  ${type.padEnd(22)} fields=${String(fields.size).padStart(3)}  enums=${enums}  structures=${structs}`);
  }
  if (onlyType) {
    const fields = types.get(onlyType);
    if (fields) {
      console.log(`\n${onlyType}:`);
      for (const [name, s] of [...fields].sort((a, b) => b[1].seen - a[1].seen)) {
        const k = kindOf(s);
        const vals = k === 'enum' ? '  ' + [...s.values.keys()].filter(Boolean).sort().join(', ') : '';
        console.log(`  ${name.padEnd(22)} ${k.padEnd(10)} seen=${String(s.seen).padStart(6)}${vals}`);
      }
    }
  }
}

if (!existsSync(join(root, 'Maps'))) {
  console.error(`no Maps folder under ${root} — nothing to measure`);
  process.exit(1);
}
