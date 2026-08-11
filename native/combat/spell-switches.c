// The switches the executable was compiled against, taught about ids it was not.
//
// A piece of the ONE translation unit — native/homm5-editor.c includes every
// piece in order, so everything included before this file is visible here and
// nothing after it is. Statics stay statics; nothing here is a module.
//
// WHAT BELONGS IN THIS FILE, and it is worth stating because the boundary is the
// whole reason the work is finite. Two layers, and confusing them is expensive:
//
//   PROPERTIES are read from the record and work for any id at all — school,
//   level, mana, the four damage entries by mastery, both flags, the element.
//   Nobody writes code for those. They live in combat/spell-record.c.
//
//   WHAT A SPELL DOES is chosen by switches on the NUMBER, and a number the
//   executable never saw falls off every one of them. Those are here. There are
//   four, they were found one crash and one dead run at a time, and each gets a
//   stub of the same shape: for our ids take the answer the document implies,
//   otherwise run the comparison we displaced and carry on.
//
//     0x77ce8a  what is this spell worth        → the case that reads the record
//     0x77be7f  which tiles does an area cover  → the tiles the mod's row names
//     0x7d0e88  does this spell deal damage     → yes
//
// The fifth — what a cast DOES — is not here: it is combat/spell-resolve.c,
// because a spell of ours resolves itself rather than borrowing a branch.
//
// A number is the right question in exactly one place: "was the executable built
// with this id". Everywhere else the answer must come from the document or the
// mod's row, or a person could never express it in the editor for a spell of
// their own. That rule is Senya's and it has been applied twice against me.

/** Which switch turns this file's logging on — see the bottom of core/log.c. */
#undef LOG_UNIT
#define LOG_UNIT combat_spell_switches

// ---------------------------------------------------------------------------
// AND THE SECOND DISPATCH, WHICH IS WHERE THE FIRST RUN STOPPED.
//
// A cast of ours walked every stack on the field and the filter spared the
// undead — and every living stack took ZERO. The reason is one function earlier
// than the damage: `0xB7CE70` is "what is this spell worth at this power", and
// it is a switch on the number too:
//
//   edi = normalise(spellId)
//   cmp edi,117h  /  je 0xB7CED1                    ; the ones that hurt
//   lea eax,[edi-1] / cmp eax,0EEh / ja 0xB7CEBD    ; out of range
//   jmp [table]                                     ; 21 in, 218 out
//   …
//   0xB7CEBD:  xor esi,esi                          ; a spell I do not know
//   0xB7CED1:  ecx = the id ; push the power ; call 0xAD4EC0   ; READ THE RECORD
//
// Twenty-one spells reach `0xB7CED1` — the nine destructive ones, Armageddon,
// Plague, both Words, the mines, the wasps and a handful of creature abilities.
// Everything else gets a hard zero, and that is the entire reason a spell of
// ours did nothing even once the field was walked: it had no damage to do.
//
// So for our ids the comparison sends the function to the case that READS THE
// DOCUMENT. `0xAD4EC0` is generic — it is handed the id, the mastery and the
// spell power and reads `<damage>` out of the loaded document, four entries by
// mastery — so from there on the numbers are the ones the editor wrote.
//
// AND THIS IS THE ONE PLACE LEFT WHERE WE ENTER A FUNCTION PART-WAY, so it is
// written down with what it costs (see combat/spell-resolve.c for the rule).
// `0xB7CED1` is not a spell's branch — it is this switch's document-reading
// default, shared by twenty-one ids, and none of its instructions belongs to
// Armageddon or to either Word. The alternative is to write our own epilogue for
// somebody else's function, which buys nothing and can be wrong. What it costs:
// if a future build moves that case, every spell of ours is worth zero — which
// the byte check turns into a refusal and a line in the log, not a crash.
//
// Safe to arrive by a jump: nothing between the comparison and that case pushes,
// so the frame `mov edx,[esp+14h]` reads is the frame it expects.

/** `cmp edi,117h` — edi IS the spell id, and the switch is about to use it. */
#define DAMAGE_LOOKUP_RVA 0x77ce8au
#define DAMAGE_LOOKUP_LEN 6
static const BYTE DAMAGE_LOOKUP_HEAD[DAMAGE_LOOKUP_LEN] = {
  0x81, 0xFF, 0x17, 0x01, 0x00, 0x00
};

/** `mov edx,[esp+14h]` / `mov ecx,edi` — the branch that reads the record. */
#define DAMAGE_FROM_RECORD_RVA 0x77ced1u
#define DAMAGE_FROM_RECORD_MARK_LEN 6
static const BYTE DAMAGE_FROM_RECORD_MARK[DAMAGE_FROM_RECORD_MARK_LEN] = {
  0x8B, 0x54, 0x24, 0x14, 0x8B, 0xCF
};

