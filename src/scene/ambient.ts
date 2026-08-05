// The floor's lighting preset — most of what makes the game's picture.
//
// The preset is plain XML under `Lights/_(AmbientLight)/`; the map names one
// per floor (HommMap.ambientLightRef). Only what the renderer draws with is
// lifted out — the preset also carries fog, vapour and bloom settings the
// editor does not attempt.

import { readFileSync, existsSync } from 'node:fs';
import { decodeModelGeom } from './model-geom.ts';
import type { Assets } from '../game/assets.ts';
import type { ReadXdb } from './xdb.ts';
import type { AmbientData } from './payload.ts';

const DEFAULT_AMBIENT = '/Lights/_(AmbientLight)/0_Default_AmbientLight.xdb';

const ambientVec3 = (xml: string, tag: string): number[] | null => {
  const m = xml.match(new RegExp(`<${tag}>\\s*<x>([^<]*)</x>\\s*<y>([^<]*)</y>\\s*<z>([^<]*)</z>`));
  return m ? [+m[1]!, +m[2]!, +m[3]!] : null;
};

/** What loadAmbient needs beyond the colours: how to decode the sky dome model. */
export interface AmbientGeomOptions { readXdb: ReadXdb; texSize: number }

export function loadAmbient(data: Assets, href: string | null, geo?: AmbientGeomOptions): AmbientData | null {
  try {
    const p = data.path((href ?? DEFAULT_AMBIENT).split('#')[0]!);
    if (!existsSync(p)) {
      // A named preset that is missing falls back to the stock default — the
      // floor should still light like a map, just not like THIS map.
      return href ? loadAmbient(data, null, geo) : null;
    }
    const xml = readFileSync(p, 'utf8');
    // The preset's <SkyDome>: a real drawable model (unlike its <Sky>, below) —
    // the backdrop the game draws behind everything. Decoded like any placed
    // object's model; its materials already say the rest (L_SELFILLUM,
    // IgnoreZBuffer). 88 shipped presets name none.
    const domeHref = xml.match(/<SkyDome\s+href="([^"#]+)/)?.[1] ?? null;
    const domeXml = geo && domeHref ? geo.readXdb(domeHref) : null;
    const dome = domeXml && geo ? decodeModelGeom(domeXml, domeHref!, data, geo.readXdb, geo.texSize) : null;
    const light = ambientVec3(xml, 'LightColor');
    const ambient = ambientVec3(xml, 'AmbientColor');
    const shade = ambientVec3(xml, 'ShadeColor');
    if (!light || !ambient || !shade) return null;
    // The fourth colour: the sun end of the same three-way mix for a surface
    // the sun does not reach. A preset that names none is shaded as if the
    // shadow were as bright as the sun, i.e. no shadow at all — so falling back
    // to `light` is the safe reading of a missing field.
    const incident = ambientVec3(xml, 'IncidentShadowColor') ?? light;
    const num = (tag: string, fallback: number): number => {
      const v = +(xml.match(new RegExp(`<${tag}>([^<]*)`))?.[1] ?? NaN);
      return Number.isFinite(v) ? v : fallback;
    };
    const pitch = num('Pitch', 45), yaw = num('Yaw', 0);
    // 100 is the engine's "follow the sun" sentinel, not an angle (§3b).
    const shadowPitch = num('ShadowPitch', 100), shadowYaw = num('ShadowYaw', 100);
    const followsSun = shadowPitch === 100;
    const maxShadowHeight = num('MaxShadowHeight', 0) || 20;

    // NOT read: the preset's <Sky> cubemap. Every adventure-map preset points
    // at the same /Textures/RefMaps set, and those are blurred highlight blobs
    // for glossy REFLECTIONS, not a drawable backdrop — the game's adventure
    // camera never shows a sky. Drawn as a background they look like lens
    // flares pasted on the void.
    return {
      light, ambient, shade, incident,
      pitch, yaw,
      shadowPitch: followsSun ? pitch : shadowPitch,
      shadowYaw: followsSun ? yaw : shadowYaw,
      maxShadowHeight,
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
      ...(dome ? { dome } : {}),
    };
  } catch { return null; }
}
