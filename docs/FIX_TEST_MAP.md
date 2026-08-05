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

## Who is standing where

Eight heroes in a row along the south of the map, each two tiles in front of the
stack he is meant to fight. Red is yours; the one at the east end is the
computer's.

| hero | race | what he is for |
|---|---|---|
| `wizard` | Academy | Master of Fire |
| `knight` | Haven | Encourage |
| `warlock` | Dungeon | Payback, the snare crash, Empowered Armageddon |
| `runemage` | Fortress | Dragon Form |
| `ranger` | Sylvan | Imbue Ballista — the bug, not a fix |
| `barbarian` | Stronghold | Barbarian Learning |
| `scholar` | Haven | the Book of Power |
| `opponent` | Sylvan, PLAYER_2 | the battle AI — and the trappers, in hotseat |

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

### 6. `dragon-form-fix` — the runemage

His army is a **Bone, Green, Deep and Fire Dragon** — the four the engine's own
table names, all of them base creatures — and an **Archangel**. In a battle, cast
the **Rune of the Dragon Form** on each.

- **off** — every one of the four dragons accepts the rune. Its own description
  says *"неприменимо к драконам"*.
- **on** — all four are refused, and the **Archangel still accepts it**. That
  second half matters: the original fix answers "tier ≥ 7" and would refuse a
  rune the shipped game allows.

### 7. `book-of-power-fix` — the scholar

The **Book of Power** lies one tile east of him. He has Education at Basic.

1. Note his maximum mana on the hero screen.
2. Pick the book up — knowledge goes up, and so should the mana.
3. Fight something, take a level, and raise **Education** to Advanced. The book's
   bonus goes from +1 to +2 on its own.

- **off** — the knowledge on the hero screen moves and the mana ball does not
  follow. Step 3 is where it is most visible, which is why the original fix is
  called "level up".
- **on** — the maximum mana follows the knowledge, both when the book is picked
  up and when Education changes what it grants. Drop the book again and the mana
  falls back.

### 8. `barbarian-learning-fix` — the barbarian

He carries **Barbarian Learning**. Note his primary stats, then have the skill
removed — a Memory Mentor, or anything else that makes a hero forget a skill.

- **off** — the skill is gone and the stats it granted stay.
- **on** — they come back off with it.

**This one has no in-game trigger on the map yet.** Nothing on it removes a
skill, so unless you have a save or a mentor to hand, this is the one entry on
the list that cannot be walked through — noted here rather than left to be
discovered in front of the game.

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

### 10. Imbue Ballista — the ranger, **not fixed**

He has **Imbue Arrow**, **Imbue Ballista** and a ballista. Fight something and
let the ballista shoot.

The perk says the shots carry his enchantment and that this costs him **mana** —
*"запас маны последнего будет уменьшаться"* — and nothing about his turn. Watch
the hero's own place on the turn bar when the ballista fires.

Nothing changes between the two runs: this fix is **not ported**, because the
original recovers the hero from an intermediate object by arithmetic on negative
offsets that transfers to no other build. What is missing is one fact — where
that object keeps its ATB — and the leads are written down in
[engineInternals/RULES_FIXES.md](engineInternals/RULES_FIXES.md). If you can see
the hero's turn being eaten, that is the confirmation the claim needs.

---

## While you are in there

The quality-of-life flags are not on this list and are not turned on by 002, but
any of these battles is where they would be judged: the health bar and the
Shift-held losses on a stack plate, and Ctrl/Shift/Alt on an army slot for the
quick split. `docs/QOL.md` says what each promises.
