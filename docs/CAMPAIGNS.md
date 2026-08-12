# Campaigns

How to build a campaign in this editor, and — more usefully — the handful of
things about the format that are not guessable and cost real debugging to find.
Everything below was checked against the game: against the campaigns it ships
(`UserMODs/All_campaigns.data.h5u`), against a campaign made by the game's own
editor, and by playing the result.

## What a campaign is

A campaign is a `<Campaign>` descriptor that binds a sequence of missions. It
**contains no maps**. Each mission points at a map by that map's `map-tag.xdb`,
by an absolute data-root path:

```xml
<MissionTag href="/Maps/SingleMissions/My Map/map-tag.xdb#xpointer(/AdvMapDescTag)"/>
```

The map travels separately, as its own archive — a `.h5m`, in our build out of
`H5E/` and in the shipped one out of `Maps/`. The game's VFS merges every archive by path, so the two meet
at load time. This is why packing a campaign
never touches a map, and why a campaign whose maps were never packed lists in
the menu and then fails to start.

## Where it goes

A user campaign is a `.h5c`, loaded from the game's **Modifications** menu — not
Single Player → Campaign, not a `.h5u` mod, and without touching
`Campaigns/CampaignsSets/Standart.xdb`.

**Which folder depends on which executable.** The shipped game scans
`<game>/UserCampaigns/`; our copy scans `<game>/H5E/` and nothing else, so that
is where the editor writes and where a campaign of ours belongs (see
[engineInternals/MODS_AND_MAPS.md](engineInternals/MODS_AND_MAPS.md)).
The archive's own contents are the same either way — the folder it sits in is
not part of it.

Inside, the layout is exactly:

```
UserCampaigns/<name>/campaign.xdb      <- the descriptor, named exactly that
UserCampaigns/<name>/CampaignName.txt  <- its texts, flat beside it
UserCampaigns/<name>/…
```

`<name>` is the `.h5c`'s own base name. Text refs are relative and flat, because
they resolve beside the descriptor. Texts are UTF-16 LE with a BOM.

## In the editor

**Campaigns…** in the toolbar opens the list. Create one, and you get the
Campaign dialog: name, short description, description, and the mission list with
Add / Edit / Remove / Up / Down. **Pack .h5c…** writes the archive.

A campaign here is a project folder under `<data>/Campaigns/<name>/`, holding
the same files that go into the archive — so packing is a copy, not a build, and
a campaign can be reopened and edited later. (The game's own editor can only
ever create one.)

Each mission has its own dialog: the map it plays on, its name and description,
the heroes it hands on, and three start-bonus slots.

Pack the campaign, pack each of its maps, and both belong where the executable
you launch reads them: `<game>/H5E/` for our build, `UserCampaigns/` and `Maps/`
for the shipped one. The dialogs offer our folder by default.

## The traps

These are the ones that cost time. Each produced a game that looked fine and
did the wrong thing.

### A mission is a MAP, and a map that cannot start takes the campaign with it

