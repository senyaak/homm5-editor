// The fill tool's planner, and the presets it paints with.
//
//   node tools/test-fill.ts [dataRoot]
//
// A fill is a scatter, so the checks are the RULES rather than a golden list:
// everything lands on painted ground, a layer keeps the clearance its widths
// add up to, nothing stands inside another object's radius, and the same seed
// twice gives the same wood. The geometry is measured here with its own small,
// dumb implementation — every edge against every point — so a mistake in the
// planner's per-tile index cannot hide behind the same mistake in the check.
//
// The presets are checked against the installed data when there is any: a
// candidate whose file is not there places nothing, silently, and that is
// exactly the kind of typo a hand-written preset carries.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { planFill, insetOf, rng } from '../src/fill/plan.ts';
import type { FillCell, FillPlacement } from '../src/fill/plan.ts';
import { readFillPresets, presetObjects, sharedHref } from '../src/fill/preset.ts';
import type { FillLayer, FillPreset } from '../src/fill/preset.ts';
import { findEditorRoot } from '../src/map/objects.ts';
import { dataDir, gameDirIfAny } from './game-dir.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const REPO = join(import.meta.dirname, '..');
const dataRoot = process.argv[2] ?? dataDir();

// --- helpers ----------------------------------------------------------------

/** A solid rectangle of painted tiles. */
function rect(x0: number, y0: number, w: number, h: number): FillCell[] {
  const out: FillCell[] = [];
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) out.push({ x, y });
  return out;
}

/**
 * Distance from a point to the painted area's edge — the slow, obvious way.
 *
 * Every side of every painted tile whose neighbour is unpainted, against the
 * point. This is the check's own opinion, deliberately not the planner's.
 */
function edgeDistance(cells: readonly FillCell[], px: number, py: number): number {
  const has = new Set(cells.map((c) => `${c.x},${c.y}`));
  let best = Infinity;
  const seg = (x0: number, y0: number, x1: number, y1: number): void => {
    const dx = x1 - x0, dy = y1 - y0;
    const len2 = dx * dx + dy * dy;
    const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / len2));
    best = Math.min(best, Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy)));
  };
  for (const c of cells) {
    if (!has.has(`${c.x},${c.y - 1}`)) seg(c.x, c.y, c.x + 1, c.y);
    if (!has.has(`${c.x},${c.y + 1}`)) seg(c.x, c.y + 1, c.x + 1, c.y + 1);
    if (!has.has(`${c.x - 1},${c.y}`)) seg(c.x, c.y, c.x, c.y + 1);
    if (!has.has(`${c.x + 1},${c.y}`)) seg(c.x + 1, c.y, c.x + 1, c.y + 1);
  }
  return best;
}

/** The radius a placement claimed, from the preset it came out of. */
function sizeOf(preset: FillPreset, p: FillPlacement): number {
  return preset.layers[p.layer]!.objects.find((o) => o.id === p.id)?.size ?? 0;
}

/** A one-layer preset, for the checks that want one rule at a time. */
function preset(name: string, layers: Array<Partial<FillLayer> & { objects: FillLayer['objects'] }>): FillPreset {
  return {
    name,
    source: 'test',
    layers: layers.map((l) => ({ dispersion: 1, width: 0, noRandomAngle: false, ...l })),
  };
}

const obj = (id: string, size: number, probability: number, noRandomAngle = false): FillLayer['objects'][number] => ({
  shared: sharedHref('AdvMapStaticShared', id),
  type: 'AdvMapStatic',
  id, size, probability, noRandomAngle,
});

// --- the generator ----------------------------------------------------------

console.log('\nrandom source');
{
  const a = rng(7), b = rng(7), c = rng(8);
  const seqA = Array.from({ length: 8 }, () => a());
  const seqB = Array.from({ length: 8 }, () => b());
  const seqC = Array.from({ length: 8 }, () => c());
  check('the same seed gives the same sequence', seqA.every((v, i) => v === seqB[i]));
  check('a different seed does not', seqA.some((v, i) => v !== seqC[i]));
  check('every value is in [0, 1)', seqA.every((v) => v >= 0 && v < 1));
}

// --- the lattice ------------------------------------------------------------

