// The floor's lighting preset — most of what makes the game's picture.
//
// The preset is plain XML under `Lights/_(AmbientLight)/`; the map names one
// per floor (HommMap.ambientLightRef). Only what the renderer draws with is
// lifted out — the preset also carries fog, vapour and bloom settings the
// editor does not attempt.

import { readFileSync, existsSync } from 'node:fs';
import type { Assets } from '../game/assets.ts';
import type { AmbientData } from './payload.ts';

const DEFAULT_AMBIENT = '/Lights/_(AmbientLight)/0_Default_AmbientLight.xdb';

const ambientVec3 = (xml: string, tag: string): number[] | null => {
  const m = xml.match(new RegExp(`<${tag}>\\s*<x>([^<]*)</x>\\s*<y>([^<]*)</y>\\s*<z>([^<]*)</z>`));
  return m ? [+m[1]!, +m[2]!, +m[3]!] : null;
};

export function loadAmbient(data: Assets, href: string | null): AmbientData | null {
  try {
    const p = data.path((href ?? DEFAULT_AMBIENT).split('#')[0]!);
    if (!existsSync(p)) {
      // A named preset that is missing falls back to the stock default — the
      // floor should still light like a map, just not like THIS map.
      return href ? loadAmbient(data, null) : null;
    }
    const xml = readFileSync(p, 'utf8');
    const light = ambientVec3(xml, 'LightColor');
    const ambient = ambientVec3(xml, 'AmbientColor');
    const shade = ambientVec3(xml, 'ShadeColor');
    if (!light || !ambient || !shade) return null;

    // NOT read: the preset's <Sky> cubemap. Every adventure-map preset points
    // at the same /Textures/RefMaps set, and those are blurred highlight blobs
    // for glossy REFLECTIONS, not a drawable backdrop — the game's adventure
    // camera never shows a sky. Drawn as a background they look like lens
    // flares pasted on the void.
    return {
      light, ambient, shade,
      pitch: +(xml.match(/<Pitch>([^<]*)/)?.[1] ?? 45),
      yaw: +(xml.match(/<Yaw>([^<]*)/)?.[1] ?? 0),
      // ×4, capped at a NET ×2 of the texel: light = min(4·sum, 2). Measured
      // from both ends of the game's own shader chain: the CPU doubles the
      // sum and saturates it into a colour byte (that is the clamp — nothing
      // survives past 1.0 there), the vertex shader halves it back for
      // headroom (`mul r4.xyz, r4.w, c29` — the probe in the running game
      // sees c29 arrive as 0.5), and the ps.1.1 pixel shader's
      // `mul_x4_sat r0.rgb, v0, t0` restores ×4. Net: min(2·sum, 1)·2.
      // Every simpler reading failed a side-by-side with the game: the
      // <Whitening> switch halved Whitening-off maps (the default preset
      // included — dusk where the game shows noon), a bare ×2 was the same
      // dusk, and an uncapped ×4 washed day presets to white (C1M1's day
      // preset sums to 0.663; 2.65× the texel is not the game's picture,
      // capped 2.0× is). No SetPixelShaderConstantF ever touches c7 — the
      // ps.2.0 shader quoted in older notes is not the path the game runs.
      whiten: 4,
    };
  } catch { return null; }
}
