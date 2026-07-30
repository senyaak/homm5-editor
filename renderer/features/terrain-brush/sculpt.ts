// The river, height and river-plane brushes.
//
// Water, Bog and LavaFlow are not ordinary ground tiles: they are the original
// editor's "river" brushes, and painting one sinks the bed below its banks.
// The height brushes move the plane itself; the river plane is painted into
// the map's own river layer.

//
// Water, Bog and LavaFlow are not ordinary ground tiles. They are the original
// editor's "river" brushes, and painting one sinks the bed below its banks —
// measured against every shipped map, the painted bed sits below the
// surrounding high ground 90% of the time for LavaFlow, 74% for Bog, 65% for
// Water. Senya's map 12 shows the profile plainly: bank 2.0, one vertex at 1.8,
// bed at 1.6.
//
// They also write the half-tile river plane, which is what actually makes a
// river a river to the game. Painting one as a plain tile produced something
// that looked like a river and was not one.

import { paintMaskTexture, rectTiles, rectVerts, squareRect } from '#features/terrain-brush/brush.ts';
import { armed, renderObjGrid } from '#features/palettes.ts';
import { regionDraw, setRegionDraw } from '#features/regions.ts';
import type { TileRect } from '#features/terrain-brush/brush.ts';
import { markDirty } from '#core/dirty.ts';
import { $, $button, $input, $select } from '#core/dom.ts';
import { api } from '#core/ipc.ts';
import { uiPrefs } from '#core/prefs.ts';
import { activeFloor, state } from '#core/state.ts';
import type { Floor3D } from '#core/state.ts';
import { brush, commitMask, groundPointAtClient, maskAt, stroke, strokeVerts, tileUnderCursor, updateBrushCursor, vertexAtClient } from '#features/terrain-brush/brush.ts';
import { controls, renderer } from '#viewport/stage.ts';
import { remeshFloor } from '#viewport/terrain-mesh.ts';
import { RAMP_BIT, TIER_STEP, tierOf } from '#src/terrain.ts';
import { saveUiPrefs } from '#core/prefs.ts';
import { setPalette } from '#features/palettes.ts';
import { UNITS_PER_TILE as U } from '#src/units.ts';
import type { BrushMode } from '#features/terrain-brush/brush.ts';
/** Tiles that behave as river brushes. They live under the Water folder. */
const isRiverTile = (path: string): boolean => /\/_\(AdvMapTile\)\/Water\//.test(path);

export const RIVER_DEPTH = 0.4;   // how far the bed drops below the bank
const RIVER_FEATHER = 0.2; // the single rim vertex between bank and bed

/** Height changes accumulated over the stroke, keyed by vertex. */
export const riverHeights = new Map<number, number>();

/**
 * Sink the bed under `verts` and feather its rim.
 *
 * Idempotent per vertex: a river is a fixed depth below its banks, not a hole
 * that deepens the longer you hold the mouse down. Dragging back over the same
 * bed must leave it where it is.
 */
function sinkRiver(fl: Floor3D, verts: number[]): void {
  const drop = fl.riverDrop;
  // Sea is not a river. Flag 0 means navigable water and it sits at exactly 0.0
  // in 100% of the 62,788 flagged vertices across 60 shipped maps, so digging it
  // another 0.4 because someone painted the water texture over it would break an
  // invariant the engine relies on. What makes water swimmable is that flag, not
  // its depth: Bog and LavaFlow never carry it, Water only where a basin was dug.
  const isSea = (v: number): boolean => fl.flags ? fl.flags[v] === 0 : false;

  /**
   * Lower `v` until it sits `want` below where the ground started.
   *
   * Expressed as a target depth rather than a step, so applying it twice is a
   * no-op and promoting a rim vertex to bed digs only the remaining 0.2. Never
   * raises: a vertex already deeper belongs to someone else's terrain.
   */
  const sink = (v: number, want: number): void => {
    if (isSea(v)) return;
    const had = drop.get(v) ?? 0;
    if (want <= had) return;
    const target = fl.heights[v]! - (want - had);
    fl.heights[v] = target;
    drop.set(v, want);
    riverHeights.set(v, target);
  };

  for (const v of verts) { sink(v, RIVER_DEPTH); fl.river.add(v); }
  // One ring of rim vertices, dropped half as far, so the bank does not fall
  // away from the bed as a sheer step.
  const bed = new Set(verts);
  for (const v of verts) {
    const x = v % fl.V, y = (v / fl.V) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= fl.V || ny < 0 || ny >= fl.V) continue;
      const n = ny * fl.V + nx;
      if (!bed.has(n)) sink(n, RIVER_FEATHER);
    }
  }
  remeshFloor(fl);
}

