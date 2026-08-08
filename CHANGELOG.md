# Changelog

What changed in each released build. The version here is the one the packaged
app reports and the one a `v*` tag publishes; `release.yml` lifts the matching
section into the release notes, so this file is what people read on GitHub.

Written for someone deciding whether to update: what was wrong, and what they
would have seen.

`## Unreleased` collects what has landed since the last tag. `release.yml` finds
its section by version number, so this heading is inert until it is renamed to
one.

## Unreleased

### Added

- **The extension logs only the file you asked about, and each launch writes its
  own file.** Every one of the mod's forty-five sources now carries its own
  switch, and a build cuts out the rest:

  ```
  npm run build-native -- --log combat/spell-resolve,lua/battle
  npm run build-native -- --list-log
  npm run build-native -- --log none
  ```

  What was wrong: all 395 places logged, always. A single spell cast wrote some
  fifteen lines per stack on the field, each one opening and closing the file
  and — in a battle — also being spoken into the game's own console through its
  Lua interpreter. The game stuttered, sometimes stopped, and the log itself was
  unreadable: hundreds of lines about everything at once, appended to the same
  file every launch since the mod was installed, with nothing marking where one
  run ended and the next began.

  Now the file is named for the moment the run started
  (`bin/homm5-editor-20260808-143012.log`, the last ten kept), and a build says
  only what it was asked to. It is the preprocessor doing the cutting, so a file
  nobody named leaves nothing behind at all — not the call and not the sentence.
  `--log none` builds a DLL with no logging in it whatsoever; without it, two
  things still speak, because they are how anybody learns the mod is there and
  what it did when it stopped: the roll-call of which hooks installed, and the
  crash report.

- **A specialization can give an ABILITY, not only a number.** Pick a spell of
  the mod's in the Ability box, and every hero holding that specialization knows
  it — beside whatever he already knew, on every map, whoever he is and however
  he got there.

  It is given ON THE MAP rather than written into the heroes the editor builds,
  and that is the whole of it: the mod ships a line in the game's global script
  that asks each hero which specialization he holds and teaches him what it
  promises. A hero the editor never wrote — one the map placed, one hired from a
  tavern — is given it just the same. Asking is the extension's half
  (`H5EHeroSpecialization`), because none of the game's own 306 script functions
  can say what specialization a hero has.

  It is a spell of the mod's rather than one of the four the engine keeps for
  this (`SPELL_ABILITY_CUSTOM1…4`) because four is a compiled ceiling in two
  places, and an entry in an enum the mod already appends to has none.

  Seen in game 07.08.2026: Gelu, whose specialization is his own, opens his book
  on the adventure map and the page is there.

- **A spell of your own does what your map's script says.** Clicking its page
  calls `onSpellCast(spell)`, and the gate that decides whether the page is even
  live asks `checkSpellCastable(spell)` — so the rules of a feature (is there
  anybody to train, is there gold) are written in Lua, where an author can write
  them, rather than compiled into the extension.

  Two functions come with it: `H5EAnswer(value)`, which is how a script's
  verdict gets back to the extension (running a line returns nothing, so the
  line calls it), and `H5ELog(number)`, which puts a number in the extension's
  log instead of the game's console — for a script measuring the engine.

  A map that defines neither is left exactly as it was.

- **The linter knows this game has no `type` and no `format`.** Neither is in
  the Lua the engine registers, alongside `getn`, `tostring` and `tonumber`, and
  a script that calls one dies where it stands. Both had been allowed because
  the strings exist in the executable — which proves only that something
  mentions the name. The allowed list now says, name by name, what backs it:
  `print`, `abs`, `sqrt`, `random`, `length` and `floor` are called by the
  game's own scripts or were measured in a run; the rest rest on that same weak
  reading, and say so.

- **The training spell is part of the mod now, not of a tool run by hand.** Its
  script and the questions the player reads are written by the build, whenever
  the mod carries the creature the training produces. Until this they reached
  the game through `_tmp/probe-train.ts`, which is to say a mod an editor built
  was a mod with a dead spell page in it and nothing said so. `mod-009` reads
  the packed archive and checks the whole chain fits together — creature, spell,
  both hooks, the dispatch by number, and a priced question per trainable kind.

- **A spell of a mod carries its own two hooks, and both branch on its number.**
  "May it be cast" and "what the click does" are the spell's, and the script that
  reaches them dispatches by the spell's id — so a mod with two spells does not
  have the second one answering the first one's page and running the first one's
  cast. The extension remembers a verdict PER SPELL for the same reason: one
  remembered answer belonged to whichever question came last.

- **The mod's sharpshooter is raised as a vampire lord**, not the skeleton archer
  the donor gives. Read out of the game's own raise table rather than reasoned
  about: all fifteen shipped shooters raise into skeleton archers and not one of
  them is tier 4; the two tier-4 shooters that exist are the succubus and her
  upgrade, and they raise into vampires and vampire lords. It is now edited in
  the creature dialog like every other difference from the donor, instead of
  being inherited silently.

- **A map's rule can tell whose spell it is.** `H5EIsCastingHero(heroName)`
  answers whether that name is the hero who cast, and `H5ECasterKnown()` whether
  anybody is casting at all — so a rule about a hero's army and a hero's gold is
  about the right hero. The script offers the names it already has out of
  `GetPlayerHeroes`; nothing is read off the hero, which is what a first attempt
  spent a run failing to do.

  The second of those matters as much as the first: without it a rule that could
  not find the caster fell back to any hero who could train, which lit one
  hero's page for another hero's archers — and then trained them. Knowing that
  somebody is casting turns that into a refusal.

- **A script can find out how full a hero's army is.** `H5EArmySlots(heroName)`
  answers how many of his seven slots are taken — the one thing about an army
  the engine tells nobody: `GetHeroCreatures` sums a kind over the whole army and
  `GetHeroCreaturesTypes` throws duplicates away, so a hero with two stacks of
  archers and five other kinds reads as six things in seven slots. His army
  looked roomy, the creature a script added had nowhere to go, and the game
  stopped to ask the player what to throw away.

- **A map's rule is now actually listened to.** There is no synchronous way into
  a map's Lua: `DoString` builds a thread called "Buffer thread" and leaves it
  for the scheduler, and so do triggers and `startThread`. So a gate that asked
  the rule and read the answer in the next breath read nothing, every time, and
  drew every page on the fallback — which is yes, and which is the whole of "the
  page is live with nothing to train", "live with no gold" and "live with no
  room".

  The rule keeps itself current instead: a thread of its own recomputes the
  verdict and hands it over, and the gate answers with the last thing it heard.
  Everything that runs per tick now keeps quiet unless its answer changes, so
  the log stays a record of what happened rather than a tally of ticks. And
  `H5EAnswer` says what it recorded, so a rule that never answered can never
  again look like a rule that said yes.

  It took a bracket either side of the call, a thread id and a sequence number on
  every line, and the whole chain logged rather than one link of it — two
  readings of the same log had contradicted each other twice before that.

- **A map rule that falls over now closes its own page** instead of leaving it
  open. A script error takes the whole line with it, so a `checkSpellCastable`
  that asks the engine one wrong question answers nothing — and nothing used to
  read as the same yes a map without any rule gets. The line the extension runs
  answers no first and replaces it only on success. A map that defines no rule
  is still free to cast.

- **A spell of your own can be cast on the adventure map.** The page in the book
  is live rather than greyed, and it takes a click. The map keeps its own gate
  (`CanCastHere`), and both the book and the cast command ask it — so a page
  that could not be pressed and a click that did nothing were one refusal, not
  two. It is a switch on the spell's NUMBER with two ranges in it, and every id
  a mod appends falls outside them, silently.

  That same switch is where the four-custom-abilities ceiling lives, for anyone
  who has run into it: `cmp eax,3`, two instructions, unmovable by data.

  Ours answers for itself; the game's own spells keep whatever the engine said,
  reasons and all. Seen in game 07.08.2026.

- **A crash inside the game names itself.** The extension now writes the
  registers, both module bases and the return addresses still on the stack into
  its log before a fault is handed on. It changes nothing about the crash — what
  it changes is that "homm5-editor.dll +0x1f9dc" in the Windows event log no
  longer costs a launch to turn into a place in the code.

- **A script can ask the player how many creatures.**
  `AskTroopCount(most, from, creature)` puts up the game's own count slider — the
  one a split uses, frame, slider and buttons alike — and answers with the number
  the player settled on, or -1 if they closed it. It is the engine's window
  driven by a controller of ours, so nothing about it is new to look at; what is
  new is that a map's Lua can raise it, which the shipped script vocabulary has
  no way to do.

  The window draws the creature the script names, a `CREATURE_…` like any other
  in a script. That turned out to need no army at all: the engine's own
  controller makes the picture out of one field of the stack it holds — which
  creature — so a number is the whole of what it needs.

  Seen in game 07.08.2026: the slider opens on the adventure map with the
  creature drawn on it, and OK comes back to the script as a number.

  Underneath it are two functions of the extension's, `H5EAskCount` and
  `H5EAskedCount`, and the reason there are two is worth knowing if you write
  against them directly: a registered function's results are counted the moment
  it returns, so the one that opens a window cannot answer with a number that
  does not exist yet. The waiting is Lua's, one `sleep` at a time, and
  `AskTroopCount` is that loop written once.

- **Spells of your own, from a window.** A page in the spellbook the game will
  let a hero cast: a name, a description, an icon, a school and a rank, the mana
  it costs, the four damage entries the four masteries use, and what resistances
  answer it. What it REACHES is one choice rather than two flags — the whole
  battlefield, an area around a point, or one stack — because the engine has one
  damage branch per shape and picks between them by exactly that pair.

  Two of the fields have nowhere in the game's data to live, and the window is
  where they are drawn: the TILES an area covers, as a grid of checkboxes
  centred on the tile aimed at (the combat grid is square, so any set of tiles is
  a legal shape — a cross, a ring, a line), and the creature KINDS the damage
  passes over, which is how Holy Word spares the undead. Both travel to the game
  through the file the native extension reads.

  A spell that hits an area and names no tiles is refused, in the window and in
  the build behind it: the shape a number the engine never heard of falls back on
  covers nothing, so it would be a cast that plays its animation, spends the mana
  and touches nobody. Removing one, on the other hand, is never refused — the
  question names the maps that store it and the heroes and classes of the mod
  that do, and then it goes.

### Changed

- **A spell of the mod's now resolves ITSELF.** Until now a cast of one jumped
  into the middle of a shipped spell's branch — the whole-field shape was Unholy
  Word's six instructions, the area shape Fireball's, the single target Magic
  Arrow's. It worked, and it cost what borrowing somebody's stack frame costs:
  three crashes in a row on casts of *Unholy Word itself*, byte-identical
  registers each time, and one cast of the mod's running the per-stack filter 178
  times because it was inside a loop written for another spell.

  The walk is now the extension's own (`native/combat/spell-resolve.c`) and the
  engine's routines are called through **their own entry points** — every stack
  on the field, may a spell touch this one, what it is worth, what it does to a
  stack, the stack losing creatures and the combat log line. So resistance,
  anti-magic, school protection and the log are all still the game's; only the
  choice of whom to hurt is ours.

  **`SPELL_ARMAGEDDON` and `SPELL_UNHOLY_WORD` are not touched at all** — not
  borrowed, not detoured, not read. What this buys beyond the crashes: a spell
  can now be authored to hurt whom the mod chooses, because choosing is a loop
  rather than a case compiled into the executable.

  Still missing, and named rather than hidden: a spell of the mod's leaves no
  Master of Fire (or Ice, or Storms) mark. The four appliers that leave one do
  not agree on how many arguments they take, so each needs its own reading.

