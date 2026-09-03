// The map.xdb emitter — the finished run's object list rendered the way
// the ENGINE writes it, laid over the blank-map skeleton.
//
// The RMG's map.xdb is the editor's fixed AdvMapDesc skeleton with a
// handful of value-level differences (buildBlankMap already emits the
// same element sequence byte for byte), plus the <objects> block. So
// this module renders the objects — one fixed body per AdvMap type, the
// field order the engine's serializer uses — and patches the skeleton's
// known lines: the drawn ambient light, the text-file refs, the active
// player slots, the empty rosters (an RMG map enables nothing), the
// minimap thumbnail, the live sRMGProps and the dialogs camera.
//
// Every patch replaces a UNIQUE marker exactly once and throws when the
// marker is missing — if blank-map.ts ever drifts, the emitter says so
// instead of silently emitting a hybrid.
//
// Numbers: Rot is the engine's `%g` of the stored f32 — six significant
// digits, trailing zeros trimmed. Positions are integers.

import { buildBlankMap } from '../map/blank-map.ts';

const NL = '\r\n';

/** `%g` with MSVC's default 6 significant digits, of the stored f32. */
export function fmtRot(v: number): string {
  const f = Math.fround(v);
  if (f === 0) return '0';
  const s = String(Number(f.toPrecision(6)));
  // No reference run has ever written an exponent-form Rot; refuse to
  // guess the CRT's exponent style rather than get it quietly wrong.
  if (s.includes('e')) throw new Error(`Rot ${v} needs %g exponent form — unhandled`);
  return s;
}

/** What one object's map entry needs — tools/rmg-run.ts records satisfy it. */
/** What the generator writes into `<dialogs>` for every map it makes. */
export const RMG_CAMERA = {
  rod: '335.585', pitch: '-0.54063', yaw: '5.93275', fov: '35',
  anchor: ['94.785', '59.4308', '2'] as [string, string, string],
};

export interface EmitObject {
  name: string;
  x: number;
  y: number;
  z: number;
  rot: number;
  floor: number;
  /** The full Shared href, xpointer included. */
  shared?: string;
  army?: { stacks: Array<{ creature: string; amount: number }>; mood: number };
  amount?: number | null;
  town?: { playerId: number; hasTavern: boolean; specialization?: string };
  /** The `<pointLights>` items — underground towns and lit crystals. */
  lights?: Array<{ x: number; y: number; z: number; color: readonly [number, number, number]; radius: number }>;
  /** Monoliths: the pair's GroupID (a plain AdvMapBuilding field). */
  groupId?: number;
  /** Shipyards: the ShipTile the engine computed (derivation unread). */
  shipTile?: readonly [number, number];
  /** Dwellings of tier >= 3: the enabled-creature switch. */
  creaturesEnabled?: number[];
}

const MOODS: Record<number, string> = {
  0: 'MONSTER_MOOD_AGGRESSIVE', 1: 'MONSTER_MOOD_FRIENDLY',
  2: 'MONSTER_MOOD_HOSTILE', 3: 'MONSTER_MOOD_WILD',
};

const CAPTURE_TRIGGER = [
  '\t\t\t\t<CaptureTrigger>',
  '\t\t\t\t\t<Action>',
  '\t\t\t\t\t\t<FunctionName/>',
  '\t\t\t\t\t</Action>',
  '\t\t\t\t</CaptureTrigger>',
];

const RESOURCES_ZERO = [
  '\t\t\t\t<Resources>',
  '\t\t\t\t\t<Wood>0</Wood>',
  '\t\t\t\t\t<Ore>0</Ore>',
  '\t\t\t\t\t<Mercury>0</Mercury>',
  '\t\t\t\t\t<Crystal>0</Crystal>',
  '\t\t\t\t\t<Sulfur>0</Sulfur>',
  '\t\t\t\t\t<Gem>0</Gem>',
  '\t\t\t\t\t<Gold>0</Gold>',
  '\t\t\t\t</Resources>',
];

/** The `AdvMap*` element name, read off the Shared href's xpointer tag. */
function typeOf(o: EmitObject): string {
  const tag = /#xpointer\(\/(\w+)Shared\)/.exec(o.shared ?? '')?.[1];
  if (!tag) throw new Error(`${o.name}: no Shared tag to derive the type from (${o.shared})`);
  return tag;
}