/**
 * Commits sent to the main process and not yet acknowledged.
 *
 * A stroke hands its edit over and does not wait — that is what keeps painting
 * responsive. It also means the file can lag behind the screen, and at
 * reconstruction scale (a hundred thousand vertex writes) the backlog outlives
 * a Save: the save runs, then the queue drains and marks the map dirty again.
 * Publishing the count lets a caller wait for quiet; nothing else depends on it.
 */
export let pendingCommits = 0;
export async function committing<T>(work: Promise<T>): Promise<T> {
  pendingCommits++;
  try { return await work; } finally { pendingCommits--; }
}

/** Weight the tile brush writes, from the toolbar. */
const tileStrength = (): number => Math.max(0, Math.min(255, +$input('tilestrength').value || 0));
/** Blend mode: write this layer only, leaving the others under it alone. */
const tileBlend = (): boolean => ($('tilesolo') as HTMLInputElement).checked;
/** Whether painting water also sinks the bed under it. */
const riverCarve = (): boolean => ($('rivercarve') as HTMLInputElement).checked;

/** Vertices painted into the masks, handed over, and strokes that did nothing. */
export let paintedVerts = 0, sentVerts = 0, refusedStrokes = 0;

/** Paint at the cursor, if the brush is armed and the tile is paintable. */
function brushAt(verts: number[]): void {
  const fl = activeFloor();
  const tile = armed.tile;
  if (!tile || !fl.splat) { refusedStrokes++; return; }
  // Before upgradeToSplat finishes there is nothing to paint into. Refusing here
  // matters: the stroke would otherwise reach the file but never the screen.
  if (!fl.maskTex) { refusedStrokes++; $('hud').textContent = 'ground textures still loading…'; return; }
  const layerIdx = fl.splat.paths.indexOf(tile.path);
  if (layerIdx < 0) {
    // Picking a tile this map has no layer for adds one in the background, and
    // a stroke that arrives first has nowhere to land. It used to be dropped in
    // silence, which is how a reconstruction lost three whole layers without
    // anything on screen or in the file saying so.
    refusedStrokes++;
    $('hud').textContent = `${tile.name} has no layer in this map yet — one moment`;
    return;
  }
  const fresh = verts.filter((v) => !strokeVerts.has(v));
  if (!fresh.length) { refusedStrokes++; return; }
  for (const v of fresh) strokeVerts.add(v);
  paintedVerts += fresh.length;
  const strength = tileStrength();
  paintMaskTexture(fl, layerIdx, fresh, strength, !tileBlend());
  // Water carves its bed — unless there is no water being painted (strength 0
  // erases) or carving is off because the ground is already at its final shape.
  if (isRiverTile(tile.path) && strength > 0 && riverCarve()) sinkRiver(fl, fresh);
}

/** Hand the finished stroke to the main process in one message. */
async function commitStroke(): Promise<void> {
  const tile = armed.tile;
  if (!tile || !strokeVerts.size || !state.world) { strokeVerts.clear(); return; }
  const verts = [...strokeVerts];
  strokeVerts.clear();
  sentVerts += verts.length;
  const heightEdits = [...riverHeights];
  riverHeights.clear();
  try {
    // Water is a river only if it carries the plane and a bed; "carve" says
    // whether this stroke does that physical part or is paint alone. Off, the
    // stroke is an ordinary tile — which is what you want when the plane is
    // already authored and the ground is at its final height.
    if (isRiverTile(tile.path) && riverCarve()) {
      // Mask, river plane and heights travel together: a river missing any one
      // of the three is not a river, and a half-applied stroke would be worse
      // than a rejected one.
      await committing(api.paintRiver({
        floor: state.world.active, tile: tile.path, verts,
        heightVerts: heightEdits.map(([v]) => v),
        heights: heightEdits.map(([, h]) => h),
      }));
    } else {
      await committing(api.paintTile({
        floor: state.world.active, tile: tile.path, verts,
        strength: tileStrength(), exclusive: !tileBlend(),
      }));
    }
    markDirty(true);
  } catch (e) {
    // The GPU already shows the stroke, so a failure here means the two copies
    // disagree. Say so plainly rather than leaving a lie on screen.
    $('hud').textContent = 'paint failed (reload to resync): '
      + (e instanceof Error ? e.message : String(e));
  }
}

// --- height brush ----------------------------------------------------------
//
// Raise and lower, with a linear falloff from the brush centre so a stroke
// leaves a rounded mound rather than a stack of boxes.
//
// Heights and flags move together, because the format ties them. Ground sits at
// the 2.0 default and a bed dug by `lower` is always exactly 0.0 and flagged
// water. So: lower a vertex to 0 and it floods; raise a flooded vertex off 0 and
// it drains back to ordinary ground. Flags matter beyond the water sheet — the
// mesher cuts a cell wherever the ground KIND changes, so getting them wrong
// puts cliffs in the middle of a hillside.
//
// Unlike the tile brush, this sends absolute values rather than an operation.
// The falloff maths only runs here, so the main process cannot compute a
// different answer and drift.

