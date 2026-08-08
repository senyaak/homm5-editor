// A spell of ours, cast on the adventure map.
//
// A piece of the ONE translation unit — native/homm5-editor.c includes every
// piece in order, so everything included before this file is visible here and
// nothing after it is. Statics stay statics; nothing here is a module.
//
// It sits after `lua/hero-specialization.c` because it needs the same thing
// that file already knows how to fetch: the adventure map itself.

// ---------------------------------------------------------------------------
// THE GATE, and the one line of it that greys a page out.
//
// The battle has its own gate (native/combat/spell-cast.c). The map's is
// `CanCastHere` at 0xc614c0, and it is asked from BOTH places that matter: the
// cast command runs it and gives up silently on a no —
//
//   call 0xc614c0 ; test al,al ; je <end> ; call 0xc619a0   (the cast itself)
//
// — and the interface asks the same routine to decide whether a page is drawn
// live or greyed. So a page that cannot be pressed and a click that does
// nothing are ONE answer, not two.
//
// What it answers with is a switch on the spell's number:
//
//   cmp eax,0EAh   ; 234
//   jg  <the small table>       -> sub eax,15Ch ; cmp eax,3 ; ja <no>
//   sub eax,31h    ; 49, the first adventure spell
//   cmp eax,9Fh    ; ...through 208
//   ja  <no>
//
// Two ranges and nothing else: 49…208 for the shipped adventure spells, and
// 348…351 — `SPELL_ABILITY_CUSTOM1…4`. That second `cmp eax,3` IS the four-slot
// ceiling those custom abilities are known for; it is two instructions, and no
// data moves it. Everything else, ours included, falls out at `xor al,al`.
//
// So the refusal is not about our spell's document — it is about the executable
// never having been compiled against the number. Same finding as the battle's
// gate, one branch of the engine over. Ours answers for itself; the game's own
// spells keep whatever the switch said, distance, mana and all.

#define ADV_GATE_RVA 0x8614c0u
#define ADV_GATE_HEAD_LEN 6
static const BYTE ADV_GATE_HEAD[ADV_GATE_HEAD_LEN] = {
  0x83, 0xEC, 0x14, 0x53, 0x55, 0x56
};
/** The number lives at `+4` of the first stacked argument. */
#define ADV_GATE_SPELL 0x04u

typedef int(__fastcall *AdvGateFn)(void *ecx, void *edx, void *what, void *where);
static AdvGateFn g_advGate = NULL;
/** The gate names what it is handed once — the hero is somewhere in there. */
static int g_gateNamed = 0;

/**
 * WHOSE SPELL THIS IS. The gate and the cast are both handed him in `edx`.
 *
 * The rule a script writes is about a hero — his army, his gold — and for a
 * while it was written about "any hero of the player", which lights one hero's
 * page for another hero's archers. The way out looked like finding the name on
 * the object, and a probe that printed every readable string in his first 0x200
 * bytes found none.
 *
 * IT WAS THE WRONG DIRECTION, and Senya said so: the script ALREADY has the
 * names, out of `GetPlayerHeroes`. Nothing needs to be read off the hero — the
 * script offers a name and we say whether it is this one. Which we can do,
 * because the map turns a name into an object and we have the object.
 */
static void *g_castingHero = NULL;

/** Whatever inside an object reads as a C string — a name is not an object. */
static void log_strings_in(void *obj, DWORD bytes, const char *what) {
  for (DWORD at = 0; at + 4 <= bytes; at += 4) {
    BYTE *field = (BYTE *)obj + at;
    if (readable_bytes(field, 4) < 4) return;
    const char *text = *(const char **)field;
    if (readable_bytes(text, 4) < 4) continue;
    int n = 0;
    while (n < 40 && text[n] >= 0x20 && text[n] < 0x7f) n++;
    if (n < 3 || text[n] != 0) continue;
    log_num(what, (int)at);
    log_text("   reads ", text);
  }
}

/** The number a gate or a cast was handed, or -1 when it cannot be read. */
static int cast_spell_of(void *what) {
  return readable_bytes(what, ADV_GATE_SPELL + 4) >= ADV_GATE_SPELL + 4
      ? *(int *)((BYTE *)what + ADV_GATE_SPELL) : -1;
}

static void start_the_watcher(int spell);
static void *hero_proper_of(void *advMapHero);