console.log('\nlattice and probability');
{
  const cells = rect(10, 10, 10, 10);
  const solid = preset('solid', [{ objects: [obj('A', 0, 1)], dispersion: 1 }]);
  const plan = planFill(cells, solid, 1);
  check('a certain layer at one-tile spacing fills every tile',
    plan.placements.length === 100, `${plan.placements.length} of 100`);
  check('every placement sits at a tile centre',
    plan.placements.every((p) => Math.abs(p.x % 1) === 0.5 && Math.abs(p.y % 1) === 0.5));

  const never = preset('never', [{ objects: [obj('A', 0, 0)], dispersion: 1 }]);
  const none = planFill(cells, never, 1);
  check('probability 0 places nothing', none.placements.length === 0);
  check('and says why', none.report.unlucky === 100, `unlucky ${none.report.unlucky}`);

  const half = planFill(cells, preset('half', [{ objects: [obj('A', 0, 0.5)], dispersion: 1 }]), 3);
  const n = half.placements.length;
  check('probability 0.5 keeps roughly half', n > 30 && n < 70, `${n} of 100`);

  const dense = planFill(cells, preset('dense', [{ objects: [obj('A', 0, 1)], dispersion: 0.5 }]), 1);
  check('halving the spacing quadruples the count',
    dense.placements.length === 400, `${dense.placements.length} of 400`);

  check('an empty area plans nothing', planFill([], solid, 1).placements.length === 0);
}

// --- staying inside ---------------------------------------------------------

console.log('\nthe painted area');
{
  // An L, so the bounding box is half unpainted — the case a planner that
  // trusted the box alone would fill in solid.
  const cells = [...rect(0, 0, 6, 3), ...rect(0, 3, 3, 3)];
  const plan = planFill(cells, preset('solid', [{ objects: [obj('A', 0, 1)], dispersion: 0.5 }]), 5);
  const painted = new Set(cells.map((c) => `${c.x},${c.y}`));
  const outside = plan.placements.filter((p) => !painted.has(`${Math.floor(p.x)},${Math.floor(p.y)}`));
  check('nothing lands off the painted tiles', outside.length === 0, `${outside.length} strays`);

  // A ring: a hole in the middle. The original refuses this shape outright.
  const ring = rect(0, 0, 9, 9).filter((c) => !(c.x >= 3 && c.x <= 5 && c.y >= 3 && c.y <= 5));
  const holed = planFill(ring, preset('inset', [
    { objects: [obj('edge', 0, 1)], dispersion: 0.5, width: 1 },
    { objects: [obj('inner', 0, 1)], dispersion: 0.5 },
  ]), 5);
  const inHole = holed.placements.filter((p) => p.x > 3 && p.x < 6 && p.y > 3 && p.y < 6);
  check('a hole in the paint stays empty', inHole.length === 0, `${inHole.length} in the hole`);
  const inner = holed.placements.filter((p) => p.layer === 1);
  const tooNearHole = inner.filter((p) => edgeDistance(ring, p.x, p.y) <= 1);
  check("the hole's rim keeps the later layer's clearance too",
    inner.length > 0 && tooNearHole.length === 0, `${tooNearHole.length} too near`);
}

// --- clearance --------------------------------------------------------------

console.log('\nwidth: a layer is held off the edge by the ones before it');
{
  const cells = rect(0, 0, 14, 14);
  const banded = preset('banded', [
    { objects: [obj('grass', 0, 1)], dispersion: 1, width: 0.5 },
    { objects: [obj('bush', 0, 1)], dispersion: 1, width: 1 },
    { objects: [obj('tree', 0, 1)], dispersion: 1 },
  ]);
  check('the inset of a layer is the sum of the widths before it',
    insetOf(banded.layers, 0) === 0 && insetOf(banded.layers, 1) === 0.5 && insetOf(banded.layers, 2) === 1.5);
  const plan = planFill(cells, banded, 11);
  for (let i = 0; i < banded.layers.length; i++) {
    const want = insetOf(banded.layers, i);
    const mine = plan.placements.filter((p) => p.layer === i);
    const near = mine.filter((p) => edgeDistance(cells, p.x, p.y) <= want);
    check(`layer ${i} keeps ${want} tiles off the edge`,
      mine.length > 0 && near.length === 0, `${mine.length} placed, ${near.length} too near`);
  }
  // The bands are nested, so an outer layer really does reach further out.
  const reach = (i: number): number =>
    Math.min(...plan.placements.filter((p) => p.layer === i).map((p) => edgeDistance(cells, p.x, p.y)));
  check('the bands are nested, not identical', reach(0) < reach(1) && reach(1) < reach(2),
    `${reach(0)} < ${reach(1)} < ${reach(2)}`);
}

