// Build a map's `map-tag.xdb` — the `<AdvMapDescTag>` index the game reads to
// LIST a map in its lobby (single scenario / custom game) without loading the
// whole map.xdb. A .h5m without this tag simply never appears in the menus:
// the browser indexes tags, not maps.
//
// Every field is derived from the map's own AdvMapDesc, so the tag is never a
// second source of truth — it is regenerated from the map each time it is
// packed. The shipped maps keep the tag as a real file beside map.xdb; we build
// it fresh at pack time instead, which cannot drift out of step with the map.
//
// The `<teams>` block is the one non-obvious part. Measured against the game's
// own maps (Maps/Scenario/*, Maps/Multiplayer/*): it carries one <Item> per
// player that occupies a lobby SLOT — a coloured player, PCOLOR_NEUTRAL excluded
// — and the value is the player's team, one-based (Team 0 -> 1, Team 1 -> 2).
// A2C1M1's two coloured players on teams 0 and 1 give <Item>1</Item><Item>2</Item>;
// a seven-player free-for-all gives seven <Item>1</Item>.

import type { XmlElement } from './xml.ts';
import { readTree } from './tree.ts';
import type { TreeData } from './tree.ts';

/** XML-escape a text or attribute value. */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** A scalar field of the desc, or a fallback when it is absent. */
function scalar(desc: Record<string, TreeData>, key: string, fallback = ''): string {
  const v = desc[key];
  return typeof v === 'string' ? v : fallback;
}

/**
 * Build the `<AdvMapDescTag>` document for a map, as latin1-ready UTF-8 text.
 * `desc` is the map's AdvMapDesc element (`map.desc`).
 */
export function buildMapTag(desc: XmlElement): string {
  const t = readTree(desc) as Record<string, TreeData>;

  // One team entry per coloured (lobby-occupying) player, team one-based.
  const players = Array.isArray(t.players) ? t.players : [];
  const teams: string[] = [];
  for (const p of players) {
    if (typeof p !== 'object' || Array.isArray(p)) continue;
    const colour = typeof p.Colour === 'string' ? p.Colour : '';
    if (!colour || colour === 'PCOLOR_NEUTRAL') continue;
    const team = parseInt(typeof p.Team === 'string' ? p.Team : '0', 10);
    teams.push(`\t\t<Item>${Math.max(1, (Number.isFinite(team) ? team : 0) + 1)}</Item>`);
  }
  const teamsBlock = teams.length ? `<teams>\n${teams.join('\n')}\n\t</teams>` : '<teams/>';

  // Thumbnails are optional and usually absent — a map without them lists with
  // the default preview. Carried across when the map does declare some.
  const thumbs = t.thumbnailImages;
  const thumbBlock = Array.isArray(thumbs) && thumbs.length
    ? `<thumbnailImages>\n${thumbs
      .map((h) => `\t\t<Item href="${esc(typeof h === 'string' ? h : '')}"/>`).join('\n')}\n\t</thumbnailImages>`
    : '<thumbnailImages/>';

  const name = scalar(t, 'NameFileRef', 'name.txt');
  const desc_ = scalar(t, 'DescriptionFileRef', 'description.txt');
  const tileX = scalar(t, 'TileX', '0');
  const tileY = scalar(t, 'TileY', '0');
  const customMapGoal = scalar(t, 'CustomMapGoal', 'false');
  const hasUnderground = scalar(t, 'HasUnderground', 'false');
  const customGameMap = scalar(t, 'CustomGameMap', 'false');

  return `<?xml version="1.0" encoding="UTF-8"?>
<AdvMapDescTag>
\t<AdvMapDesc href="map.xdb#xpointer(/AdvMapDesc)"/>
\t<NameFileRef href="${esc(name)}"/>
\t<DescriptionFileRef href="${esc(desc_)}"/>
\t<TileX>${esc(tileX)}</TileX>
\t<TileY>${esc(tileY)}</TileY>
\t<MapGoal href=""/>
\t<CustomMapGoal>${esc(customMapGoal)}</CustomMapGoal>
\t${teamsBlock}
\t${thumbBlock}
\t<HasUnderground>${esc(hasUnderground)}</HasUnderground>
\t<RandomMap>false</RandomMap>
\t<CustomGameMap>${esc(customGameMap)}</CustomGameMap>
\t<Version>3</Version>
</AdvMapDescTag>
`;
}
