// DOES THIS FIELD DO ANYTHING? — asked of the engine, not of the listing.
//
// The static sweep (`tools/reverse/struct-use.ts`) says which fields of a
// structure some instruction reads. That is a claim about the code, and a claim
// about the code is worth exactly one experiment: change the field, order the
// same map again, and see whether anything moved. A field the sweep calls
// unread must produce a map identical to the baseline; a field it calls read
// must produce a different one, and if it does not, either the sweep is wrong
// or this instrument is blind — which is what `--control` is for.
//
//   node tools/rmg-field-probe.ts --game <dir> --field TransitiveTileIntensity=250
//   node tools/rmg-field-probe.ts --game <dir> --unread            the params verdicts
//   node tools/rmg-field-probe.ts --game <dir> --control           the params controls
//   node tools/rmg-field-probe.ts --game <dir> --template --unread    the template's
//   node tools/rmg-field-probe.ts --game <dir> --template --control
//
// HOW IT ASKS. A LOOSE file under `<game>/data/` wins over the copy inside
// `data.pak` — measured, not assumed: the first run with `Mine1LevelMaxRadius`
// cut from 20 to 8 moved a mine from x=32 to x=18 and repainted 23,640 bytes of
// terrain. The parameters are probed in place, at `data/RMG/Params/Default.xdb`;
// a TEMPLATE is copied to `data/RMGProbe/Probe.xdb` first and ordered from
// there, so the game's own `RMG/Templates` — which the native generator lists —
// is never touched.
//
// ONE ORDER PER LAUNCH, and that is not a preference. A launch's SECOND order
// does not repeat its first: two identical orders in one process came out with
// different statics, so something survives between generations inside the
// executable. One order per launch IS reproducible — twice over, the whole
// output matched except the `RMGguid`, drawn fresh every time, and ONE byte of
// GroundTerrain.bin, the uninitialised one the port already knows about. Both
// are subtracted below; anything else is the field's doing.

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { dataDir, gameDir } from './game-dir.ts';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name: string): boolean => args.includes(`--${name}`);

const game = gameDir();
const bin = join(game, 'bin');
const editor = join(bin, 'H5_MapEditor_H5E.exe');
const orders = join(bin, 'homm5-editor-rmg-orders.txt');
const runs = join(bin, 'rmg-runs');

const onTemplate = has('template');
const onPreset = has('preset');
/** The template a `--template` run varies; the reference run's own by default. */
const templateName = flag('template-name') ?? 'S1P2Z2M1';

// THE PRESET TABLE IS PROBED IN PLACE, unlike a template: it is one document
// the generator looks up by race, not a file named in the order, so there is
// nowhere else to put it. Its fields also repeat once per race, which is why
// `--preset` replaces EVERY occurrence — the question is whether the field does
// anything at all, and asking it of all nine races at once is the loudest way
// to ask.
const stock = onPreset
  ? join(dataDir(), 'GameMechanics', 'RefTables', 'RMGPresetTable.xdb')
  : onTemplate
    ? join(dataDir(), 'RMG', 'Templates', `${templateName}.xdb`)
    : join(dataDir(), 'RMG', 'Params', 'Default.xdb');
const loose = onPreset
  ? join(game, 'data', 'GameMechanics', 'RefTables', 'RMGPresetTable.xdb')
  : onTemplate
    ? join(game, 'data', 'RMGProbe', 'Probe.xdb')
    : join(game, 'data', 'RMG', 'Params', 'Default.xdb');

const ORDER = flag('order')
  ?? `${onTemplate ? 'RMGProbe/Probe.xdb' : 'RMG/Templates/S1P2Z2M1.xdb'} -seed 1785351845 -size 1`;

/**
 * The sweep's verdicts as at 03.09.2026 — the fields nothing was found to read.
 * Each is given a value far from the shipped one, so a field that does anything
 * at all has every chance to show it.
 */
const UNREAD_PARAMS: Array<[string, string]> = [
  ['RMGVersion', '99'],
  ['TeleportMinBorderDistance', '9'],
  ['TeleportMaxBorderDistance', '30'],
  ['DistBetweenLakes', '40'],
  ['CreatureMinStackAmount', '40'],
  ['CreatureMaxStackAmount', '9'],
  ['MinDistanceBetweenBigObjects', '2'],
  ['MinDistanceBetweenTreasureBlocks', '25'],
  ['TransitiveTileIntensity', '250'],
  ['ShipyardGuardsLevelCoef', '40'],
  ['MinDist', '40'],
];

/** Fields the sweep says ARE read: if one of these does nothing, believe nothing. */
const CONTROL_PARAMS: Array<[string, string]> = [
  ['Mine1LevelMaxRadius', '8'],
  ['DistBetweenTreasureBlocks', '20'],
  ['JunctionMinBorderDistance', '15'],
];

/**
 * The template's dead fields. The first two are the document's own — parsed,
 * defaulted, copied between objects, branched on by nothing in either
 * executable. The next two are zone fields the observatory step is handed the
 * address of and never looks at. `BuffPoints` is the odd one out and the reason
 * READ and CONSUMED are not the same word: the driver does read it and passes
 * it to a worker whose entire body is `ret 4`.
 *
 * `CanBeWater` belongs on this list by the sweep and is NOT on it, because the
 * console command has no water switch: on a dry map the field could not matter
 * either way, so a "no change" here would prove nothing.
 */