/**
 * The last thing the map's rule said about each spell of ours.
 *
 * PER SPELL, because a mod carries more than one and the gate is asked about
 * one at a time. A single remembered verdict answered whichever question came
 * last, so a second spell of a mod would have silently decided the first one's
 * page — the kind of fault that only shows up in somebody else's mod.
 */
#define VERDICTS 16
static int g_verdictSpell[VERDICTS];
static int g_verdictValue[VERDICTS];
static int g_verdicts = 0;

static void remember_verdict(int spell, int value) {
  for (int i = 0; i < g_verdicts; i++) {
    if (g_verdictSpell[i] != spell) continue;
    g_verdictValue[i] = value;
    return;
  }
  if (g_verdicts >= VERDICTS) {
    log_num("more spells of ours than there is room to remember: ", spell);
    return;
  }
  g_verdictSpell[g_verdicts] = spell;
  g_verdictValue[g_verdicts] = value;
  g_verdicts++;
}

/** The verdict for one spell, or `fallback` if the rule has not spoken yet. */
static int verdict_of(int spell, int fallback) {
  for (int i = 0; i < g_verdicts; i++) {
    if (g_verdictSpell[i] == spell) return g_verdictValue[i];
  }
  return fallback;
}

/** `CAdvMapHero`'s own hero — the slot its own gate calls before asking it
 *  anything. Not the same 0x14 as the map's find-by-name; another class. */
#define VT_HERO_OF_ADVMAP 0x14u
#define HERO_PROPER ".?AVCHero@NWorld@@"

/**
 * `CHero`'s own "may he cast this at all" — knowledge, mana, and whatever else
 * the engine counts, asked with the cast the gate was handed.
 *
 * THE PREAMBLE OF `CanCastHere` ASKS IT BEFORE ITS SWITCH, of every spell, and
 * that is the half of the engine's answer we were throwing away: our detour
 * runs the original, gets a 0, and cannot tell "refused because the id is not
 * one I was compiled with" from "refused because he has no mana". So we ask it
 * ourselves, the way the shipped adventure spells have it asked for them.
 */
#define VT_MAY_CAST 0x154u

typedef void *(__fastcall *HeroOfFn)(void *advMapHero, void *edx);
typedef int(__fastcall *MayCastFn)(void *hero, void *edx, void *what);