const GROUND_LEVEL = 2.0;   // the format's default ground height
const WATER_LEVEL = 0.0;    // what `lower` digs a bed to, exactly
const STEP = 0.35;          // default height change per brush tick at full strength
const TICK_MS = 70;         // how often a held brush reapplies

/**
 * How much one Bulk/Dig tick moves the ground at the centre of the brush, and
 * how sharply that movement tapers towards the rim.
 *
 * Both were constants, and that made most of a real map unreachable: a fixed
 * 0.35 per tick with a fixed taper puts every height the brush can produce on
 * one lattice, and C1M1's field — 7420 distinct values, 87.7% of them off any
 * step grid — is nowhere near it (docs/E2E_RECONSTRUCTION.md). With a force you
 * can set, a stroke can land on a chosen value exactly; with a tension you can
 * choose between a sharp spike and a flat lift, which is the difference between
 * carving a gully and raising a field.
 */
/** 1 = taper to a third at the rim (what it always did); 0 = flat stamp. */
/**
 * Vertex mode: Bulk/Dig moves the single grid corner nearest the cursor.
 *
 * The smallest square brush is still four vertices — a tile's corners — and
 * four vertices moved together cannot express a surface whose corners differ,
 * which every real map's does. It is also the only way to reach the outermost
 * row and column, of which there is one more than there are tiles.
 */

/**
 * Does this flag record a deliberate ground kind that sculpting must not undo?
 *
 * Plateau tiers and ramps are authored, so a height change leaves them alone.
 * The test used to be `flag & 32`, which is only true for tiers 2 and 3: tier 4
 * (64) has no bit in common with it, so sculpting anywhere on a tier-4 plateau
 * silently reset it to ordinary ground — and C1M1 has 623 such vertices.
 */
const keepsGroundKind = (flag: number): boolean => tierOf(flag) >= 2 || (flag & RAMP_BIT) !== 0;

/** What a left-drag does. Mirrors the mode selector in the brush panel. */

/** What the armed tool does, said in full — for the hud and the panel. */
export const BRUSH_SAYS: Record<BrushMode, string> = {
  paint: 'painting',
  bulk: 'bulk: smooth raise', dig: 'dig: smooth lower',
  raise: 'raise: a plateau 2.0 up, with cut edges',
  lower: 'lower: a pit dug to 0, which floods',
  ramp: 'ramp: half a step up, walkable instead of a wall',
  level: 'plateau: pull everything to the level you start on',
  kind: 'ground kind: paints the tier (and ramp) without moving the ground',
  river: 'river plane: half-tile cells at the chosen strength; carve is optional',
  mask: 'masking: left-drag blocks movement', erase: 'erasing the movement mask',
};

/** The same in two words, for the bar button while the panel is closed. */
const BRUSH_LABEL: Record<BrushMode, string> = {
  paint: 'paint', bulk: 'bulk', dig: 'dig', raise: 'raise', lower: 'lower', ramp: 'ramp',
  level: 'plateau', kind: 'kind', river: 'river', mask: 'mask', erase: 'erase',
};

/**
 * Which settings each mode actually has.
 *
 * All of them used to be in the toolbar at once, so the tier picker sat there
 * while you painted textures and the river strength never went away. A mode
 * whose row list is empty has nothing to set beyond its size — Raise steps a
 * fixed 2.0, and a mask stroke is on or off.
 */
const BRUSH_ROWS: Record<BrushMode, readonly string[]> = {
  // Carve belongs to a water stroke wherever it comes from, and painting a
  // Water tile is one — hence the carve row on the tile brush as well.
  paint: ['bp-weight', 'bp-carve'],
  bulk: ['bp-force', 'bp-tension'], dig: ['bp-force', 'bp-tension'],
  raise: [], lower: [], ramp: [], level: [],
  kind: ['bp-tier'],
  river: ['bp-river', 'bp-carve'],
  mask: [], erase: [],
};
const BRUSH_ROW_IDS = ['bp-force', 'bp-tension', 'bp-tier', 'bp-weight', 'bp-river', 'bp-carve'] as const;

/** Show the rows the current mode uses, and say what it does. */
export function syncBrushPanel(): void {
  const rows = BRUSH_ROWS[brush.mode];
  for (const id of BRUSH_ROW_IDS) $(id).style.display = rows.includes(id) ? 'flex' : 'none';
  $('bp-note').textContent = BRUSH_SAYS[brush.mode];
}
/** Height direction for the sculpt modes; 0 for the rest. */


