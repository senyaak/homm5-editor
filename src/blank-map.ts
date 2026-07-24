// Generate a blank map.xdb (`<AdvMapDesc>`) from scratch — the map-document half
// of "New Map". Paired with buildBlankTerrain (src/terrain-blank.ts) and the
// sibling text files, it makes a complete, loadable map project.
//
// A fresh map's document is a large but entirely FIXED skeleton — decoded from
// the pristine blanks the original editor exports, which differ across every
// size and level count in only a handful of places:
//
//   * TileX / TileY            the map size (72 … 320)
//   * HasUnderground and the two lines that follow from it (the underground
//     terrain ref and ambient-light slot)
//   * <spellIDs> / <artifactIDs>   the enabled-everything rosters
//
// Everything else — eight identical neutral player slots, eight scenario-info
// entries, the primary "defeat all" objective, the RMG defaults, the empty
// lists — is byte-for-byte constant. So this module writes that skeleton in
// code (not a shipped game file) and fills those holes: the size and level from
// the caller, and the two rosters from the live registry (so mod-added spells
// and artifacts flow in on their own — the editor "enables everything"). The
// result is byte-identical to the editor's own blank (tools/test-blank-map.ts).
//
// The map's visible name lives in the sibling name.txt, not here, so it is not a
// parameter of the document.

const NL = '\r\n'; // the game writes map.xdb with CRLF line endings

/** What buildBlankMap needs: size, level count, and the enabled rosters. */
export interface BlankMapOptions {
  /** TileX = TileY, one of the New Map sizes (72, 96, 136, 176, 216, 256, 320). */
  tiles: number;
  /** A second (underground) floor. */
  twoLevel: boolean;
  /** Every spell id (registry.spells()) — the map enables them all by default. */
  spells: string[];
  /** Every artifact id (registry.artifacts()). */
  artifacts: string[];
}

// One neutral, inactive player slot — identical for all eight in a fresh map.
const PLAYER = [
  '\t\t\t<MainTown/>',
  '\t\t\t<MainHero/>',
  '\t\t\t<ActivePlayer>false</ActivePlayer>',
  '\t\t\t<Team>0</Team>',
  '\t\t\t<CanBeHumanPlayer>true</CanBeHumanPlayer>',
  '\t\t\t<CanBeComputerPlayer>true</CanBeComputerPlayer>',
  '\t\t\t<Behaviour>PB_RANDOM</Behaviour>',
  '\t\t\t<CaptureAbility>0</CaptureAbility>',
  '\t\t\t<StartHero/>',
  '\t\t\t<HeroInTown>false</HeroInTown>',
  '\t\t\t<ReserveHeroes/>',
  '\t\t\t<AddHeroTrigger>',
  '\t\t\t\t<Action>',
  '\t\t\t\t\t<FunctionName/>',
  '\t\t\t\t</Action>',
  '\t\t\t</AddHeroTrigger>',
  '\t\t\t<RemoveHeroTrigger>',
  '\t\t\t\t<Action>',
  '\t\t\t\t\t<FunctionName/>',
  '\t\t\t\t</Action>',
  '\t\t\t</RemoveHeroTrigger>',
  '\t\t\t<VictoryMessageRef href=""/>',
  '\t\t\t<DefeatMessageRef href=""/>',
  '\t\t\t<Race>TOWN_NO_TYPE</Race>',
  '\t\t\t<Colour>PCOLOR_NEUTRAL</Colour>',
  '\t\t\t<CanBeDisabled>true</CanBeDisabled>',
  '\t\t\t<Attractors/>',
  '\t\t\t<DefaultBonus>PLAYER_BONUS_RANDOM</DefaultBonus>',
  '\t\t\t<CanChangeBonus>true</CanChangeBonus>',
  '\t\t\t<TavernFilter>',
  '\t\t\t\t<BannedHeroesRaces/>',
  '\t\t\t\t<BannedHeroes/>',
  '\t\t\t\t<AllowedHeroes/>',
  '\t\t\t</TavernFilter>',
  '\t\t\t<DenyFogOfWarForAllies/>',
];