static void *__fastcall on_adv_gate(void *ecx, void *edx, void *what, void *where) {
  int spell = cast_spell_of(what);
  int answer = ((int)(INT_PTR)g_advGate(ecx, edx, what, where)) & 0xFF;
  // EVERY SPELL THE BOOK ASKS ABOUT, with the engine's own verdict. Ours is the
  // only one we answer for, but the shipped ones are the control: how often the
  // book asks at all, and whether the engine's own answer for, say, Town Portal
  // follows a hero's mana while the book is open or only after something is
  // clicked. A page of ours going stale is only OUR bug if theirs does not.
  log_num("gate: spell ", spell);
  log_num("      the engine says ", answer);
  if (spell < FIRST_SPELL_OF_OURS || answer) return (void *)(INT_PTR)answer;
  log_line("GATE >>> asked about a spell of ours");
  if (readable(edx, 4)) {
    // EVERY ASK, not once: whether this changes between draws is the whole
    // question when a rule about "the hero casting" recognises nobody.
    g_castingHero = edx;
    // BOTH, every ask: the map object the engine hands us and the hero proper
    // inside it. The second is the one a name can be compared with — the first
    // never could be, and printing it alone made every "not him" line in the log
    // an invitation to wonder why two unrelated numbers were not equal.
    log_num("gate: the casting CAdvMapHero is at ", (int)(INT_PTR)edx);
    log_num("      and his CHero at ", (int)(INT_PTR)hero_proper_of(edx));
  } else {
    log_line("gate: the hero casting this is not where the engine's arguments say");
  }
  // WHO IS ASKING, once. The rules a script writes are about a hero — whose
  // army, whose gold — and today it is handed a number and nothing else. The
  // gate is asked while the book is drawn, so this is where that hero is.
  if (!g_gateNamed) {
    g_gateNamed = 1;
    const char *of;
    of = class_name_of(ecx);   log_text("gate: ecx is   ", of ? of : "(no rtti)");
    of = class_name_of(edx);   log_text("gate: edx is   ", of ? of : "(no rtti)");
    of = class_name_of(what);  log_text("gate: what is  ", of ? of : "(no rtti)");
    of = class_name_of(where); log_text("gate: where is ", of ? of : "(no rtti)");
    // THE HERO'S NAME is what a script deals in, and the dump of pointers is
    // blind to it: a name is characters, not an object with a vtable. So every
    // word of him that points at something readable and printable is printed as
    // text — one run, and the offset is either in it or it is not there.
    log_strings_in(edx, 0x200u, "gate: the hero at ");
  }
  // THE ENGINE'S HALF FIRST, then the mod's. A spell of ours falls out of the
  // switch before anything about the hero is weighed, so the mana and the
  // knowledge have to be asked for separately — and a rule in a script has no
  // business re-deciding them.
  void *hero = hero_proper_of(edx);
  if (hero) {
    void *may = vtable_entry(hero, VT_MAY_CAST);
    if (may) {
      int allowed = ((MayCastFn)may)(hero, NULL, what) & 0xFF;
      log_num("gate: the engine says he may cast it: ", allowed);
      if (!allowed) return (void *)(INT_PTR)0;
    } else {
      log_line("gate: the hero has no may-cast where we measured one");
    }
  }
  // AND THE MOD'S HALF, WHICH CANNOT BE ASKED HERE.
  //
  // Source handed to the map does not run when it is handed over: `DoString`
  // builds a "Buffer thread" and leaves it for the scheduler (0xa33942). It was
  // measured rather than argued about in the end — a bracket either side of the
  // call, one thread in the whole log, a counter with no gaps: three questions
  // answered, nothing between the brackets, and the three rules running
  // afterwards in a row.
  //
  // So the rule is not asked at the moment of drawing. It KEEPS ITSELF CURRENT:
  // a thread in the map's script recomputes the verdict and hands it to
  // `H5EAnswer`, and this gate reads the last thing it said. Which is per tick,
  // and Senya objected to per tick when we still believed this gate could ask
  // and be answered — that belief is what has just been disproved.
  start_the_watcher(spell);
  int verdict = verdict_of(spell, 1);
  log_num("GATE <<< answering ", verdict);
  return (void *)(INT_PTR)verdict;
}

// ---------------------------------------------------------------------------
// AND WHAT THE CLICK DOES, which is where a spell of ours becomes ours.
//
// Past the gate the map runs `0xc619a0` — same two arguments, `ret 8`. It asks
// the gate again itself and then switches on the number a second time, so an id
// the executable never heard of gets through the door and then does nothing.
//
// This is the seam. For a number of OURS the engine's body is not run at all:
// every branch in it is written against a spell it was compiled with, and what
// it would do with one it does not know is undefined rather than nothing.
// Instead the map's own Lua is asked, by name, the way a trigger is:
//
//     onSpellCast(<the number>)
//
// A map with no such function is left alone — the line tests for it first.
//
// WHERE THE LUA RUNS, and this is what the first attempt got wrong. The battle
// half of the extension runs source through `0xa44cf0`, and the obvious move
// was to remember whatever host passed through it. Nothing ever did: THE MAP
// DOES NOT USE IT. The map keeps its script system in a field of its own —
// `world+0x40` — and runs source through that object's FIRST virtual slot,
// which is how `scripts/advmap-startup.lua` and `createAdvmapAliases();`
// themselves are run (0x6d7ac8 and 0x6d7b0c). So the map is asked the way the
// map asks itself.

#define ADV_CAST_RVA 0x8619a0u
#define ADV_CAST_HEAD_LEN 6
static const BYTE ADV_CAST_HEAD[ADV_CAST_HEAD_LEN] = {
  0x83, 0xEC, 0x6C, 0x53, 0x55, 0x56
};

/** The map's script system, and the slot that takes a line of source. */
#define WORLD_SCRIPTS 0x40u
#define SCRIPTS_RUN_SOURCE 0x00u

typedef void *(__fastcall *AdvCastFn)(void *ecx, void *edx, void *what, void *where);
/** `DoString`, by its own name in the string it passes on. It answers whether
 *  the source ran — `setg al` on what the interpreter gave back. */
typedef int(__fastcall *RunOnMapFn)(void *scripts, void *edx, const char *source);
static AdvCastFn g_advCast = NULL;
/** Said once: which object it is that runs our lines. */
static int g_scriptsNamed = 0;
/** The objects a cast is handed are named once, for the hero that is in them. */
static int g_castNamed = 0;

