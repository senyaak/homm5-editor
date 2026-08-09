# The Rules Test map — what to look at, and when

Every rule fix in `native/qol/fix-*.c` is verified as **bytes**: `npm run
test-fixes` reads the installed executable and says each patch is aimed where it
claims. Nothing automated can say *"the barbarian loses the stats when he
forgets the skill"* — that is a thing to watch in a battle. This is the map to
watch it in, and the list of what to watch.

The map is built by the e2e suite, so it is the same map every time and it is
built by the editor under test:

```bash
HOMM5_GAME="<game>" HOMM5_NO_REMOVE=1 npx playwright test e2e/fix-001-rules-map.spec.ts
```

`HOMM5_NO_REMOVE=1` is what puts it in the **real** install (`<game>/H5E/Rules
Test.h5m`); without it the whole thing happens in a throwaway under `_tmp`,
which is right for checking that the spec still works and useless for playing.

## The shape of the experiment

**001 builds the map and turns every fix OFF. 002 turns every fix ON and
touches nothing else.** So:

1. run `fix-001-rules-map`, play the map, walk down the list below and see each
   bug;
2. run `fix-002-rules-on`, play the *same* map again, walk down the list and see
   each one gone.

The map is the constant and the flags are the variable. That is the only
arrangement in which "it is fixed" means anything — rebuild the map between the
two and a hero who came out slightly different reads as a fix that worked.

`e2e/fixes.ts` is the plan: which hero carries which perk and why. Nothing about
the kit lives in the specs.

**Before either run, the plan is checked against the game's own files** —
`npm run test-fix-map`, a second, no install needed:

- a perk the hero will not be granted (the class, the parent skill, the perks
  that come first — read out of `Skills.xdb`);
- a creature id or a shared record that is not there;
- a fix with no hero standing for it, or a hero standing for a flag `002` never
  asserts went on;
- two things placed on one tile;
- a battle too short for a fix whose result is read from the log.

Every one of those fails **silently** in the game: the map is written, it loads,
and the thing you came to watch is not there. It has cost a play-through before
— the warlock was given Payback with no Dark Magic to hang it on. `fix-001` asks
the same questions before it builds anything.

## Who is standing where

Eight heroes in a row along the south of the map, each two tiles in front of the
stack he is meant to fight. Red is yours; the one at the east end is the
computer's.

| hero | race | what he is for |
|---|---|---|
| `wizard` | Academy | Master of Fire |
| `knight` | Haven | Encourage |
| `warlock` | Dungeon | Payback, the snare crash, Empowered Armageddon, the element a mass spell hits in |
| `runemage` | Fortress | Dragon Form |
| `ranger` | Sylvan | Imbue Ballista — the fix, and the bug it claims |
| `barbarian` | Stronghold | Barbarian Learning |
| `scholar` | Haven | the Book of Power |
| `opponent` | Sylvan, PLAYER_2 | the battle AI — and the trappers, in hotseat |