// --- the river plane, painted directly --------------------------------------
//
// The plane lives on a (2V-1)² grid — twice the resolution of the vertices — and
// its values are graded. The tile-driven river brush above writes full strength
// at vertex positions, which draws a river fine and cannot reproduce one: of
// C1M1's 2317 wet cells, 1815 sit between vertices and they hold 134 distinct
// values. This mode addresses the plane on its own terms.

/** Cells painted in the current stroke, as indices into the (2V-1)² plane. */
const strokeCells = new Set<number>();

/** Cells per side of the river plane for a V-vertex map. */
export const riverSide = (V: number): number => 2 * V - 1;

/** The river cell nearest these client coordinates, or null when off the map. */
export function riverCellAtClient(clientX: number, clientY: number): { x: number; y: number } | null {
  const p = groundPointAtClient(clientX, clientY);
  if (!p) return null;
  const W = riverSide(activeFloor().V);
  // Cells sit every half tile, so the grid step is U/2.
  const x = Math.round(p.x / (U / 2)), y = Math.round(p.y / (U / 2));
  if (x < 0 || y < 0 || x >= W || y >= W) return null;
  return { x, y };
}

/** Paint the river plane under the cursor at the chosen strength. */
function riverAt(cells: { x: number; y: number }[]): void {
  const fl = activeFloor();
  const W = riverSide(fl.V);
  const value = Math.max(0, Math.min(255, +$input('riverstrength').value || 0));
  const carve = riverCarve();
  const bed: number[] = [];
  for (const c of cells) {
    const idx = c.y * W + c.x;
    if (strokeCells.has(idx)) continue;
    strokeCells.add(idx);
    // A cell that lands on a vertex is the only one with ground under it to
    // sink; the ones between vertices have no height of their own.
    if (carve && value > 0 && c.x % 2 === 0 && c.y % 2 === 0) bed.push((c.y / 2) * fl.V + (c.x / 2));
  }
  if (bed.length) {
    sinkRiver(fl, bed);
    for (const v of bed) strokeVerts.add(v);
  }
}

/** Send the finished river stroke. */
async function commitRiver(): Promise<void> {
  const fl = activeFloor();
  if (!strokeCells.size || !state.world) { strokeCells.clear(); strokeVerts.clear(); return; }
  const cells = [...strokeCells];
  strokeCells.clear();
  const value = Math.max(0, Math.min(255, +$input('riverstrength').value || 0));
  try {
    await committing(api.setRiverCells({ floor: state.world.active, cells, value }));
    // Carving moved ground, and those heights travel by the sculpt path.
    if (strokeVerts.size) await commitSculpt(); else strokeVerts.clear();
    markDirty(true);
  } catch (e) {
    strokeVerts.clear();
    $('hud').textContent = 'river failed (reload to resync): '
      + (e instanceof Error ? e.message : String(e));
  }
  void fl;
}

/**
 * The ground kind the Tier brush paints: `16 × tier`, plus 8 for a ramp.
 * Read from the toolbar at the moment of the stroke.
 */
function selectedKind(): number {
  const tier = +$select('kindtier').value;
  return tier * TIER_STEP + (($('kindramp') as HTMLInputElement).checked ? RAMP_BIT : 0);
}

/**
 * Paint the ground kind, leaving the height exactly where it is.
 *
 * Every other tool changes a tier by MOVING the ground: Raise adds a step and
 * takes the tier with it, Lower digs to 0 and calls it water. That is right for
 * sculpting and useless once the surface is already at its final height — which
 * is exactly the state a reconstruction is in when it comes to set the tiers
 * (docs/E2E_RECONSTRUCTION.md), and the state you are in whenever a hill is
 * shaped the way you want but reads as the wrong kind of ground.
 *
 * @returns the vertices it changed, or null if they already held that kind.
 */
function kindAt(verts: number[], vertexOnly = false): number[] | null {
  const fl = activeFloor();
  if (!fl.flags) return null;
  const kind = selectedKind();
  const moved: number[] = [];
  for (const v of verts) {
    if (!vertexOnly && strokeVerts.has(v)) continue;
    if (fl.flags[v] === kind) continue;
    fl.flags[v] = kind;
    moved.push(v);
  }
  if (!moved.length) return null;
  // The mesher reads flags: tier boundaries become cut walls, ramps are smoothed
  // and flag 0 is where the sea sheet goes, so the view is stale until it runs.
  remeshFloor(fl);
  return moved;
}

/**
 * Move one vertex by the brush force. Nothing tapers, nothing else moves.
 * @returns the vertex it moved, or null if the force changed nothing.
 */