static int say_to_the_map(const char *line) {
  // NOT `adventure_map(NULL)`: that lookup wants the Lua context a script was
  // called with, and a detour on a cast has none — handing it NULL faulted
  // inside the lookup at 0xa455f1. The map a script of ours already fetched
  // is the same map, and by the time a spell can be cast the specializations
  // have long since asked for it.
  void *map = map_without_context();
  if (!map || !readable((BYTE *)map + WORLD_SCRIPTS, 4)) return 0;
  void *scripts = *(void **)((BYTE *)map + WORLD_SCRIPTS);
  void *fn = vtable_entry(scripts, SCRIPTS_RUN_SOURCE);
  if (!fn) return 0;
  if (!g_scriptsNamed) {
    g_scriptsNamed = 1;
    const char *of = class_name_of(scripts);
    log_text("the map's scripts are ", of ? of : "(no rtti)");
  }
  // BRACKETED, because two readings of the same log disagreed about it and
  // arguing was getting nowhere. Slot 0 of this class's first vtable is
  // `DoString` and runs the source there and then; the log looked as though
  // three questions were answered before any of the three rules ran. Whichever
  // is true, it shows here: anything the rule prints lands between these two
  // lines, or it does not.
  log_line("   >>> the rule runs now");
  int ran = ((RunOnMapFn)fn)(scripts, NULL, line) & 0xFF;
  log_num("   <<< it has run, and the interpreter says ", ran);
  return 1;
}

static void *__fastcall on_adv_cast(void *ecx, void *edx, void *what, void *where) {
  int spell = cast_spell_of(what);
  if (spell < FIRST_SPELL_OF_OURS) return g_advCast(ecx, edx, what, where);

  log_num("adventure cast: OURS, spell ", spell);
  if (readable(edx, 4)) g_castingHero = edx;
  else log_line("the hero casting this is not where the engine's arguments say");
  // WHO IS CASTING is the next thing the script will need, and the run that
  // proves the cast works can answer it for free: every object the engine hands
  // us, named. Once — the click is not a place to write four lines every time.
  if (!g_castNamed) {
    g_castNamed = 1;
    const char *of;
    of = class_name_of(ecx);   log_text("   ecx is   ", of ? of : "(no rtti)");
    of = class_name_of(edx);   log_text("   edx is   ", of ? of : "(no rtti)");
    of = class_name_of(what);  log_text("   what is  ", of ? of : "(no rtti)");
    of = class_name_of(where); log_text("   where is ", of ? of : "(no rtti)");
  }
  char line[120];
  int at = 0;
  const char *head = "if onSpellCast ~= nil then onSpellCast(";
  while (*head) line[at++] = *head++;
  int n = 0;
  num_to_dec(spell, line + at, &n);
  at += n;
  const char *tail = "); end;";
  while (*tail) line[at++] = *tail++;
  line[at] = 0;
  if (!say_to_the_map(line)) log_line("   but the map has no script system to say it to");
  else log_text("   said to the map: ", line);
  return (void *)1;
}


// ---------------------------------------------------------------------------
// ASKING THE MAP WHETHER IT MAY BE CAST, and hearing the answer back.
//
// The gate above answers "yes" for any number of ours, which is right for
// "the executable never heard of it" and wrong for everything a feature needs
// to say: nobody to train, no gold, no room. Those are the mod's rules, not the
// engine's, so they belong in the map's Lua —
//
//     checkSpellCastable(<the number>)   -> true / false
//
// HOW AN ANSWER COMES BACK. Running a line is one-way: the engine's runner
// hands back nothing a caller can read. So the line calls a function of OURS
// with the result —
//
//     if checkSpellCastable ~= nil then H5EAnswer(checkSpellCastable(353)); end;
//
// — and `H5EAnswer` is an ordinary registered function that writes the number
// down where the detour can pick it up. No globals to look up, no symbols: the
// two halves already work and this is just the two of them facing each other.
//
// A map that defines no `checkSpellCastable` never calls `H5EAnswer`, the
// answer stays unset, and the gate falls back to yes — a mod without rules is
// not a mod that may not cast.
//
// BUT A RULE THAT DIES IS NOT A RULE THAT SAID YES. A script error takes the
// whole line with it, so a `checkSpellCastable` that asks the engine one wrong
// question answers nothing — and "nothing" used to be that same yes, which is
// how a hero with nothing to train kept a live page. So the line answers NO
// first and only replaces it on success:
//
//     if F == nil then H5EAnswer(1) else H5EAnswer(0); if F(353) then H5EAnswer(1) end; end;
//
// The last answer wins, the absent-rule default survives, and a rule that
// falls over closes its own page instead of leaving it open.

