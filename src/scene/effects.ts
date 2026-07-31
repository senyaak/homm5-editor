// Parsing `bin/effects/<uid>` — a particle effect as the game plays it.
//
// This is neither GR2 nor the usual Nival record container: it is a BAKED
// SIMULATION. The effects were authored as Maya particle systems (each
// `.(Particle).xdb` names its `.mb` source), and what shipped is the recording:
// every particle's birth and death frame, and per-frame keys for where it is,
// how it is turned, how big it is, what colour it is, and which texture of the
// instance's `<Textures>` list it shows. Playing an effect back is therefore
// exact by construction — there is no emitter logic to get wrong, only keys to
// interpolate.
//
// Layout (all little-endian; offsets in the directory count from byte 4):
//
//   u32   payload size (file length - 4)
//   f32   duration, seconds
//   f32   sample rate, frames/second (30 for 98% of the library)
//   u32   particle count
//   per particle:
//     i16   birth frame (negative = born before t=0, a pre-warmed loop)
//     u16   death frame (absolute, not a lifetime)
//     5 x { u16 keyCount; u32 offset }   — pos, rot, size, color, texframe
//   then the key blocks, contiguous, in that same order:
//     pos      14B  [i16 frame][f32 x][f32 y][f32 z]
//     rot       6B  [i16 frame][f32 radians]
//     size     10B  [i16 frame][f32 w][f32 h]
//     color     6B  [i16 frame][u8 b][u8 g][u8 r][u8 a]   (D3DCOLOR order; presented as RGBA)
//     texframe  4B  [i16 frame][u16 textureIndex]   (0xffff = hidden)
//
// Validated structurally against the whole shipped library (1922/1924 files;
// the other two are 16-byte headers with zero particles): every byte is
// covered by exactly one block, blocks are contiguous in directory order, and
// every key's frame lies inside its particle's [birth, death].
//
// docs/EFFECTS_FORMAT.md tells the story; tools/test-effects.ts re-checks it.

/** One keyed sample; `frame` is in file frames (divide by `rate` for seconds). */
export interface FxKey {
  frame: number;
  /** pos: [x,y,z] · rot: [radians] · size: [w,h] · color: [r,g,b,a] 0-255 · tex: [index]. */
  v: number[];
}

export interface FxParticle {
  /** First frame this particle exists; negative for pre-warmed loops. */
  birth: number;
  /** Last frame this particle exists (absolute frame, not a duration). */
  death: number;
  pos: FxKey[];
  rot: FxKey[];
  size: FxKey[];
  color: FxKey[];
  /** Which texture of the instance's <Textures> list to show; -1 = hidden. */
  tex: FxKey[];
}

export interface FxData {
  /** Seconds; the effect loops over this. */
  duration: number;
  /** Frames per second the keys are sampled at. */
  rate: number;
  particles: FxParticle[];
}

/**
 * The renderer-facing form: flat `[frame, ...values]` runs per channel, in
 * typed arrays so Electron's structured clone ships them binary — the same
 * data as JSON doubled a map's whole scene payload.
 */
export interface FxTransfer {
  duration: number;
  rate: number;
  /** Most particles alive on any single frame — the renderer's buffer size. */
  maxAlive: number;
  particles: {
    birth: number; death: number;
    /** [frame,x,y,z]* */ pos: Float32Array;
    /** [frame,radians]* */ rot: Float32Array;
    /** [frame,w,h]* */ size: Float32Array;
    /** [frame,r,g,b,a]* (0-255) */ color: Float32Array;
    /** [frame,index]* (-1 = hidden) */ tex: Float32Array;
  }[];
}

/** Parse and flatten in one go — what the `map:fx` IPC hands the renderer. */
export function transferEffect(b: Buffer): FxTransfer {
  const fx = parseEffect(b);
  const flat = (keys: FxKey[], width: number): Float32Array => {
    const out = new Float32Array(keys.length * (width + 1));
    let o = 0;
    for (const k of keys) { out[o++] = k.frame; for (let i = 0; i < width; i++) out[o++] = k.v[i]!; }
    return out;
  };
  const events: [number, number][] = [];
  for (const p of fx.particles) events.push([p.birth, 1], [p.death + 1, -1]);
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let alive = 0, maxAlive = 0;
  for (const [, d] of events) { alive += d; if (alive > maxAlive) maxAlive = alive; }
  return {
    duration: fx.duration, rate: fx.rate, maxAlive,
    particles: fx.particles.map((p) => ({
      birth: p.birth, death: p.death,
      pos: flat(p.pos, 3), rot: flat(p.rot, 1), size: flat(p.size, 2),
      color: flat(p.color, 4), tex: flat(p.tex, 1),
    })),
  };
}

/** Bytes per key, per channel, in directory order. */
const KEY_BYTES = [14, 6, 10, 6, 4];

/**
 * Parse one `bin/effects` file. Throws on a malformed buffer — the caller
 * treats that as "this effect stays invisible", never as a failed map load.
 */
export function parseEffect(b: Buffer): FxData {
  const duration = b.readFloatLE(4);
  const rate = b.readFloatLE(8);
  const n = b.readUInt32LE(12);
  let off = 16;
  const dirs: { birth: number; death: number; chans: { keys: number; off: number }[] }[] = [];
  for (let i = 0; i < n; i++) {
    const birth = b.readInt16LE(off), death = b.readUInt16LE(off + 2);
    off += 4;
    const chans = [];
    for (let c = 0; c < 5; c++) {
      chans.push({ keys: b.readUInt16LE(off), off: 4 + b.readUInt32LE(off + 2) });
      off += 6;
    }
    dirs.push({ birth, death, chans });
  }
  const particles: FxParticle[] = [];
  for (const d of dirs) {
    const read = (c: number, w: (o: number) => number[]): FxKey[] => {
      const { keys, off: base } = d.chans[c]!;
      const out: FxKey[] = [];
      for (let k = 0; k < keys; k++) {
        const o = base + k * KEY_BYTES[c]!;
        out.push({ frame: b.readInt16LE(o), v: w(o + 2) });
      }
      return out;
    };
    particles.push({
      birth: d.birth, death: d.death,
      pos: read(0, (o) => [b.readFloatLE(o), b.readFloatLE(o + 4), b.readFloatLE(o + 8)]),
      rot: read(1, (o) => [b.readFloatLE(o)]),
      size: read(2, (o) => [b.readFloatLE(o), b.readFloatLE(o + 4)]),
      // Stored B,G,R,A (the era's D3DCOLOR little-endian order), presented as
      // RGBA. Read as RGBA every fire in the library tints BLUE — the campfire
      // and phoenix flame colours average (215..255 in the LAST byte-but-one)
      // and orange only comes out with the swap.
      color: read(3, (o) => [b[o + 2]!, b[o + 1]!, b[o]!, b[o + 3]!]),
      tex: read(4, (o) => { const v = b.readUInt16LE(o); return [v === 0xffff ? -1 : v]; }),
    });
  }
  return { duration, rate, particles };
}
