// The Pandora's Box, stage one: watch the chest speak, before replacing it.
//
// A piece of the ONE translation unit — native/homm5-editor.c includes every
// piece in order, so everything included before this file is visible here and
// nothing after it is. Statics stay statics; nothing here is a module.

/** Which switch turns this file's logging on — see the bottom of core/log.c. */
#undef LOG_UNIT
#define LOG_UNIT qol_pandora_box

// ---------------------------------------------------------------------------
// WHAT THIS IS FOR. The box is a treasure chest to the engine, so a hero who
// opens one gets the CHEST's dialog and the chest's goods on top of whatever
// the map's script hands over. Replacing that means owning one virtual slot,
// and docs/engineInternals/PANDORA_OBJECT.md says which one:
//
//   the chest's dialog is 0xD20C80, the function that reaches the message
//     getter four times (`push 3` — the artifact-found line — at 0xD21015);
//   it answers slot +0x0C of the table at 0xFD5108, through a vtordisp thunk;
//   and that table's pointer sits at object +0xF8, worked out from the
//     base-offset table at 0xFD514C.
//
// Every one of those was read out of the executable, and every one of them
// could still be a misreading — the first version of that document named a
// different function from a slot counted off the wrong table, and it was
// plausible for a week. So this file WATCHES first: it logs when the dialog
// runs and what the object's +0xF8 holds, and replaces nothing at all. A run
// that prints the table we predict is what makes the replacement worth writing.
//
// It costs a game run, and the game is launched by hand here — so what this
// installs is exactly what a run has to answer, in one line per visit.

/** `CAdvMapTreasure`'s dialog-and-goods, RVA in the 3.1 build. */
#define TREASURE_SPEAK_RVA 0x920c80u
/** Its first five bytes: `sub esp,84h` / `push ebx` — a whole number of
 *  instructions, which is what the detour needs. */
static const BYTE TREASURE_SPEAK_HEAD[6] = { 0x81, 0xEC, 0x84, 0x00, 0x00, 0x00 };

/** Where the object keeps the pointer to the table that slot belongs to. */
#define TREASURE_SPEAK_TABLE_OFFSET 0xF8
/** What we expect to find there — the table's RVA, added to the load base. */
#define TREASURE_SPEAK_TABLE_RVA 0xbd5108u

/** The original, reached through the trampoline the detour leaves us. */
static void *g_treasure_speak_orig;

/**
 * Say what the engine is about to do, and let it do it.
 *
 * `this` arrives in ecx already corrected: the slot's thunk does the vtordisp
 * subtraction before jumping here, so what we get is the object itself.
 */
static void __fastcall treasure_speak_watch(void *self, void *unused, void *hero) {
  (void)unused;
  if (self) {
    BYTE *at = (BYTE *)self;
    DWORD expect = (DWORD)((BYTE *)GetModuleHandleW(NULL) + TREASURE_SPEAK_TABLE_RVA);
    // WHAT `this` IS HERE, measured rather than assumed.
    //
    // The first run answered: `[this+0xF8]` is zero, so `this` is NOT the start
    // of the object — the thunk's `sub ecx,[ecx-4]` leaves it pointing at the
    // SUBOBJECT the table belongs to. If that is so, the table is at `[this]`
    // and the displacement it was moved by is the word in front of it, which is
    // also the offset to subtract to get the object back. All three are printed
    // because the one that matters is whichever turns out to be the table.
    DWORD own = *(DWORD *)at;
    DWORD before = *(DWORD *)(at - 4);
    DWORD deep = *(DWORD *)(at + TREASURE_SPEAK_TABLE_OFFSET);
    log_line(own == expect ? "pandora: chest speaks, and `this` IS the subobject: [this] is our table"
                           : "pandora: chest speaks — neither [this] nor [this+0xF8] is our table");
    log_hex("pandora:   this        ", (DWORD)at);
    log_hex("pandora:   [this]      ", own);
    log_hex("pandora:   [this-4]    ", before);
    log_hex("pandora:   [this+0xF8] ", deep);
    log_hex("pandora:   our table   ", expect);
  }
  ((void(__fastcall *)(void *, void *, void *))g_treasure_speak_orig)(self, unused, hero);
}

/** Watch the chest's dialog. False when the bytes are not the ones we know. */
static int install_pandora_watch(void) {
  g_treasure_speak_orig = detour(TREASURE_SPEAK_RVA, TREASURE_SPEAK_HEAD,
                                 sizeof TREASURE_SPEAK_HEAD,
                                 (void *)treasure_speak_watch, "pandora chest dialog");
  return g_treasure_speak_orig != NULL;
}