- **A spell is four files in the extension, not one.** `spell-cast.c` had grown
  to 1198 lines and held four subjects — a spell's document, the cast being
  watched, the switches taught about the mod's ids, and a fix that belonged with
  the other QoL fixes entirely. It is now `combat/spell-record.c`,
  `combat/spell-cast.c`, `combat/spell-switches.c`, `combat/spell-resolve.c` and
  `qol/fix-mass-spell-element.c`, each under 600 lines.

  Nothing moved but text: every extracted block is byte-identical to what it
  replaced, and the only code change is two accessor lookups moving into an
  install of their own that runs first. `engine_code` — "this address still holds
  the bytes we measured, hand it back" — moved to `core/detour.c` beside `detour`
  and `overwrite_code`, which is the family it belongs to.

- **Two new checks that stand in for a launch of the game.**
  `test-native-anchors` takes every address the extension recognises by its
  bytes — 45 of them — and reads those bytes out of the executable on disk. The
  extension already refuses to touch a place that does not match, but that
  refusal only happens while the game is running, and by then the feature is
  quietly missing and somebody has to read a log. And `test-training-plan` puts
  the training rule through sixteen thousand armies against a model of the
  engine's own habits — seven slots, the removal that will not empty a hero, and
  the commands that happen later than they are asked for. It found a hole the
  rule still had: a training that had to take the whole stack was still offered
  on a slider that started at one, and taking one would have made the game ask
  the player which creature to throw away.

- **The script reference now says what the army functions really do**, both
  learned the expensive way. `GetHeroCreaturesTypes` hands back SEVEN NUMBERS
  rather than a table — the distinct creature ids of the army in slot order,
  padded with zeroes — so walking it with `for` dies, and no `type` exists in
  this game to ask it what it gave. `RemoveHeroCreatures` will not empty a hero:
  when the creature asked for occupies every slot he has, it silently removes one
  less. And neither it nor `AddHeroCreatures` edits the army at all — each hands
  the world a command to run later, while `GetHeroCreatures` reads the army
  itself. Both facts together are nastier than either: counting after an add
  counts the army as it was, and the "leave one behind" clamp is decided when the
  command is MADE, so add-then-remove written back to back still leaves one. Add,
  `sleep` until the count really changes, then remove.

- **The suite spends less of its time opening the same things twice.** Four
  specs opened the shipped map A2C1M1 four times — thirteen seconds apiece — to
  ask four questions about the one scene it produces; a fifth opened it twice
  more to close it. They are one file now, one load, and the questions are
  unchanged: 81 seconds became 35. The dragon's bone-glued glow and the
  fountain's retrigger period likewise shared a 72×72 map of their own each, and
  now share one. Nothing was dropped to get there — every assertion is where it
  was, and each reading now names the object it is about instead of taking
  whatever is on the floor.

- **A test run writes its whole output to a file**, and exits non-zero when
  something failed. Both were lost by piping the run through `tail` to read it,
  which throws away the middle — where a diff report says which value differed —
  and replaces the exit status with the pipe's.

- **A test run no longer takes the screen.** Every launch used to bring the
  editor to the front — dozens of times in a full run, over whatever you were
  doing. The suite now starts it inactive and parked off the desktop, still
  drawing so the specs that read the canvas still can. `HOMM5_NO_FOCUS=0` puts it
  back in front, for when watching a spec run is the point.

### Fixed

- **`mass-spell-element-fix` could have corrupted the stack.** It made one call
  site dispatch to whichever of three element appliers a spell's document named —
  and those three do not take the same number of arguments (`ret 10h`, `14h`,
  `18h`) while the site pushes four. A water or air mass spell would have
  returned four or eight bytes short, and the crash would have landed somewhere
  with nothing to do with spells.

  It never fired: the only elemental spell that reaches that routine is
  Armageddon, and Armageddon is fire. The fix now asks the document the one
  question the site can act on — *is this damage fire* — and leaves the `call`
  the game wrote. Found while giving the mod's spells a resolver of their own.

- **The battle log names the hook, not a deed.** Its lines opened with "cast",
  and a run in which the only click was opening a spellbook read as eleven
  spells being cast one after another — what the engine had actually done was
  walk the hero's whole Dark school, level by level, asking the gate about each.

  Every line now opens with where it came from — `[gate]`, `[cast command]`,
  `[resolver]`, `[worth]`, `[damage]` — and the two gate cases are named by what
  is true of them rather than by a guess: "inside a cast command", or "no
  command", which is the book, the AI weighing a move, or a tooltip, and this
  hook cannot tell those three apart.

- **A mod's spell page is grey again when there is nothing to do with it.** The
  training spell stayed pressable over an army with nothing left to train, and
  pressing it did nothing — the rule inside was refusing correctly the whole
  time, and its answer never got out.

  The rule's dispatch had been written as `if spell == 353 then return
  H5ETrainMayCast(); end;`, and **returning the result of a CALL from inside a
  nested block is a shape this engine's Lua does not carry out**: the call
  happens and the block does not end. A run measured it exactly — the rule
  reached its own last line (the kind and the count both written down, the army
  printed) and then the statement AFTER the `if` ran as well, so what the caller
  received was never the rule's answer but whatever the second `return` left
  behind, which read as yes every time. The game's own scripts settle what is
  safe: across 47 shipped scripts and 1096 functions they return a value from a
  nested block 65 times and the result of a call exactly never
  (`tools/nested-returns.ts` counts it). The dispatch has one exit now, and
  `src/script/lua-lint.ts` refuses the shape — in the editor's script editor
  too, so a map of your own cannot acquire it.

- **The training rule stops warning the player in red.** Five lines of
  `Value was NIL when getting global` on screen, one per name the rule keeps its
  reasons in. Assigning `nil` to a global does not CREATE it, so every one of
  them was read before it existed; they are born with values now. The verdict is
  also remembered per spell rather than in one variable for all of them — with
  two spells the second found the number already equal to its own answer and
  said nothing, leaving its page whatever the first one had left it.

- **Undo gives the picture back, not just the objects.** Ctrl+Z re-parses the map
  and the renderer rebuilds the floor from the instance list that comes back —
  and the rebuild dropped everything that had been done to those objects after
  they were first made. Shadows went: the roles that put a mesh in the shadow map
  are handed out once, when the floor is built, so the rebuilt draws neither cast
  nor received, and every object on the map stood in flat sun with nothing under
  it. Effects went twice over: a particle system belongs to the instance it was
  built for, so the ones from before the step kept burning for objects that were
  gone — a campfire whose placement you undid went on smoking over bare grass, and
  nothing on the map claimed it, so it could not be moved or deleted — while the
  objects that came back stood cold. Also restored: the ground-projected
  materials (the abandoned mine's earth mound), and the designer point lights
  the objects carry, which the main process was not sending back at all.

  Three of the same miss elsewhere, since it was never really about undo but
  about anything made after its floor: an animated object placed from the palette
  never cast a shadow, nor did the first object of a model the map did not
  already have, and a batch that outgrew itself took every copy of its model out
  of the shadow map on the way.

- **Saving no longer kills undo.** After a Save, Ctrl+Z could answer `patch does
  not fit: document is 49636 bytes, patch expects 49556` and never work again for
  that map. Save was tidying the map's derived tile list on its way out — naming
  the ground tiles the terrain paints with — which is an edit, and one the undo
  stack knew nothing about: every patch on it had been taken from bytes that no
  longer existed. The tidy-up happens where the tiles actually change, at open and
  inside the recorded step that adds a layer, so Save now only writes. It was also
  fighting you, putting back the entry an undo of that very layer had just taken
  out.

  Two things behind it are fixed as well. A step that cannot be applied now leaves
  the documents and the stack exactly as they were, instead of moving the cursor
  and half the documents — the press after the failure used to reach for a patch
  belonging to a state the map had never been in. And a map is put in step with
  its tile list BEFORE a history from a previous run is adopted, not after, so a
  stored history is either usable or dropped rather than adopted and then broken.

- **A mass spell damages in the element its record names.** A spell that hits the
  whole field lands through one of four functions — air, fire and water, which
  are what a Master of Storms, of Fire or of Ice acts on, plus a fourth belonging
  to no element. The game picks by asking whether the spell is Armageddon, which
  answers "is it elemental" and "which element" at once and gets away with it
  because Armageddon is the only spell there whose damage is elemental. The game
  has a second: the Empowered Armageddon, which lands with no element at all, so
  no Master of Fire follows it and no fire resistance answers it. This asks the
  spell's own record for both. A mass spell added by the editor needs it on to
  hit in the element it declares; an area or single-target one does not, since
  that routine reads the element by itself.

- **A creature of yours can be raised by necromancy.** Which creature comes back
  from the dead, and as what, is one table in the game's own files — 134
  dead→risen pairs covering every faction creature and no other. A creature
  outside it is left where it fell, with nothing said: our Sharpshooter, a
  neutral like the Heroes III unit it ports, yielded a necromancer nothing at
  all, which reads as necromancy being broken rather than as a missing row. A
  creature now says what it is raised as, and the mod appends the pair. It is
  part of the preset too, so a copy of a Grand Elf raises like a Grand Elf
  without anybody having to know this table exists — and «nothing» is still a
  choice, the one every shipped neutral makes.

- **A map made here can be played, without anyone remembering a field two
  panels away.** An object's owner and the player slots were kept apart: a hero
  given to PLAYER_1 belonged to somebody the game does not offer, because a
  fresh map ships all eight slots off. The map loaded and there was nobody to
  start it as — no error, nothing to read. Now giving anything an owner turns
  that owner on, and a hero also becomes where that player begins when the slot
  has no main hero yet; a chosen one is never taken over by the next hero
  placed. Removing an object reads the rule backwards: the main hero leaving
  hands the field to another hero of that player's or empties it, and a player
  left owning nothing is turned off again. One undo takes back the owner and the
  slot together.

- **A packed map is listed as the game it is.** The `<teams>` block of a
  map-tag was written by a rule that fits 12 of the 69 shipped maps: one entry
  per active COLOURED player, holding the team number. It is one entry per
  SIDE, holding how many players are in it — and colour has nothing to do with
  it. Most shipped maps leave every slot neutral, so skipping neutrals wrote an
  empty `<teams/>`, and a tag claiming no sides is a map the lobby cannot
  start. `CustomTeams` decides how the sides are drawn: on, the `Team` field
  means it and team 0 is a team like any other; off, every active player is a
  side of his own. The corrected rule reproduces all 65 shipped tags exactly,
  and `tools/test-map-tag.ts` checks it against every one of them rather than
  against examples.
- **An object placed with only a path is refused, instead of quietly not being
  on the map.** A `<Shared>` names the definition document AND the class inside
  it; the game resolves neither half alone. A path with no `#xpointer` was
  written down as given and the placement reported complete — and the object
  then was not there, which the game reported as "PlayerN has no heroes and no
  towns" and then "start player does not exist". Placing through the window was
  never affected: the palette hands its entry over whole. Now a caller with only
  a path gets it completed from the palette — the same href the editor reads —
  and one that names nothing the palette places is told so.

- **The Colour list was missing a colour.** Seven of the game's eight, in an
  order of its own — `PCOLOR_YELLOW` was absent outright, so a yellow player
  could not be made at all. It is the game's own list now, neutral first, the
  way the original editor shows it.

- **Main hero, main town and start hero are not files.** All three said "a
  standalone document (its own file)" in the schema. Every shipped map that has
  one writes an href INTO the map instead. Written as text the field looks
  filled in here and reads as blank to the game, which kills the map on load
  with "start player does not exist".

## 0.8.0 — 2026-08-06

### Added