/** One object's `<Item>` block, exactly as the engine's serializer writes it. */
export function renderObject(o: EmitObject): string[] {
  const type = typeOf(o);
  const lights = o.lights?.length
    ? [
        '\t\t\t\t<pointLights>',
        ...o.lights.flatMap((l) => [
          '\t\t\t\t\t<Item>',
          '\t\t\t\t\t\t<Pos>',
          `\t\t\t\t\t\t\t<x>${l.x}</x>`,
          `\t\t\t\t\t\t\t<y>${l.y}</y>`,
          `\t\t\t\t\t\t\t<z>${l.z}</z>`,
          '\t\t\t\t\t\t</Pos>',
          '\t\t\t\t\t\t<Color>',
          `\t\t\t\t\t\t\t<x>${fmtRot(l.color[0])}</x>`,
          `\t\t\t\t\t\t\t<y>${fmtRot(l.color[1])}</y>`,
          `\t\t\t\t\t\t\t<z>${fmtRot(l.color[2])}</z>`,
          '\t\t\t\t\t\t</Color>',
          `\t\t\t\t\t\t<Radius>${l.radius}</Radius>`,
          '\t\t\t\t\t</Item>',
        ]),
        '\t\t\t\t</pointLights>',
      ]
    : ['\t\t\t\t<pointLights/>'];
  const head = [
    `\t\t<Item href="#n:inline(${type})" id="${o.name}">`,
    `\t\t\t<${type}>`,
    '\t\t\t\t<Pos>',
    `\t\t\t\t\t<x>${o.x}</x>`,
    `\t\t\t\t\t<y>${o.y}</y>`,
    `\t\t\t\t\t<z>${o.z}</z>`,
    '\t\t\t\t</Pos>',
    `\t\t\t\t<Rot>${fmtRot(o.rot)}</Rot>`,
    `\t\t\t\t<Floor>${o.floor}</Floor>`,
    '\t\t\t\t<Name/>',
    '\t\t\t\t<CombatScript/>',
    ...lights,
    `\t\t\t\t<Shared href="${o.shared}"/>`,
  ];
  const tail = [`\t\t\t</${type}>`, '\t\t</Item>'];

  const body = ((): string[] => {
    switch (type) {
      case 'AdvMapStatic':
        return [
          '\t\t\t\t<IsRemovable>false</IsRemovable>',
          '\t\t\t\t<TerrainAligned>false</TerrainAligned>',
          '\t\t\t\t<ScalePercent>100</ScalePercent>',
        ];
      case 'AdvMapTreasure':
        return [
          `\t\t\t\t<IsCustom>${o.amount != null}</IsCustom>`,
          `\t\t\t\t<Amount>${o.amount ?? 0}</Amount>`,
          '\t\t\t\t<MessageFileRef href=""/>',
        ];
      case 'AdvMapArtifact':
        return [
          '\t\t\t\t<armySlots/>',
          '\t\t\t\t<MessageFileRef href=""/>',
          '\t\t\t\t<spellID>SPELL_NONE</spellID>',
          '\t\t\t\t<RandomShiftRadius>0</RandomShiftRadius>',
          '\t\t\t\t<untransferable>false</untransferable>',
        ];
      case 'AdvMapShrine':
        return ['\t\t\t\t<SpellID>SPELL_NONE</SpellID>'];
      case 'AdvMapMine':
        return [
          '\t\t\t\t<PlayerID>PLAYER_NONE</PlayerID>',
          ...CAPTURE_TRIGGER,
          '\t\t\t\t<armySlots/>',
          '\t\t\t\t<CreatureSwapBlockedForAI>false</CreatureSwapBlockedForAI>',
        ];
      case 'AdvMapBuilding':
        return [
          '\t\t\t\t<PlayerID>PLAYER_NONE</PlayerID>',
          ...CAPTURE_TRIGGER,
          `\t\t\t\t<GroupID>${o.groupId ?? 0}</GroupID>`,
          '\t\t\t\t<showCameras/>',
        ];
      case 'AdvMapShipyard':
        return [
          '\t\t\t\t<ShipTile>',
          `\t\t\t\t\t<x>${o.shipTile?.[0] ?? 0}</x>`,
          `\t\t\t\t\t<y>${o.shipTile?.[1] ?? 0}</y>`,
          '\t\t\t\t</ShipTile>',
        ];
      case 'AdvMapPrison':
        return [
          '\t\t\t\t<PrisonedHero/>',
          '\t\t\t\t<RandomHero>true</RandomHero>',
        ];
      case 'AdvMapAbanMine':
        return [
          '\t\t\t\t<AvailableResources>',
          ...[0, 0, 1, 1, 1, 1, 1].map((v) => `\t\t\t\t\t<Item>${v}</Item>`),
          '\t\t\t\t</AvailableResources>',
          ...CAPTURE_TRIGGER,
        ];
      case 'AdvMapDwelling':
        return [
          '\t\t\t\t<PlayerID>PLAYER_NONE</PlayerID>',
          ...CAPTURE_TRIGGER,
          '\t\t\t\t<RandomCreatures>false</RandomCreatures>',
          ...(o.creaturesEnabled?.length
            ? [
                '\t\t\t\t<creaturesEnabled>',
                ...o.creaturesEnabled.map((v) => `\t\t\t\t\t<Item>${v}</Item>`),
                '\t\t\t\t</creaturesEnabled>',
              ]
            : ['\t\t\t\t<creaturesEnabled/>']),
          '\t\t\t\t<RndSource>RND_NONE</RndSource>',
          '\t\t\t\t<LinkToPlayer>PLAYER_NONE</LinkToPlayer>',
          '\t\t\t\t<LinkToTown/>',
        ];
      case 'AdvMapMonster': {
        const army = o.army!;
        const extra = army.stacks.slice(1);
        return [
          '\t\t\t\t<Custom>true</Custom>',
          `\t\t\t\t<Amount>${army.stacks[0]!.amount}</Amount>`,
          '\t\t\t\t<Amount2>0</Amount2>',
          '\t\t\t\t<AttackType>ATTACK_ANY</AttackType>',
          '\t\t\t\t<MoveType>MOVE_ANY</MoveType>',
          '\t\t\t\t<DoesNotGrow>false</DoesNotGrow>',
          '\t\t\t\t<MessageFileRef href=""/>',
          '\t\t\t\t<Script/>',
          ...RESOURCES_ZERO,
          '\t\t\t\t<ArtifactID>ARTIFACT_NONE</ArtifactID>',
          `\t\t\t\t<Mood>${MOODS[army.mood]}</Mood>`,
          '\t\t\t\t<Courage>MONSTER_COURAGE_CAN_FLEE_JOIN</Courage>',
          '\t\t\t\t<AllowQuickCombat>true</AllowQuickCombat>',
          '\t\t\t\t<DoesNotDependOnDifficulty>false</DoesNotDependOnDifficulty>',
          ...(extra.length
            ? [
                '\t\t\t\t<AdditionalStacks>',
                ...extra.flatMap((s) => [
                  '\t\t\t\t\t<Item>',
                  `\t\t\t\t\t\t<Creature>${s.creature}</Creature>`,
                  '\t\t\t\t\t\t<CustomAmount>true</CustomAmount>',
                  `\t\t\t\t\t\t<Amount>${s.amount}</Amount>`,
                  '\t\t\t\t\t\t<Amount2>0</Amount2>',
                  '\t\t\t\t\t</Item>',
                ]),
                '\t\t\t\t</AdditionalStacks>',
              ]
            : ['\t\t\t\t<AdditionalStacks/>']),
          '\t\t\t\t<SingleMonsterNameFileRef href=""/>',
          '\t\t\t\t<MultipleMonstersNameFileRef href=""/>',
          '\t\t\t\t<RacesRandomGroupID>0</RacesRandomGroupID>',
          '\t\t\t\t<relationsOverrides/>',
        ];
      }
      case 'AdvMapTown': {
        const t = o.town!;
        return [
          `\t\t\t\t<PlayerID>${t.playerId ? `PLAYER_${t.playerId}` : 'PLAYER_NONE'}</PlayerID>`,
          ...CAPTURE_TRIGGER,
          '\t\t\t\t<HeroDeployTrigger>',
          '\t\t\t\t\t<Action>',
          '\t\t\t\t\t\t<FunctionName/>',
          '\t\t\t\t\t</Action>',
          '\t\t\t\t</HeroDeployTrigger>',
          '\t\t\t\t<ShipTile>',
          '\t\t\t\t\t<x>0</x>',
          '\t\t\t\t\t<y>0</y>',
          '\t\t\t\t</ShipTile>',
          `\t\t\t\t<Specialization href="${t.specialization
            ? t.specialization.includes('#xpointer')
              ? t.specialization
              : `${t.specialization}#xpointer(/TownSpecialization)`
            : ''}"/>`,
          '\t\t\t\t<buildings>',
          '\t\t\t\t\t<Item>',
          '\t\t\t\t\t\t<Type>TB_TOWN_HALL</Type>',
          '\t\t\t\t\t\t<InitialUpgrade>BLD_UPG_1</InitialUpgrade>',
          '\t\t\t\t\t\t<MaxUpgrade>BLD_UPG_4</MaxUpgrade>',
          '\t\t\t\t\t</Item>',
          ...(t.hasTavern
            ? [
                '\t\t\t\t\t<Item>',
                '\t\t\t\t\t\t<Type>TB_TAVERN</Type>',
                '\t\t\t\t\t\t<InitialUpgrade>BLD_UPG_1</InitialUpgrade>',
                '\t\t\t\t\t\t<MaxUpgrade>BLD_UPG_5</MaxUpgrade>',
                '\t\t\t\t\t</Item>',
              ]
            : []),
          '\t\t\t\t</buildings>',
          '\t\t\t\t<Editable>',
          '\t\t\t\t\t<NameFileRef href=""/>',
          '\t\t\t\t\t<BiographyFileRef href=""/>',
          '\t\t\t\t</Editable>',
          '\t\t\t\t<armySlots/>',
          '\t\t\t\t<spellIDs/>',
          '\t\t\t\t<CaptionFileRef href=""/>',
          '\t\t\t\t<GarrisonHero/>',
          '\t\t\t\t<Script/>',
          '\t\t\t\t<RndSource>RND_NONE</RndSource>',
          '\t\t\t\t<LinkToPlayer>PLAYER_NONE</LinkToPlayer>',
          '\t\t\t\t<LinkToTown/>',
          '\t\t\t\t<CanCaptureOnlyNotVisit>false</CanCaptureOnlyNotVisit>',
          '\t\t\t\t<AllowQuickCombat>true</AllowQuickCombat>',
          '\t\t\t\t<CreaturesUpgradesFilter>',
          '\t\t\t\t\t<ForbiddenBasicUpgradeTiers/>',
          '\t\t\t\t\t<ForbiddenAlterUpgradeTiers/>',
          '\t\t\t\t\t<NotUpgradeable/>',
          '\t\t\t\t\t<ForbiddenUpgrades/>',
          '\t\t\t\t</CreaturesUpgradesFilter>',
          '\t\t\t\t<GarrisonBlockedForAI>false</GarrisonBlockedForAI>',
          '\t\t\t\t<BannedRaces/>',
        ];
      }
      default:
        throw new Error(`${o.name}: no renderer for ${type}`);
    }
  })();

  return [...head, ...body, ...tail];
}