/** Says what was asked about, so a zero has somewhere to be blamed. */
static void __cdecl on_spell_power(int spell) {
  if (spell >= FIRST_SPELL_OF_OURS) log_num("[worth] what is it worth? spell id ", spell);
}

#define POWER_STUB_LEN 37
static BYTE POWER_STUB[POWER_STUB_LEN] = {
  0x60,                                     // pushad
  0x9C,                                     // pushfd
  0x57,                                     // push edi        — the spell id
  0xE8, 0x00, 0x00, 0x00, 0x00,             // call on_spell_power
  0x83, 0xC4, 0x04,                         // add esp,4
  0x9D,                                     // popfd
  0x61,                                     // popad
  0x81, 0xFF, 0x61, 0x01, 0x00, 0x00,       // cmp edi,161h    — 353, the first of ours
  0x72, 0x05,                               // jb +5           — the game's own, carry on
  0xE9, 0x00, 0x00, 0x00, 0x00,             // jmp <read the record>
  0x81, 0xFF, 0x17, 0x01, 0x00, 0x00,       // cmp edi,117h    — displaced
  0xE9, 0x00, 0x00, 0x00, 0x00,             // jmp back
};

static BYTE POWER_TO_STUB[DAMAGE_LOOKUP_LEN] = {
  0xE9, 0x00, 0x00, 0x00, 0x00, 0x90
};

static void install_spell_power(void) {
  BYTE *base = (BYTE *)GetModuleHandleW(NULL);
  BYTE *branch = base + DAMAGE_FROM_RECORD_RVA;
  for (int i = 0; i < DAMAGE_FROM_RECORD_MARK_LEN; i++) {
    if (branch[i] == DAMAGE_FROM_RECORD_MARK[i]) continue;
    log_line("the branch that reads a spell's damage is not where we left it - ours will do nothing");
    return;
  }
  BYTE *stub = (BYTE *)VirtualAlloc(NULL, POWER_STUB_LEN, MEM_COMMIT | MEM_RESERVE,
                                    PAGE_EXECUTE_READWRITE);
  if (!stub) { log_line("spell power: no memory for the stub"); return; }
  for (int i = 0; i < POWER_STUB_LEN; i++) stub[i] = POWER_STUB[i];
  *(DWORD *)(stub + 4) = (DWORD)(void *)on_spell_power - (DWORD)(stub + 8);
  *(DWORD *)(stub + 22) = (DWORD)branch - (DWORD)(stub + 26);
  *(DWORD *)(stub + 33) =
      (DWORD)(base + DAMAGE_LOOKUP_RVA + DAMAGE_LOOKUP_LEN) - (DWORD)(stub + POWER_STUB_LEN);
  FlushInstructionCache(GetCurrentProcess(), stub, POWER_STUB_LEN);

  *(DWORD *)(POWER_TO_STUB + 1) = (DWORD)stub - ((DWORD)(base + DAMAGE_LOOKUP_RVA) + 5);
  if (overwrite_code(DAMAGE_LOOKUP_RVA, DAMAGE_LOOKUP_HEAD, POWER_TO_STUB, DAMAGE_LOOKUP_LEN,
                     "the spell's own damage")) {
    log_line("a spell of ours is worth what its document says");
  }
}

// ---------------------------------------------------------------------------
// AND THE THIRD DISPATCH: WHICH TILES AN AREA COVERS.
//
// Setting `IsAreaAttack` says a spell hits an area. It does not say WHAT area,
// and the document has no field that does — twenty-two fields and not one is a
// radius. The shape is decided by `CCombatSpell::TilesCovered` (0xB7BE30), and
// it is a switch on the number like the other two:
//
//   edi = normalise(spellId)
//   if (!IsAreaAttack(edi) && !isMassSpell(edi)) return {}   ; nothing to cover
//   cmp edi,11Ah / … / jmp [eax*4+0xB7C67C]                  ; the shape
//   …
//   0xB7C59A:  if (!isMassSpell(edi)) return {}              ; the default
//
// Every area spell has a case of its own — Fireball, Frost Ring, Stone Spikes,
// Meteor Shower, the Firewall, the death cloud, the scatter shot — and 221 ids
// share a default that is only for the MASS spells and answers with NOTHING for
// anything else. (`isMassSpell` is 0xAD40C0, and it is exactly the twelve ids
// 210…221 mapped back to the spell they are the mass version of.)
//
// So a spell of ours with the flag set gets into this function and out of it
// with an empty list: it would have asked where to aim and then hit nothing at
// all. The flag is the door, not the shape.
//
// WHAT WE DO INSTEAD OF BORROWING ONE. The engine does not keep a menu of
// shapes: it builds the list by pushing one tile at a time, and each of its
// cases is only a different loop around that one call. So ours is a loop over
// the offsets the mod wrote, and a spell of ours may cover anything.
//
// The offsets are plain (dx, dy) because the combat grid is SQUARE — the
// engine's own "adjacent tiles" table is the eight offsets of a 3×3 block, so a
// fireball is a 3×3 and none of this needs a word about hexes.
//
// ONLY AN AREA SPELL OF OURS GETS HERE. The whole-field and the one-stack shapes
// both have `IsAreaAttack` false and neither is a mass spell, so the early exit
// above turns them away before the switch. That is why this stub asks about the
// number and nothing else.