function sculptVertex(fl: Floor3D, x: number, y: number): number[] | null {
  const i = y * fl.V + x;
  const next = Math.max(WATER_LEVEL, fl.heights[i]! + brush.dir * brush.force);
  if (next === fl.heights[i]) return null;
  fl.heights[i] = next;
  if (fl.flags) {
    const f = fl.flags[i]!;
    if (!keepsGroundKind(f)) fl.flags[i] = next <= WATER_LEVEL ? 0 : 16;
  }
  return [i];
}

/**
 * Apply one tick of the height brush at tile (cx, cy).
 * @returns the vertices it moved, or null if nothing changed.
 */
function sculptAt(fl: Floor3D, cx: number, cy: number): number[] | null {
  // Footprint: the same vertex box the tile brush paints, so both brushes cover
  // what the cursor visibly highlights. A size-N brush spans tiles cx-k..cx+k,
  // whose corners are vertices cx-k..cx+k+1.
  //
  // Distance is Chebyshev (square), not Euclidean. A radial test fails outright
  // at size 1: the tile centre is 0.707 from each of its four corners, so a
  // radius of 0.5 excludes every vertex and the brush silently does nothing.
  const k = Math.floor(Math.max(1, brush.size) / 2);
  const rad = k + 0.5;              // half-width in tiles, centre to outer vertices
  const ox = cx + 0.5, oy = cy + 0.5;
  const touched: number[] = [];
  for (let y = cy - k; y <= cy + k + 1; y++) for (let x = cx - k; x <= cx + k + 1; x++) {
    if (x < 0 || x >= fl.V || y < 0 || y >= fl.V) continue;
    const d = Math.max(Math.abs(x - ox), Math.abs(y - oy));
    if (d > rad) continue;
    // The innermost ring sits at 0.5, so subtracting it puts full strength
    // there and tapers towards the rim. Size 1 is a flat 2x2 stamp. Tension
    // scales how much of that taper applies: at 0 the whole footprint moves
    // together, at 1 the rim gets a third of the centre, as it always did.
    const falloff = k === 0 ? 1 : 1 - brush.tension * ((d - 0.5) / rad);
    const i = y * fl.V + x;
    const next = Math.max(WATER_LEVEL, fl.heights[i]! + brush.dir * brush.force * falloff);
    if (next === fl.heights[i]) continue;
    fl.heights[i] = next;
    if (fl.flags) {
      // A vertex at exactly 0 is a dug bed, which is what water is. Anything
      // above it is ordinary ground. Plateau (32) and ramp (8) bits are
      // deliberate authoring, so leave those vertices' kind alone.
      const f = fl.flags[i]!;
      if (!keepsGroundKind(f)) fl.flags[i] = next <= WATER_LEVEL ? 0 : 16;
    }
    touched.push(i);
  }
  return touched.length ? touched : null;
}

/**
 * The step a plateau stands above the ground it sits on.
 *
 * Measured across every shipped map: of 23,539 plateau edges, 45% are exactly
 * 2.00 and both the median and the lower quartile are 2.00 — which is also the
 * format's default ground level. Nothing else comes close.
 */
const PLATEAU_STEP = 2.0;

/**
 * How far from the stroke's starting level a vertex may sit and still count as
 * the same tier.
 *
 * Half the step: tiers are 2.0 apart, so anything within 1.0 is the level you
 * started on and anything beyond is a different one. It cannot be an exact
 * match — only 25.6% of plateau vertices sit level with their neighbours, since
 * a plateau keeps the relief of the ground it was raised from.
 */
const PLATEAU_TOL = PLATEAU_STEP / 2;

/** The level a height stroke started on; NaN between strokes. */
let plateauBase = NaN;
/** The tier flag that goes with it, for the levelling tool. */
let plateauBaseFlag = 16;
/** True while the size selector is on Rect: drag out a rectangle, apply on release. */
/** Where a Rect drag started. */

/**
 * Raise a plateau, or dig a pit — the original editor's Raise and Lower, as
 * opposed to the smooth Bulk and Dig.
 *
 * Raise ADDS the step rather than levelling to it: only 25.6% of plateau
 * vertices have all their plateau neighbours at the same height, so a plateau
 * is not a flat table. It carries the relief of the ground it was raised from,
 * which is why its cut edge flows with the terrain instead of sitting level.
 *
 * Marking the kind is the whole point. A cut is a change of ground KIND, not of
 * steepness, so without flag 32 the mesher would blend the new step into a
 * smooth ramp however tall it is. Lower digs to exactly 0.0 and flags water,
 * which is what makes the pit flood.
 */
