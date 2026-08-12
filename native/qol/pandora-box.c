// The Pandora's Box stops being a chest.
//
// A piece of the ONE translation unit — native/homm5-editor.c includes every
// piece in order, so everything included before this file is visible here and
// nothing after it is. Statics stay statics; nothing here is a module.

/** Which switch turns this file's logging on — see the bottom of core/log.c. */
#undef LOG_UNIT
#define LOG_UNIT qol_pandora_box

// ---------------------------------------------------------------------------
// WHAT WAS WRONG. The box is an `AdvMapTreasure` in the data, so a hero opening
// one got the CHEST's work on top of ours: its dialog, its goods, and the
// object taken off the map before the player had answered anything. The map's
// script then handed over the real contents to somebody who had already been
// told they found a chest.
//
// WHAT THIS DOES. One virtual slot — the chest's dialog-and-goods at 0xD20C80,
// which is slot +0x0c of the table at 0xFD5108 — is refused for OUR boxes and
// left alone for every real chest on the map. Nothing is patched, nothing is
// copied: the detour asks whose object this is and either returns without
// doing anything or calls the original.
//
// HOW A BOX IS RECOGNISED, and it is the point this file turned on. Not by its
// class (ours IS a treasure), not by its type (9, a chest, like the rest), but
// by the DOCUMENT it was built from: a shared definition carries its own path
// at +0x20, and ours read
//
//   /Buildings/PandoraBox/PandoraBox_Green.(AdvMapTreasureShared).xdb#xpointer(…)
//
// in the run that settled it. So the test is the folder our boxes live in, and
// a map full of ordinary chests is untouched by any of this.
//
// WHAT STILL HAPPENS. The touch trigger is a separate path and still fires, so
// the map's generated block still asks its question, hands over the contents
// and removes the object when it is done (src/mods/pandora-scripts.ts). What
// the player loses is exactly the chest: no dialog of its own, no gold of its
// own, and no vanishing before the answer.

/** `CAdvMapTreasure`'s dialog-and-goods, RVA in the 3.1 build. */
#define TREASURE_SPEAK_RVA 0x920c80u
/** Its first six bytes: `sub esp,84h` — a whole instruction, which is what the
 *  detour needs (the trampoline runs it and jumps back). */
static const BYTE TREASURE_SPEAK_HEAD[6] = { 0x81, 0xEC, 0x84, 0x00, 0x00, 0x00 };

// How the function itself reaches its shared document, copied instruction for
// instruction from 0xD20D1C so ours cannot drift from the engine's:
//
//   mov eax,[ebx-0F4h]    ; the vbtable pointer, ebx being `this`
//   lea ecx,[ebx-0F4h]
//   mov eax,[eax+8]       ; the third base offset
//   add ecx,eax           ; the subobject that answers
//   mov eax,[ecx]         ; its vtable
//   call [eax+8Ch]        ; give me my shared document
#define TREASURE_VB_OFFSET 0xF4
#define TREASURE_SHARED_SLOT 0x8C
/** Where a shared definition keeps the path it was loaded from — measured. */
#define SHARED_PATH_OFFSET 0x20

/** The folder every box of ours is built out of. */
static const char PANDORA_MARK[] = "PandoraBox";

/** The original, reached through the trampoline the detour leaves us. */
static void *g_treasure_speak_orig;
/** Said once, so a map of sixty-four boxes does not write sixty-four lines. */
static int g_pandora_said;

/** Does `text` hold `needle`? No CRT here, and this is the whole of what we
 *  need from one (see the header of native/homm5-editor.c). */
static int text_holds(const char *text, const char *needle) {
  if (!text) return 0;
  for (int i = 0; text[i]; i++) {
    int k = 0;
    while (needle[k] && text[i + k] == needle[k]) k++;
    if (!needle[k]) return 1;
    if (!text[i + k]) break;
  }
  return 0;
}

/**
 * The path a treasure's shared definition was loaded from, or null.
 *
 * Walked exactly the way the engine walks it. Everything is checked before it
 * is followed: this runs inside somebody else's function, and a wrong turn
 * here is the game's crash, not ours.
 */
static const char *treasure_document(void *self) {
  BYTE *at = (BYTE *)self;
  BYTE *base = at - TREASURE_VB_OFFSET;
  DWORD vb = *(DWORD *)base;
  if (!vb) return NULL;
  BYTE *sub = base + *(DWORD *)(vb + 8);
  void **vt = *(void ***)sub;
  if (!vt) return NULL;
  typedef void *(__fastcall * SharedOf)(void *self, void *unused);
  void *shared = ((SharedOf)vt[TREASURE_SHARED_SLOT / 4])(sub, 0);
  if (!shared) return NULL;
  return *(const char **)((BYTE *)shared + SHARED_PATH_OFFSET);
}

/**
 * The chest's visit, ours to refuse.
 *
 * `this` arrives already corrected: the slot's thunk does the vtordisp
 * subtraction before jumping here, so what we get is the subobject the table
 * belongs to — which is object+0xF8, and is what `treasure_document` expects.
 */
static void __fastcall treasure_speak_gate(void *self, void *unused, void *hero) {
  if (self) {
    const char *doc = treasure_document(self);
    if (text_holds(doc, PANDORA_MARK)) {
      if (!g_pandora_said) {
        g_pandora_said = 1;
        log_text("pandora: this box is ours, the chest stays quiet: ", doc);
      }
      return;   // no dialog, no goods, no vanishing — the script does the rest
    }
  }
  ((void(__fastcall *)(void *, void *, void *))g_treasure_speak_orig)(self, unused, hero);
}

/** Take the chest's visit away from our boxes. False when the bytes are not
 *  the ones we know, in which case every chest behaves as it always did. */
static int install_pandora_gate(void) {
  g_treasure_speak_orig = detour(TREASURE_SPEAK_RVA, TREASURE_SPEAK_HEAD,
                                 sizeof TREASURE_SPEAK_HEAD,
                                 (void *)treasure_speak_gate, "pandora chest dialog");
  return g_treasure_speak_orig != NULL;
}