// The <Award> body shared by scenario-info and objective items. Written at the
// scenario item's depth (tag at 3 tabs); the objective indents it three deeper.
const AWARD = [
  '\t\t\t<Award>',
  '\t\t\t\t<Type>AWARD_NONE</Type>',
  '\t\t\t\t<Experience>0</Experience>',
  '\t\t\t\t<Resources>',
  '\t\t\t\t\t<Wood>0</Wood>',
  '\t\t\t\t\t<Ore>0</Ore>',
  '\t\t\t\t\t<Mercury>0</Mercury>',
  '\t\t\t\t\t<Crystal>0</Crystal>',
  '\t\t\t\t\t<Sulfur>0</Sulfur>',
  '\t\t\t\t\t<Gem>0</Gem>',
  '\t\t\t\t\t<Gold>0</Gold>',
  '\t\t\t\t</Resources>',
  '\t\t\t\t<Attribute>HERO_ATTRIB_DEFENCE</Attribute>',
  '\t\t\t\t<AttributeAmount>0</AttributeAmount>',
  '\t\t\t\t<ArtifactID>ARTIFACT_NONE</ArtifactID>',
  '\t\t\t\t<SpellID>SPELL_NONE</SpellID>',
  '\t\t\t\t<ArmySlot>',
  '\t\t\t\t\t<Creature>CREATURE_UNKNOWN</Creature>',
  '\t\t\t\t\t<Count>0</Count>',
  '\t\t\t\t</ArmySlot>',
  '\t\t\t\t<SpellPoints>0</SpellPoints>',
  '\t\t\t\t<Morale>0</Morale>',
  '\t\t\t\t<Luck>0</Luck>',
  '\t\t\t\t<SkillWithMastery>',
  '\t\t\t\t\t<Mastery>MASTERY_NONE</Mastery>',
  '\t\t\t\t\t<SkillID>HERO_SKILL_NONE</SkillID>',
  '\t\t\t\t</SkillWithMastery>',
  '\t\t\t</Award>',
];

// A <TargetGlance> body (tag at 3 tabs, the scenario item's depth).
const targetGlance = (radius: number, duration: number): string[] => [
  '\t\t\t<TargetGlance>',
  '\t\t\t\t<Target>',
  '\t\t\t\t\t<Type>ADV_TARGET_NONE</Type>',
  '\t\t\t\t\t<Name/>',
  '\t\t\t\t\t<Coords>',
  '\t\t\t\t\t\t<FloorID>0</FloorID>',
  '\t\t\t\t\t\t<cell>',
  '\t\t\t\t\t\t\t<x>0</x>',
  '\t\t\t\t\t\t\t<y>0</y>',
  '\t\t\t\t\t\t</cell>',
  '\t\t\t\t\t</Coords>',
  '\t\t\t\t</Target>',
  `\t\t\t\t<Radius>${radius}</Radius>`,
  `\t\t\t\t<Duration>${duration}</Duration>`,
  '\t\t\t</TargetGlance>',
];