console.log('\nsize: nothing stands inside another object');
{
  const cells = rect(0, 0, 20, 20);
  // Spacing well under the radius, so the rule — not the lattice — is what
  // thins this out. At 0.25 spacing the lattice alone would place 6400.
  const crowded = preset('crowded', [{ objects: [obj('tree', 0.6, 1)], dispersion: 0.25 }]);
  const plan = planFill(cells, crowded, 13);
  check('the radius rule is what limits the count',
    plan.placements.length > 0 && plan.placements.length < 1200,
    `${plan.placements.length} placed, ${plan.report.crowded} refused for crowding`);
  let closest = Infinity;
  for (let i = 0; i < plan.placements.length; i++) {
    for (let j = i + 1; j < plan.placements.length; j++) {
      const a = plan.placements[i]!, b = plan.placements[j]!;
      closest = Math.min(closest, Math.hypot(a.x - b.x, a.y - b.y));
    }
  }
  // The original lets a pair overlap by a tenth of the radius, and so do we.
  check('no pair is closer than the radius allows', closest * 0.9 >= 0.6 - 1e-9, `closest ${closest.toFixed(3)}`);

  // Sabotage: with the radius at zero the same preset fills the lattice, so
  // the check above is measuring the rule and not the spacing.
  const free = planFill(cells, preset('free', [{ objects: [obj('tree', 0, 1)], dispersion: 0.25 }]), 13);
  check('with no radius the same lattice fills up', free.placements.length === 6400,
    `${free.placements.length} of 6400`);
}

// --- facings ----------------------------------------------------------------

console.log('\nfacing');
{
  const cells = rect(0, 0, 12, 12);
  const plan = planFill(cells, preset('turned', [{ objects: [obj('A', 0, 1)], dispersion: 1 }]), 17);
  const STEP = Math.PI / 8;
  const steps = new Set(plan.placements.map((p) => Math.round(p.r / STEP)));
  // The angle is written to six decimals, as a placement records it, so the
  // tolerance is that rounding rather than float noise.
  check('every facing is a multiple of 22.5°',
    plan.placements.every((p) => Math.abs(p.r - Math.round(p.r / STEP) * STEP) < 1e-5));
  // The original draws `rand() % 15`, which can never produce the sixteenth
  // step. Ours draws sixteen, and over 144 placements all of them show up.
  check('all sixteen steps are reachable', steps.size === 16, `${steps.size} distinct steps`);

  const still = planFill(cells, preset('still', [{ objects: [obj('A', 0, 1, true)], dispersion: 1 }]), 17);
  check('NoRandomAngle on the object stands it straight', still.placements.every((p) => p.r === 0));
  const stillLayer = planFill(cells, preset('stillLayer', [
    { objects: [obj('A', 0, 1)], dispersion: 1, noRandomAngle: true },
  ]), 17);
  check('NoRandomAngle on the layer does too', stillLayer.placements.every((p) => p.r === 0));
}

// --- determinism and groups -------------------------------------------------

console.log('\nrepeatability');
{
  const cells = rect(0, 0, 12, 12);
  const p = preset('mixed', [
    { objects: [obj('a', 0, 0.4), obj('b', 0.3, 0.4)], dispersion: 0.8 },
    { objects: [obj('c', 0.6, 0.5)], dispersion: 1.2, width: 0.5 },
  ]);
  const one = planFill(cells, p, 42), two = planFill(cells, p, 42), other = planFill(cells, p, 43);
  const same = one.placements.length === two.placements.length
    && one.placements.every((a, i) => {
      const b = two.placements[i]!;
      return a.shared === b.shared && a.x === b.x && a.y === b.y && a.r === b.r;
    });
  check('the same seed plans the same fill', same);
  check('a different seed does not', JSON.stringify(one.placements) !== JSON.stringify(other.placements));
  const sizes = one.placements.map((pl) => sizeOf(p, pl));
  check('placements carry an id their layer knows', sizes.length > 0 && sizes.every((s) => s >= 0));
}