/** What buildRmgMapDesc patches over the blank skeleton. */
export interface RmgMapInput {
  tiles: number;
  twoLevel: boolean;
  objects: readonly EmitObject[];
  /** The drawn surface ambient light href (params list at setup's index). */
  groundAmbientLight: string;
  /** How many player slots are active (the first N). */
  players: number;
  /**
   * The dialog's Minimap tick. With it off the engine writes no minimap files
   * and points the thumbnail at a stock texture, and says so in the record —
   * two lines, and nothing else about the map changes.
   */
  minimap?: boolean;
  sRMG: {
    version: number;
    seed: number;
    guid: string;
    mapSize: string;
    template: string;
    waterAmount: string;
    monsterLevel: string;
    hasUnderground: boolean;
    races: string[];
    mapName: string;
  };
  /**
   * The dialogs camera. Not a derivation and not the operator's viewport: a
   * CONSTANT the map creation writes, identical across all three ordered
   * references (96 tiles and 72, with water and without) and, to the digits
   * its build prints, in a map ordered from the GAME's own generator too.
   * The anchor settles it — (94.785, 59.4308) sits OFF a 72-tile map and is
   * written there all the same. A hand-made Nival map carries a completely
   * different camera, so this is the generated-map default and nothing else.
   * Overridable, but nothing needs to.
   */
  camera?: { rod: string; pitch: string; yaw: string; fov: string; anchor: [string, string, string] };
}

