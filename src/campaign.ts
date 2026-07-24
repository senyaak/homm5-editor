// Campaign document model — read, build and serialize a <Campaign> (the
// descriptor behind a .h5c). Deliberately thin: a campaign is edited through the
// same path-addressable tree layer as a map's settings (src/tree.ts + the
// schema in src/campaign.schema.json), so this only has to build a fresh one,
// load an existing one, and write it back. The missions inside reference their
// maps by map-tag; bundling those maps is the packer's job (not here).

import campaignSchemaJson from './campaign.schema.json' with { type: 'json' };
import type { HasDefs, FieldSchema } from './schema.ts';
import { deref } from './schema.ts';
import { buildEntity, buildItem } from './skeleton.ts';
import { parse, serialize, find, setText } from './xml.ts';
import type { XmlElement } from './xml.ts';

/** The campaign schema, typed as both a $defs root and a buildable field. */
export const campaignSchema = campaignSchemaJson as unknown as HasDefs & FieldSchema;

/** The `<Mission>` item schema, resolved once for building new missions. */
export function missionSchema(): FieldSchema {
  const missions = campaignSchema.properties?.Missions;
  if (!missions?.items) throw new Error('campaign schema has no Missions.items');
  return deref(campaignSchema, missions.items);
}

/**
 * A fresh `<Campaign>` document body, every field at its schema default: a user
 * campaign with no missions yet. `UserCampaign` is forced true — the whole point
 * of authoring one here is that the game lists it under Custom Campaigns.
 */
export function newCampaignBody(internalName: string): XmlElement {
  const el = buildEntity(campaignSchema, 'Campaign', campaignSchema, '\n');
  if (!el) throw new Error('campaign schema has no buildable fields');
  setChildText(el, 'InternalName', internalName);
  setChildText(el, 'UserCampaign', 'true');
  return el;
}

/** A fresh `<Item>` for the Missions list, indented to sit among its siblings. */
export function newMission(indent = '\n\t\t'): XmlElement {
  return buildItem(campaignSchema, missionSchema(), indent);
}

/** The `<Bonus>` item schema — one of a mission's start-bonus slots. */
export function bonusSchema(): FieldSchema {
  const def = campaignSchema.$defs?.Bonus;
  if (!def) throw new Error('campaign schema has no Bonus');
  return deref(campaignSchema, def);
}

/** A fresh `<Item>` for a mission's Bonuses list. */
export function newBonus(indent = '\n\t\t\t\t'): XmlElement {
  return buildItem(campaignSchema, bonusSchema(), indent);
}

/** The `<PoolHero>` item schema — one hero a mission hands on. */
export function poolHeroSchema(): FieldSchema {
  const def = campaignSchema.$defs?.PoolHero;
  if (!def) throw new Error('campaign schema has no PoolHero');
  return deref(campaignSchema, def);
}

/** A fresh `<Item>` for a mission's HeroesPool.Heroes list. */
export function newPoolHero(indent = '\n\t\t\t\t\t'): XmlElement {
  return buildItem(campaignSchema, poolHeroSchema(), indent);
}

/** Parse a Campaign document, returning its `<Campaign>` root element. */
export function loadCampaign(xmlText: string): XmlElement {
  const doc = parse(xmlText);
  const root = doc.name === 'Campaign' ? doc : find(doc, 'Campaign');
  if (!root) throw new Error('not a Campaign document (no <Campaign> root)');
  return root;
}

/** Serialize a `<Campaign>` root back to an .xdb document. */
export function saveCampaign(root: XmlElement): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${serialize(root)}\n`;
}

/** Set a scalar child's text — used for the fields New forces non-empty. */
function setChildText(el: XmlElement, name: string, value: string): void {
  const child = find(el, name);
  if (child) setText(child, value);
}