/** `cmp edi,11Ah` — edi is the spell id, and the shape switch is about to use it. */
#define AREA_SHAPE_RVA 0x77be7fu
#define AREA_SHAPE_LEN 6
static const BYTE AREA_SHAPE_HEAD[AREA_SHAPE_LEN] = {
  0x81, 0xFF, 0x1A, 0x01, 0x00, 0x00
};

/**
 * `vector<Point>::push_back` — how the engine adds ONE tile to the list.
 *
 * Every shape it has is only a different loop around this call: the default is
 * a 4×4 block, a fireball is the point plus the eight around it, a frost ring is
 * those eight without the point. So a shape of ours is our own loop, and no menu
 * of the engine's limits what a spell of ours may cover.
 *
 * A Point is two ints and the container is a plain vector — `sar ecx,3` on the
 * capacity is the whole proof of the element size.
 */
#define ADD_TILE_RVA 0x184970u
#define ADD_TILE_HEAD_LEN 6
static const BYTE ADD_TILE_HEAD[ADD_TILE_HEAD_LEN] = {
  0x83, 0xEC, 0x08, 0x53, 0x55, 0x8B                          // sub esp,8 / push ebx / push ebp
};
typedef void(__thiscall *AddTileFn)(void *tiles, const int *point);
static AddTileFn g_addTile = NULL;

/** `push [esp+14h]` — where the engine goes once the tiles are collected. */
#define TILES_DONE_RVA 0x77c19bu
#define TILES_DONE_MARK_LEN 8
static const BYTE TILES_DONE_MARK[TILES_DONE_MARK_LEN] = {
  0xFF, 0x74, 0x24, 0x14, 0x8B, 0x06, 0x8B, 0xCE
};

/**
 * The tiles a spell of ours covers: its own row, or the engine's own shape.
 *
 * A row with no offsets falls through to nothing here and the stub sends the
 * cast to the tail with an empty list — which is what a spell that says it hits
 * an area and does not say where would do anyway. The mod is expected to say.
 */
/** Set by the C, read by the stub after its `popad` — `al` does not survive that. */
static BYTE g_tilesWereOurs = 0;

/** Non-zero when the mod said which tiles this spell covers, and they were laid. */
static char __cdecl our_tiles(int spell, void *tiles, int x, int y) {
  SpellRow *row = spell_row(spell);
  // ONLY DURING A REAL CAST, and that is the whole reason there is a condition
  // here rather than a bare log: this runs once per tile the pointer crosses
  // while an area spell is armed, which is thousands of times in a battle. A
  // cast is an event — see the note at the head of combat/spell-cast.c.
  //
  // WHY IT SAYS ANYTHING AT ALL. A run on 09.08.2026 had an area cast of ours
  // reach the resolver with `stacks to consider 0` four times, and from the
  // resolver's side "the row's tiles are wrong", "the tiles were never laid" and
  // "the tiles were laid where nobody stands" are the same silence. These four
  // numbers tell the three apart.
  if (g_inCastCommand) {
    log_num("[area] tiles for spell id ", spell);
    log_num("   aimed at x ", x);
    log_num("   aimed at y ", y);
    log_num("   offsets its row names ", row ? row->areaCount : -1);
  }
  if (!row || !row->areaCount || !g_addTile) return 0;
  for (int i = 0; i < row->areaCount; i++) {
    int point[2] = { x + row->areaX[i], y + row->areaY[i] };
    g_addTile(tiles, point);
    if (g_inCastCommand) {
      log_num("   tile x ", point[0]);
      log_num("      and y ", point[1]);
    }
  }
  return 1;
}