static int g_askLogged = 0;

/**
 * `H5ELog(value)` — a number from a script, into the extension's log.
 *
 * `print` goes to the game's console, which is where a player looks and not
 * where the answer to "what does this engine function actually return" gets
 * read afterwards. This puts it in the same file as everything else, so a
 * script can measure the game and the measurement survives the session.
 */
static void *__fastcall lua_log(void *ctx) {
  int value = 0;
  if (lua_arg_int(ctx, 1, &value)) log_num("script says ", value);
  else log_line("script says something that is not a number");
  return NULL;
}

/** `H5EAnswer(value)` — what a question of ours was answered with. Anything
 *  that is not zero counts as yes, so `true` and `1` both work in the script. */
static void *__fastcall lua_answer(void *ctx) {
  int spell = 0, value = 0;
  if (!lua_arg_int(ctx, 1, &spell) || !lua_arg_int(ctx, 2, &value)) {
    log_line("H5EAnswer: wants the spell's number and then the verdict");
    return NULL;
  }
  remember_verdict(spell, value != 0);
  log_num("the map answers about spell ", spell);
  log_num("                        with ", value != 0);
  return NULL;
}

/**
 * `H5EIsCastingHero(heroName)` — 1 when that name is the hero whose spell this
 * is, nil otherwise (and nil when we cannot tell, which the script must read as
 * "not him" and not as "probably him").
 *
 * TWO CLASSES, ONE HERO. The gate is handed a `CAdvMapHero`; the map's lookup
 * answers with a `CHero`, which is what every hero function of theirs works on.
 * Comparing those pointers would fail even for the same hero, so both are taken
 * back to the start of the whole object first — the offset RTTI keeps beside
 * every vtable, the same trick that found the screen 0x844 bytes in.
 */
/** EVERY WAY OUT SAYS SO, EVERY TIME. The first version of this answered nil
 *  from six different places and logged from none of them, so a run that never
 *  matched said nothing at all about which of the six it was — and reasoning
 *  about it from the outside ruled out five that all looked equally impossible.
 *  The second version logged twelve of them and then went quiet, which is the
 *  same failure with a delay: a log that stops is a log that lies about what
 *  happened after it stopped. */
static const char *g_lastWhy = NULL;

static void *no_caster(const char *why, void *name) {
  // ON CHANGE ONLY, for the same reason the army count is: the rule asks this of
  // every hero every tick now, and the same refusal repeated is not news. The
  // pointer is compared rather than the text — these are all literals.
  if (why != g_lastWhy) {
    g_lastWhy = why;
    log_text("H5EIsCastingHero: ", why);
    if (name) log_hero_name("                  asked about ", name);
  }
  return NULL;
}

/**
 * The `CHero` inside the `CAdvMapHero` the engine hands a cast.
 *
 * TYPED, not pattern-matched, and the difference cost a run. The first version
 * searched the caster for a pointer EQUAL TO the hero just looked up and took
 * the first hit: it answered "+344" for one hero and "+936" for another, and one
 * field cannot be at two offsets. A hero object holds pointers to plenty of
 * heroes, so "somewhere in here is a pointer to the one I am asking about" is a
 * coincidence waiting to happen — and a wrong yes here trains the wrong army.
 *
 * THE ENGINE HAS AN ACCESSOR AND IT IS ASKED, which is where this should have
 * started. `CanCastHere`'s very first move on the hero it is handed is
 * `mov eax,[ebx]; mov ecx,ebx; call [eax+14h]`, and everything it asks
 * afterwards — `[+0x218]`, `[+0x154]` — it asks of what came back. That is the
 * hero proper, named by the engine itself.
 *
 * THREE GUESSES CAME FIRST AND EACH COST A LAUNCH: a pointer equal to the hero
 * being asked about (it matched a neighbour, and trained the wrong army), a
 * pointer of the right type (there is none in the object at all), and before
 * either of them, reading a name off the object (there is no name in it). The
 * dump that settled it showed a `CAdvMapHero` holding no RTTI-bearing pointer
 * in its first 0x1000 bytes — these objects do not reference each other by
 * address, so no amount of searching memory was ever going to find the link.
 *
 * Read the code. It was eight instructions into the function we already hook.
 */