Four of them — `wizard`, `knight`, `warlock`, `scholar` — also carry a spell of
ours, which is an experiment rather than a fix; see [11](#11-волна-смерти--a-spell-of-ours-on-four-heroes).

---

## The list

### 1. `snare-crash-fix` — the warlock against the opponent, in HOTSEAT

**Start this map as a hotseat game.** Two things were measured in a real battle,
and between them they rule out every simpler arrangement:

- **a snare does not fire on its own side.** Give the warlock his own trappers
  and his crystal lands on their snare, both sit on the tile, and nothing
  happens. The trap never goes off, so the crash's code is never reached.
- **a neutral stack of trappers does not lay snares at all.** So attacking a
  wandering stack of them gives nothing to aim at either.

What is left is a snare laid by the other PLAYER, on a tile you chose — which is
what hotseat is for. The opponent hero at the east end carries the trappers.
Walk the warlock into him, and in the battle:

1. on the trappers' turn, lay a snare on a tile you will remember;
2. on the warlock's turn, cast **«Кристалл тайного»** (Arcane Crystal) or
   **«Стена мечей»** (Blade Barrier) onto that same tile.

The rest of the list plays as an ordinary single-player game, where the opponent
is the computer — which is what the battle-AI test needs. The map is the same
either way; only the mode differs.

- **off** — the battle ends. That is the whole bug: the game drops out of the
  fight.
- **on** — the obstacle goes down and the battle carries on.

Do this one first: it is the only one whose failure mode is a crash, so it is
the only one that can cost you the rest of the run.

### 2. `payback-fix` — the same warlock, same battle

He has **Payback** — `HERO_SKILL_PAYBACK`, a Dark Magic perk the shipped game
shows as **«Темное восполнение»**: *"Если заклинание не подействовало на отряд
существ благодаря их сопротивлению магии, то герою возвращается вся потраченная
на заклятие мана, и его следующий ход наступает раньше."* Mana back when a stack
RESISTS. (dredknight's file calls it the Arcane Renewal fix, which is Heroes
5.5's name and is nearer the Russian one than "Payback" is.)

He also has the three spells that put an obstacle on the field: **«Кристалл
тайного»** (Arcane Crystal), **«Стена мечей»** (Blade Barrier) and **«Призыв
улья»** (Summon Hive). Watch the mana ball and the turn order as you cast one.

- **off** — "Payback!", the whole cost comes back, and his turn moves up. Every
  time, for a spell that is standing on the field.
- **on** — the mana is spent and stays spent. A spell a stack actually *resists*
  still pays back, which is worth one cast at a real target to confirm.

### 3. `encourage-fix` — the knight

His army holds three **Black Dragons**, which are immune to magic. In a battle,
use **Encourage** on them.

- **off** — refused, "immune". His own dragons refuse an ability that only moves
  their turn up.
- **on** — it works. Try it on the Swordsmen too, before and after: nothing about
  them should change.

### 4. `master-of-fire-fix` — the wizard

Two things in his kit are the instrument, and neither is obvious:

- he fights **100 zombies**, because an Armageddon leaves nothing of a peasant
  stack and this is read off a stack that is still standing;
- he has **100 druids**, because the defence has to be raised *while the fire
  effect is still on* — and the effect lasts **one turn**, so the hero who cast
  the Armageddon cannot also cast the buff in time. A creature caster can:
  `CREATURE_DRUID` knows **Stone Skin**, and acts in the same round on its own
  initiative.

So: cast **Armageddon** (it hits your own stacks as well), then on the **druids'**
turn have them cast **Stone Skin** on a stack of yours that the fire caught. Read
that stack's defence in its tooltip after each step.

**Read all four numbers, in order.** With the fix on and a stack whose defence
is 12, a Stone Skin worth +4 gives:

| when | reads | why |
|---|---|---|
| before anything | 12 | |
| the fire lands | 6 | 12 − ⌊12/2⌋ |
| Stone Skin cast | 8 | 16 − ⌊16/2⌋ — the half FOLLOWED the buff |
| the fire expires | **16** | the buff is still on; it outlives the fire |

That last row looks wrong and is not: **16 is higher than the 12 you started
with because Stone Skin is still running.** If you want to watch the removal on
its own, cast the Armageddon and nothing else — when the effect expires the
defence must come back to exactly what it was, and any other number is a real
fault.

- **off** — the fire took a fixed number away when it landed, so after Stone Skin
  the stack has *more* than half its defence. The debuff no longer means 50%.
- **on** — the defence reads half of whatever it currently is, Stone Skin
  included. On the turn the fire lands with nothing else moving, the number is
  the same as it was before the fix — that is the point, only the drift is gone.

The reverse case is the ugly one and worth reproducing: let a defence buff
*expire* while the fire effect is still on, and off the fix the stack can lose
everything it had.

### 5. `empowered-armageddon-fix` — the WARLOCK

Not the wizard: **Empowered Spells is the Warlock's class perk**, and a perk
whose class does not match is one the game quietly declines to grant. So the
Armageddon test sits with Payback and the snare, on the Dungeon hero.

He has **Empowered Spells**, so his Armageddon is cast in its empowered form
(double mana, +50% damage). He also carries a **ballista**, and so does the
enemy hero if you fight one.

- **off** — the war machines take nothing, and the tile the spell lands on takes
  no local damage. The empowered version is the weaker spell in every way the
  code decides by id, though its own description promises damage to war
  machines.
- **on** — war machines take damage and the point of impact does too.

Cast the plain Armageddon as well (turn Empowered Spells off in the battle if the
interface lets you, or compare against the enemy hero's): the plain one was
always right, and it must stay exactly as it was.

### 5a. `mass-spell-element-fix` — the same warlock, the same casts

His army also holds **twenty Fire Elementals**, immune to fire, and an Armageddon
hits its own side — so this reads off the casts already being made.

The routine behind a whole-field spell applies the damage through one of four
functions: air, fire and water, which are what a Master of Storms, of Fire or of
Ice acts on, and a fourth belonging to no element. It picks by asking whether the
spell is Armageddon — which answers "is it elemental" and "which element" at
once, and gets away with it because Armageddon is the only spell there whose
damage is elemental. The game has a second: the empowered version.

- **off** — the **empowered** Armageddon burns his own Fire Elementals. Their
  immunity has nothing to answer, because the damage carries no element.
- **on** — they take nothing from it, exactly as they already take nothing from
  the plain Armageddon he also carries.

The plain one is the control and should behave the same in both runs.

**And a spell of the editor's own rides on this flag.** A mass spell a mod adds
takes its element from its own record only while this is on; with it off it lands
with no element, the way everything but Armageddon does in the shipped game. An
area or single-target spell is not affected — that routine reads the element by
itself.

### 6. `dragon-form-fix` — the runemage

**A rune can only be cast on a creature of the Dwarves** — measured in a battle,
not derived — and that decides the whole test: of the four base dragons the
engine's table names, only the **Fire Dragon** is dwarven, so it is the only one
the fix can be seen on.

Mind the names, because they cross: **«Огненные драконы»** is the BASE
(`CREATURE_FIRE_DRAGON`, the one the bug is about) and **«Лавовые драконы»** is
its UPGRADE (`CREATURE_MAGMA_DRAGON`). «Драконы Арката» is the other upgrade.

His army is therefore four dwarven stacks and the three unreachable dragons:

| stack | off | on |
|---|---|---|
| **Огненные драконы** (base) | rune is offered — **the bug** | refused |
| **Лавовые драконы** (upgrade) | refused | refused |
| **Драконы Арката** (upgrade) | refused | refused |
| **Таны** (no dragon) | works | **still works** |
| Bone / Green / Deep | not castable at all — they are not dwarven | same |

That last row is there so the "dwarves only" claim can be re-checked rather than
remembered: if a rune is offered on a Bone Dragon, this table is wrong.

In a battle, cast the **Rune of the Dragon Form** on each.

He carries the rune itself, not just Runelore: a rune is a spell and is learnt
like one, so the skill alone would leave him with nothing to cast. It costs
1 wood and 1 sulfur per cast rather than mana, out of the resources the game
starts you with.

- **off** — the **Огненные драконы** accept the rune, whose own description says
  *"неприменимо к драконам"*.
- **on** — they are refused, and the **Таны still accept it**. That second half
  matters: the original fix answers "tier ≥ 7" instead, which would refuse the
  rune on any tier-7 creature the shipped game allows it on.

### 7. `book-of-power-fix` — the scholar

The **Book of Power** lies one tile east of him. He has Education at Basic.

1. Note his maximum mana on the hero screen.
2. Pick the book up — knowledge goes up, and so should the mana.
3. Take a level and raise **Education** to Advanced — six **Дольмены знания**
   stand behind him, +1000 experience each, so this needs no fighting. The
   book's bonus goes from +1 to +2 on its own.

- **off** — the knowledge on the hero screen moves and the mana ball does not
  follow. Step 3 is where it is most visible, which is why the original fix is
  called "level up".
- **on** — the maximum mana follows the knowledge, both when the book is picked
  up and when Education changes what it grants. Drop the book again and the mana
  falls back.

### 8. `barbarian-learning-fix` — the barbarian

He carries **Barbarian Learning**, and the **Ментор** stands right behind him —
*"здесь любой герой может полностью сменить все умения и способности,
полученные им прежде"*. That is what makes this test possible: the fix is about
what a hero KEEPS after the skill is taken off, and nothing else on a map takes
a skill off a hero. Three **Дольмены знания** to his west give him the level he
needs first.

1. Note his primary stats.
2. Visit the Mentor and drop Barbarian Learning.

- **off** — the skill is gone and the stats it granted stay.
- **on** — they come back off with it.

### 9. `combat-ai-fix` — the opponent at the east end

Attack him. He has Destructive and Summoning Magic at Expert, mass spells, a
summon, and a stack of **Grand Elves**, which carry Deflect Arrows.

- **off** — he never casts the mass spells or the summon: a spell with no
  creature target ranked below every targeted plan. He does cast Deflect Arrows,
  repeatedly, instead of fighting.
- **on** — the mass spells and the summon appear in what he does, and he stops
  recasting the counterspell.

This is the one to judge over several battles rather than one: it is a change in
what the AI *prefers*, not a rule that either fires or does not.

### 10. Imbue Ballista — the ranger

He has **Imbue Arrow**, **Imbue Ballista** and a ballista — Ballista off War
Machines, Imbue Arrow off Avenger, and Imbue Ballista off War Machines wanting
both of those first, all of it at Expert, so the game grants every one of them.

**Both sides are five hundred Air Elementals**, and that is the instrument.
This is the only hero on the map whose result is read off a LOG rather than seen
in a turn, and a ballista writes one line per shot — but the first two battles
came back with the hero's reading identical every shot, which is what a live
value in a still battle looks like AND what a misread value looks like.
Elementals act at initiative 17 to the hero's 10, so the bar keeps turning
between shots. Five hundred a side is about five rounds. Fight it and let the
ballista shoot; there is nothing to do but attack.

The perk says the shots carry his enchantment and that this costs him **mana** —
*"запас маны последнего будет уменьшаться"* — and nothing about his turn.

**Watch the hero's own marker on the turn bar**, and watch it in BOTH runs.

- **off** — it slides back when the ballista fires. That is the bug.
- **on** — it stays where it was.

**Do not judge this one from the log alone.** With the fix on, the log of a
fixed game says the turn was never taken — which reads exactly like "there is no
bug here", and on this fix it very nearly ended in the switch being deleted. The
off run is the only half that can see the bug at all.

The lines, when they come, are in the battle console and in
the newest `bin/homm5-editor-*.log`, in thousandths (`3600` is `3.6`):

- `the cast moved the hero's turn to …` / `put back where it was, …` — a shot
  where the fix did something;
- `the cast cost the hero no turn, still …` — a shot where there was nothing to
  put back. Both are budgeted separately, so a run of quiet shots cannot use up
  the room the interesting ones need.

---

## 11. Волна смерти — a spell of OURS, on four heroes

Not a fix, and the only thing on this map that is not: an experiment riding
along, because it wants exactly what this map already is — several heroes, one
click each, one battle to watch.

**What is being asked.** Whether a spell the executable was never compiled
against does what it says. The spell is `SPELL_H3_DEATH_RIPPLE`, id 353, the
first past the shipped 353; the mod declares it and `H5_Game_H5E.exe` counts 354.
It should now **damage every living stack on the field and pass over the undead,
the elementals and the machines** — the damage taken from the engine's own
routine, so magic resistance, anti-magic and immunity all still apply to it.

Beside it, `SPELL_H3_TEST_ARMAGEDDON` (id 354, on the wizard) is the control: the
same machinery with NO filter row, so it should hit everything, undead included.
Two spells in one battle say whether the filter is the thing doing the sparing.

**And the same Armageddon twice more, differing in two booleans.** The engine has
three damage shapes and one branch each, and what picks between them is
`IsAimed` and `IsAreaAttack` — flags the document already carries. So the wizard
also holds `…_AREA` (355) and `…_TARGET` (356): identical to 354 in school,
level, mana, damage, element, icon and visuals, and different only in those two.
If the first covers the field, the second a patch where it is pointed, and the
third the one stack under it, the flags are the choice.

**And a fifth, «Волна смерти по цели» (357), for the gate.** The ripple's rule —
the same three kinds passed over — aimed at one stack, so it can be pointed at a
stack it passes over and asked to do nothing. That is what a cast reaching NOBODY
looks like, and nothing else here can be made to show it: the other four cover
the field or a patch of it, where something unspared is always standing. It goes
to the wizard because his foe is undead.

**Who carries it, and why those four.** One variable, four values:

| hero | Dark Magic | what his reading is for |
|---|---|---|
| `knight` | none | the school is not his at all — does the book still show it, and can the button be pressed |
| `wizard` | Basic | |
| `scholar` | Advanced | the three together say whether a spell's numbers are picked by mastery |
| `warlock` | Expert | his already, for Payback |

**What to do.** Start a battle with each — the stack in front of him will do —
open the book, and look before clicking:

1. **Is the page there at all**, with the name «Волна смерти» and the plague
   icon it borrows? A missing icon and a missing spell look the same, which is
   why it borrows one.
2. **Is it greyed out?** It should not be, and now for a reason rather than by
   default: the extension answers the engine's "may this be cast" with whether
   the cast would reach ANYBODY, so a spell that would touch nothing is refused
   and its page greys the way Resurrection's does. The ripple covers the whole
   field, and a field always holds somebody it does not spare, so this one is
   bright in every battle on this map. It is still grey for the engine's own
   reasons (not enough mana, a blocked spell), and those are left alone.
3. **Press it, with something undead on the field.** Expect the living stacks to
   take damage and the undead to take none — and the numbers to grow with the
   caster's Dark Magic across the four heroes. A stack with anti-magic on it, or
   a black dragon, should take nothing: that is the engine's rule, not ours, and
   it applies because the damage comes from the engine.
4. **Then the control**, on the wizard: «Армагеддон (наш)» should hit the undead
   too. If both spare the undead the filter is not what is doing it; if neither
   does, the row did not reach the extension.
5. **Then the two twins**, also on the wizard. «Армагеддон по области» should ask
   where to aim and hit **a cross five tiles wide** — the area's own shape is a
   third switch on the number, and the shape here is the mod's, not the engine's.
   A cross is the point: nothing in the game covers one, so if that is what lands
   on the field it came from the config row. «Армагеддон по цели» should ask for a
   stack and hit that one. If all three cover the whole field, the flags are NOT
   what chooses the shape; if the area one asks where to aim and then hits
   nothing, the tiles did not reach the extension.
6. **«Волна смерти по цели» at the ZOMBIES** — the one reading on this map for a
   cast that would reach nobody. It is the ripple's rule aimed at a single stack,
   so pointed at the undead there is nothing for it to do: it must **refuse, and
   the mana must still be there** afterwards.

   **And «Армагеддон по цели» at the SAME zombies is the control** — same shape,
   same target, and the only difference is that it passes over nobody. It must
   hit. Not one of his own stacks: the engine refuses damage on your own side
   itself (`COMBAT_CANT_CAST_ONLY_FOR_HOSTILE`, measured), so that would prove
   nothing about ours. A refusal in both is a gate saying no to everything of
   ours; a hit in both is the question not being asked at all, and the mana is
   short either way.

**Then send the log.** The newest `bin/homm5-editor-*.log` has a line per cast and, for ours,
a line per stack it was asked about:

```
cast: OURS, spell id 353
damage of ours, spell id 353
   the target is spared, ability 10
damage of ours, spell id 353
   the engine says 47
```

- `what is it worth? spell id 353` is the second dispatch — without it the spell
  is worth nothing and every stack takes zero however well the rest works, which
  is exactly what the first run showed.
- `element the engine sees 2` is what every elemental rule will act on — the
  protections and the three Master perks all go through that one accessor. Zero
  means the record is not being read the way we think.
- `shape: the whole field` / `an area` / `one stack` is what the two flags asked
  for. `shape: NONE` means the record could not be read or that branch was not
  recognised, and the spell will do nothing.
- `it would reach nobody — the refusal stands, and the mana with it` is the gate
  answering for us, and it is the line the sixth step is looking for. Its
  opposites are `would reach somebody` and `nothing here can say whom it would
  reach` — the third is a yes given because the question could not be answered,
  and a cast that hits nothing after THAT line is a different bug from a cast
  that hits nothing after the first.
- `the target is spared` is our filter, before the engine's arithmetic.
- `the engine says 0` is the ENGINE sparing it — immunity, resistance, or a
  school the target is protected from. The two are different answers and are
  named apart on purpose.
- The load banner says `spell filter rows: 3` — the ripple's kinds, the area
  one's tiles, and the aimed ripple's kinds. Fewer means a row never reached the extension, and everything
  below it is meaningless.
- `area: no tiles said for spell id 355` means the row is missing: the spell will
  ask where to aim and then cover nothing.

---

## While you are in there

The quality-of-life flags are not on this list and are not turned on by 002, but
any of these battles is where they would be judged: the health bar and the
Shift-held losses on a stack plate, and Ctrl/Shift/Alt on an army slot for the
quick split. `docs/QOL.md` says what each promises.