/**
 * The stub: our ids collect their own tiles and join the engine at the tail.
 *
 * `edi` is the spell id, `ebx` the list being filled and `[ebp+0Ch]`/`[ebp+10h]`
 * the point aimed at — all three set before the switch, so the arguments are
 * read straight off the frame. Registers and flags go back untouched, because
 * the tail reads `esi` and `ebx` exactly as the shipped cases leave them.
 */
#define AREA_STUB_LEN 50
static BYTE AREA_STUB[AREA_STUB_LEN] = {
  0x60,                                     // pushad
  0x9C,                                     // pushfd
  0xFF, 0x75, 0x10,                         // push dword ptr [ebp+10h]   — y
  0xFF, 0x75, 0x0C,                         // push dword ptr [ebp+0Ch]   — x
  0x53,                                     // push ebx                   — the list
  0x57,                                     // push edi                   — the spell id
  0xE8, 0x00, 0x00, 0x00, 0x00,             // call our_tiles  — 0 if nothing was said
  0x83, 0xC4, 0x10,                         // add esp,16
  0xA2, 0x00, 0x00, 0x00, 0x00,             // mov [g_tilesWereOurs],al
  0x9D,                                     // popfd
  0x61,                                     // popad
  0x80, 0x3D, 0x00, 0x00, 0x00, 0x00, 0x00, // cmp byte ptr [g_tilesWereOurs],0
  0x74, 0x05,                               // je +5           — the game's own shape
  0xE9, 0x00, 0x00, 0x00, 0x00,             // jmp <the tail>
  0x81, 0xFF, 0x1A, 0x01, 0x00, 0x00,       // cmp edi,11Ah    — displaced
  0xE9, 0x00, 0x00, 0x00, 0x00,             // jmp back
};

static BYTE AREA_TO_STUB[AREA_SHAPE_LEN] = {
  0xE9, 0x00, 0x00, 0x00, 0x00, 0x90
};

static void install_area_shape(void) {
  BYTE *base = (BYTE *)GetModuleHandleW(NULL);
  BYTE *tail = engine_code(TILES_DONE_RVA, TILES_DONE_MARK, TILES_DONE_MARK_LEN,
                             "the tail an area spell joins");
  BYTE *add = engine_code(ADD_TILE_RVA, ADD_TILE_HEAD, ADD_TILE_HEAD_LEN,
                            "adding one tile to the list");
  if (!tail || !add) return;
  g_addTile = (AddTileFn)add;

  BYTE *stub = (BYTE *)VirtualAlloc(NULL, AREA_STUB_LEN, MEM_COMMIT | MEM_RESERVE,
                                    PAGE_EXECUTE_READWRITE);
  if (!stub) { log_line("area shape: no memory for the stub"); return; }
  for (int i = 0; i < AREA_STUB_LEN; i++) stub[i] = AREA_STUB[i];
  // No log anywhere here, deliberately: the interface asks this routine for every
  // tile the cursor crosses while an area spell is armed, so a line each would
  // bury the cast it belongs to. What shape a cast used is said once, at the cast.
  *(DWORD *)(stub + 11) = (DWORD)(void *)our_tiles - (DWORD)(stub + 15);
  *(DWORD *)(stub + 19) = (DWORD)(void *)&g_tilesWereOurs;
  *(DWORD *)(stub + 27) = (DWORD)(void *)&g_tilesWereOurs;
  *(DWORD *)(stub + 35) = (DWORD)tail - (DWORD)(stub + 39);
  *(DWORD *)(stub + 46) =
      (DWORD)(base + AREA_SHAPE_RVA + AREA_SHAPE_LEN) - (DWORD)(stub + AREA_STUB_LEN);
  FlushInstructionCache(GetCurrentProcess(), stub, AREA_STUB_LEN);

  *(DWORD *)(AREA_TO_STUB + 1) = (DWORD)stub - ((DWORD)(base + AREA_SHAPE_RVA) + 5);
  if (overwrite_code(AREA_SHAPE_RVA, AREA_SHAPE_HEAD, AREA_TO_STUB, AREA_SHAPE_LEN,
                     "the tiles an area spell covers")) {
    log_line("an area spell of ours covers the tiles its row names");
  }
}