/** The caster, dumped whole, if ever the accessor above stops working. */
static int g_casterDumped = 0;

/**
 * EVERY WORD OF AN OBJECT, with everything we can say about it.
 *
 * Not a filtered view. Two runs went on testing one guess apiece about how a
 * `CAdvMapHero` and a `CHero` are joined, and each guess cost a launch to learn
 * that it was wrong; a filtered dump would have cost a third. So: the value, the
 * class of whatever it points at, any text it points at, and whether the word
 * itself begins a base class living inside — a base is not a pointer field, and
 * a scan for outgoing pointers is blind to exactly that.
 */
#define DUMP_BYTES 0x1000u

static void log_everything(void *obj) {
  const char *of = class_name_of(obj);
  log_text("    it is ", of ? of : "(no rtti)");
  for (DWORD at = 0; at + 4 <= DUMP_BYTES; at += 4) {
    BYTE *field = (BYTE *)obj + at;
    if (!readable(field, 4)) {
      log_num("    (unreadable from +", (int)at);
      return;
    }
    void *value = *(void **)field;
    log_num("    +", (int)at);
    log_num("       = ", (int)(INT_PTR)value);
    const char *points = class_name_of(value);
    if (points) log_text("       points at ", points);
    const char *inside = class_name_of(field);
    if (inside && at) log_text("       IS a ", inside);
    if (readable(value, 2)) {
      const char *text = (const char *)value;
      int n = 0;
      while (n < 40 && text[n] >= 0x20 && text[n] < 0x7f) n++;
      if (n >= 3 && text[n] == 0) log_text("       reads ", text);
    }
  }
}

static int names_match(const char *a, const char *b) {
  while (*a && *a == *b) { a++; b++; }
  return *a == *b;
}

static int g_heroOfSaid = 0;

/** When the accessor disappoints, the whole object goes in the log — once. The
 *  three guesses before it each cost a launch to disprove; a dump costs none. */
static void dump_the_caster(void) {
  if (g_casterDumped) return;
  g_casterDumped = 1;
  log_num("=== THE HERO THE ENGINE SAYS IS CASTING, at ", (int)(INT_PTR)g_castingHero);
  log_everything(g_castingHero);
}

static void *hero_proper_of(void *advMapHero) {
  void *heroOf = vtable_entry(advMapHero, VT_HERO_OF_ADVMAP);
  if (!heroOf) {
    log_line("H5EIsCastingHero: the casting hero has no accessor where we measured one");
    dump_the_caster();
    return NULL;
  }
  void *proper = ((HeroOfFn)heroOf)(advMapHero, NULL);
  const char *of = class_name_of(proper);
  // CHECKED, not assumed: a slot number is only ever right for the vtable it was
  // measured against, and this one was measured on the gate's own argument.
  if (!of || !names_match(of, HERO_PROPER)) {
    log_text("H5EIsCastingHero: slot +0x14 gave back ", of ? of : "(no rtti)");
    dump_the_caster();
    return NULL;
  }
  if (!g_heroOfSaid) {
    g_heroOfSaid = 1;
    log_num("H5EIsCastingHero: the casting hero's own CHero is at ", (int)(INT_PTR)proper);
  }
  return proper;
}

/**
 * Is the hero a name was resolved to the one who is casting?
 *
 * TWO `CHero`s COMPARED, and that is the point. Both sides are now the same
 * kind of thing — the caster's, through the engine's own accessor, and the
 * candidate's, through the map's own lookup — so the comparison is an identity
 * and not a resemblance. Every earlier version compared a `CAdvMapHero` with a
 * `CHero`, which is why even the log was unreadable: it printed two addresses
 * that could never have been equal and invited whoever read it to wonder why.
 */
static int same_hero(void *found, void *caster) {
  void *proper = hero_proper_of(caster);
  return proper && proper == found;
}

