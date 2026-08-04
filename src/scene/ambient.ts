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
      // The modulate factor is a CONSTANT ×4 — the game's own ps.1.1 shaders
      // say `mul_x4_sat r0.rgb, v0, t0` (×4, in the instruction modifier, not
      // in any constant) — and it is NOT the preset's <Whitening> switch,
      // which an earlier reading took for a ×2-on/off. Two screenshot pairs
      // measure it: the Sharpshooter map (default preset, Whitening=false)
      // renders grass at tex·0.83 under ×2 while the game shows tex·1.66 —
      // exactly the missing doubling — and C1M1's day scene puts tree
      // backsides at amb·4 = 0.75, the game's bright canopy, where ×2 gave a
      // dusk. The same ×4 explains the "game ignores dark presets" puzzle:
      // the Inferno arena's 0.345 ambient saturates to 1 under ×4, so most
      // dark presets LOOK daylit, while the two all-zero ones stay black.
      whiten: 4,
    };
  } catch { return null; }
}