// ---------------------------------------------------------------------------
// AND THE FOURTH: "DOES THIS SPELL DEAL DAMAGE".
//
// The fire Armageddon of ours has ELEMENT_FIRE in its document and the engine's
// own accessor reads it — the element is DATA, and every elemental rule in the
// game goes through that one accessor. And a Master of Fire still left no burn
// on what it hit.
//
// The reason is one gate earlier. The block that applies the three Master perks
// (`0xBD3BD0`) asks `0xBD0E80` before it looks at the element at all, and that
// is a switch on the number like the rest:
//
//   eax = normalise(spellId)
//   cmp eax,117h / jg <second table> / je <yes>
//   dec eax / cmp eax,0F7h / ja <no>
//   jmp [eax*4+0BD0EE0h]                       ; 22 spells say yes
//   …
//   0xBD0ED9:  xor al,al ; ret                 ; everything else says no
//
// Twenty-seven ids answer yes and they are exactly the damaging ones — the nine
// destructive spells, Armageddon, both Words, the mines, the wasps, the
// firewalls, the shields that burn, and five more above the range. Ours is not
// among them, so the perk block turns away before the element is asked and no
// burn is left. NINE places ask this question, so it is not the perk's own: it
// is "is this a spell that hurts", and the perks are one reader.
//
// OURS ANSWER YES, and today that is true by construction: our own resolver
// hurts every stack it picks, whichever of the three shapes the record asks for.
// The day a spell of ours puts an EFFECT on a stack instead of damage, the
// resolver will have to tell the two apart — and this answer moves with it, to
// the same question the row will then be answering.

/** `cmp eax,117h` — eax is the normalised spell id, and the switch follows. */
#define DAMAGING_SPELL_RVA 0x7d0e88u
#define DAMAGING_SPELL_LEN 5
static const BYTE DAMAGING_SPELL_HEAD[DAMAGING_SPELL_LEN] = {
  0x3D, 0x17, 0x01, 0x00, 0x00
};

/** `mov al,1` / `pop esi` / `ret` — the answer "yes", and its own way out. */
#define DAMAGING_YES_RVA 0x7d0ebdu
#define DAMAGING_YES_MARK_LEN 4
static const BYTE DAMAGING_YES_MARK[DAMAGING_YES_MARK_LEN] = {
  0xB0, 0x01, 0x5E, 0xC3
};

// No call and no pushad: eax already holds the id, and the displaced `cmp` sets
// the flags the switch below reads. It logged for a while — that is how the
// Master perks' block was found among the nine readers, at 0xBD3BE4 — and the
// line is gone because nine callers ask this constantly and the answer is now
// written down rather than watched.
#define DAMAGING_STUB_LEN 22
static BYTE DAMAGING_STUB[DAMAGING_STUB_LEN] = {
  0x3D, 0x61, 0x01, 0x00, 0x00,             // cmp eax,161h    — 353, the first of ours
  0x72, 0x05,                               // jb +5           — the game's own, carry on
  0xE9, 0x00, 0x00, 0x00, 0x00,             // jmp <yes>
  0x3D, 0x17, 0x01, 0x00, 0x00,             // cmp eax,117h    — displaced
  0xE9, 0x00, 0x00, 0x00, 0x00,             // jmp back
};

static BYTE DAMAGING_TO_STUB[DAMAGING_SPELL_LEN] = {
  0xE9, 0x00, 0x00, 0x00, 0x00
};

static void install_damaging_spell(void) {
  BYTE *base = (BYTE *)GetModuleHandleW(NULL);
  BYTE *yes = engine_code(DAMAGING_YES_RVA, DAMAGING_YES_MARK, DAMAGING_YES_MARK_LEN,
                            "a spell that deals damage");
  if (!yes) return;
  BYTE *stub = (BYTE *)VirtualAlloc(NULL, DAMAGING_STUB_LEN, MEM_COMMIT | MEM_RESERVE,
                                    PAGE_EXECUTE_READWRITE);
  if (!stub) { log_line("damaging spell: no memory for the stub"); return; }
  for (int i = 0; i < DAMAGING_STUB_LEN; i++) stub[i] = DAMAGING_STUB[i];
  *(DWORD *)(stub + 8) = (DWORD)yes - (DWORD)(stub + 12);
  *(DWORD *)(stub + 18) =
      (DWORD)(base + DAMAGING_SPELL_RVA + DAMAGING_SPELL_LEN) - (DWORD)(stub + DAMAGING_STUB_LEN);
  FlushInstructionCache(GetCurrentProcess(), stub, DAMAGING_STUB_LEN);

  *(DWORD *)(DAMAGING_TO_STUB + 1) = (DWORD)stub - ((DWORD)(base + DAMAGING_SPELL_RVA) + 5);
  if (overwrite_code(DAMAGING_SPELL_RVA, DAMAGING_SPELL_HEAD, DAMAGING_TO_STUB,
                     DAMAGING_SPELL_LEN, "a spell that deals damage")) {
    log_line("a spell of ours counts as one that hurts");
  }
}