// One <ScenarioInformation> entry. The eight differ only in the suffix on their
// caption/description file refs (scenario-caption.txt, scenario-caption.1.txt …).
const scenarioItem = (i: number): string[] => {
  const suf = i === 0 ? '' : `.${i}`;
  return [
    '\t\t<Item>',
    '\t\t\t<Name/>',
    `\t\t\t<CaptionFileRef href="scenario-caption${suf}.txt"/>`,
    '\t\t\t<ObscureCaptionFileRef href=""/>',
    `\t\t\t<DescriptionFileRef href="scenario-description${suf}.txt"/>`,
    '\t\t\t<ProgressCommentsFileRef/>',
    '\t\t\t<Kind>OBJECTIVE_KIND_SCENARIO_INFO</Kind>',
    '\t\t\t<Parameters/>',
    '\t\t\t<Timeout>-1</Timeout>',
    '\t\t\t<Holdout>-1</Holdout>',
    '\t\t\t<CheckDelay>-1</CheckDelay>',
    '\t\t\t<Dependencies/>',
    '\t\t\t<InstantVictory>false</InstantVictory>',
    ...targetGlance(10, 5000),
    ...AWARD,
    '\t\t\t<TakeContribution>false</TakeContribution>',
    '\t\t\t<CanUncomplete>false</CanUncomplete>',
    '\t\t\t<IsInitialyActive>true</IsInitialyActive>',
    '\t\t\t<IsInitialyVisible>true</IsInitialyVisible>',
    '\t\t\t<IsHidden>false</IsHidden>',
    '\t\t\t<Ignore>false</Ignore>',
    '\t\t\t<ShowCompleted>true</ShowCompleted>',
    '\t\t\t<NeedComplete>true</NeedComplete>',
    '\t\t\t<StateChangeTrigger>',
    '\t\t\t\t<Action>',
    '\t\t\t\t\t<FunctionName/>',
    '\t\t\t\t</Action>',
    '\t\t\t</StateChangeTrigger>',
    '\t\t\t<SoundActivated/>',
    '\t\t\t<SoundComplete/>',
    '\t\t\t<SoundFailed/>',
    '\t\t</Item>',
  ];
};

// The single primary objective — "defeat all" — inside Objectives/Primary/Common.
const PRIMARY_OBJECTIVE = [
  '\t\t\t\t\t<Item>',
  '\t\t\t\t\t\t<Name/>',
  '\t\t\t\t\t\t<CaptionFileRef href="objective-caption-text.txt"/>',
  '\t\t\t\t\t\t<ObscureCaptionFileRef href=""/>',
  '\t\t\t\t\t\t<DescriptionFileRef href="objective-desc-text.txt"/>',
  '\t\t\t\t\t\t<ProgressCommentsFileRef/>',
  '\t\t\t\t\t\t<Kind>OBJECTIVE_KIND_DEFEAT_ALL</Kind>',
  '\t\t\t\t\t\t<Parameters/>',
  '\t\t\t\t\t\t<Timeout>-1</Timeout>',
  '\t\t\t\t\t\t<Holdout>-1</Holdout>',
  '\t\t\t\t\t\t<CheckDelay>0</CheckDelay>',
  '\t\t\t\t\t\t<Dependencies/>',
  '\t\t\t\t\t\t<InstantVictory>true</InstantVictory>',
  // the objective sits three levels deeper than a scenario item, so its shared
  // glance/award bodies are indented three extra tabs.
  ...targetGlance(0, 0).map((l) => '\t\t\t' + l),
  ...AWARD.map((l) => '\t\t\t' + l),
  '\t\t\t\t\t\t<TakeContribution>false</TakeContribution>',
  '\t\t\t\t\t\t<CanUncomplete>false</CanUncomplete>',
  '\t\t\t\t\t\t<IsInitialyActive>true</IsInitialyActive>',
  '\t\t\t\t\t\t<IsInitialyVisible>true</IsInitialyVisible>',
  '\t\t\t\t\t\t<IsHidden>false</IsHidden>',
  '\t\t\t\t\t\t<Ignore>false</Ignore>',
  '\t\t\t\t\t\t<ShowCompleted>true</ShowCompleted>',
  '\t\t\t\t\t\t<NeedComplete>true</NeedComplete>',
  '\t\t\t\t\t\t<StateChangeTrigger>',
  '\t\t\t\t\t\t\t<Action>',
  '\t\t\t\t\t\t\t\t<FunctionName/>',
  '\t\t\t\t\t\t\t</Action>',
  '\t\t\t\t\t\t</StateChangeTrigger>',
  '\t\t\t\t\t\t<SoundActivated/>',
  '\t\t\t\t\t\t<SoundComplete/>',
  '\t\t\t\t\t\t<SoundFailed/>',
  '\t\t\t\t\t\t<AllowMultipleActivations>false</AllowMultipleActivations>',
  '\t\t\t\t\t\t<AllowMultipleCompletions>false</AllowMultipleCompletions>',
  '\t\t\t\t\t</Item>',
];