/** Replace a unique marker exactly once, or throw. */
function patch(text: string, marker: string, replacement: string): string {
  const i = text.indexOf(marker);
  if (i < 0) throw new Error(`emit: marker not found: ${marker.slice(0, 60)}`);
  if (text.indexOf(marker, i + marker.length) >= 0) {
    throw new Error(`emit: marker not unique: ${marker.slice(0, 60)}`);
  }
  return text.slice(0, i) + replacement + text.slice(i + marker.length);
}

/** Replace the Nth occurrence (0-based) of a marker, or throw. */
function patchNth(text: string, marker: string, replacement: string, n: number): string {
  let i = -1;
  for (let k = 0; k <= n; k++) {
    i = text.indexOf(marker, i + 1);
    if (i < 0) throw new Error(`emit: occurrence ${n} of marker not found: ${marker.slice(0, 60)}`);
  }
  return text.slice(0, i) + replacement + text.slice(i + marker.length);
}

/** The RMG's map-tag.xdb — the lobby-facing summary next to map.xdb. */
export function buildRmgMapTag(input: {
  tiles: number; twoLevel: boolean; players: number;
  /** The order's Minimap tick — the tag carries the same thumbnail as the map. */
  minimap?: boolean;
}): string {
  const thumb = (floor: number): string => (input.minimap === false
    ? '\t\t<Item href="/UI/RMGScreen/GriffinPicAdopted.(Texture).xdb#xpointer(/Texture)"/>'
    : `\t\t<Item href="minimap_floor_0${floor}.xdb#xpointer(/Texture)"/>`);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<AdvMapDescTag>',
    '\t<AdvMapDesc href="map.xdb#xpointer(/AdvMapDesc)"/>',
    '\t<NameFileRef href="mapname-text-0.txt"/>',
    '\t<DescriptionFileRef href="mapdesc-text-0.txt"/>',
    `\t<TileX>${input.tiles}</TileX>`,
    `\t<TileY>${input.tiles}</TileY>`,
    '\t<MapGoal href="mapobjective-text-0.txt"/>',
    '\t<CustomMapGoal>true</CustomMapGoal>',
    '\t<teams>',
    ...Array.from({ length: input.players }, () => '\t\t<Item>1</Item>'),
    '\t</teams>',
    '\t<thumbnailImages>',
    thumb(1),
    ...(input.twoLevel ? [thumb(2)] : []),
    '\t</thumbnailImages>',
    `\t<HasUnderground>${input.twoLevel}</HasUnderground>`,
    '\t<RandomMap>true</RandomMap>',
    '\t<CustomGameMap>false</CustomGameMap>',
    '\t<Version>1</Version>',
    '</AdvMapDescTag>',
  ].join(NL) + NL;
}

