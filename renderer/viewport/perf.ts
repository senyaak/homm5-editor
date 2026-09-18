// Where the frame goes — counted, not guessed.
//
// SLICE_fx_performance.md §5: reading a renderer instead of measuring it has
// produced a plausible and wrong diagnosis three times in this project. So
// before anything about the frame is changed, this module says what the frame
// actually is — how long, how much of it is our JavaScript, how many draws it
// issues, and which functions the long ones are spent in. Every number here is
// reachable without a dependency: the render loop's own clock, three's
// `renderer.info`, and Chromium's Long Animation Frames API, which attributes a
// slow frame to a script and a source position instead of just saying "slow".
//
// Read through `view.perf()` — by a test that opens a shipped map and asks, or
// by a person in DevTools. Nothing here draws or changes what is drawn.

import * as THREE from 'three';
import { state, activeFloor } from '#core/state.ts';
import { renderer } from '#viewport/stage.ts';
import { fxAtlasStats, fxTableStats } from '#viewport/particles.ts';
import { idleTableStats } from '#viewport/idle.ts';
import { shadowRedraws } from '#viewport/shadows.ts';
import { bakeStats } from '#viewport/bakes.ts';

/** Frames kept for the percentiles — ten seconds at 60 Hz. */
const RING = 600;
/** Long frames kept, newest last. */
const LOAF_KEPT = 50;

const frameMs = new Float32Array(RING);
const jsMs = new Float32Array(RING);
let head = 0, count = 0;
let calls = 0, triangles = 0;
/** The loop's sections, each its own ring — where inside our JS the time goes. */
const sections = new Map<string, Float32Array>();
let lapAt = 0;

/** Start timing the loop's sections; `lap(name)` closes one and opens the next. */
export function lapStart(): void { lapAt = performance.now(); }
export function lap(name: string): void {
  const now = performance.now();
  let ring = sections.get(name);
  if (!ring) { ring = new Float32Array(RING); sections.set(name, ring); }
  ring[head] = now - lapAt;
  lapAt = now;
}

/** One long animation frame, as Chromium attributes it. */
export interface LongFrame {
  /** Total duration of the animation frame, ms. */
  duration: number;
  /** The part of it that blocked input, ms. */
  blocking: number;
  /** Rendering (style, layout, paint) share, ms. */
  render: number;
  /** The scripts it names, longest first: `name durationMs @url:pos`. */
  scripts: string[];
}
const loaf: LongFrame[] = [];

/** What the loop reports, once per frame, right after `renderer.render`. */
export function markFrame(frame: number, js: number): void {
  frameMs[head] = frame;
  jsMs[head] = js;
  head = (head + 1) % RING;
  if (count < RING) count++;
  // `info.autoReset` is on: the counters describe the render() that just
  // returned, and are zeroed at the start of the next one.
  calls = renderer.info.render.calls;
  triangles = renderer.info.render.triangles;
}

export function perfReset(): void {
  head = 0; count = 0;
  loaf.length = 0;
}

function percentiles(ring: Float32Array): { p50: number; p95: number; max: number } {
  if (!count) return { p50: 0, p95: 0, max: 0 };
  const a = Array.from(ring.subarray(0, count)).sort((x, y) => x - y);
  const at = (q: number): number => a[Math.min(a.length - 1, Math.floor(q * a.length))]!;
  return { p50: at(0.5), p95: at(0.95), max: a[a.length - 1]! };
}

/**
 * The particle side: the active floor's batches and copies, and the atlases
 * and recording tables, which are shared across floors and counted whole —
 * `atlases` is how many the floor's batches hold (one each), `distinctAtlases`
 * and `atlasBytes` what actually exists.
 */
