// A whole-field spell hits in the element its record names, not the one its
// NUMBER implies.
//
// A piece of the ONE translation unit — native/homm5-editor.c includes every
// piece in order, so everything included before this file is visible here and
// nothing after it is. Statics stay statics; nothing here is a module.
//
// WHY IT SITS WITH THE OTHER FIXES. This changes what a SHIPPED spell does — the
// empowered Armageddon — so it is behind `mass-spell-element-fix` in the panel
// like every rule fix beside it (docs/QOL.md, docs/engineInternals/RULES_FIXES.md),
// and it shares its site with qol/fix-empowered-armageddon.c, which is now its
// neighbour rather than a file away. With the flag off not a byte moves.
//
// It used to live in combat/spell-cast.c because that is where it was written,
// which is not a reason. Nothing of our own spells' rides on it any more: they
// are resolved in combat/spell-resolve.c, which picks its own applier.

/** Which switch turns this file's logging on — see the bottom of core/log.c. */
#undef LOG_UNIT
#define LOG_UNIT qol_fix_mass_spell_element

// ---------------------------------------------------------------------------
// AND THE FIFTH SWITCH: WHOSE ELEMENT THE DAMAGE IS DEALT IN.
//
// The whole-field routine has FOUR appliers and they are one per element — each
// asks the caster for that element's Master perk:
//
//   0xBD1790  45, Master of Storms — air
//   0xBD1420  44, Master of Fire
//   0xBD12C0  43, Master of Ice — water
//   0xBD1980  nothing at all — the NO-ELEMENT applier
//
// EXCEPT THAT IT DOES NOT CHOOSE BETWEEN FOUR. Only the AREA routine does that;
// this one has a single comparison, `cmp eax,0Ah`, and behind it the fire
// applier and nothing else:
//
//   cmp eax,0Ah / jne → 0xBD1980 for every unit          ; not Armageddon
//   …            → 0xBD1980 for units NEAR the point     ; the local hit
//                → 0xBD1420 for every unit               ; FIRE, unconditionally
//
// So there are two decisions bundled in one comparison — "is the damage
// elemental" and "which element" — and the second was answered by there being
// only one spell to answer it for. Reading it as "the elemental branch" and
// letting anything elemental in sent an ICE spell of ours down the fire path;
// that was a real hole and this is where it is closed.
//
// WHAT WE DO. ONE change, and it is not a case for a spell: the comparison
// becomes `SpellElement(id) == fire` — the question `cmp eax,0Ah` was a shortcut
// for, asked of the document instead of of the number. The `call 0xBD1420`
// behind it is left exactly as the game wrote it.
//
// AND WHY ONLY FIRE, which took a second reading to get right. The site pushes
// FOUR arguments, and the four appliers do not agree on how many they take —
// their `ret`s are 10h (fire), 14h (air) and 18h (water). An earlier version of
// this made the call indirect and pointed it at whichever applier the element
// named, which for water or air would have returned with the stack four or eight
// bytes short — a crash somewhere else entirely, and one that would never have
// been traced back to here. It never fired, because the only elemental spell
// that reaches this routine is Armageddon and Armageddon is fire. A spell of
// OURS does not come through here at all any more: it is resolved in
// combat/spell-resolve.c, which picks its own applier and calls it with its own
// argument list.
//
// ARMAGEDDON IS UNTOUCHED by both: its element is fire, so it takes the same
// branch to the same applier, and its own near-point hit is not in the way. Nor
// does that hit reach a spell of ours with anything: its amount is decided at
// `0xD60E29`, where a `cmp ecx,0Ah` gives everything but Armageddon a zero, and
// `0xBD1980` bails on a zero in its first two instructions.
//
// AND THE SITE IS SHARED. It is the third of the three
// `native/qol/fix-empowered-armageddon.c` documents, and asking the record
// answers that one too: the accessor normalises the empowered Armageddon (232)
// to 10 and finds it elemental, so that site is not a case anybody adds — it
// falls out of asking properly, and so will any elemental whole-field spell the
// game is ever given.
//
// BEHIND ITS OWN FLAG, WHOLE. `mass-spell-element-fix` decides whether any of
// this is written at all — not a branch inside it. With the flag off not a byte
// moves and the game is the game, ours included; with it on the question is the
// document's, for every spell alike and with no number compared anywhere.

/** `mov eax,[esi+4] / cmp eax,0Ah / jne` — which element the damage is dealt in. */
#define WHOLE_FIELD_ELEMENT_RVA 0x9610b7u
#define WHOLE_FIELD_ELEMENT_LEN 12
static const BYTE WHOLE_FIELD_ELEMENT_HEAD[WHOLE_FIELD_ELEMENT_LEN] = {
  0x8B, 0x46, 0x04, 0x83, 0xF8, 0x0A, 0x0F, 0x85, 0xBC, 0x00, 0x00, 0x00
};
/** Its two continuations: elemental, and not. */
#define WHOLE_FIELD_ELEMENTAL_RVA 0x9610c3u
#define WHOLE_FIELD_PLAIN_RVA 0x96117fu