/** The minimap's Texture document — one per floor, fixed but for the name. */
export function buildMinimapXdb(floor: number): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Texture>',
    '\t<SrcName href=""/>',
    `\t<DestName href="minimap_floor_0${floor + 1}.dds"/>`,
    '\t<Type>REGULAR</Type>',
    '\t<ConversionType>CONVERT_ORDINARY</ConversionType>',
    '\t<AddrType>CLAMP</AddrType>',
    '\t<Format>TF_8888</Format>',
    '\t<Width>256</Width>',
    '\t<Height>256</Height>',
    '\t<MappingSize>0</MappingSize>',
    '\t<NMips>1</NMips>',
    '\t<Gain>0</Gain>',
    '\t<AverageColor>0</AverageColor>',
    '\t<InstantLoad>true</InstantLoad>',
    '\t<IsDXT>false</IsDXT>',
    '\t<FlipY>false</FlipY>',
    '\t<StandardExport>true</StandardExport>',
    '\t<UseS3TC>false</UseS3TC>',
    '</Texture>',
  ].join(NL) + NL;
}

/** The whole map.xdb text for a finished RMG run. */
export function buildRmgMapDesc(input: RmgMapInput): string {
  let text = buildBlankMap({
    tiles: input.tiles, twoLevel: input.twoLevel, spells: [], artifacts: [],
  });

  // The objects.
  const items = input.objects.flatMap((o) => renderObject(o));
  text = patch(text, '\t<objects/>', ['\t<objects>', ...items, '\t</objects>'].join(NL));

  // The drawn ambient light; a two-level RMG map lights its underground
  // with the fixed Tests/underground document.
  text = patch(text,
    '\t\t<Item href="/Lights/_(AmbientLight)/0_Default_AmbientLight.xdb#xpointer(/AmbientLight)"/>',
    `\t\t<Item href="${input.groundAmbientLight}"/>`);
  if (input.twoLevel) {
    text = patch(text,
      '\t\t<Item href="/Lights/_(AmbientLight)/Tests/Night.xdb#xpointer(/AmbientLight)"/>',
      '\t\t<Item href="/Lights/_(AmbientLight)/Tests/underground.xdb#xpointer(/AmbientLight)"/>');
  }

  // The text-file refs.
  text = patch(text, '\t<NameFileRef href="name.txt"/>', '\t<NameFileRef href="mapname-text-0.txt"/>');
  text = patch(text, '\t<DescriptionFileRef href="description.txt"/>',
    '\t<DescriptionFileRef href="mapdesc-text-0.txt"/>');
  text = patch(text, '\t<CustomMapGoal>false</CustomMapGoal>', '\t<CustomMapGoal>true</CustomMapGoal>');
  text = patch(text, '\t<CustomGoal href=""/>', '\t<CustomGoal href="mapobjective-text-0.txt"/>');
  text = patch(text, 'href="objective-caption-text.txt"', 'href="objective-caption-text-0.txt"');
  text = patch(text, 'href="objective-desc-text.txt"', 'href="objective-desc-text-0.txt"');

  // The scenario-info refs: the first N players get generated texts (the
  // caption counter continues after the map name's caption-text-0..1),
  // the rest empty out.
  for (let i = 0; i < 8; i++) {
    const suf = i === 0 ? '' : `.${i}`;
    text = patch(text, `href="scenario-caption${suf}.txt"`,
      i < input.players ? `href="caption-text-${2 + i}.txt"` : 'href=""');
    text = patch(text, `href="scenario-description${suf}.txt"`,
      i < input.players ? `href="desc-text-${i}.txt"` : 'href=""');
  }

  // The active player slots.
  for (let i = 0; i < input.players; i++) {
    text = patchNth(text, '\t\t\t<ActivePlayer>false</ActivePlayer>',
      '\t\t\t<ActivePlayer>true</ActivePlayer>', 0);
    text = patchNth(text, '\t\t\t<HeroInTown>false</HeroInTown>',
      '\t\t\t<HeroInTown>true</HeroInTown>', 0);
  }

  // The empty rosters — an RMG map writes both self-closed.
  text = patch(text, `\t<spellIDs>${NL}\t</spellIDs>`, '\t<spellIDs/>');
  text = patch(text, `\t<artifactIDs>${NL}\t</artifactIDs>`, '\t<artifactIDs/>');

  // The minimap thumbnails — one per floor, or the stock picture when the
  // order asked for no minimap at all.
  const thumb = (floor: number): string => (input.minimap === false
    ? '\t\t<Item href="/UI/RMGScreen/GriffinPicAdopted.(Texture).xdb#xpointer(/Texture)"/>'
    : `\t\t<Item href="minimap_floor_0${floor}.xdb#xpointer(/Texture)"/>`);
  text = patch(text, '\t<thumbnailImages/>', [
    '\t<thumbnailImages>',
    thumb(1),
    ...(input.twoLevel ? [thumb(2)] : []),
    '\t</thumbnailImages>',
  ].join(NL));

  // sRMGProps, live.
  const s = input.sRMG;
  text = patch(text,
    [
      '\t<sRMGProps>',
      '\t\t<RMGmap>false</RMGmap>',
      '\t\t<RMGversion>1</RMGversion>',
      '\t\t<RMGstartseed>0</RMGstartseed>',
      '\t\t<RMGguid/>',
    ].join(NL),
    [
      '\t<sRMGProps>',
      '\t\t<RMGmap>true</RMGmap>',
      `\t\t<RMGversion>${s.version}</RMGversion>`,
      `\t\t<RMGstartseed>${s.seed}</RMGstartseed>`,
      `\t\t<RMGguid>${s.guid}</RMGguid>`,
    ].join(NL));
  text = patch(text, '\t\t\t<MapSize>MAP_SIZE_TINY</MapSize>', `\t\t\t<MapSize>${s.mapSize}</MapSize>`);
  text = patch(text, '\t\t\t<Players>0</Players>', `\t\t\t<Players>${input.players}</Players>`);
  text = patch(text, '\t\t\t<Template/>', `\t\t\t<Template href="${s.template}"/>`);
  text = patch(text, '\t\t\t<WaterAmount>WATER_NONE</WaterAmount>',
    `\t\t\t<WaterAmount>${s.waterAmount}</WaterAmount>`);
  text = patch(text, '\t\t\t<MonsterLevel>MONSTER_LEVEL_WEAK</MonsterLevel>',
    `\t\t\t<MonsterLevel>${s.monsterLevel}</MonsterLevel>`);
  text = patch(text, '\t\t\t<HasUnderground>false</HasUnderground>',
    `\t\t\t<HasUnderground>${s.hasUnderground}</HasUnderground>`);
  const playersInfo = s.races.flatMap((race) => [
    '\t\t\t\t<Item>',
    `\t\t\t\t\t<Race>${race}</Race>`,
    '\t\t\t\t\t<StartHero/>',
    '\t\t\t\t</Item>',
  ]);
  text = patch(text,
    [
      '\t\t\t<PlayersInfo>',
      '\t\t\t\t<Item>',
      '\t\t\t\t\t<Race>TOWN_SPECIAL</Race>',
      '\t\t\t\t\t<StartHero/>',
      '\t\t\t\t</Item>',
      '\t\t\t\t<Item>',
      '\t\t\t\t\t<Race>TOWN_SPECIAL</Race>',
      '\t\t\t\t\t<StartHero/>',
      '\t\t\t\t</Item>',
      '\t\t\t</PlayersInfo>',
    ].join(NL),
    ['\t\t\t<PlayersInfo>', ...playersInfo, '\t\t\t</PlayersInfo>'].join(NL));
  text = patch(text, '\t\t\t<MapName/>', `\t\t\t<MapName>${s.mapName}</MapName>`);
  if (input.minimap !== false) {
    text = patch(text, '\t\t\t<Minimap>false</Minimap>', '\t\t\t<Minimap>true</Minimap>');
  }
  text = patch(text, '\t\t\t<ResourceMultiplier>RESOURCE_MISERABLE</ResourceMultiplier>',
    '\t\t\t<ResourceMultiplier>RESOURCE_LITTLE</ResourceMultiplier>');
  text = patch(text, '\t\t\t<ExpMultiplier>EXP_MISERABLE</ExpMultiplier>',
    '\t\t\t<ExpMultiplier>EXP_LITTLE</ExpMultiplier>');

  // The dialogs camera.
  const cam = input.camera ?? RMG_CAMERA;
  text = patch(text, '\t<dialogs/>', [
    '\t<dialogs>',
    '\t\t<Item>',
    '\t\t\t<Sentences/>',
    '\t\t\t<Camera>',
    `\t\t\t\t<Rod>${cam.rod}</Rod>`,
    `\t\t\t\t<Pitch>${cam.pitch}</Pitch>`,
    `\t\t\t\t<Yaw>${cam.yaw}</Yaw>`,
    '\t\t\t\t<Roll>0</Roll>',
    `\t\t\t\t<FOV>${cam.fov}</FOV>`,
    '\t\t\t\t<ClipDistanceMin>1</ClipDistanceMin>',
    '\t\t\t\t<ClipDistanceMax>500</ClipDistanceMax>',
    '\t\t\t\t<Anchor>',
    `\t\t\t\t\t<x>${cam.anchor[0]}</x>`,
    `\t\t\t\t\t<y>${cam.anchor[1]}</y>`,
    `\t\t\t\t\t<z>${cam.anchor[2]}</z>`,
    '\t\t\t\t</Anchor>',
    '\t\t\t</Camera>',
    '\t\t\t<Floor>0</Floor>',
    '\t\t\t<BackgroundMusicVolume>100</BackgroundMusicVolume>',
    '\t\t\t<BackgroundGeneralSoundVolume>100</BackgroundGeneralSoundVolume>',
    '\t\t\t<BackgroundAmbientVolume>100</BackgroundAmbientVolume>',
    '\t\t\t<SpeechVolume>100</SpeechVolume>',
    '\t\t</Item>',
    '\t</dialogs>',
  ].join(NL));

  return text;
}