function plateauAt(verts: number[], up: boolean, start: number): void {
  const fl = activeFloor();
  // The first tick of a stroke fixes the tier being worked on. Dragging off it
  // onto a step above or below must leave that ground alone: otherwise tracing
  // along the rim of a tier quietly raises the one beneath it too, and one pass
  // leaves a staircase of mixed heights. Lower is bound the same way — a pit
  // traced along a plateau's edge should not swallow the plateau.
  if (!strokeVerts.size) plateauBase = fl.heights[start]!;
  let touched = false;
  for (const v of verts) {
    if (strokeVerts.has(v)) continue;
    if (Math.abs(fl.heights[v]! - plateauBase) > PLATEAU_TOL) continue;
    strokeVerts.add(v);
    fl.heights[v] = up ? fl.heights[v]! + PLATEAU_STEP : 0;
    if (fl.flags) {
      // Step to the NEXT tier, keeping the count rather than pinning everything
      // to 32: tier 3 stacked on tier 2 must be a different kind or the mesher
      // blends the wall between them into a slope. The ramp bit is dropped —
      // this makes a wall, not an incline.
      fl.flags[v] = up ? Math.min(240, (fl.flags[v]! & 0xf0) + 16) : 0;
    }
    touched = true;
  }
  if (touched) remeshFloor(fl);
}

/**
 * Cut a walkable ramp into a tier boundary.
 *
 * A ramp is not a gentle slope the tool draws freehand: the format has exactly
 * one intermediate value, bit 3, and a ramp vertex sits precisely half a tier
 * up. Measured across every shipped map, 16->24 and 24->32 each step 1.00 —
 * half of the 2.00 between tiers. So this raises the vertices it touches by half
 * a step and flags them, turning one wall into two half-height steps that the
 * mesher smooths, because it smooths any cell holding a ramp vertex.
 *
 * Bound to its starting level like Raise and Lower: a ramp traced along a rim
 * must not chew into the tier above or below it.
 */
function rampAt(verts: number[], start: number): void {
  const fl = activeFloor();
  const flags = fl.flags;
  if (!flags) return;
  if (!strokeVerts.size) plateauBase = fl.heights[start]!;

  /** A ramp only exists where a cut does — and it is cut INTO the low side. */
  const onLowSideOfCut = (v: number): boolean => {
    const x = v % fl.V, y = (v / fl.V) | 0;
    const me = flags[v]! >> 4;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= fl.V || ny < 0 || ny >= fl.V) continue;
      if ((flags[ny * fl.V + nx]! >> 4) > me) return true;
    }
    return false;
  };

  let touched = false, blocked = false;
  for (const v of verts) {
    if (strokeVerts.has(v)) continue;
    if (Math.abs(fl.heights[v]! - plateauBase) > PLATEAU_TOL) continue;
    // Already a ramp: leave it. It still sits on the low tier and still borders
    // the high one, so without this a second pass raises it another half step
    // and a few clicks push it clean through the tier it was meant to reach.
    if (flags[v]! & 8) continue;
    // Nowhere but a cut. Every one of the 3,718 ramp vertices across the shipped
    // maps has a neighbour on a different tier — 100.0%, not merely most — so a
    // ramp in open ground is not a thing the format expresses. Refusing beats
    // leaving half a step stranded in a field.
    if (!onLowSideOfCut(v)) { blocked = true; continue; }
    strokeVerts.add(v);
    fl.heights[v] = fl.heights[v]! + PLATEAU_STEP / 2;
    flags[v] = (flags[v]! & 0xf0) | 8;
    touched = true;
  }
  if (touched) remeshFloor(fl);
  // Say so rather than appearing broken: the brush is armed and nothing happens.
  else if (blocked) $('hud').textContent = 'ramps go at the foot of a cut — aim at the low side of a step';
}

/** Sculpt at the cursor, rate-limited so holding still is controllable. */
function sculptTick(ev: PointerEvent): void {
  const fl = activeFloor();
  const at = brush.vertex ? vertexAtClient(ev.clientX, ev.clientY) : tileUnderCursor(ev);
  if (!at) return;
  const tile = at.y * fl.V + at.x;
  const now = performance.now();
  // Reapply when the cursor moves to a new tile, or on a timer while held —
  // otherwise a stroke that pauses would silently stop sculpting.
  if (tile === stroke.lastTile && now - stroke.lastTick < TICK_MS) return;
  stroke.lastTile = tile; stroke.lastTick = now;
  const idx = at.y * fl.V + at.x;
  if (brush.mode === 'paint') { brushAt([idx]); return; }
  const moved = brush.mode === 'kind'
    ? kindAt([idx], true)
    : brush.vertex ? sculptVertex(fl, at.x, at.y) : sculptAt(fl, at.x, at.y);
  if (!moved) return;
  for (const v of moved) strokeVerts.add(v);
  remeshFloor(fl);
}