/** Where the stub keeps the answer across its own `popad`. */
static BYTE g_wholeFieldElemental = 0;

/**
 * ONE RULE, FOR EVERY SPELL IN THE GAME: the element comes from the document.
 *
 * No number is asked here, and that is the point. `SpellElement` IS the question
 * `cmp eax,0Ah` was a shortcut for — it normalises the id, reads the record, and
 * answers 0 unless `DamageIsElemental` is set — so asking it directly is asking
 * what the engine already meant, for Armageddon exactly as for a spell of ours.
 *
 * WHY NOT BEHIND A FLAG, when a changed shipped behaviour usually is. Because
 * the change is not a behaviour: it is the same question asked properly, and it
 * moves exactly ONE shipped spell. Only three reach this routine — Armageddon
 * (elemental, fire applier, as before), Holy Word and Unholy Word (both name an
 * element and leave `DamageIsElemental` false, so both answer 0 and take the
 * plain applier, as before). The fourth is the Empowered Armageddon, which the
 * accessor normalises to 10 and finds elemental — and that is the shipped BUG
 * `fix-empowered-armageddon` exists for, not a rule anybody chose.
 *
 * And a spell of ours must not need a fix switched on to have the element its
 * own document gives it. See docs/QOL.md for the line between the two.
 */
static void __cdecl decide_whole_field(int spell) {
  // 2 is fire, and fire is the only answer this site can act on — the `call`
  // behind it is `0xBD1420` and stays so. See the paragraph above for why.
  g_wholeFieldElemental = (BYTE)(g_spellElement && g_spellElement(spell) == 2);
}

#define WHOLE_FIELD_STUB_LEN 34
static BYTE WHOLE_FIELD_STUB[WHOLE_FIELD_STUB_LEN] = {
  0x60,                                     // pushad
  0x9C,                                     // pushfd
  0xFF, 0x76, 0x04,                         // push dword ptr [esi+4]  — the spell id
  0xE8, 0x00, 0x00, 0x00, 0x00,             // call decide_whole_field
  0x83, 0xC4, 0x04,                         // add esp,4
  0x9D,                                     // popfd
  0x61,                                     // popad
  0x80, 0x3D, 0x00, 0x00, 0x00, 0x00, 0x00, // cmp byte ptr [g_wholeFieldElemental],0
  0x74, 0x05,                               // je +5           — not fire
  0xE9, 0x00, 0x00, 0x00, 0x00,             // jmp <the fire applier's caller>
  0xE9, 0x00, 0x00, 0x00, 0x00,             // jmp <the plain applier's caller>
};

static BYTE WHOLE_FIELD_TO_STUB[WHOLE_FIELD_ELEMENT_LEN] = {
  0xE9, 0x00, 0x00, 0x00, 0x00, 0x90, 0x90, 0x90, 0x90, 0x90, 0x90, 0x90
};

static void install_whole_field_element(void) {
  BYTE *base = (BYTE *)GetModuleHandleW(NULL);
  BYTE *stub = (BYTE *)VirtualAlloc(NULL, WHOLE_FIELD_STUB_LEN, MEM_COMMIT | MEM_RESERVE,
                                    PAGE_EXECUTE_READWRITE);
  if (!stub) { log_line("whole-field element: no memory for the stub"); return; }
  for (int i = 0; i < WHOLE_FIELD_STUB_LEN; i++) stub[i] = WHOLE_FIELD_STUB[i];
  *(DWORD *)(stub + 6) = (DWORD)(void *)decide_whole_field - (DWORD)(stub + 10);
  // The answer travels in a byte of ours rather than in a register: `popad`
  // would put the old eax back, so the C writes `g_wholeFieldElemental` itself
  // and the stub reads it after the registers are restored.
  *(DWORD *)(stub + 17) = (DWORD)(void *)&g_wholeFieldElemental;
  *(DWORD *)(stub + 25) = (DWORD)(base + WHOLE_FIELD_ELEMENTAL_RVA) - (DWORD)(stub + 29);
  *(DWORD *)(stub + 30) = (DWORD)(base + WHOLE_FIELD_PLAIN_RVA) - (DWORD)(stub + 34);
  FlushInstructionCache(GetCurrentProcess(), stub, WHOLE_FIELD_STUB_LEN);

  *(DWORD *)(WHOLE_FIELD_TO_STUB + 1) =
      (DWORD)stub - ((DWORD)(base + WHOLE_FIELD_ELEMENT_RVA) + 5);
  if (overwrite_code(WHOLE_FIELD_ELEMENT_RVA, WHOLE_FIELD_ELEMENT_HEAD, WHOLE_FIELD_TO_STUB,
                     WHOLE_FIELD_ELEMENT_LEN, "which element a whole-field spell hits in")) {
    log_line("a whole-field spell hits in the element its record names");
  }
}