Four mistakes make the game refuse a map with one sentence —
`ERROR: Start player does not exist on map/…` — and they are properties of any
map, campaign or not: no active slot, an active slot left neutral, a live
player who owns neither hero nor town (an EntryPoint is not one, and its class
does not say so), and a victory condition satisfied at load. All four, with the
`Shared` hrefs that tell an EntryPoint from a hero, are in
[MAP_PROPERTIES.md](MAP_PROPERTIES.md#why-the-game-refuses-to-start-a-map),
along with `npm run test-startable`, which asks a map before it is launched.

What is campaign-specific is the LAST of them. A mission usually clears the
default `OBJECTIVE_KIND_DEFEAT_ALL` rather than giving itself an opponent, and
leaves the ending to its own quests: C1M1’s `Primary/Common/Objectives` is
empty for exactly that reason, and its four quests live in `PlayerSpecific[0]`.

### An empty reference is a bare element, never `href=""`

No campaign the game ships, nor the one its own editor writes, contains a single
`href=""`. An empty reference is written as the bare element:

```xml
<TargetCampaign/>          <!-- right -->
<TargetCampaign href=""/>  <!-- silently breaks the handover -->
```

A hero whose `TargetCampaign` carried an empty `href` was simply never handed
on. Nothing errored. `saveCampaign()` strips them now.

Note this is campaign-specific: maps legitimately write `href=""` (a blank map
has `<VictoryMessageRef href=""/>`).

## Carrying a hero between missions

`HeroesPool` on a mission lists the heroes it hands on:

```xml
<HeroesPool>
  <Count>1</Count>
  <Heroes>
    <Item>
      <HeroScriptName>Isabell</HeroScriptName>
      <TargetCampaign/>
      <TargetMission>1</TargetMission>
    </Item>
  </Heroes>
</HeroesPool>
```

* **`HeroScriptName` is the CHARACTER's name** — the `<InternalName>` of the
  hero's `*.(AdvMapHeroShared).xdb` (`Isabell`, `Godric`, `Agrael`, …). It is
  **not** the `<Name>` of the object standing on the map; that one is the handle
  the map's Lua uses, and it is often empty.

  The proof is in the shipped campaign: C1 hands on `Isabell` at every step, and
  C1M2 and C1M3 receive her while the Isabell standing on them has no `<Name>`
  at all. A made-up name matches no character, so the hero is never handed on —
  the next mission just starts with the hero its own map holds, at level 1, with
  no error anywhere.

* **`TargetMission` is a 0-based index** of the destination mission. Every
  shipped campaign hands on to the next one, so mission *i* writes *i+1*. The
  last mission hands on to nobody.

* **`Count` is the length of the list.** The game's editor offers four slots.

* **The receiving map places the hero itself.** C1M2 holds an Isabell for the
  Isabell it is about to receive; the arriving hero takes her place, carrying his
  level, skills and army. This is also what gives the mission a start player.

* `TargetCampaign` is empty to stay in this campaign, or references another
  `Campaign` document to send the hero elsewhere (C1 does this into C2 and C3).

### Start bonuses

A mission offers **three** bonus slots or none at all — those are the only two
shapes the shipped campaigns use. An unused slot is `E_BONUS_NONE`. Each kind
uses its own field: artifact, creatures (`BonusArmy`), a spell, resources (the
resource *is* whichever field of `BonusResources` is non-zero), or a town
building.

## Still open

* **What an EntryPoint is actually for.** Not one of the 93 maps in the shipped
  campaigns uses one, and the hero a campaign hands on does not need it — he
  arrives on his own placed copy. A hired hero has no copy waiting, which makes
  an arrival point the obvious guess, but that is a guess.
* **How C1M5 receives its hero.** It holds no hero object at all — only an
  `AdvMapPrison`. Worth reading before building a chain longer than a couple of
  missions.

## Where the code is

| file | what it does |
| --- | --- |
| `src/campaign/campaign.schema.json` | the `<Campaign>` schema — **property order matters**, these are serialized structs |
| `src/campaign/campaign.ts` | build / load / save a descriptor (and strip empty hrefs) |
| `src/campaign/campaign-project.ts` | the project folder: texts, the mission list, hero pools, bonuses |
| `src/campaign/campaign-pack.ts` | `packCampaign` → `.h5c`, and `campaignMaps` (which `.h5m` you still owe) |
| `electron/channels/campaigns.ts` | the `campaign:*` IPC, including resolving a map's heroes to their characters |
| `renderer/app.ts` | the three dialogs |
| `tools/test-campaign.ts` | the format checks, held against a real editor-made campaign when one is present |
| `e2e/campaign.spec.ts` | a one-mission campaign, assembled in the app |
| `e2e/campaign-three.spec.ts` | three missions carrying a hero — the one that proves the handover |