// A per-player empty objective bucket (eight of them, twice — primary/secondary).
const PS_ITEM = [
  '\t\t\t\t<Item>',
  '\t\t\t\t\t<Objectives/>',
  '\t\t\t\t\t<DieInWeekWithoutTowns>true</DieInWeekWithoutTowns>',
  '\t\t\t\t</Item>',
];

/** Build the blank `map.xdb` document text for the given options. */
export function buildBlankMap(opt: BlankMapOptions): string {
  const { tiles, twoLevel } = opt;
  const ug = twoLevel;
  const lines: string[] = [];
  const push = (...ls: string[]): void => { for (const l of ls) lines.push(l); };
  const rep = (block: string[], n: number): void => { for (let i = 0; i < n; i++) push(...block); };

  push(
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<AdvMapDesc>',
    '\t<CustomGameMap>true</CustomGameMap>',
    '\t<Version>3</Version>',
    `\t<TileX>${tiles}</TileX>`,
    `\t<TileY>${tiles}</TileY>`,
    `\t<HasUnderground>${ug}</HasUnderground>`,
    '\t<HasSurface>true</HasSurface>',
    '\t<InitialFloor>0</InitialFloor>',
    '\t<objects/>',
    '\t<Resources>',
    '\t\t<PointLights/>',
    '\t\t<SavesFilenames/>',
    '\t</Resources>',
    '\t<AmbientLight/>',
    '\t<UndergroundAmbientLight/>',
    '\t<GroundAmbientLights>',
    '\t\t<Item href="/Lights/_(AmbientLight)/0_Default_AmbientLight.xdb#xpointer(/AmbientLight)"/>',
    '\t</GroundAmbientLights>',
    '\t<UndergroundAmbientLights>',
    ug
      ? '\t\t<Item href="/Lights/_(AmbientLight)/Tests/Night.xdb#xpointer(/AmbientLight)"/>'
      : '\t\t<Item/>',
    '\t</UndergroundAmbientLights>',
    '\t<ReflectiveWater>false</ReflectiveWater>',
    '\t<tiles/>',
    '\t<regions/>',
    '\t<GroundTerrainFileName href="GroundTerrain.bin"/>',
    `\t<UndergroundTerrainFileName href="${ug ? 'UndergroundTerrain.bin' : ''}"/>`,
    '\t<NameFileRef href="name.txt"/>',
    '\t<DescriptionFileRef href="description.txt"/>',
    '\t<moons>',
  );
  rep(['\t\t<Item>', '\t\t\t<State>0</State>', '\t\t\t<RotationRate>0</RotationRate>', '\t\t</Item>'], 3);
  push(
    '\t</moons>',
    '\t<RandomMoons>true</RandomMoons>',
    '\t<HeroMaxLevel>0</HeroMaxLevel>',
    '\t<CustomTeams>false</CustomTeams>',
    '\t<players>',
  );
  for (let i = 0; i < 8; i++) { push('\t\t<Item>'); push(...PLAYER); push('\t\t</Item>'); }
  push(
    '\t</players>',
    '\t<CustomMapGoal>false</CustomMapGoal>',
    '\t<CustomGoal href=""/>',
    '\t<ScenarioInformation>',
  );
  for (let i = 0; i < 8; i++) push(...scenarioItem(i));
  push(
    '\t</ScenarioInformation>',
    '\t<Objectives>',
    '\t\t<Primary>',
    '\t\t\t<Common>',
    '\t\t\t\t<Objectives>',
    ...PRIMARY_OBJECTIVE,
    '\t\t\t\t</Objectives>',
    '\t\t\t\t<DieInWeekWithoutTowns>true</DieInWeekWithoutTowns>',
    '\t\t\t</Common>',
    '\t\t\t<PlayerSpecific>',
  );
  rep(PS_ITEM, 8);
  push(
    '\t\t\t</PlayerSpecific>',
    '\t\t</Primary>',
    '\t\t<Secondary>',
    '\t\t\t<Common>',
    '\t\t\t\t<Objectives/>',
    '\t\t\t\t<DieInWeekWithoutTowns>true</DieInWeekWithoutTowns>',
    '\t\t\t</Common>',
    '\t\t\t<PlayerSpecific>',
  );
  rep(PS_ITEM, 8);
  push(
    '\t\t\t</PlayerSpecific>',
    '\t\t</Secondary>',
    '\t</Objectives>',
    '\t<Birds/>',
    '\t<BirdsAmount>10</BirdsAmount>',
    '\t<Weather/>',
    '\t<Wind/>',
    '\t<PreLight/>',
    '\t<MapScript/>',
    '\t<NewDayTrigger>',
    '\t\t<Action>',
    '\t\t\t<FunctionName/>',
    '\t\t</Action>',
    '\t</NewDayTrigger>',
    '\t<WarFogEnterTrigger>',
    '\t\t<Action>',
    '\t\t\t<FunctionName/>',
    '\t\t</Action>',
    '\t</WarFogEnterTrigger>',
    '\t<PWLTutorialHintTrigger/>',
    '\t<BorderSize>1</BorderSize>',
    '\t<spellIDs>',
  );
  for (const id of opt.spells) push(`\t\t<Item>${id}</Item>`);
  push('\t</spellIDs>', '\t<artifactIDs>');
  for (const id of opt.artifacts) push(`\t\t<Item>${id}</Item>`);
  push(
    '\t</artifactIDs>',
    '\t<isUntransferable/>',
    '\t<AvailableHeroes/>',
    '\t<MapRumours/>',
    '\t<Music/>',
    '\t<MoonCalendarModifications>',
    '\t\t<BlockMonstersWeeks>false</BlockMonstersWeeks>',
    '\t</MoonCalendarModifications>',
    '\t<thumbnailImages/>',
    '\t<PWLPicture/>',
    '\t<BanTransparency>false</BanTransparency>',
    '\t<MoonCalendar/>',
    '\t<StartScene/>',
    '\t<sRMGProps>',
    '\t\t<RMGmap>false</RMGmap>',
    '\t\t<RMGversion>1</RMGversion>',
    '\t\t<RMGstartseed>0</RMGstartseed>',
    '\t\t<RMGguid/>',
    '\t\t<InitialParams>',
    '\t\t\t<MapSize>MAP_SIZE_TINY</MapSize>',
    '\t\t\t<Players>0</Players>',
    '\t\t\t<Template/>',
    '\t\t\t<WaterAmount>WATER_NONE</WaterAmount>',
    '\t\t\t<MonsterLevel>MONSTER_LEVEL_WEAK</MonsterLevel>',
    '\t\t\t<HasUnderground>false</HasUnderground>',
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
    '\t\t\t<MapName/>',
    '\t\t\t<RandomTowns>false</RandomTowns>',
    '\t\t\t<Minimap>false</Minimap>',
    '\t\t\t<ResourceMultiplier>RESOURCE_MISERABLE</ResourceMultiplier>',
    '\t\t\t<ExpMultiplier>EXP_MISERABLE</ExpMultiplier>',
    '\t\t\t<Grail>false</Grail>',
    '\t\t</InitialParams>',
    '\t</sRMGProps>',
    '\t<dialogs/>',
    '\t<disabledArtifactSets/>',
    '\t<RacesRandomGroups/>',
    '\t<ImportantArtifacts>',
    '\t\t<PreservingArtifacts/>',
    '\t</ImportantArtifacts>',
    '\t<LoadingScreenSound/>',
    '\t<AdditionallyRollableHeroes/>',
    '</AdvMapDesc>',
  );

  return lines.join(NL) + NL; // trailing CRLF, as the editor writes it
}
