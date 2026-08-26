// The artifact table, as the treasure-block distributor reads it — an id, a
// gold cost and the adventure-map shared the piles put on the ground.
//
// The pool is built once, in the distributor's constructor 0xED3B80: every
// artifact whose record says it may be generated, in ascending id order.
// Two ids are named there rather than filtered — 0 is skipped outright and
// 10 sits behind a context flag — but on a vanilla install both are refused
// by the flag anyway, so the naming only matters to a mod that turns them on.
//
// `CostOfGold` is +0x34 of the engine's record and `CanBeGeneratedToSell` is
// +0x3C (docs/engineInternals/ARTIFACTS_AND_EQUIPMENT.md). Nothing in the
// data is called "RMG": selling and scattering are the same permission.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { childText, find, findAll, parse } from '../format/xml.ts';

export interface ArtifactInfo {
  /** The index in the reference table — the `ARTIFACT_*` enum value. */
  id: number;
  name: string;
  /** `CostOfGold`; the distributor spends and measures a FIFTH of it. */
  cost: number;
  /** `CanBeGeneratedToSell` — false keeps it out of the pool. */
  generated: boolean;
  /** The `AdvMapArtifactShared` href, empty for ARTIFACT_NONE. */
  href: string;
}

/** Skipped by id in 0xED3B80 — 0 always, 10 unless the context says otherwise. */
export const ARTIFACT_NONE = 0;
export const ARTIFACT_SEXTANT = 10;

export function readArtifacts(dataRoot: string): ArtifactInfo[] {
  const root = parse(readFileSync(join(dataRoot, 'GameMechanics', 'RefTables', 'Artifacts.xdb'), 'utf8'));
  const table = find(root, 'Table_DBArtifact_ArtifactEffect');
  const objects = table ? find(table, 'objects') : null;
  if (!objects) return [];
  return findAll(objects, 'Item').map((item, id) => {
    // The record is inline here — unlike the creature table, nothing to load.
    const obj = find(item, 'obj');
    return {
      id,
      name: childText(item, 'ID'),
      cost: obj ? Number.parseInt(childText(obj, 'CostOfGold'), 10) || 0 : 0,
      generated: obj ? childText(obj, 'CanBeGeneratedToSell') === 'true' : false,
      href: (obj ? find(obj, 'ArtifactShared')?.attrs['href'] : undefined) ?? '',
    };
  });
}

/** The distributor's `+0x70`: the pool the treasure blocks pick from. */
export function rmgArtifactPool(all: readonly ArtifactInfo[], sextant = false): ArtifactInfo[] {
  return all.filter((a) =>
    a.id !== ARTIFACT_NONE && (sextant || a.id !== ARTIFACT_SEXTANT) && a.generated);
}