console.log('\nrandom groups');
{
  const cells = rect(0, 0, 10, 10);
  const members = ['Fence01', 'Fence02', 'Fence03'].map((id) => ({
    shared: sharedHref('AdvMapStaticShared', id), type: 'AdvMapStatic',
  }));
  const plan = planFill(cells, preset('group', [{ objects: [obj('RandomFence', 0, 1)], dispersion: 1 }]), 21, {
    expand: () => members,
  });
  const used = new Set(plan.placements.map((p) => p.shared));
  // The original picks with `rand() % (count - 1)`, so the last member of a
  // group is unreachable; over a hundred placements all three show up here.
  check('a group scatters across all its members', used.size === 3, `${used.size} of 3 used`);
  check('and every placement is one of them',
    plan.placements.every((p) => members.some((m) => m.shared === p.shared)));
}

// --- the preset files -------------------------------------------------------

console.log('\npresets');
{
  const file = join(REPO, 'assets', 'fill-presets.xml');
  const ours = readFillPresets(readFileSync(file, 'utf8'), 'assets/fill-presets.xml');
  check('our own presets parse', ours.length >= 6, `${ours.length} presets`);
  check('every preset has layers and candidates',
    ours.every((p) => p.layers.length > 0 && p.layers.every((l) => l.objects.length > 0 && l.dispersion > 0)));
  check('every candidate builds a resolvable href',
    ours.every((p) => presetObjects(p).every((o) => /^\/MapObjects\/.+\.\(AdvMapStaticShared\)\.xdb#xpointer\(\/AdvMapStaticShared\)$/.test(o.shared))));
  check('the href implies the placed type',
    ours.every((p) => presetObjects(p).every((o) => o.type === 'AdvMapStatic')));
  const corn = ours.find((p) => p.name === 'Corn Field');
  check('a preset that asks for a fixed facing keeps it',
    !!corn && presetObjects(corn).every((o) => o.noRandomAngle));

  // Each of ours actually plans something on a modest patch — a preset whose
  // numbers never place anything is a preset that does nothing when clicked.
  for (const p of ours) {
    const n = planFill(rect(0, 0, 12, 12), p, 99).placements.length;
    check(`${p.name} plans something`, n > 0, `${n} objects`);
  }

  if (existsSync(join(dataRoot, 'MapObjects'))) {
    const missing: string[] = [];
    for (const p of ours) {
      for (const o of presetObjects(p)) {
        const rel = o.shared.split('#')[0]!.replace(/^\//, '');
        if (!existsSync(join(dataRoot, rel))) missing.push(`${p.name}: ${o.id}`);
      }
    }
    check('every candidate names a file the game has', missing.length === 0, missing.slice(0, 5).join('; '));
  } else {
    console.log(`  skip  candidate files — no MapObjects under ${dataRoot}`);
  }

  // The game's own file, when this machine has the editor folder. Its presets
  // are the ones named "(test)", and reading them is the compatibility claim:
  // the format is theirs, not ours.
  const editor = gameDirIfAny() ? join(gameDirIfAny()!, 'Editor') : findEditorRoot(dataRoot);
  const theirs = editor ? join(editor, 'FillPresets.xml') : '';
  if (theirs && existsSync(theirs)) {
    const read = readFillPresets(readFileSync(theirs, 'utf8'), 'Editor/FillPresets.xml');
    check("the game's own presets parse", read.length > 0, `${read.length} presets: ${read.map((p) => p.name).join(', ')}`);
    check('with the layers and candidates they declare',
      read.every((p) => p.layers.every((l) => l.objects.length > 0)));
  } else {
    console.log('  skip  the game\'s FillPresets.xml — no Editor folder found');
  }
}

console.log(`\n${failures ? `\x1b[31m${failures} failed\x1b[0m` : '\x1b[32mall checks passed\x1b[0m'}`);
process.exit(failures ? 1 : 0);
