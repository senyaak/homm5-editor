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
// The `<teams>` block is the one non-obvious part, and it was read wrong for a
// while: one <Item> per SIDE, holding how many players are in it — see
// teamSizes() below. The old reading — one item per active COLOURED player,
// holding the team number — fits 12 of the 69 shipped maps that carry a tag;
// the corrected one fits 68, and the single map it does not fit is our own,
// written by the rule it replaces.
//
// Both halves of the mistake matter. Colour is not a criterion at all: most
// shipped maps leave every slot PCOLOR_NEUTRAL, so skipping neutrals wrote
// `<teams/>` for them, and a tag claiming no sides is a map the lobby cannot
// start. And a value is a COUNT, not a team number: A2M5's
// <Item>2</Item><Item>2</Item> is two sides of two, matching its four active
// players — read as team numbers it would be two players and the map would list
// as half of itself.
//
// An inactive player is not a side either way — a fixed AI enemy the mission
// places but the lobby cannot pick.

import type { XmlElement } from '../format/xml.ts';
import { readTree } from '../schema/tree.ts';
import type { TreeData } from '../schema/tree.ts';

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
 * The `<teams>` block's numbers: one per SIDE, each the size of that side.
 *
 * Not one per player carrying a team number, which is what this used to write —
 * an easy thing to read into `<Item>1</Item><Item>1</Item>` and wrong on 57 of
 * the 69 shipped maps. A2M5 is the map that says it plainly: four active
 * players, `<Item>2</Item><Item>2</Item>` — two sides of two, not two players
 * on team 2.
 *
 * CustomTeams decides how the sides are drawn:
 *
 *   true   the `Team` field means it, and team 0 is a real team like any other.
 *          A2C2M1's three actives are all team 0 and its tag is `[3]`.
 *   false  the field is not being used, and every active player is a side of
 *          his own. A2M10's six actives are all team 0 and its tag is
 *          `[1,1,1,1,1,1]`.
 *
 * COLOUR HAS NOTHING TO DO WITH IT, which is the other half of the old rule and
 * the more damaging one: it skipped `PCOLOR_NEUTRAL` players, and most shipped
 * maps leave every slot neutral — A1L1 has four active neutral players and a
 * tag of four sides. Skipping them wrote `<teams/>` for maps like it, and a map
 * whose tag claims no sides is not a map the lobby can start.
 *
 * Measured against every shipped map that carries a tag: 68 of 69 agree. The
 * one that does not is our own `Sharpshooter Test`, written by the rule this
 * replaces.
 */
export function teamSizes(players: readonly TreeData[], customTeams: boolean): number[] {
  const active: number[] = [];
  for (const p of players) {
    if (typeof p !== 'object' || p === null || Array.isArray(p)) continue;
    if (p.ActivePlayer !== 'true') continue;
    const team = parseInt(typeof p.Team === 'string' ? p.Team : '0', 10);
    active.push(Number.isFinite(team) ? team : 0);
  }
  if (!customTeams) return active.map(() => 1);
  const sizes = new Map<number, number>();
  for (const team of active) sizes.set(team, (sizes.get(team) ?? 0) + 1);
  return [...sizes.entries()].sort((a, b) => a[0] - b[0]).map(([, n]) => n);
}

/**
 * Build the `<AdvMapDescTag>` document for a map, as latin1-ready UTF-8 text.
 * `desc` is the map's AdvMapDesc element (`map.desc`).
 */
export function buildMapTag(desc: XmlElement): string {
  const t = readTree(desc) as Record<string, TreeData>;

  const players = Array.isArray(t.players) ? t.players : [];
  const teams = teamSizes(players, scalar(t, 'CustomTeams', 'false') === 'true')
    .map((n) => `\t\t<Item>${n}</Item>`);
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