/** Hand the finished sculpt to the main process as absolute values. */
async function commitSculpt(): Promise<void> {
  const fl = activeFloor();
  if (!strokeVerts.size || !state.world) { strokeVerts.clear(); return; }
  const verts = [...strokeVerts];
  strokeVerts.clear();
  try {
    await committing(api.sculpt({
      floor: state.world.active,
      verts,
      heights: verts.map((v) => fl.heights[v]!),
      flags: fl.flags ? verts.map((v) => fl.flags![v]!) : null,
    }));
    markDirty(true);
  } catch (e) {
    $('hud').textContent = 'sculpt failed (reload to resync): '
      + (e instanceof Error ? e.message : String(e));
  }
}

/**
 * Level everything under the brush to the tier the stroke started on.
 *
 * The plateau tool: drag on an upper tier and the ground around is pulled up to
 * it, drag on a lower one and what stands above is cut down. Unlike Raise it
 * sets an absolute height and tier rather than adding a step, which is the whole
 * point — it is how you get a flat table at a chosen level out of uneven ground.
 */
function levelAt(verts: number[], start: number): void {
  const fl = activeFloor();
  if (!strokeVerts.size) {
    plateauBase = fl.heights[start]!;
    plateauBaseFlag = fl.flags ? fl.flags[start]! : 16;
  }
  let touched = false;
  for (const v of verts) {
    if (strokeVerts.has(v)) continue;
    strokeVerts.add(v);
    if (fl.heights[v] === plateauBase && (!fl.flags || fl.flags[v] === plateauBaseFlag)) continue;
    fl.heights[v] = plateauBase;
    // The tier travels with the height. Levelling the ground without it leaves
    // a tier boundary with no step across it, which the mesher then cuts into a
    // wall of zero height — a seam through the middle of a flat plateau.
    if (fl.flags) fl.flags[v] = plateauBaseFlag;
    touched = true;
  }
  if (touched) remeshFloor(fl);
}

/**
 * The tiles a stroke acts on right now.
 *
 * Rect defers: while the button is down it only previews, and the whole
 * rectangle is applied once on release. Every other size acts under the cursor
 * as you move.
 */
export function currentRect(ev: PointerEvent): TileRect | null {
  const at = tileUnderCursor(ev);
  if (!at) return null;
  if (!brush.rect) return squareRect(at.x, at.y, brush.size);
  if (!stroke.rectAnchor) return squareRect(at.x, at.y, 1);
  return {
    x0: Math.min(stroke.rectAnchor.x, at.x), y0: Math.min(stroke.rectAnchor.y, at.y),
    x1: Math.max(stroke.rectAnchor.x, at.x), y1: Math.max(stroke.rectAnchor.y, at.y),
  };
}

/** One tick of whichever brush is armed, over `r`. */
export function applyRect(r: TileRect): void {
  const fl = activeFloor();
  const verts = rectVerts(fl.V, r);
  const start = Math.max(0, Math.min(fl.V * fl.V - 1, r.y0 * fl.V + r.x0));
  switch (brush.mode) {
    case 'paint': brushAt(verts); break;
    case 'bulk': case 'dig': sculptRect(verts); break;
    case 'raise': plateauAt(verts, true, start); break;
    case 'lower': plateauAt(verts, false, start); break;
    case 'ramp': rampAt(verts, start); break;
    case 'level': levelAt(verts, start); break;
    case 'kind': { const moved = kindAt(verts); if (moved) for (const v of moved) strokeVerts.add(v); break; }
    case 'mask': maskAt(rectTiles(fl.V, r), false); break;
    case 'erase': maskAt(rectTiles(fl.V, r), true); break;
  }
}

/**
 * Bulk and Dig over a rectangle: one step at full strength, no falloff.
 *
 * The radial falloff exists to round a mound made by dragging. A rectangle is
 * an explicit shape, so tapering its edges would fight what was asked for.
 */
function sculptRect(verts: number[]): void {
  const fl = activeFloor();
  let touched = false;
  for (const v of verts) {
    if (strokeVerts.has(v)) continue;
    strokeVerts.add(v);
    const next = Math.max(WATER_LEVEL, fl.heights[v]! + brush.dir * brush.force);
    if (next === fl.heights[v]) continue;
    fl.heights[v] = next;
    if (fl.flags) {
      const f = fl.flags[v]!;
      if (!keepsGroundKind(f)) fl.flags[v] = next <= WATER_LEVEL ? 0 : 16;
    }
    touched = true;
  }
  if (touched) remeshFloor(fl);
}

/** One tick of whichever brush is armed. */
export function applyBrush(ev: PointerEvent): void {
  // Rect only previews while dragging; the work happens on release.
  if (brush.rect) { updateBrushCursor(tileUnderCursor(ev)); return; }
  // Bulk and Dig keep their own rate limiting and radial falloff; the kind
  // brush borrows that path when it is painting one vertex at a time.
  if (brush.mode === 'bulk' || brush.mode === 'dig'
      || (brush.vertex && (brush.mode === 'kind' || brush.mode === 'paint'))) { sculptTick(ev); return; }
  if (brush.mode === 'river') {
    const c = riverCellAtClient(ev.clientX, ev.clientY);
    if (c) riverAt([c]);
    return;
  }
  const r = currentRect(ev);
  if (r) applyRect(r);
}