static void *__fastcall lua_is_casting_hero(void *ctx) {
  void *name = lua_arg_string(ctx, 1);
  if (!name) return no_caster("the argument is not a hero's script name", NULL);
  if (!readable(g_castingHero, 4)) return no_caster("nobody has cast anything yet", name);
  void *map = adventure_map(ctx);
  if (!map) return no_caster("no adventure map to ask", name);
  void *find = vtable_entry(map, VT_FIND_BY_NAME);
  if (!find) return no_caster("the map has no lookup where we measured one", name);
  void *hero = ((FindByNameFn)find)(map, NULL, name);
  if (!hero) return no_caster("no hero of that name", name);
  if (!pointer_alive(hero)) return no_caster("that hero is not alive", name);
  // EVERYTHING ABOUT BOTH OF THEM, ONCE. Two runs have now gone on adding one
  // more guess about how a `CAdvMapHero` and a `CHero` are joined — a pointer
  // equal to the other one, then a pointer of the right type — and each guess
  // cost a launch to learn that it was wrong. The whole neighbourhood costs the
  // same launch: every object either of them points at, every base class inside
  // either of them, and the engine's own name for each.
  static void *lastCaster = NULL;
  if (!same_hero(hero, g_castingHero)) return NULL;
  // Only when the CASTER changes — the four heroes are walked every tick, and
  // three of them are not him every time.
  if (g_castingHero != lastCaster) {
    lastCaster = g_castingHero;
    log_hero_name("H5EIsCastingHero: the spell is being cast by ", name);
  }
  return (void *)(INT_PTR)lua_push_int(ctx, 1);
}

/** `H5ECasterKnown()` — 1 when we hold the hero whose spell this is.
 *
 *  Which is what lets a script tell "I could not find him among the player's
 *  heroes" from "nobody is casting": the first means the rule must refuse, and
 *  falling back to any hero at all is how one hero's page came to be lit by
 *  another hero's archers — and then to train them. */
static void *__fastcall lua_caster_known(void *ctx) {
  return readable(g_castingHero, 4) ? (void *)(INT_PTR)lua_push_int(ctx, 1) : NULL;
}

/**
 * Set the map's rule going, once.
 *
 * IT CANNOT BE ASKED AND ANSWERED IN ONE BREATH. Every door into the map's Lua
 * makes a THREAD: `DoString` builds one called "Buffer thread" (0xa33942) and
 * leaves it for the scheduler, and so do triggers and `startThread` — the class
 * beside the engine is literally `CLuaThread`. Measured rather than argued over
 * in the end: a bracket either side of the call, one thread writing the whole
 * log, a counter with no gaps — three questions answered, nothing between the
 * brackets, and the three rules running afterwards in a row.
 *
 * So the rule keeps ITSELF current. This hands the map one line, the first time
 * a page of ours is drawn, and that line starts a thread which recomputes the
 * verdict and gives it to `H5EAnswer`. The gate answers from the last thing the
 * rule said.
 *
 * Which is per tick — and Senya said per tick was pointless back when we still
 * believed this gate could ask and be answered. That belief is what the
 * measurement above disproved.
 */
static int g_watcherStarted = 0;

static void start_the_watcher(int spell) {
  (void)spell;   /* the script knows its own spells; this only sets it going */
  if (g_watcherStarted) return;
  // AND THE MAP THAT HAS NOTHING TO SAY SAYS SO. The same test either way: a map
  // with no watcher will never answer, so the gate must stop holding its spells
  // shut waiting for it.
  const char *line = "if H5ECastableWatch ~= nil then startThread(H5ECastableWatch) end;";
  if (!say_to_the_map(line)) return;
  g_watcherStarted = 1;
  log_text("the map will keep its verdicts current: ", line);
}

static void install_adv_cast(void) {
  g_advGate = (AdvGateFn)detour(ADV_GATE_RVA, ADV_GATE_HEAD, ADV_GATE_HEAD_LEN,
                                (void *)&on_adv_gate, "the adventure map's cast gate");
  if (g_advGate) log_line("a spell of ours may be cast on the adventure map");
  g_advCast = (AdvCastFn)detour(ADV_CAST_RVA, ADV_CAST_HEAD, ADV_CAST_HEAD_LEN,
                                (void *)&on_adv_cast, "the adventure map's cast");
  add_map_function("H5EAnswer", (void *)&lua_answer);
  add_map_function("H5ELog", (void *)&lua_log);
  add_map_function("H5EIsCastingHero", (void *)&lua_is_casting_hero);
  add_map_function("H5ECasterKnown", (void *)&lua_caster_known);
  if (g_advCast) log_line("and a cast of ours will ask the map's own script");
}