- **A spell of your own now DOES something.** Until this it was a page in the
  spellbook: a name, an icon, a cost, and a cast the engine carried out to the
  far end of and dropped, because what a spell does is compiled against the
  number it was built with and ours is a number the game never heard of. It now
  borrows the branch the game's own mass spells go through, so the damage is the
  engine's: your document's numbers, the target's magic resistance, any
  anti-magic on it, protection from the school, and a line in the combat log —
  none of it arithmetic of ours going around the rules.

  A spell also says what its damage passes over, by creature kind. «Живое
  существо» is not a flag anything carries — the game prints it when a creature
  is neither undead nor elemental nor mechanical — so a spell that hits
  everything alive is written as one that spares those three, which is how the
  engine asks the question about its own Unholy Word. The port of Heroes III's
  Death Ripple is the first that does.

  **All three shapes of damage**, chosen by the two checkboxes a spell already
  had: not aimed hits the whole field, aimed at an area hits a patch where you
  point, aimed without an area hits the one stack under the cursor. Those are the
  engine's own three, and the flags separate its own spells the same way —
  Armageddon, Fireball and Magic Arrow, in that order. So a new damage spell of
  any of the three shapes is now pure data.

  **And an area spell says what area.** How big an area is has no field in a
  spell document — the game decides it per spell, and what it would give one of
  ours is nothing at all — so a spell of ours lists the tiles it covers, as
  offsets from where it is aimed. Not from a menu: the game builds every one of
  its own shapes by adding one tile at a time, so a spell of yours can cover a
  cross, a line, a ring or whatever else. The battlefield is a square grid and
  the offsets are plain (x, y).

  **And it counts as a real spell to everything else.** A spell of yours with an
  element is a fire (or ice, or storm) spell to the whole game: the elemental
  protections answer it, and a hero with the matching Master perk leaves the
  burn — which the game had been refusing, and not because of the element. It
  keeps a list of "spells that deal damage", asked in nine places, and a spell
  of ours was not on it.

- **Dialog scenes — the cutscenes a campaign plays — open and play in the
  editor.** `Scenes…` on the launcher asks for a FILE, the way opening a map
  does, and lists the scenes inside it: point at
  `UserMODs/All_campaigns.data.h5u` for the original campaigns' 185, at
  `data.pak` for the addon's, or at a map of your own for the ones it carries —
  an archive is read by its listing alone, so even the 1.3 GB one answers
  instantly and unpacks nothing until a scene is picked. A `DialogScene.xdb`
  can be opened directly too, wherever it sits.

  What opens is a window of its own: the arena the scene is staged on, the
  props it brings, its actors on their ARENA rigs rather than their adventure
  models, and the shots down the side. Pick a shot and the camera goes exactly
  where that shot's camera is; press play and it walks the move, actors playing
  the clips the scene names on them.

  The game's own editor cannot make these — its manual says outright that
  script-based movies are "not a process intended for an unprepared user" — so
  the format had to be measured rather than read: `docs/DIALOG_SCENES.md` has
  what a scene is made of, how often each field is actually used, and how the
  camera's angles turned out to be meant (`npm run camera-shape`).

  Editing is not here yet: a scene opens, plays and closes without being
  written back. What it already proves is the whole risky half — that a scene
  resolves, draws and frames the way the game frames it.

- **The sky is drawn: a lighting preset's `<SkyDome>` model stands behind the
  world, in scenes and on maps alike.** The horizon used to be void — black
  behind C1M1's opening where the game shows a red inferno sunset, because the
  dome the preset names was read for nothing. It is decoded with the preset
  and drawn the way its own materials ask (self-lit, depth ignored, painted
  first, riding the camera), and it follows a shot's light override — the red
  sky over that field IS the override's sphere, swapped in with the rest of
  the inferno preset while the scene's own preset names the blue day cube.
  Tilt the map editor's camera to the horizon and the same dome is there,
  from the floor's own preset.

- **Objects cast shadows, in scenes and on maps.** A field of trees used to sit
  on the grass with nothing under it; now the sun throws each one across the
  ground, and the actors of a cutscene stand in their own. A shadow here is not
  a darkening — the engine evaluates its whole light mix a second time with
  `IncidentShadowColor` in place of `LightColor` and picks between the two
  results, so shadowed ground goes the preset's own cold blue rather than
  simply dim, which is what the game's picture does. Which way they fall comes
  from the preset as well: `ShadowPitch`/`ShadowYaw` of 100 is the engine's
  "follow the sun" sentinel rather than an angle, and the thirteen shipped
  presets that aim their shadows elsewhere get their own direction.

- **Imbue Ballista costs the ranger mana, not his turn.** The perk says the
  ballista's shots carry his enchantment and that his mana pays for them, and
  says nothing about his turn — but they took his turn as well: play a ranger
  without this and his marker on the turn bar slides back every time the
  ballista fires. The enchantment now runs between two readings of that value
  and the old one goes back if it moved.

- **A tool for finding the same code in another build.**
  `tools/reverse/match.ts` compares a jump table's shape, filters `.text` for
  functions matching byte needles, and scores candidates against a reference
  function by what it does rather than by its bytes. It is how every fix above
  was located, and it is what makes the rest of that patch set portable.

- **No more crash when a wall is summoned onto a snare.** Summoning an Arcane
  Crystal or a Blade Barrier onto a snared tile ended the battle: the snare asks
  the tile for the creature standing there and uses the answer without looking,
  and an obstacle is not a creature. The snare now does nothing when there is
  nobody to catch — the "nothing happened" the engine already returns from that
  code. dredknight's fix for the same bug lands in a tail with an uninitialised
  register instead; ours could not be a transliteration anyway, since our build
  inlined that function and allocated its registers differently. Both copies our
  compiler emitted are patched.

- **Empowered Armageddon is an Armageddon.** The empowered spell has an id of
  its own, and the code that resolves the impact asks three questions about the
  spell by that raw id — whether to do the local damage at the point of impact,
  whether to hit war machines, and how to damage the tiles around it. All three
  answered no, so the empowered version cost double mana and was the weaker
  spell, though its own description promises damage to war machines. The engine
  already maps an empowered id to the spell it is a version of; it is now asked
  that. At the first site the answer was already sitting in a register, unused.

- **A map to watch the rule fixes in.** Every one of them is verified as bytes,
  and none of them can be verified that way as BEHAVIOUR — "the knight's own
  dragons refuse Encourage" is a thing to watch in a battle. So the e2e suite
  builds one: `fix-001-rules-map` packs a Rules Test map into the install with
  every fix off, one hero per fix standing in front of the stack he is meant to
  fight, and `fix-002-rules-on` turns them all on and touches nothing else. Play
  it between the two runs; docs/FIX_TEST_MAP.md is the list of what changes.

- **Master of Fire halves the defence it is halving.** The perk says a creature
  caught by Fireball, Firewall or Armageddon loses 50% of its defence for a
  turn. The game read the defence when the spell landed, halved that, and
  subtracted the resulting number for as long as the effect ran — so the two
  agreed only while nothing else touched the creature's defence. Buff it after
  the fireball and it lost less than half; let a buff expire and it could lose
  everything it had. The half is now taken where the defence is summed, so it
  follows; on the turn the spell lands with nothing else moving the number is
  exactly the one the shipped game produced. Creatures with Броня are exempt, as
  they were.

- **The Book of Power's knowledge buys mana.** The artifact gives +1 to spell
  power and knowledge, +2 with Advanced Education and +3 with Expert — a bonus
  that depends on a skill, so the engine grants it through a special case rather
  than through the path an ordinary artifact takes. That path recomputes the
  hero's maximum mana whenever knowledge changes; the special case did not, so
  the knowledge appeared on the hero screen and the mana did not follow. It
  showed up after a level up, which is when Education changes the bonus on its
  own. The engine's own recomputation now runs in that case too, both when the
  artifact goes on and when it comes off.

- **Creature abilities of the editor's own, and the first of them: Дракон.**
  Almost no ability in this game is code — a creature's `<Abilities>` is a list
  of ids, and the engine asks "does it have that one" where it matters, which is
  why Undead is a flag rather than a behaviour. So an ability nothing asks about
  does nothing, and that is what a tag is. Adding one costs what an artifact
  costs and no executable at all: the enum and the name→number entry in
  types.xml, the size the table declares, and an object with a caption and a
  description in `CombatAbilities.xdb`. `ABILITY_DRAGON` is the first and is a
  worked example rather than a behaviour; the picker offers it before the mod
  carrying it is installed and reads it out of the data afterwards, and the next
  tag is simply the next number.

- **Dragon Form is refused on a dragon that never upgraded.** The rune says it
  does not apply to dragons, and the game refuses it — by asking the creature
  for its *base* creature and looking that up in a table of the four dragons. A
  creature that is a base itself has no base, so the lookup falls out of range
  and a Bone, Green, Deep or Fire Dragon is told it is not a dragon. Everywhere
  else the engine reads a base creature it falls back to the creature itself;
  that missing fallback is now written in. Upgraded dragons were refused before
  and still are. dredknight's fix answers "tier ≥ 7" instead, which would also
  refuse the rune on an Archangel or a Titan in a dwarf's army.

- **Payback stops paying for spells that worked.** Payback returns a spell's
  mana and moves the hero's turn up when a stack RESISTS it — but the cast keeps
  one byte for "the spell did nothing" and the three spells that put an obstacle
  on the field never clear it. So Arcane Crystal, Summon Hive and Blade Barrier
  were cast, stood on the field, and were refunded in full every time. The byte
  is now cleared where all three place their last tile; a resisted spell still
  pays back. dredknight's file calls this the Arcane Renewal fix, which is what
  Heroes 5.5 renamed the perk to.