/** Hand the finished stroke to the main process. */
export async function commitBrush(): Promise<void> {
  switch (brush.mode) {
    case 'paint': await commitStroke(); break;
    case 'bulk': case 'dig': case 'raise': case 'lower': case 'ramp': case 'level': case 'kind':
      await commitSculpt(); break;
    case 'river': await commitRiver(); break;
    case 'mask': await commitMask(false); break;
    case 'erase': await commitMask(true); break;
  }
}

export function setBrush(on: boolean): void {
  brush.on = on;
  // The two are mutually exclusive, both being left-click on the terrain.
  // armObject() disarms the brush; this is the same rule the other way round,
  // and it must not call back into armObject or the two would bounce.
  if (on && armed.object) {
    armed.object = null;
    $('obj-sel').textContent = 'no object selected';
    renderObjGrid();
  }
  // The region tool is a third claimant on the same left-drag; arming the brush
  // puts it down. setRegionDraw does not call back here, so this cannot bounce.
  if (on && regionDraw) setRegionDraw(false);
  const b = $button('brushbtn');
  b.classList.toggle('on', on);
  // The label says the state rather than the action: with the mode selector
  // beside it, "Brush" alone gave no way to tell armed from not.
  b.textContent = on ? 'on' : 'off';
  // The panel can be closed while the brush is live, so the bar button carries
  // the armed state — otherwise a left-drag edits the terrain with nothing on
  // screen saying why. Open/closed needs no light of its own: a 268px strip
  // either occupies the right edge or it does not.
  $('palbtn').classList.toggle('on', on);
  $('palbtn').textContent = on ? `Terrain: ${BRUSH_LABEL[brush.mode]}` : 'Terrain';
  // The arrow is hidden, not restyled: the footprint gizmo IS the cursor, and
  // an arrow on top of it only obscures the tile under the tip.
  renderer.domElement.style.cursor = on ? 'none' : '';
  if (!on) updateBrushCursor(null);
  if (!on && stroke.painting) { stroke.painting = false; controls.enabled = true; }
}

/** Bind the brush strip: the arm button, the size, the force and the mode. */
export function initBrushPanel(): void {
  $('brushbtn').onclick = () => {
    // Arming the tile brush without a tile chosen would silently do nothing, so
    // open the palette instead and let the user pick one. Sculpting needs no tile.
    if (!brush.on && brush.mode === 'paint' && !armed.tile) {
      setPalette(true);
      $('hud').textContent = 'pick a ground tile to paint with';
      return;
    }
    setBrush(!brush.on);
  };
  $select('brushsizesel').addEventListener('change', (e) => {
    const v = (e.currentTarget as HTMLSelectElement).value;
    brush.rect = v === 'rect';
    brush.vertex = v === 'vertex';
    if (!brush.rect && !brush.vertex) brush.size = +v;
    if (brush.rect) $('hud').textContent = 'rect: drag out a rectangle, it applies on release';
    if (brush.vertex) $('hud').textContent = 'vertex: Bulk/Dig moves the single corner nearest the cursor';
  });
  $input('brushforce').addEventListener('input', (e) => {
    const v = +(e.currentTarget as HTMLInputElement).value;
    // A force of zero is a brush that does nothing; ignore rather than arm it.
    if (!Number.isFinite(v) || v <= 0) return;
    brush.force = v;
    saveUiPrefs({ brushForce: brush.force });
  });
  $input('brushtension').addEventListener('input', (e) => {
    brush.tension = +(e.currentTarget as HTMLInputElement).value;
    $('brushtensionval').textContent = brush.tension.toFixed(2);
    saveUiPrefs({ brushTension: brush.tension });
  });
  $select('brushmode').addEventListener('change', (e) => {
    brush.mode = (e.currentTarget as HTMLSelectElement).value as BrushMode;
    brush.dir = brush.mode === 'bulk' ? 1 : brush.mode === 'dig' ? -1 : 0;
    syncBrushPanel();
    // Picking a mode is the intent to use it, so arm right away. Only paint needs
    // something else chosen first, so that is the one case that redirects.
    if (brush.mode === 'paint' && !armed.tile) {
      setBrush(false); setPalette(true);
      $('hud').textContent = 'pick a ground tile to paint with';
      return;
    }
    setBrush(true);
    $('hud').textContent = BRUSH_SAYS[brush.mode];
  });
}