function fxSummary(): { batches: number; copies: number; alive: number; atlases: number; atlasBytes: number; distinctAtlases: number; frames: { refs: number; objects: number; bytes: number }; tables: number; tableEntries: number; tableBytes: number } {
  const fl = state.world ? activeFloor() : null;
  const t = fxTableStats();
  const a = fxAtlasStats();
  const out = { batches: 0, copies: 0, alive: 0, atlases: 0, atlasBytes: a.bytes, distinctAtlases: a.atlases, frames: { refs: 0, objects: 0, bytes: 0 }, tables: t.tables, tableEntries: t.entries, tableBytes: t.bytes };
  if (!fl) return out;
  // The frames the floor's payloads hold — references against objects. One
  // object per distinct frame is what the IPC clone is supposed to deliver
  // (payload.ts Picture); the bytes are what those objects weigh in the heap.
  const frames = new Set<object>();
  for (const { batch } of fl.fx) {
    out.batches++;
    out.copies += batch.copies;
    out.alive += batch.alive;
    if ((batch.mesh.material as THREE.ShaderMaterial).uniforms.uAtlas?.value) out.atlases++;
    for (const f of batch.fx.textures) {
      if (!f) continue;
      out.frames.refs++;
      if (!frames.has(f)) { frames.add(f); out.frames.objects++; out.frames.bytes += f.rgba.byteLength; }
    }
  }
  return out;
}

/** Everything `view.perf()` answers — see ViewApi for what each field means. */
export function perfStats(): {
  frames: number;
  frame: { p50: number; p95: number; max: number };
  js: { p50: number; p95: number; max: number };
  calls: number; triangles: number;
  textures: number; geometries: number;
  pixelRatio: number; size: number[];
  sections: Record<string, { p50: number; p95: number; max: number }>;
  fx: ReturnType<typeof fxSummary>;
  idle: { bodies: number; tables: number; tableBytes: number };
  jsHeapBytes: number;
  /** Shadow-map redraws so far, and how many were asked for by a change (the rest: the view moved, or the periodic refresh). */
  shadow: { redraws: number; dirty: number };
  bakes: ReturnType<typeof bakeStats>;
  loaf: LongFrame[];
} {
  const it = idleTableStats();
  const sec: Record<string, { p50: number; p95: number; max: number }> = {};
  for (const [name, ring] of sections) sec[name] = percentiles(ring);
  return {
    frames: count,
    frame: percentiles(frameMs),
    js: percentiles(jsMs),
    calls, triangles,
    textures: renderer.info.memory.textures,
    geometries: renderer.info.memory.geometries,
    pixelRatio: renderer.getPixelRatio(),
    size: [renderer.domElement.width, renderer.domElement.height],
    sections: sec,
    fx: fxSummary(),
    idle: { bodies: (state.world ? activeFloor() : null)?.idle.length ?? 0, tables: it.tables, tableBytes: it.bytes },
    // Chromium's non-standard heap counter — the one number that says whether
    // a big map's memory is ours (JS) or the GPU's.
    jsHeapBytes: (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0,
    shadow: shadowRedraws(),
    bakes: bakeStats(),
    loaf: [...loaf],
  };
}

// Long Animation Frames. `buffered: true` so frames from before the observer
// existed — the map load — are reported too. The API is Chromium 123+; the
// typings lag it, hence the local shape.
interface LoafScript { name?: string; duration: number; sourceURL?: string; sourceCharPosition?: number; invoker?: string }
interface LoafEntry extends PerformanceEntry { blockingDuration: number; renderStart: number; styleAndLayoutStart: number; scripts: LoafScript[] }
try {
  new PerformanceObserver((list) => {
    for (const e of list.getEntries() as LoafEntry[]) {
      const scripts = [...(e.scripts ?? [])]
        .sort((a, b) => b.duration - a.duration)
        .map((s) => `${s.name || s.invoker || '?'} ${s.duration | 0}ms @${(s.sourceURL ?? '').split('/').pop()}:${s.sourceCharPosition ?? ''}`);
      loaf.push({
        duration: e.duration,
        blocking: e.blockingDuration,
        render: e.renderStart ? e.styleAndLayoutStart - e.renderStart : 0,
        scripts,
      });
      if (loaf.length > LOAF_KEPT) loaf.splice(0, loaf.length - LOAF_KEPT);
    }
  }).observe({ type: 'long-animation-frame', buffered: true });
} catch {
  // An older Chromium: the percentiles still work, only the attribution is gone.
}