- **Two rules fixes from H5_DLL.** Ported from dredknight's
  [H5_DLL](https://github.com/dredknight/H5_DLL) with his permission, each one
  byte in a jump table:
  - **Encourage works on a stack immune to magic.** A Knight's Encourage only
    moves a friendly stack's turn up, but the game runs it through the check
    that refuses a spell against an immune target — so it is refused by your own
    creature's immunity. The ability's own description says nothing about magic.
  - **Forgetting Barbarian Learning takes its bonuses back.** The switch that
    undoes what a skill granted has a case for Learning and none for Barbarian
    Learning, which falls through to "do nothing"; this points it at the case
    Learning already uses.

  Their addresses are not his: that patch targets the retail build, ours is
  compiled for SSE, and each site was found again by the **shape** of the switch
  it lives in. `tools/test-fixes.ts` checks every such byte against the
  installed executable, and finds the patches by walking the C rather than by a
  list kept by hand. His Agility fix is deliberately **not** ported — he
  withdrew it himself once the ability's in-game text turned out to describe the
  behaviour it "fixed".

- **Game settings — a Fixes tab.** The panel splits into *Quality of life* (how
  you want to play) and *Fixes* (bugs of the shipped game taken out), with the
  fixes grouped — crashes, mechanics, battle AI — and an *Enable every fix*
  master switch, which only that tab gets: all fixes on is a reasonable
  default, all preferences on is not a thing. The battle-AI fix moved there.
  The port of dredknight's H5_DLL fixes lands on this tab fix by fix, with the
  author's permission.

- **The game settings panel reads as a list.** Each switch's paragraph folds
  away behind *What this does*, and a switch that is somebody else's work
  carries an (i) naming them and where they published it — in the config file's
  comments too, so the acknowledgement travels with the install.

- **Game settings — the battle AI's spellcasting, fixed.** A new switch,
  `combat-ai-fix`, takes three bugs out of the code that decides what the AI
  does in a battle: a plan with no creature targets — mass spells, summons —
  ranked below every targeted one and so never cast, which is why the enemy's
  high circles were never seen; a counterspell "deleting" the enemy hero's
  whole magic factor from the army valuation, which made casting one look worth
  that entire factor and is the AI everyone remembers recasting it instead of
  fighting; and a stack's worth counted as its size **squared** under Deflect
  Arrows, drowning out every other reason to prefer a target. Found again in
  our build from RedHeavenHero's CombatAIFix v1.1, which makes the same three
  changes in a different build of 3.1; nothing could be copied, since that one
  is compiled for x87 where ours uses SSE. The first switch that writes the
  game's own code: with it off not a byte of the image is touched, every site
  is compared against the bytes we measured before anything is written, and
  `tools/test-combat-ai.ts` checks those addresses against the installed
  executable — the failure mode is a switch that silently does nothing.

- **The game being open is a sentence now, not an `EBUSY`.** Everything the
  editor installs goes into `bin`, and Windows will not let those files be
  replaced while the game holds them — which used to surface as a message about
  a temporary file with a `.new` suffix, from a button that said Apply. The
  ceilings and the extension now ask first and say which file is held and what
  to do; applying settings saves them and leaves the install alone, rather than
  half-writing it. Only **our** build counts: `H5_Game.exe` is never written to,
  so playing the unmodded game stops nothing.

- **Game settings — two more battle switches.**
  - **A health bar on the stack plate.** In a battle every stack's plate
    carries a bar showing what the creature at the front has left — the one
    being hit, not the stack as a whole, like the HotA bar in Heroes III.
    Bright green on near-black, sized to the plate every frame. Applying the
    flag writes `H5E/homm5-editor-qol.h5u` (the strips are the game's own
    child windows) and turning it off deletes it again.
  - **Losses on the plate while Shift is held.** Every plate reads
    `now / at the start of the battle` — 53 of the 59 that walked in reads
    `53/59`. Costs nothing while the key is up.

- **Four more things a skill of yours can do to a first aid tent.** The
  extension already gave it extra uses; it can now also make the machine itself
  tougher (`tent_health`, percent), heal for more (`tent_healing`, points),
  strip stronger curses off whoever it heals (`tent_cleanse`, levels) and give a
  use back for mana its owner spends in the battle. The first three are rows in
  the skill form, keyed on the skill's own id, and cost the game nothing it was
  not already computing; the fourth turned out to belong half in Lua — a hero's
  mana is not spent through anything the extension could hook, but the battle's
  own vocabulary reads it. All four ran in a battle on 2026-08-03.

- **A battle can be spoken to, and can answer.** Two halves, both measured in
  game rather than argued about:

  - **Lua functions of ours now reach a fight.** The battle's vocabulary is
    handed over by an accessor of exactly the shape the adventure map's is, so
    the same routine extends both — a script inside a battle can call what the
    extension registers.
  - **Triggers, with arguments.** `H5ESetCombatTrigger(kind, handler)` in a
    battle script, and the extension calls every handler registered for a moment
    — `H5E_COMBAT_STARTED` and `H5E_MANA_SPENT(spent, side)`. Handlers stack, so
    two perks may want the same moment. It works in an ORDINARY battle, not only
    a scripted one. See docs/api/combat.md.
  - **And one function the other way: `H5ETentCharge()`**, which hands the first
    aid tent another use. It is what makes the mana trigger worth having — the
    watching is done in Lua, which can read mana, and the writing in the
    extension, which is the only side that can reach a war machine's uses.

### Changed

- **Opening a scene no longer stops the editor.** Assembling one — reading the
  archives, meshing 600-odd props, baking 214 clips — is about six seconds, and
  it used to happen in the main process, which is single-threaded: for those six
  seconds nothing else answered. The map list, the object panel, the file
  watcher, a second window: all of them waited, which from outside is
  indistinguishable from a hang. It runs in a background process of its own now
  (Electron's `utilityProcess`), and the window keeps its own hands free too —
  the actors, their clip measurements and the effects are built a few at a time
  with the frame handed back in between.

  Measured, and the measurement is checked by breaking it: while a scene comes
  up the app answers 42 of 42 pings, against 8 with the background process
  disabled (`HOMM5_SCENE_INLINE=1`, which exists so the test can prove it is
  measuring something — `e2e/scene-thread.spec.ts`). What is left is the payload
  itself: 21 MB crossing two process boundaries, about two seconds, and the
  window is briefly busy parsing it.

- **Where the game is comes from `.env` or the command line, and from nothing
  else.** There were four answers for the data root and three for the game: the
  environment, the checkout's own folder, a `settings.json` in the user's
  app-data — shared by every checkout, every worktree and the packaged build at
  once — and two "the folder above this one" guesses, one of which outranked the
  settings. No run ever said which had won, and a wrong one is silent in the
  worst way: the map opens, everything a MOD supplies is on it, the game's own
  objects are not, and the tile list is empty. That reads as a broken map, a
  broken build, or deleted files.

  Now: `--game=` / `--data=` beats `HOMM5_ROOT` / `HOMM5_DATA`, which `.env`
  beside the build fills in — and there is nothing behind that. Nobody said, and
  the setup window asks and writes the `.env` itself, so the picker's answer and
  the file a developer edits are the same file. One per checkout, which is what
  lets a worktree work against its own copy of the game. `settings.json` stays
  for the two things that are about the machine and hold no path (software
  rendering, whether idles animate).

- **`run-test-and-keep.bat` is told where the game is.** The live run that
  builds the mod into a real install and leaves it there no longer treats the
  directory above the checkout as the game. It reads `HOMM5_ROOT`, falls back
  to the `.env` beside it, and REFUSES to run when neither says: a wrong
  install here is not a crash, it is a full mod authored into a folder nobody
  meant, reported as success.

- **Where the game is, is SAID — never guessed.** Every tool takes `--game`,
  `HOMM5_GAME` or `HOMM5_ROOT` (and the unpacked-data cache `--data` or
  `HOMM5_DATA`), through one resolver, `tools/game-dir.ts`; a tool with nothing
  said refuses — or, in a test suite, skips in so many words — instead of
  proceeding into a made-up path. The old guess, "the checkout's parent", was
  only ever right when the repo sat inside the install, and a worktree paid for
  it with failures three calls away from the reason. Three suites had kept a
  copy of that guess: `test-pak` opened the literal `../data/GEmaps.pak`, the
  Lua registry check read `../bin/H5_Game_H5E.exe`, and `test-terrain` parsed
  two `.bin` files under `_tmp/probes/` that nothing creates — someone had put
  them there by hand once, so that suite passed on one machine and crashed on
  every other. The e2e suite follows: a worktree now builds its sandboxes FROM
  a real install without also playing IN it.

- **The C1M1 reconstruction is a release gate, not a test run.** It rebuilds a
  whole shipped mission over an extracted fixture — minutes that measure the
  editor's completeness, not a change. A bare `playwright test` (and so
  `test-e2e-fast`, and what `npm test` runs) never picks it up; `npm run
  test-e2e` sets `PW_C1M1` and runs everything, which is what a release is
  gated on.

- **The extension's source is a folder of features.** `native/homm5-editor.c`
  is now 133 lines of includes over `core/`, `combat/`, `lua/` and `qol/` —
  still one translation unit, so every `static` stays `static` and the build
  does not change; the cut is proved by the DLL coming out byte-for-byte
  identical.

- **The suite can start from nothing, and the specs found their shelves.**
  `e2e/000-cold-start` walks the real setup window from a bare install to an
  open editor — sandboxed, or live against the real install with only OUR
  things taken out first. The game-settings specs are their own numbered
  family (`qol-00X`), and the sharpshooter stage is a folder of three sittings
  the way the C1M1 stages are.

### Fixed

- **A live run puts the mod chain back to its start, and says "everything" in
  one word.** Two halves of the same miss. The suite decides whether to reset
  the chain by reading the command line — it runs before there are any test
  files to look at — and it read the argument as a STRING: `e2e/`, which is
  every spec there is, mentions no stage by name and so counted as a run about
  something else. The reset was skipped, and mod-001 failed on finding the last
  run's creature still installed, 93 specs from the end. A folder is read from
  disk now, and `tools/e2e-live.ts --all` passes no filter at all, which is the
  documented way to mean the whole suite; the bare form still refuses, since
  running every spec against an install is a thing to say out loud.

  And the reset itself is wholesale: the installed mod is taken away, not
  disassembled. Taking out exactly our own things meant a list of every kind of
  content to keep up to date forever, and it bought nothing — a live run happens
  in the copy of the game this checkout sits in. A copy goes to
  `_tmp/mod-backup/` first, so it is one file-copy from back.

- **A test run no longer rewrites the `.env` your own editor reads.** The cold
  start is the one spec that drives the real setup window to its end, and that
  end writes down where the game is — into the file beside the build, which is
  the developer's. It had been overwriting it with the paths of the sandbox the
  same run deletes on the way out, so afterwards the file named a folder that no
  longer existed and the next `npm start` opened setup as if the machine were
  new. A green run did it too; the failure it was noticed through was a
  different one. `--setup-test` gives that run a file of its own (`.env.test`,
  read and written both), and the spec now checks what setup actually leaves —
  including that the checkout's file was not touched.

- **A shot filmed from inside a hill shows the scene, not the inside of the
  hill.** Every model was drawn with both of its faces, and the engine draws
  only the ones facing you: `<Is2Sided>` is false on 11209 of the 11639 shipped
  materials, and the 430 that ask for both are the flat things — foliage cards,
  banners, grass. It matters wherever a camera stands inside something, which
  in a dialogue is normal: a wide shot of a small arena has nowhere to pull back
  to except the ridge of mountains around it, and four of C1M1's cameras do
  exactly that. Shot 22 — the archangel, five units inside `Mountain12x12` —
  came out as a wall of rock. Now the material says which faces to draw, so the
  ridge is there from outside and gone from within.
- **Models are lit the way the game lights them, and stop coming out in
  patches.** Three things were wrong at once and each is now measured rather
  than modelled. The **normal** was read from the wrong byte of the render
  vertex: the trailing twelve bytes are a tangent BASIS and the decoder took
  the second of the three, so every model was lit by a vector lying in its own
  surface — a peasant's shirt came out with neighbouring panels at different
  brightnesses. The **light direction** was half a circle off, which on 62 of
  the 73 adventure presets is the same wrong direction. And the **formula**
  itself had the wrong shape: `LightColor` is not a term added to ambient but
  the colour a sun-facing surface is turned INTO, and `ShadeColor` — never used
  here before — is the other end. All three come out of the running game's own
  vertex buffer —
  390,000 baked vertices, fitted at R² 0.999, every coefficient landing on a
  preset field to the byte (docs/LIGHTING.md §2). The multiplier over that mix
  is ×4: `c29`, which the vertex shader scales by, is the scene FADE and not a
  constant — one old probe sample of 0.5 had been written down as a halving,
  and rendering every map at half the game's brightness is what that cost.
- **Terrain-object grass stands in the ground and wears its own dark green,
  instead of glowing lime scribble.** The grass props are `P_STATIC` particle
  systems — 33 blade-clump cards per patch, one position key each, all on the
  ground plane — and the game plants them upright. Played as full camera-facing
  billboards every card tipped toward a low camera and the clumps piled into a
  luminous web; tinted by the baked colour ×2 and blended straight, their soft
  edges ADDED green over the scene. A static system now stands its quads
  vertically (yaw follows the camera so a clump never degenerates to an edge),
  anchors them by the instance's `<Pivot>`, and draws the texel's own colour
  premultiplied by alpha — the game's look, per its `mov r0.rgb, t0` shader.
  Fire, smoke and every moving effect keep the old path untouched.

- **Spell effects that swell now swell: a baked clip carries scale.** The bake
  read position and rotation, which is everything a walking creature needs and
  nothing a shockwave does. So a meteor shower's impacts were small cards lying
  in the grass instead of rings expanding out of each strike (their quads are
  authored to grow ×78 and settle back), the arch devil's gating vortex a knot
  of ribbons around him instead of a column opening up, and the falling meteors
  stretched into beams from the ground to the sky — their trail rests squashed
  to half height and our poser drew it at full. Of 427 clips sampled, 83 animate
  their scale and another 172 sit at a constant non-unit one, so this was
  quietly wrong across the whole effect library. Creatures are untouched: their
  display scale still rides on the mesh alone, and a test on real creatures
  fails if the clip ever carries it too.

- **Every particle effect was drawn mirrored, and grass grew roots-up.** A
  particle frame is authored with the art's "up" as the image's BOTTOM row, and
  the quad sampled it the other way — measured on the two families whose up is
  unmistakable: a grass clump keeps its dense base in the image's top half with
  the blades hanging off it, and a candle flame is widest along its top rows and
  tapers to a point at the bottom. On fire the flip is invisible (a flame reads
  as a flame upside down, which is how it survived the whole particle pass); on
  grass it is a lawn of blades pointing at the sky. Now flipped once, for every
  instance, so fire and smoke rise from their base too.

- **Maps and scenes are lit like the game: the light term is ×4, capped at
  doubling the texel — `min(4·(amb + sun·N·L), 2)`.** Measured from both ends
  of the game's own shader chain: the CPU doubles the sum and saturates it
  into a colour byte (the cap), the vertex shader halves it back for headroom
  (`c29`, seen arriving as 0.5 by the probe in the running game), and the
  ps.1.1 pixel shader's `mul_x4_sat` restores ×4. Every simpler reading
  failed a side-by-side: the preset's `<Whitening>` as a 2-or-1 switch halved
  every Whitening-off map (the default preset included — the Sharpshooter
  test map rendered at dusk against the game's noon), and an uncapped ×4
  washed day presets toward white. The probe also shows the game never sets
  the ps.2.0 shader's c7.x constant — that shader is not the path it runs.

- **The impaled-body totem stands beside the arch devil in C1M1's opening,
  instead of lying invisible under the grass.** The DemonLord path props
  (Cross01 and its five siblings) are meshed and skinned lying flat; the model
  skeleton's rest pose is the STANDING stance, and their idle clip drives no
  channel at all. Baking a silent channel against the model's rest made the
  inverse bind and the pose cancel, so the mesh stayed as authored — flat,
  a hand's breadth below the turf. A channel the clip does not drive now holds
  the clip's own skeleton's stance (the pose the clip was authored in), which
  is what the engine's inverse-bind arithmetic expects — the crosses stand,
  lean and all, on the map view and in scenes alike.

- **The editor says which folders it settled on, and which answer it used.** It
  prints one `[roots]` block at startup naming each folder and who chose it, and
  says so loudly when the data root holds neither `MapObjects/` nor
  `bin/Geometries` — the state in which a map shows only what a mod supplies.
  Printed before the setup gate, because the run that most needs to know is the
  one about to refuse to open.

- **An animated creature is checked for standing where the map puts it.** The
  placement assertion only ever covered the batched draws, and a creature with
  an idle leaves the batch entirely — so `misplaced: 0` was silence about half
  the map. `view.idle()` now answers the same question for the animated bodies.

- **An object the editor cannot mesh is NAMED, not counted.** A map that opened
  one object short said `no model 1` and nothing else — for eleven objects, with
  no way to tell which of them was missing or why. It now says the href it
  looked for, on the status line and again in the terminal. The case that found
  this: two maps saved in July point at
  `/Dwellings/SharpshooterPalace/…`, which the editor's own mod stopped writing
  when dwellings became one of the sixteen building classes and moved under
  `/Buildings/` — so rebuilding the mod moved a file out from under maps that
  named it, and the dwelling quietly left the map.

- **Models are textured at the size the art was drawn at, instead of at
  128×128.** Every texture in a payload was point-sampled onto a fixed 128-pixel
  SQUARE, whatever it had been: a hero's 512×512 skin lost fifteen of every
  sixteen texels — a face that is a quarter of its atlas arrived about fifty
  texels across — and a 512×256 one was squashed out of shape besides. On a map
  that mostly reads as soft; in a dialog scene, where the camera stands a metre
  from somebody's face, it is mush. Textures now come at their own shape and
  their own size up to 512 a side, reduced by AVERAGING rather than by throwing
  texels away, and the transparent black a DXT1 cutout stores is weighted out of
  that average, so foliage no longer wears a dark fringe. Anisotropic filtering
  is on, which is what the ground under a low shot needed.

  It costs nothing to load, because two things paid for it: a texture is now
  decoded once per file rather than once per mesh wearing it (C1M1's opening
  dialog names 4659 textures and has 299), and each one crosses to the window
  once rather than once per reference. That scene's payload was 183 MB and is
  163 MB — with four times the texture detail — and builds in 6 seconds where it
  took 8.

- **An actor in a dialog scene is shaded like the stage they stand on.** The
  scene player built its own materials, so the heroes and the armies went
  through three.js's lighting while the grass under them went through the
  game's — the same mismatch fixed for maps below, still in the one window where
  everybody is a close-up.

- **Everything on a map is lit the way the game lights it, not the way three.js
  does.** The ground always ran the game's own sum; objects, actors and props
  went through three.js's linear lighting instead, and against a preset authored
  in gamma that is a colour error, not a brightness one. The Inferno arena's
  warm sun `0.635/0.267/0.141` decodes to `0.361/0.058/0.018` — the green
  channel loses a factor of four — so C1M1's knights came out salmon-pink over
  grass that looked fine, and every tree stood a shade too dark beside the hill
  it grew on. One sum now, for all of it: `albedo · (Ambient + Light·N·L) ·
  Whitening`, clamped, multiplied on the raw texel.

  It is not a guess about the era. The game's shaders are embedded in its
  executable as assembler text, and the object one reads
  `mul r3, v0, r2` / `mul_sat r0, r3, c7.x` — texture, vertex colour,
  multiplier, clamp. A scratch DLL watching the running game adds that Direct3D
  lighting is switched off, that `SetLight` is never called once, and that no
  preset colour ever reaches a shader constant. The same run measured the sun
  direction the engine hands its shaders and it matched the editor's to three
  decimals, which promotes "Pitch counts from the zenith" from a good guess to a
  measurement. `docs/LIGHTING.md` §2, §2a, §3.

- **A hero in a scene flies his own colours.** Isabell's banner came out a
  washed grey-blue where the game shows bright blue, and it was neither the
  light nor the texture: a hero has NINE bodies, one per player colour, and the
  `<Model>` beside the list is the white one. We were drawing the white one for
  everybody. The colour is chosen by the owner's `PlayerID` now — the map's own
  player table where it names a colour, the player's number where it does not,
  which is every dialog-scene arena. Agrael rides red, Isabell blue, and the
  seventeen characters that have coloured bodies all have exactly nine, which is
  the length of the `PCOLOR` enum. Heroes with a bespoke model and no list
  (`Isabel_Flagless`, `Beatrice_DS`) keep it. The adventure map still draws the
  colourless one — same bug, bigger change, written down in
  `docs/DIALOG_SCENES.md`.

- **`<Whitening>` is read from the preset instead of assumed.** The ×2 was
  written into the terrain shader as a constant. It is a per-preset switch, and
  31 of the 291 shipped presets turn it off — those were rendering twice as
  bright as the game shows them.

- **A test that had never run.** `ambient-light.spec.ts` opened
  `Maps/Scenario/A1C1M1`, which is not in the unpacked data at all, so it
  skipped itself on every run while reporting green. It opens A2C1M1 now, and
  a new `object-light.spec.ts` checks the sum by arithmetic — one known albedo
  under one known normal, read back a pixel at a time, and verified by
  deliberately breaking both the multiplier and the colour space.

- **A griffin that takes off stays up.** A clip whose last frame leaves the body
  somewhere the idle does not have it was handed back to the idle anyway, which
  teleports rather than blends: the royal griffin sprang into the air and
  reappeared standing, the arch devil rose back out of the ground he had just
  gated into. Those clips hold their last frame now, and which ones they are is
  measured when the scene opens rather than listed by name.

- **Inferno soldiers are on fire again.** A creature's flames hang off its IDLE
  animation and burn whether or not anything cues it. On a map they ride the
  adventure body — which a scene takes off the field to make room for the rig
  that can act, so a scene's demons stood there cold. They burn wherever the
  actor is now, marching included.

- **A scene's actors march.** 922 cues in the shipped scenes carry a path of
  tiles to walk, and nobody walked any of them: the actor stood on their first
  tile playing the walk cycle on the spot. The pace is not in the scene file —
  every one of the 922 leaves it at 0 and it comes off the `move` clip itself —
  and neither is the starting point, which is wherever the actor is when the
  walk begins. Where a walk leaves them is where they are for the rest of the
  scene, five shots later.

- **Most of a scene's cast was missing.** An actor can be declared INSIDE the
  animation that moves them (`#n:inline(AdvMapMonster)` with the whole body in
  the link), and 1517 of the shipped scenes' 1814 inline actors are written that
  way. Read only from the object list and the spoken lines, as this was, and
  A2C3/M4/S1 opened with 9 figures on the field instead of 138 — the army that
  marches into it was not there at all. Inline actors are also told apart
  properly now: their hrefs are identical, so cues aimed at them all landed on
  whichever was read first.

- **A scene now runs on one clock, so a quarter of what it does stops being
  dropped.** A cue's delay is measured from the shot that writes it and nothing
  keeps it inside that shot: of the 7296 cues and effects the shipped scenes
  schedule, 1034 start after their shot has ended and 870 before it begins.
  Played a shot at a time, none of those ever happened — which is why the
  marksman in C1M1's opening never shot (his cue is 6.7 seconds into a
  three-second shot) and the priest's blessing was cut off after a third of a
  second. Everything is placed on the scene's own clock now, and a clip that
  runs out hands the actor back to idling instead of freezing on its last frame.

- **An actor's animation brings its own effect.** A clip names an `<Effect>`
  beside its Granny file, and that is where a caster's fire lives — the blue
  glow that runs up a knight's sword as he casts is his `buff` clip's, named
  nowhere in the scene. 45 of the 132 cues in C1M1's opening play a clip that
  carries one, so a third of what the scene did was happening in silence.

- **A spell's geometry moves, and then goes away.** Every model an effect places
  carries a skeletal clip of its own — the ice bolt falls now instead of hanging
  in the air — and that clip is also what ends it. Without one nothing did: the
  praying hands of a Prayer stayed standing inside the soldier they were cast on
  for the rest of the scene.

- **A shot's camera no longer laps its subject.** `Direction` on a camera set
  says which way the heading travels, not "go the long way round" — read the
  wrong way, 583 of the shipped moves swung most of a circle instead of 150.
  Agrael's first cast, a straight pull-back from his face to his whole army,
  orbited him.
- **An effect brings its own geometry.** Nine of the twelve effects C1M1's
  opening fires carry `<Models>` — the ice crystal of an ice bolt, the burning
  gate an arch devil steps through — and only their sparks were drawn. (Two
  pieces are still missing: a model that carries its own skeletal animation is
  drawn in the pose it starts in, and an effect's `<Lights>` are not drawn.)
- **The fallen stay down.** A clip played once was wrapped like a loop, so
  clamping it to its own length landed on frame zero — a corpse standing to
  attention — and a death was forgotten when its shot ended, so the swordsmen
  cut down in one shot were on their feet in the next.
- **A scene's armies move, and there is one of each hero.** Three things were
  wrong at once and each hid the others. A cue usually says WHICH clip by a
  number — a position in that actor's own animation set — and only sometimes by
  name; reading names alone left the heroes still through half of C1M1's
  opening and its armies still through all of it. An actor was taken to be
  whoever speaks, so the sixteen creatures saluting Isabell's speech were never
  rigged to play anything. And a hero the scene both lists and speaks through
  was placed twice, which put a second, unblinking copy of every hero inside the
  first — two demon lords in every close-up of one.
- **A shot's camera stayed put between shots.** The orbit controls rebuild the
  camera from their own state every frame, and switching them off does not stop
  that, so any shot that was not actively playing was aimed and then thrown away
  a frame later: stepping through a scene showed the map's viewpoint each time,
  with the spellwork and the animations going off out of frame.
- A cue that has not fired yet no longer shows: an actor idles until their
  delay is up instead of standing in the first frame of the clip to come, and an
  effect stays hidden instead of holding its opening flash on the field.
- Baked effects no longer need an open map. `bin/effects/<uid>` is a global
  asset, but the handler that serves it demanded a map session, so every
  campfire and firefly in a dialog scene asked for its keys and was told "no
  map loaded".

- **A dialog scene now draws its cast where they stand.** C1M1's opening played
  its eight speaking actors on an empty field: the two armies and 600-odd pieces
  of set dressing were being drawn on top of each other at the corner of the
  arena. An object's transform was fetched by its `<Item id>`, and a scene's
  objects have none — three.js starts an instance buffer at identity, so the
  ones that never got a transform were not missing, they were at the origin.

- The armies in a scene move. Idle animation is a map setting and off by
  default; a scene turns it on for as long as it is up, instead of showing the
  crowd frozen in the bind pose with their arms straight out.

- Undo no longer shrinks every creature on the map. Rebuilding a floor's objects
  left the display scale off the handles it made, so a hero who had been
  three-quarter height came back full size.

- **A scene's camera was on the wrong side of its own rod**, so every close-up
  filmed the back of somebody's head — Isabell's hood for twelve shots running,
  Godric from behind his horse, the listener instead of the speaker. C1M1's
  opening now plays the frames the game plays. Four shots whose rod is exactly
  zero, which left the camera pointing wherever it last pointed, aim properly.

- **A shot fires its own effects**, which is most of what a scene does: the
  Prayer over Isabell's line of soldiers, the Bloodlust that turns Agrael's army
  red, the ice bolt that lands on it, the gating of the arch devil. They start
  at their own delay from the line and go away with the shot.

- **A scene is lit by itself**, not by the arena it borrows. The scene names a
  preset and a shot can override it — the battle that opens C1M1 is lit by
  `InfernoArena`, the parley that follows by daylight — and the sun, the shading
  and the tint on the particles all follow it.

- **Apply no longer freezes the editor while it builds the health bar.** The
  archive is made out of four files of the game's own, and it was getting them
  by reading all 1.4 GB of `data.pak` into memory and decompressing every one of
  its 84 312 members to pick out four. That ran in the main process, so the
  whole application stopped answering for as long as it took — minutes, and
  three and a half gigabytes of memory. It now takes those four out of the
  unpacked data the editor already keeps, which is where everything else in the
  app reads them from: **6 ms and 10 MB**, and the same eleven records byte for
  byte. No archive of the game's is opened at all.

- **Apply in the game settings panel cannot be started twice at once.** It
  installs the extension and rewrites game profiles — most of a minute on a real
  install — and it used to look exactly as unpressed while it worked, so the
  natural thing to do while waiting was press it again and have a second Apply
  writing the same files as the first. It now goes dead and says *applying…*
  until the work is finished, and comes back afterwards even if it failed.

- **A live e2e run no longer resets a mod it has nothing to do with.** The mod
  stages run as a chain over one install, so the suite put that install back to
  the chain's starting state in its GLOBAL setup — which meant every run did it,
  including a run of one unrelated spec. Live, "the starting state" is the
  player's installed mod with the authored content taken back out of it, and a
  mod holding nothing else is then deleted: twenty-six megabytes, four minutes
  of rebuilding, and an install left holding maps that point at content which is
  no longer there — which the game loads, and dies on. The reset now happens
  only for a run that can contain a mod stage, and says so when it does not. The
  archive is also copied to `_tmp/mod-backup/` before anything is taken out of
  it, so the same mistake is undoable rather than merely regrettable.

- **A mod could break battle scripting for the whole game, silently.** Our battle
  code used to be appended to the game's own `combat-startup.lua`, which the
  engine compiles as ONE chunk — so a single bad token in ours failed every
  declaration that file makes (`IsAttacker`, `UnitDeath`, the vocabulary every
  combat script in the game is written against). Our code now lives in a file of
  its own, loaded by one added line, and a mistake in it can only cost itself.

- **The Lua linter knows two rules it did not.** `return;` — legal in Lua 5,
  rejected by the Lua 4 the game runs, and it fails the whole FILE. And the
  standard library the game does not register at all: `tinsert`, `getn`,
  `tostring`, `pairs`, and `dofile` — which is the sharp one, since the engine's
  own is `doFile`. Generated battle scripts are linted in the test suite now,
  rather than in a battle.

## 0.7.0 — 2026-08-02

### Added

- **Game settings — how the game plays, from a panel.** A new button beside
  Play, offered with a map open or without, because none of this has anything to
  do with what the window has loaded. Everything in it is off until you turn it
  on, and an install that never opens it plays exactly as it did before.

  - **Borderless window.** The game's own window without its frame, filling the
    screen. It also sets windowed mode and the render size in your game profile,
    because exclusive fullscreen has no frame to take off and a window the size
    of the screen with a 1024x768 picture in it is a stretched one.
  - **Keep settings and saves with the mod.** Profiles, key bindings, settings
    and saves go to `H5E/user` inside the install instead of Documents, where
    every copy of the game on the machine shares one set of them. It starts
    empty: nothing is copied over, so the base game keeps its saves and this
    build begins fresh.
  - **Split a stack with a held key.** Clicking an army slot with **Ctrl** puts
    one creature in the first free slot — or, on a stack of one, puts it back
    with its own kind. **Shift** evens out every stack of that creature and adds
    one more each click: 12 becomes 6 and 6, then 4, 4 and 4; uneven stacks are
    levelled first, so 12 and 5 become 9 and 8 before they become 6, 6 and 5.
    Stacks of a single creature are left where they are — they are scouts, and
    you put them there. **Alt** gathers them all back into the one you clicked,
    and **Ctrl+Shift** puts one creature into every free slot. No slider window
    appears, and a click with no key held picks the stack up exactly as before —
    dragging is untouched, slider and all.

  The first two are import-table hooks — one pointer each, no instruction of the
  game's touched. See [docs/QOL.md](docs/QOL.md), and
  [docs/UI_INTERNALS.md](docs/UI_INTERNALS.md) for how a screen is put together.

- **Hero classes and skills of your own.** The Heroes window has tabs now, and
  two of them are new: a class, and a skill for it to own. A class decides what
  the hero screen calls him, how often each skill is offered at a level up and
  how the four attributes grow — and a skill of yours can be his racial, with
  its own icon, its own words at each level of mastery, and perks to grow into.
  A class takes its skills with it: put one in a mod and everything it owns
  travels with it. Confirmed in game — Gem stands on a map as a Колдунья holding
  a racial nobody shipped. See [docs/HERO_CLASSES.md](docs/HERO_CLASSES.md).

- **A perk can actually do something,** in either of two ways. It can add a term
  to a sum the engine computes — the tent master gives the first aid tent a use
  per level of mastery, four at basic and five at advanced — or it can carry Lua
  and run at a moment the engine already hands out, which is how a tent
  destroyed in a battle is standing again afterwards. The second needs no
  extension at all. See
  [docs/engineInternals/FIRST_AID_TENT.md](docs/engineInternals/FIRST_AID_TENT.md).

- **A hero can have a face of his own, and a specialization of his own.** Give
  the specialization pictures and the mod builds the game's own textures from
  them on every build — both portrait sizes and the specialization icon — so a
  drawing painted over a preset's art is no longer replaced by the preset's on
  the next build. The specialization itself is a value the game was never
  compiled against, and it answers in a battle.

### Fixed

- **The editor no longer guesses where the game is when it has been told.**
  `start-editor.bat` set `HOMM5_ROOT` to the directory above the checkout, which
  is right when the repo sits inside the install and wrong everywhere else — and
  because the environment outranks everything, that guess beat the folder the
  setup window had recorded. The same guess still happens, in `paths.ts`, as the
  last resort it was meant to be. Visible symptom: an editor that opened, listed
  maps and edited them perfectly while insisting the install had no executable.

## 0.6.0 — 2026-07-31

### Added

- **Buildings — everything a hero walks up to, made in a window.** Mines,
  dwellings, banks, shrines, border guards, garrisons, prisons, sphinxes: the
  fifteen classes the game has anything to say about, each with a tab of its own.
  The class is the first thing you pick because it decides the rest — whether the
  building chooses one of the 128 behaviours the game has compiled in or IS one,
  what fields it adds, how many lines it shows. Start from a shipped object with
  **Use preset…** and edit the difference, or fill the form from nothing.

  A building you make borrows nothing. Its model, textures, animation, effects,
  sound, icon and every word it says are copies inside the mod, so you can
  repaint it with the same brush the creature list has, swap its mesh, or
  translate it, and the game's own files stay as they are. A building from the
  town screen can be brought down to map scale on the way in, which is how a
  dwelling gets art for a tier the adventure map never had.

  The form marks what it cannot do without — the identifier, the model, the name,
  and whatever the class needs (a dwelling hires nobody without creatures) — and
  Save stays down until those are in, saying what is still missing rather than
  refusing after the fact.

  What it will not do yet: say what a PLACED building needs. A shrine put on a
  map teaches the spell that placement names, and a fresh one names none — so it
  stands there and does nothing, and nothing marks the field the way the
  building's own form marks its own. Same for a sign with no message, a seer hut
  with no quest and a shipyard with no water tile. All four can be filled in —
  the sign's message through the panel's New, the quest and the ship tile
  through Edit… into the tree — and the map the test suite builds now has them
  filled, bay included.

- **A way back out of a map, and a bar that shows one thing at a time.** The top
  bar had been carrying both of the window's jobs at once — the editors that
  build content for the game, and the tools that work on the open map — in a
  single row of two dozen controls that had simply grown until it scrolled
  sideways. It now shows one face or the other.

  With no map open you get the launcher: **Campaigns**, **Units**, **Artifacts**
  and **Heroes** stand out in the open, because they are what that screen is for.
  With a map open you get its tools, grouped under **View** (what the window
  draws — the plan view, the idle stance, effects, light, cliffs, the grid) and
  **Properties** (what the map carries — its settings, its tree, regions,
  scripts, texts). Undo and Redo stay out in the open next to them: they are
  worked, not chosen from a list. So do the three panel toggles — **Objects**,
  **Objects+** and **Terrain** — which are held down through a whole session and
  double as the readout of which brush is live.

  **Map** is the one menu on both screens, and it now holds **Close map**. That
  was the missing door: a map could be opened and never put down, so the list of
  maps was somewhere you passed through once at startup and could not get back
  to. Closing tears the scene down for real and lets go of the map in the main
  process too — the file watcher stops, which matters because a watcher left
  running keeps pushing "changed on disk" at a window that no longer holds the
  map, and on Windows its open handle alone is enough to stop that folder being
  replaced by the next thing you open. Unsaved work is asked about first, in a
  dialog of ours, and Cancel means the map stays.

  Panels you had open are hidden, not closed: whether the terrain palette is up
  is your standing choice, and it comes back the way you left it on the next map
  rather than being quietly forgotten every time one is put away.
- **A ▶ Play button in the bar**, beside **Pack**, because the two are a pair:
  build the archive, then go and look at it. It starts *our* copy of the game —
  `bin/H5_Game_H5E.exe`, the only one that reads your `H5E` folder — and says
  which file is missing if the install has not been prepared yet. The game runs
  on its own and outlives the editor, and nothing is saved on the way out: what
  it shows is what was last packed.

  It launches with `bin/` as the working directory, which is not a detail. Given
  the install root instead, the game came up, played, found its archives, wrote a
  generated map exactly where it should — and broke creature models while doing
  it. Started by hand from `bin/` it never did, which is how that was found.
- **`run-test-and-keep.bat`** runs the five mod stages against the install this
  checkout sits in and sweeps up nothing, so the creature, the artifacts, the set
  and a map to see them in are left in `H5E/` for you to play. An ordinary test
  run does the same work in a throwaway install and deletes it, which is what
  makes the suite say something about the code rather than about one machine.
- **The first run prepares the whole install, and it is tested.** Four things
  have to be true before the editor is any use: the archives unpacked, a
  readable copy of the game's executable, our extension loaded by it, and that
  copy reading our own mod folder. Only the first was ever done for anybody —
  the other three were `npm run` commands typed by hand, so they had happened
  once, on the machine of whoever wrote them, and nothing exercised them again.
  The setup screen now does all four, shows which are already true, and only
  offers **Open the editor** when none are left; the steps are idempotent, so a
  second run writes nothing. `--setup` reopens the screen at any time.
- **`.env` beside the checkout** (`.env.example` says what goes in it) fills the
  setup window's two fields in. It decides nothing: the picker in that window is
  the only place an install is ever chosen. The e2e suite pointedly does not
  read it — there `HOMM5_ROOT` means "the install to play in", and its default is
  a throwaway one so a run cannot leave test maps in a real game folder.
- **Every form outside the map says what it needs before you press Save.** The
  buildings window learned this first; creatures, artifacts, artifact sets,
  heroes, campaigns and New Map now do the same. What a build refuses to go without is
  marked with a star, Save stays down while one of those is empty, and the ones
  still missing are named under the form — instead of a rebuild ending in a line
  of red about a field nothing ever pointed at.

  The preset is the one worth knowing about: a creature and a hero are COPIES of
  a shipped one, so with none picked the build got as far as the channel and came
  back "cannot resolve the donor (none)". It is marked now. Editing one already
  in the mod does not ask again — it keeps the documents it was built from.

- **The artifact-set window explains itself.** Making a set worked and reading
  the form did not: three controls in a row with nothing over them, an amount in
  no stated unit, and the sentence the player will read typed a second time by
  hand. Now the row says what its columns are and that a hero's own stats are
  not among them (the engine has no hook — a script row does those), the unit
  sits beside the amount (necromancy in percentage points, dark energy in
  ceiling points), and **Draft from the effects** writes a first version of every
  tooltip from the rows — cumulative, the way the shipped sets word theirs, and
  only into boxes nobody has written in. This was the last thing the test suite
  still marked unfinished.

  A set's **script starts written**, too. The editor used to open on an empty
  box, and everything above the author's first line was knowledge they had no
  way to have: that the members arrive as `<Set>_MEMBERS`, that the walk over
  the eight players is theirs to write, that `EditorHeroWearing` is the question
  to ask — and that a file which never calls `Trigger` does nothing at all. It
  now opens on that shape, named after the set, with the worn count as a knob
  (`local x = 3`) rather than a number buried in a call: a second behaviour at
  another count is that function copied with another x. What it does not do is
  decide WHEN the set acts — "once a day" fits a granting effect and fits
  nothing else — so the hook is a line of commented shapes to pick from, and the
  starter as it stands runs nothing on purpose. Written once, when a set has no
  script; after that it is yours like any other text.

### Changed

- **A map of ours is a `.h5m` again**, not a `.mod`. The extension was ours to
  choose and choosing a new one bought nothing: the game mounts every archive
  the same way, and every tool, wiki and habit around Heroes 5 says `.h5m`.
  Existing maps in `<game>/H5E/` need renaming — the archives themselves are
  unchanged — and `npm run mod-paths -- --set ours` writes the new pattern into
  `bin/H5_Game_H5E.exe`.
- **Maps the game generates land in our folder.** The random map generator saves
  to `<install>/Maps/`, which our build stopped mounting in 0.5.0, so a
  generated map was written to disk and then never seen again — it played that
  once and was gone from the list next launch. That folder is now patched with
  the same switch, so the generator writes into `<game>/H5E/` like everything
  else. `npm run mod-paths` lists it beside the five it already showed.

### Fixed

- **A creature opened for editing remembers what it was copied from.** The form
  never put the preset back, so Save either failed outright or — if a preset had
  been picked for something else since — quietly rebuilt the creature from THAT
  one's art. The creature records its donor now, the way a hero has always
  recorded his, and one made before that keeps the documents it already has.
- **An artifact set opened for editing keeps its file stem.** The stem was not
  among the fields the list handed back, so the box held whatever the last set
  put there — or nothing — and saving wrote the set's texts under that name.
- **New creature / New artifact / New set clear the form.** Every box kept the
  last one's contents, so the quickest way to lose ten minutes was to author one,
  press New, and be refused for an identifier that was already taken.
- **The campaign's name box does something.** It showed the name, took typing,
  and wrote nothing back: renaming a campaign in it changed nothing and said
  nothing. It is saved now. Create with an empty name is refused visibly rather
  than by doing nothing at all.
- **Edit… on a deep structure opens a tree that shows it.** A shipyard's ship
  tile and a seer hut's quest are marked advanced, and the tree hides those
  until they are asked for — so the panel's own Edit… button led to a tree
  without the field it named. Naming it is asking for it: the switch goes on.
- **A building says the line the class means, not the line that happened to be
  next.** `messagesFileRef` is read by POSITION, and the lists differ by class:
  a shipyard has five entries and the fifth is what it says when there is no
  water to build on, a seer hut's fifth is its extra message, a shrine has six.
  The editor wrote the same four for everything and skipped the ones left blank,
  so the fifth line of a shipyard did not exist — a hero walking up to one with
  no water got an empty box — and a blank third line silently promoted the
  fourth into its place. Every class now has its own list, read off the shipped
  documents, and a line with nothing to say is written as the empty entry the
  game's own Garrison and Sphinx use. Buildings made from a preset pick up the
  words the shipped object had in those slots, which they had been dropping.

## 0.5.0 — 2026-07-28

### Changed

- **Our build reads one folder, `<game>/H5E/`, and nothing anyone else
  installed.** The game scans five patterns for archives to mount —
  `Maps/*.h5m`, `DuelPresets/*.h5p`, `UserCampaigns/*.h5c`, `UserMODs/*.h5u`,
  `UserMODs/*.zip` — and every mod anyone ever installed sits in them. Our copy
  of the executable now scans `H5E/*` instead, so a stranger's `.h5u` or a map
  dropped into `Maps/` is not read at all. A map of ours is `H5E/<name>.mod`;
  campaigns, duel presets and mods keep their extensions beside it. The shipped
  executable is untouched and still reads all five, which is the way back —
  or `npm run mod-paths -- --set shipped`.
- **The patched executable is `bin/H5_Game_H5E.exe`** (was `H5_Game_NCF.exe`).
  The copy is ours end to end — our ceilings, our import, our folder — and is
  named for what makes it.
- **Everything the editor installs goes there too:** the mod, packed maps,
  campaigns. The Units and Artifacts dialogs read `H5E/` when they list what is
  installed.
- **New Map creates a file, not just a folder.** It writes
  `<game>/H5E/<name>.mod` at once and Save goes back into it, so there is no
  state where a map exists only as a working folder nothing ships from.
- **The map picker lists maps out of the install, never out of the unpacked
  data.** Ours, packed, under "Ours"; the game's own read straight from its
  `.pak` archives under "The game's" — 42 of them, in about 50 ms, without
  reading the 1.4 GB archive itself. Opening one of the game's maps unpacks a
  copy to start from and never writes to the archive it came from. The old list
  walked the whole unpacked `Maps` tree, stat-ing every file of every shipped
  map, and was the standing suspect for the lag on the first screen.
- **Open… starts in our folder** — where the maps are files — and then follows
  the last map opened, as before.

### Upgrading

Everything of yours moves into `<game>/H5E/`: maps as `.mod` (the archives
themselves are unchanged — rename or repack), campaigns as `.h5c`, and the
editor's mod, which **Units…**/**Artifacts…** reinstall there in one press.
Nothing is migrated for you, and nothing is deleted: `bin/H5_Game.exe` still
reads the old folders, so the game as it was is one launch away.

### Fixed

- **An error from a mod form was written where nobody could see it.**
  `id="um-err"` (and `am-err`) existed twice in the page — once in the list,
  once in the form on top of it — and `getElementById` answers with the first,
  so every message the form raised landed on the dialog behind it. The forms
  have their own lines now, and a build's "installed …" note stays with the
  list the form closes back to.
- **Placing two of the same object in a row placed one.** A palette swatch
  toggles; arming what is already armed puts it down, and the next click on the
  map went nowhere.
- **Painting straight after picking a new tile went nowhere, silently.**
  Choosing a tile the map has no layer for adds one in the background, and the
  brush was armed and the tile named on screen before that landed — so a stroke
  in between had nothing to paint into and was dropped without a word, the
  ground looking untouched and the file keeping its zeroes. The bigger the map,
  the longer the window: rebuilding C1M1 lost three complete texture layers
  this way. The brush now says when a tile is not paintable yet, and reports
  itself unready until the layer is really there.

## 0.4.0 — 2026-07-28

### Fixed

- **Effects that were slowed down no longer play twice over.** The retrigger
  period turned out to be measured in the instance's own clock — the one
  `<Speed>` scales — and not in wall seconds. Read the wrong way, any effect
  authored slow retriggered far too often: the Fountain of Fortune grew a
  second rainbow arcing over the first while it was still at full strength
  (208 alive particles against the recording's own peak of 131, now 136), and
  the shipped library asked for up to 36 copies of a single fog recording at
  once. It shows on the 154 instances whose `<Speed>` is not 1 — fog, forge
  smoke, tavern flames, the town splashes.
- **A creature's glued effects follow the animation.** The shadow dragon's eye
  glow hangs off its Head bone; it was placed against the bind pose when the
  scene was built and then never moved again, so the head turned through its
  idle clip and the eyes stayed behind, floating where the head had been. The
  glued instances now keep their transform in the BONE's frame and are re-hung
  off the live bone each frame — measured, the glow travels a third of a unit
  over a beat of the clip where the unglued mist around the same dragon moves
  exactly zero.
- **Fires no longer die and relight — the effect loop was the wrong model.**
  The baked effect files turned out to be one-shots, not loops: the particle
  population ramps up from nothing and dies back to nothing (1911 of the 1921
  files). Playing one copy on repeat — what 0.3.0 shipped — makes every
  campfire visibly gutter to a single ember and flare up again every few
  seconds. The game instead RETRIGGERS the recording on a fixed period
  (`EndCycle`, misleadingly named — the value is seconds), overlapping copies
  so the die-out of one hides under the ramp-in of the next: the campfire
  now holds a steady 35–45 particles where a single loop dipped to one. The
  same reading fixes rhythm the other way round: a 1.1-second wisp with a
  7-second period is a puff of smoke every seven seconds, which used to
  replay six times too often. One-burst instances (`CycleCount 1` — the
  phoenix's wing-whoosh of 1118 particles) fire once per idle-animation
  cycle, the way the game times them, rather than looping continuously —
  the clip length gave the mechanism away: the phoenix's looping fire is
  authored with period 3.16666 and its idle clip is 3.1666667 seconds long.

- **An object placed from the palette now gets its effects on the spot.** The
  campfire used to land cold and only start burning after a save and reopen;
  the palette path grafted the mesh and the idle animation onto the live
  scene but never the particle systems.

### Added

- **New creatures and new artifacts, from the window.** Two toolbar buttons —
  **Units…** and **Artifacts…** — build and install a mod without the command
  line. Pick a shipped creature or artifact as a **preset** and its every field
  loads: stats, name, description, the hire dialog's ability line, the engine
  abilities, the home town, the four art documents; or for an artifact its slot,
  rank, prices, the six hero stats and its icon. Then edit the difference. The
  ids spell themselves from the file name, every enum is a select, and the four
  art rows are the copy handles — point one at another file and only that piece
  changes. The mod is always the one in `UserMODs`, found rather than asked
  about, because two creature mods conflict outright. Installing writes the
  archive and the executable's ceiling as one action, as it must. Dwellings and
  whole creature sets stay on the command line.
  See [docs/UNITS_AND_ARTIFACTS.md](docs/UNITS_AND_ARTIFACTS.md).
- **Recolour a mod creature's textures, by palette.** A **Recolor** button per
  creature opens its textures with their dominant colours as swatches — each
  remappable on its own, so the cloak goes grey and the skin stays skin. A pixel
  keeps its own lightness, which is where the drawing lives; alpha is never
  touched, being the silhouette. Global hue/saturation/lightness/tint apply on
  top, with a one-click Grey. The previews are not an approximation: preview and
  rewrite run the same arithmetic. It repaints the mod's own copies, so nothing
  shipped is touched. Seen in the running game: the Sharpshooter with its cloak
  remapped to steel grey — and its skin left alone, which is the point, since
  skin and gold trim share one hue cluster and the sliders would have taken the
  face too. **First cut** all the same: the recoloured surface is written
  uncompressed, which quadruples the texture and drops its mipmap chain.
  Recompressing to DXT3 is the first thing in the plan.
- **The last three real "cannot decode" objects decode.** Of the objects that
  refused to mesh, three turned out to be real and each hid a different
  mechanism: the unshipped Hill_Castle town declares an EMPTY exterior, which
  starved the town path of the plain `<Model>` it actually has; the
  ghost-mode hero (the wisp you steer in multiplayer while waiting out a
  turn) carries no model in its own document — its body is wired per class in
  the GhostMode tables, every class pointing at the same Ghost character; and
  Fire_glow is the palette's one pure light — no particles, no model, just an
  animated fire light — which now stands in as a warm glow card. The
  seventeen still refused are the game's own dead stubs: empty `<Model/>`
  documents that nothing in the original editor's palette links to (its
  working Sunflowers, snow Alchemist Lab and subterranean rails are different
  documents), verified against the original editor on a showcase map.

- **Scene light reaches the particles marked for it.** Effect instances are
  authored `L_LIT` (lit by the scene — mostly the falling leaves of oaks and
  pines) or `L_NORMAL` (self-lit — fire, glows). Lit instances now darken
  under the map's lighting preset: on a night map the leaves dim into the
  scene while the campfire beside them keeps burning. Daylight presets leave
  everything as it was. (Two neighbouring fields turned out to be dead ends,
  written up in the format doc: `WindAffected` is false on every effect the
  game ships, and the presets' `ParticlesColor` is the same 0.25 grey in all
  of them — an engine constant, not a per-map knob.)

### Known limitations

- **A recoloured texture is written uncompressed.** The shipped creature
  textures are DXT3 with a mipmap chain; a repaint writes the surface back as
  plain 32-bit with a single level, which the game reads (a recoloured
  Sharpshooter was checked in play) but which costs four times the VRAM and
  leaves nothing to fall back to when the creature is drawn small.
  Recompressing is the next thing in the plan.
- **Dwellings and whole creature sets are still command-line only** — the
  dialogs author one creature or one artifact at a time (`npm run units-mod`
  builds a set from a project's `units.json`).

## 0.3.0 — 2026-07-27

### Added

- **Every map lights like itself.** The editor used to light every map with one
  built-in daylight; now it reads the map's own `AmbientLight` preset — sun
  colour and direction, ambient and shade — and applies it per floor, so a
  night map opens dark, an underground floor stops looking like noon, and the
  burnt Griffin Empire opens under the sombre light its designers chose. The
  ground and the building mounds on it are lit with the game's own formula in
  the game's own colour space; two things had to be learned for the picture to
  come out right rather than as a permanent dusk: the game multiplies colours
  in gamma space (so its ×2 is three.js's ×4.6), and the preset's sun angle
  counts from the zenith, not the horizon. Written up in docs/LIGHTING.md,
  including why the preset's "Sky" is a set of reflection blobs and not a sky.

- **The designers' point lights pool on the ground.** The violet glow under an
  underground crystal, the torch light on a mine wall, the red wash of a lava
  chamber — that light was never in the lighting preset or the effects: every
  placed object in a map file can carry its own point lights, and the shipped
  maps carry about ten thousand eight hundred of them. The editor bakes each
  floor's lights into a lightmap the ground is lit through, in the same colour
  space as the rest of the game's formula, so an underground floor now looks
  like the cave the designers lit rather than a uniformly dark room. The pools
  follow their object when it is dragged and die with it when it is deleted.
  Objects standing in a pool are not yet tinted by it — the ground is.

- **Particle effects play.** Campfires burn, mana crystals spark, portals
  shimmer — every effect a placed object references is drawn and moving, not
  as an approximation but as the game's own frames: `bin/effects` — the last
  unknown format between the editor and the game's full picture — turned out
  to be a baked simulation. The effects were authored as Maya particle
  systems, and what shipped is the recording: 1.69 million particles with 41.8
  million keyframes for position, rotation, size, colour and texture frame.
  Nothing to simulate, only keys to interpolate, so playback is exact by
  construction. The parser reads the entire library with every byte accounted
  for (docs/EFFECTS_FORMAT.md, `npm run test-effects`); the static glow cards
  that used to stand in stay as fallbacks. Known simplifications (blending is
  inferred from the art, loop windows and wind are ignored) are written up in
  the format doc.

- **Creatures play their own effects.** The ghost dragon stands in its swirling
  cloud mist with glowing eyes, the fire elemental burns, the water elemental
  churns. These effects were invisible to the editor because they hang off a
  different hook than an object's: every monster's own effect slot is empty,
  and the real one rides the idle animation clip. Two discoveries along the
  way: an instance can be glued to a skeleton bone (the eyes are two particles
  around the head bone's origin — the bone's rest pose, read from the
  animation file, is folded in; a bone that can't be found drops the instance
  rather than drawing it at the creature's feet), and the baked particle
  colours are authored around 128-is-full-brightness — the same era's
  modulate-×2 the terrain lighting uses — so the mist rendered near-black
  until the colour stage doubled it. The doubling clamps where effects were
  already saturated, so campfires stay campfires.

- **Creatures stand at the game's size, and fire actually burns — in the right
  colour.** The phoenix used to tower over its tile and burn without flames;
  three format truths hid behind that. The size: a creature's idle-clip
  skeleton carries a display scale on its root bone (the phoenix is shown at
  0.37 of its authored mesh, the devil at 0.7) — the editor now applies it to
  the placed model while the effect stays full-size, which is the game's own
  look: a small bird inside towering fire. The missing fire: fire art ships
  with NO alpha channel — that IS the era's blend convention (a texel's
  colour adds, its alpha occludes, one mode: ONE/ONE_MINUS_SRC_ALPHA with
  straight colour) — and it hit two traps at once: a blend-guessing heuristic
  classified zero-alpha fire as smoke and discarded every flame fragment,
  and the browser canvas the atlas is built through premultiplies, turning
  colour-under-zero-alpha black in transit, so each frame now travels as a
  colour image plus its alpha as a separate grayscale. And the colour itself:
  the baked colour bytes are stored in the era's B,G,R,A order, so every
  flame in the editor was quietly tinted BLUE and every water swirl beige —
  the campfire got away with it only because its tint is nearly white. With
  all three fixed, the phoenix, the arch devil, the infernal succubus and
  the fire elemental burn orange, and the water elemental churns in blue.
  (The base devil, base succubus and the earth elemental carry no idle
  effect in the game's data — the fire belongs to the upgrades.)

- **Effects and Light join the view toggles.** Next to Idle stance the bar now
  carries **Effects: on/off** (stop the particles moving and drawing) and
  **Light: map/flat** — the floor lit as the game lights it, or the editor's
  flat neutral look, because a designer-lit underground is atmospheric and
  nearly black, and editing it means wanting the lights off. Both choices
  stick between sessions, cost nothing to flip, and touch nothing but the
  view: effects keep arriving and keep following their objects while hidden.

### Fixed

- **`npm start` ran a stale renderer.** The build script's am-I-being-run-
  directly check compared a file URL (spaces as `%20`) against a plain path
  (spaces literal), never matched under this repo's path, and quietly built
  nothing — every `npm start` since the bundle was last built by the test
  suite ran old renderer code. Developer-facing only; releases were built by
  CI and unaffected.

## 0.2.0 — 2026-07-27

### Added

- **Creatures and buildings can move.** The map has always drawn every object
  frozen in the pose its model was exported in — the pose the original editor
  shows too. The new **Idle stance** button plays what the game plays when
  nothing is happening: a gremlin fidgets, a dwelling's chains swing, a phoenix
  works its wings.

  It cycles three states, and starts at **off**, which is not a paused loop:
  with it off the scene is built without any of the animation data, so a map you
  are only editing costs exactly what it did before — the payload of an animated
  creature is otherwise about twice the size. **Visible** re-poses only what the
  camera can see; **all** keeps everything moving, on screen or not. An animated
  object also stops sharing a draw call with its identical neighbours, which is
  why there is a middle setting at all.

  Every switch takes effect on the spot. Turning it on for a map that was opened
  without it briefly says *loading animations…* while the missing data is
  fetched and grafted onto the open scene; nothing is reopened and nothing else
  moves.

  Reading the animations meant working out two formats the editor had never
  touched: the animation files are not the game's own container but RAD's Granny
  GR2, and most of them are packed with RAD's Oodle1 codec, which is now decoded
  here rather than handed to the 32-bit DLL the game ships. The port is
  byte-for-byte identical to that DLL on every packed file in the game — checked
  against all 2839 — so every idle the game references plays, including the one
  Orc building (`ShamanOfNommads`) whose idle resisted until its quirk was read
  out of the DLL itself. Anything that ever fails to read falls back to the
  frozen mesh rather than disappearing.

  Three kinds of object needed their own rule before they looked right. A model
  is skinned against its OWN skeleton — the one inside an animation file holds
  the pose that clip starts from, not the pose the mesh was bound in, and the
  addon creatures' stances sit far enough from bind (167° for the Combat Mage)
  that the Air Elemental came apart into chunks. A model that declares no
  skeleton stays still no matter what its animation set says — the Gold Mine
  ships an idle clip it never uses, and playing it scattered the gold across
  the hill. And a clip whose bones outrun the sampling grid (the Air
  Elemental's vortex turns 171° between two default samples) is resampled
  faster until it moves smoothly instead of stuttering.

### Known limitations

- Only the idle clip is played. Creatures also ship combat animations (attack,
  move, hit, death) and those are read correctly, but nothing on the adventure
  map has a reason to play them yet.
- Rotations are sampled from their curves rather than evaluated exactly as the
  engine does — fast bones are sampled densely enough to stay smooth, but it is
  still a sampling. On an idle loop seen from the map camera there is nothing to
  see; it is written down as the one place in the chain that is close rather
  than measured.

## 0.1.2 — 2026-07-26

### Fixed

- **The editor opened and then did nothing.** The window came up with its
  toolbar, the map list said "loading…" and never stopped, and no button did
  anything — including Open map and New map. On a machine whose graphics driver
  gives Chromium no 3D context, the first thing the editor sets up failed, and
  that stopped everything after it from loading: every button, and the map list
  itself. The window still looked fine, because the toolbar and that "loading…"
  are part of the page rather than signs of a working editor.

  It now says what happened, alongside what this machine's graphics report, and
  offers to restart drawing in software instead — several times slower, but it
  needs nothing from the driver. While that is on, the editor says so and offers
  the GPU back in one click. Any other failure this early gets the same
  treatment: a message you can copy, rather than a window that ignores you.

## 0.1.1 — 2026-07-25

### Fixed

- **Setup opened onto nothing.** Answering the first-run screen closed it and
  the app was gone; starting the exe a second time worked, because by then the
  answers were saved and setup no longer ran — so it looked like setup had not
  taken. Setup destroyed its own window, which leaves the app with no windows
  open for an instant, and Electron reads that as the app being finished. It
  now hides its window and hands over, and the editor's window is up before
  anything closes.

## 0.1.0 — 2026-07-25

The first build that can be handed to someone: a folder with `homm5-editor.exe`
in it, no installer, no Node, no checkout.

### Added

- **A standalone Windows build.** `npm run dist` bundles the main process, the
  preloads and the renderer, and packages them into
  `dist/homm5-editor-win32-x64/`. Nothing at runtime needs `node_modules` or a
  TypeScript loader.
- **A first-run setup screen.** A packaged editor has no checkout to take its
  bearings from, so it asks where the game is installed and where the unpacked
  data should go, then unpacks the archives itself with a progress bar. The
  answers live in `settings.json` under the user's app-data folder;
  `homm5-editor.exe --setup` reopens the screen when they go stale, and
  `HOMM5_ROOT` / `HOMM5_DATA` still win over what was remembered.
- **Releases built by GitHub.** A `v*` tag runs the typecheck and the tests
  that need no game data, packages, and publishes the zip.

### Fixed

- **Two thirds of the game went missing when unpacking.** A fresh unpack
  produced a data root with the geometry present and almost no object
  definitions — 16 files where there should be 5225 — so maps opened as
  "3557 objects, placed 0, no model 3557" and the palette offered seven
  objects. The end-of-central-directory record counts entries in sixteen bits,
  and `data.pak` holds 84,312 of them: its header says 18,776, the same number
  modulo 65536, with no ZIP64 record to correct it. Both archive readers
  believed that count. They now walk the directory to its end and never consult
  it.

### Known limitations

- The build is not code-signed, so Windows SmartScreen warns about an unknown
  publisher: *More info → Run anyway*. That needs a certificate from a
  certificate authority, not a packaging flag.
- The editor needs the game itself — it reads its models, textures and rosters,
  and ships none of them.
- Windows x64 only.