const UNREAD_TEMPLATE: Array<[string, string]> = [
  ['GraalOnMap', 'true'],
  ['Underground', 'true'],
  ['DenOfThieves', '9'],
  ['RedwoodObservatoryDensity', '400'],
  ['BuffPoints', '400'],
];

/**
 * The template's controls. The first tag wins, and for a per-zone field that
 * means ZONE 0 — which is enough to move the map, and is the point.
 */
const CONTROL_TEMPLATE: Array<[string, string]> = [
  ['TreasureDensity', '400'],
  ['Prisons', '4'],
];

/**
 * The preset table's suspected dead numbers. The two road strengths are the
 * claim this was written to settle: the road painter puts the literal 255 at a
 * tile's four corners, and the 100 beside each road tile in the data was said
 * to be unread on the strength of that one function.
 */
const UNREAD_PRESET: Array<[string, string]> = [
  ['RoadTileStrenght', '20'],
  ['SecondaryRoadTileStrenght', '20'],
  ['WaterTileStrenght', '20'],
  ['WaterBottomTileStrenght', '20'],
  ['GuardStrenght', '9'],
];

/** Preset controls: numbers in the same document that must move the map. */
const CONTROL_PRESET: Array<[string, string]> = [
  ['SetProbability', '100'],
  ['ConcurentProbability', '100'],
  ['BorderWidth', '6'],
];

interface Snapshot { files: Map<string, Buffer> }

function snapshot(dir: string): Snapshot {
  const files = new Map<string, Buffer>();
  const walk = (at: string): void => {
    for (const e of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, e.name);
      if (e.isDirectory()) walk(path);
      else files.set(relative(dir, path).replace(/\\/g, '/'), readFileSync(path));
    }
  };
  walk(dir);
  return { files };
}

/** What changed between two runs, with the two known nuisances taken out. */
function differences(a: Snapshot, b: Snapshot): string[] {
  const out: string[] = [];
  for (const [name, left] of a.files) {
    const right = b.files.get(name);
    if (!right) { out.push(`${name} — gone`); continue; }
    if (name.endsWith('.xdb') || name.endsWith('.txt')) {
      const strip = (buf: Buffer): string => buf.toString('latin1').replace(/<RMGguid>[^<]*<\/RMGguid>/g, '');
      if (strip(left) !== strip(right)) out.push(`${name} — differs`);
      continue;
    }
    if (left.length !== right.length) { out.push(`${name} — ${left.length} vs ${right.length} bytes`); continue; }
    let bytes = 0;
    for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) bytes++;
    if (bytes > 1) out.push(`${name} — ${bytes} bytes differ`);
  }
  for (const name of b.files.keys()) if (!a.files.has(name)) out.push(`${name} — new`);
  return out;
}

/** One launch, one order, the kept output. */
function generate(): Snapshot {
  rmSync(runs, { recursive: true, force: true });
  writeFileSync(orders, `# written by tools/rmg-field-probe.ts\n${ORDER}\n`, 'latin1');
  execFileSync(editor, ['--rmg'], { cwd: bin, stdio: 'ignore' });
  const one = join(runs, '1');
  if (!existsSync(one)) throw new Error('the batch kept nothing — read bin/homm5-editor-rmg.log');
  return snapshot(one);
}

/**
 * The stock file with one field changed — the FIRST occurrence, or every one
 * of them in the preset table, where a field repeats per race.
 */
function withField(field: string, value: string): string {
  const xml = readFileSync(stock, 'utf8');
  const tag = new RegExp(`<${field}>[^<]*</${field}>`, onPreset ? 'g' : '');
  if (!new RegExp(`<${field}>`).test(xml)) throw new Error(`${stock} has no <${field}>`);
  return xml.replace(tag, `<${field}>${value}</${field}>`);
}

const wanted: Array<[string, string]> = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] !== '--field') continue;
  const [name, value] = (args[i + 1] ?? '').split('=');
  if (!name || value === undefined) { console.error('--field Name=value'); process.exit(2); }
  wanted.push([name, value]);
}
if (has('unread')) wanted.push(...(onPreset ? UNREAD_PRESET : onTemplate ? UNREAD_TEMPLATE : UNREAD_PARAMS));
if (has('control')) wanted.push(...(onPreset ? CONTROL_PRESET : onTemplate ? CONTROL_TEMPLATE : CONTROL_PARAMS));
if (!wanted.length) {
  console.error('say what to probe: --field Name=value, --unread, --control (add --template for a template)');
  process.exit(2);
}

mkdirSync(join(loose, '..'), { recursive: true });

console.log(`${onPreset ? 'preset table' : onTemplate ? 'template' : 'parameters'}: ${stock}`);
console.log(`order: ${ORDER}`);
console.log('baseline…');
cpSync(stock, loose);
const baseline = generate();

const verdicts: Array<[string, string, string[]]> = [];
for (const [field, value] of wanted) {
  process.stdout.write(`${field} = ${value} … `);
  writeFileSync(loose, withField(field, value), 'utf8');
  const changed = differences(baseline, generate());
  verdicts.push([field, value, changed]);
  console.log(changed.length ? `CHANGED (${changed.join('; ')})` : 'no change');
}

// LEAVE THE INSTALL AS IT WAS FOUND. The loose file is the whole of what this
// touches, and a stray modified one would quietly change every later run.
rmSync(loose, { force: true });

console.log('\n--- verdicts ---');
for (const [field, value, changed] of verdicts) {
  console.log(`${changed.length ? 'READ    ' : 'INERT   '} ${field} = ${value}`);
}
console.log(`\n${loose} has been removed again`);
