// The plate over a stack: Shift-losses and the health bar.
//
// A piece of the ONE translation unit — native/homm5-editor.c includes every
// piece in order, so everything included before this file is visible here and
// nothing after it is. Statics stay statics; nothing here is a module.

// ---------------------------------------------------------------------------
// The plate over a stack in a battle.
//
// WHAT THE PLATE IS. The number over a creature's head is `ID_STACKINFO_WINDOW`
// in UI/UIGameRoot.(UIGameRoot).xdb — a four-state button declared by
// UI/CombatArena-FPP-2/StackInfo.(WindowMSButtonShared).xdb, with exactly one
// child, `Text`, and its four backgrounds in UI/AdventureScreen/StackInfo. So
// the widget is DATA: a health bar beside the number is a child window added in
// an archive of ours, and only its WIDTH would have to come from here.
//
// HOW THE NUMBER GETS THERE. Three functions, and the reconnaissance that found
// them is written up in docs/engineInternals/COMBAT.md:
//
//   0x739c40   place ONE plate: `this` is the window, and the second stack
//              argument is the number it will show.
//   0x7c0ed0   that number as the player reads it — the text key
//              CREATURES_NUMBER with `count` put in, and "2K" above a thousand.
//              ONE caller in the whole image, and it is the line above.
//   0x4dc940   a string of the engine's own taking a C string.
//
// So the text on a plate, and nothing else in the game, is ours to write. That
// one caller is what makes this cheap: no test of "is this a plate", no state
// to keep about which screen is up.
//
// WHAT IS STILL MISSING, and it is the health bar's half: which combat creature
// a plate stands for. The placement call carries the window and the number and
// nothing else, and the `CCreature` the screen's own walk carries is the stack
// on the map — its whole object was printed, and a wound is not in it. So the
// losses are done here and the bar is not: see the docs for where that goes
// next.

/** Place one plate. `sub esp,1Ch / push ebx / push ebp / mov ebp,ecx`. */
#define PLATE_SHOW_RVA 0x339c40u
#define PLATE_SHOW_HEAD_LEN 7
static const BYTE PLATE_SHOW_HEAD[PLATE_SHOW_HEAD_LEN] = {
  0x83, 0xEC, 0x1C, 0x53, 0x55, 0x8B, 0xE9
};
/** `mov eax,fs:[2Ch]` and `sub esp,0Ch`. The absolute in the first is a segment
 *  offset rather than an address in the image, so nothing here is relocated. */
#define COUNT_TEXT_RVA 0x3c0ed0u
#define COUNT_TEXT_HEAD_LEN 9
static const BYTE COUNT_TEXT_HEAD[COUNT_TEXT_HEAD_LEN] = {
  0x64, 0xA1, 0x2C, 0x00, 0x00, 0x00, 0x83, 0xEC, 0x0C
};
/**
 * The battle's OWN plate loop, and it is a different one.
 *
 * `CCombatArenaScreen` lays plates out from two branches, and the one first
 * hooked — the short one — turned out never to run in a battle: four battles
 * spent watching it caught the adventure map and the setup screen and nothing
 * else. This is the other. Its second stack argument is a vector of pointers,
 * copied by 0x73a590 out of what 0xbab640 hands back for the screen's +0x2A0,
 * which is the COMBAT itself. So these are the fighting creatures, and the
 * wound the health bar wants is in one of them.
 *
 * `push ebp / mov ebp,esp / and esp,-8 / sub esp,54h` — nine bytes, and its
 * `ret 1Ch` says seven arguments on the stack. Counting pushes at the call
 * site gives two; five more were left there by a call that does not clean up.
 */
#define BATTLE_PLATES_RVA 0x339f60u
#define BATTLE_PLATES_HEAD_LEN 9
static const BYTE BATTLE_PLATES_HEAD[BATTLE_PLATES_HEAD_LEN] = {
  0x55, 0x8B, 0xEC, 0x83, 0xE4, 0xF8, 0x83, 0xEC, 0x54
};
/** `CFinishCombat`'s apply — the one door a battle leaves by. Seven bytes,
 *  stopping before the short jump, whose meaning is where it sits. */
#define FINISH_COMBAT_RVA 0x773230u
#define FINISH_COMBAT_HEAD_LEN 7
static const BYTE FINISH_COMBAT_HEAD[FINISH_COMBAT_HEAD_LEN] = {
  0x8B, 0xD1, 0x8B, 0x4A, 0x10, 0x85, 0xC9
};

typedef void(__fastcall *PlateShowFn)(void *window, int shown, int first, int number,
                                      int x, int y);
typedef void *(__fastcall *CountTextFn)(int number, int thousands);
typedef int(__fastcall *FinishCombatFn)(void *command, void *edx);
typedef void(__fastcall *BattlePlatesFn)(void *self, void *edx, void *a1, void *units,
                                         void *a3, void *screen, void *a5, void *a6, void *a7);

static PlateShowFn g_plateShow = NULL;
static CountTextFn g_countText = NULL;
static FinishCombatFn g_finishCombat = NULL;
static BattlePlatesFn g_battlePlates = NULL;

/**
 * What each plate held when we first saw it, which is what it walked in with.
 *
 * KEYED ON THE WINDOW, because that is all the placement call carries. Within
 * one battle a window belongs to one stack — the screen makes them once, by
 * row, and keeps them — so the key holds for exactly as long as the answer is
 * wanted. Across battles it would not, which is what the finish hook is for.
 */
#define PLATES_REMEMBERED 32
static struct { void *window; int start; } g_plateWalkedIn[PLATES_REMEMBERED];
static int g_platesKnown = 0;

/** The plate being drawn right now, for the text hook, which is called from
 *  inside the placement and has no other way to know whose number it is. */
static int g_plateStart = 0;
static int g_platesLogged = 0;
static int g_textLogged = 0;
static int g_barsLogged = 0;

/** The bar's half of this, which is written below because it needs the fighting
 *  stacks, and used here because the plate is placed here. */
static void bar_follow_plate(void *window, int number);
/** What the strips leave clear at each end, and how tall they are — the same
 *  two numbers the archive declares them with. */
#define BAR_MARGIN 1
#define BAR_TALL 2
/** How many plates still owe a line, so that the numbers on screen are written
 *  down beside the words of a fighting creature that might be them. Set by the
 *  reconnaissance below, which runs one frame ahead of the plates it wants. */

/** Is Shift down — asked at most once a tick rather than once per plate per
 *  frame, which at fourteen stacks and sixty frames is eight hundred times a
 *  second for an answer that cannot change that often. */
static DWORD g_shiftAskedAt = 0;
static int g_shiftDown = 0;

static int shift_now(void) {
  DWORD tick = GetTickCount();
  if (tick != g_shiftAskedAt) {
    g_shiftAskedAt = tick;
    g_shiftDown = held(VK_SHIFT);
  }
  return g_shiftDown;
}

static int walked_in_with(void *window, int number) {
  for (int i = 0; i < g_platesKnown; i++)
    if (g_plateWalkedIn[i].window == window) return g_plateWalkedIn[i].start;
  if (g_platesKnown < PLATES_REMEMBERED) {
    g_plateWalkedIn[g_platesKnown].window = window;
    g_plateWalkedIn[g_platesKnown].start = number;
    g_platesKnown++;
  }
  return number;
}

/**
 * The number on the plate, with what the stack started the battle with beside
 * it while Shift is held.
 *
 * The engine's own text is built first and then replaced rather than skipped:
 * what comes back is a static string of the game's, and letting it be filled
 * the usual way is what keeps the object in the state the rest of the frame
 * expects. Its buffer is freed before ours goes in, because the assignment
 * does not free — the engine only ever assigns to a string that is empty.
 */
static void *__fastcall count_text_hook(int number, int thousands) {
  void *text = g_countText(number, thousands);
  if (!g_qol[QOL_STACK_LOSSES] || !g_plateStart || !shift_now()) return text;
  if (!readable(text, 12)) return text;
  // A few, and only for the key being held: the first battle with this on is
  // the one that says whether a plate's baseline is the stack's own.
  int say = g_textLogged < 8 ? ++g_textLogged : 0;
  if (say) {
    log_num("shift: the plate shows ", number);
    log_num("       it walked in with ", g_plateStart);
  }

  char both[32];
  int at = 0, digits = 0;
  num_to_dec(number, both, &digits);
  at += digits;
  both[at++] = '/';
  num_to_dec(g_plateStart, both + at, &digits);
  at += digits;
  both[at] = 0;
  if (say) log_text("       ours reads ", both);

  // THE STRING IS WIDE, and two crashes were that and nothing else. The text is
  // built by a `%d` that lives in the image as `25 00 64 00` — UTF-16 — so a
  // narrow assignment into it, and narrow bytes written into its buffer, both
  // left the window holding something that is not a string, and the game died
  // in the drawing rather than here. The tell was in the log the whole time:
  // one character `6` measured TWO bytes long.
  //
  // WRITTEN WHERE IT ALREADY IS. No allocation, no free: the first attempt did
  // both through the engine's own allocator and changed its state under a
  // frame that was still running, and the room was never wanted anyway — a
  // one-digit count sits in thirty bytes. What comes out is the object the
  // engine built, holding what it held, only longer.
  //
  // `end` EXCLUDES the terminator: the engine's own string constructor copies
  // the characters, stops before the zero, and leaves end at begin + length.
  void **string = (void **)text;
  WCHAR *begin = (WCHAR *)string[0];
  int room = begin ? (int)((char *)string[2] - (char *)begin) : 0;
  if (!begin || room < (at + 1) * 2) {
    if (say) log_num("       no room in it, bytes ", room);
    return text;
  }
  // Digits and a slash, so widening each is the whole of the conversion.
  for (int i = 0; i <= at; i++) begin[i] = (WCHAR)(BYTE)both[i];
  string[1] = (char *)begin + at * 2;
  return text;
}

static void __fastcall plate_show_hook(void *window, int shown, int first, int number,
                                       int x, int y) {
  int known = g_platesKnown;
  g_plateStart = walked_in_with(window, number);
  if (known != g_platesKnown && g_platesLogged < 8) {
    g_platesLogged++;
    log_hex("plate: a new one at ", (DWORD)window);
    log_num("       walked in with ", g_plateStart);
  }
  g_plateShow(window, shown, first, number, x, y);
  // AFTER the engine has placed it, because the plate takes its width from the
  // text it was just given, and the bar takes its width from the plate.
  bar_follow_plate(window, number);
  g_plateStart = 0;
}

static void hex_into(char *line, int *at, DWORD value, int digits) {
  static const char DIGITS[] = "0123456789abcdef";
  for (int i = digits - 1; i >= 0; i--) line[(*at)++] = DIGITS[(value >> (i * 4)) & 0xF];
}

/**
 * One word of an object: where it sits, what it holds, and — when it points at
 * something readable — the first word of THAT, which for an object is its
 * vtable and is what names a class offline with `tools/reverse/vtable.ts`.
 *
 * Addresses in the log are the RUNNING image's. This executable is relocatable
 * and has loaded at 0x650000 every time, so 0x250000 comes off before the
 * disassembly recognises anything — which is why each pass prints the base.
 */
static void log_word(int offset, DWORD value) {
  char line[64];
  int i = 0;
  const char *lead = "      +";
  for (int j = 0; lead[j]; j++) line[i++] = lead[j];
  hex_into(line, &i, (DWORD)offset, 3);
  const char *gap = "  0x";
  for (int j = 0; gap[j]; j++) line[i++] = gap[j];
  hex_into(line, &i, value, 8);
  if (readable((void *)(UINT_PTR)value, 4)) {
    const char *arrow = "  -> 0x";
    for (int j = 0; arrow[j]; j++) line[i++] = arrow[j];
    hex_into(line, &i, *(DWORD *)(UINT_PTR)value, 8);
  }
  line[i] = 0;
  log_line(line);
}

/** Two numbers on one line, so that hundreds of them are still readable. */
static void log_pair(const char *prefix, int first, const char *between, int second) {
  char line[160];
  int i = 0, n = 0;
  while (prefix[i] && i < 60) { line[i] = prefix[i]; i++; }
  num_to_dec(first, line + i, &n);
  i += n;
  for (int j = 0; between[j] && i < 140; j++) line[i++] = between[j];
  num_to_dec(second, line + i, &n);
  line[i + n] = 0;
  log_line(line);
}

/** `words` words of an object, each guarded on its own — a probe inside a
 *  battle asks the kernel about every page it touches. */
static void log_words(void *p, int words) {
  for (int i = 0; i < words; i++) {
    BYTE *at = (BYTE *)p + i * 4;
    if (!readable(at, 4)) return;
    log_word(i * 4, *(DWORD *)at);
  }
}

/**
 * What a fighting creature answers, watched while a battle changes it.
 *
 * EVERY CALL, not on a timer. Sampling every two seconds asked what a creature
 * looked like NEAR a blow rather than at it, and three battles of that never
 * once caught a health falling. This rides the frame, and what bounds its cost
 * is the log rather than the work.
 */
static int g_unitChangesLeft = 300;
#define UNIT_MAX 8

/**
 * WHAT A FIGHTING CREATURE ANSWERS ABOUT ITS HEALTH.
 *
 * Found where it was USED rather than where it was stored, which is the whole
 * lesson of the seven runs before this one. Seven sweeps of memory looked for a
 * number that was 17 and became less, and there is no such word — the panel's
 * "5 /15" is asked for, not kept.
 *
 * `CCombat::HowManyDie` (0xb57310) is the place it is asked. Four instructions
 * carry the entire formula, and every term of it is a virtual call on the
 * creature:
 *
 *     dead = damage / vt[0x1A8]
 *          + (damage % vt[0x1A8] >= vt[0x1D4] ? 1 : 0)
 *     capped at vt[0x1D8]
 *
 * which can only mean one thing each: the health of a whole creature, the
 * health left in the one at the front, and how many are standing. Asked
 * through the slots, so the virtual-base adjustment stays the engine's
 * business — every slot of this class begins `sub ecx,[ecx-4]`.
 */
#define CREATURE_WHOLE_HEALTH 0x1A8u
#define CREATURE_FRONT_HEALTH 0x1D4u
#define CREATURE_HOW_MANY 0x1D8u

static struct { void *unit; int known; int front, whole, many; } g_unitWas[UNIT_MAX];

static int ask_creature(void *unit, DWORD slot) {
  NoArgFn ask = (NoArgFn)vtable_entry(unit, slot);
  return ask ? (int)(DWORD)ask(unit, NULL) : -1;
}

static void watch_unit(void *unit, int index) {
  if (!readable(unit, 8)) return;
  int front = ask_creature(unit, CREATURE_FRONT_HEALTH);
  int whole = ask_creature(unit, CREATURE_WHOLE_HEALTH);
  int many = ask_creature(unit, CREATURE_HOW_MANY);

  int slot = -1;
  for (int i = 0; i < UNIT_MAX; i++) {
    if (g_unitWas[i].known && g_unitWas[i].unit == unit) { slot = i; break; }
  }
  if (slot < 0) {
    for (int i = 0; i < UNIT_MAX && slot < 0; i++) if (!g_unitWas[i].known) slot = i;
    if (slot < 0) return;
    g_unitWas[slot].unit = unit;
    g_unitWas[slot].known = 1;
  } else if (g_unitWas[slot].front == front && g_unitWas[slot].whole == whole
             && g_unitWas[slot].many == many) {
    return;
  }
  g_unitWas[slot].front = front;
  g_unitWas[slot].whole = whole;
  g_unitWas[slot].many = many;
  if (g_unitChangesLeft <= 0) return;
  g_unitChangesLeft--;
  log_pair("stack ", index, ": health of the one in front ", front);
  log_pair("          out of ", whole, ", and there are ", many);
}

// --- the bar itself --------------------------------------------------------
//
// The plate is a button and the bar is two child windows of it, declared in
// `homm5-editor-qol.h5u` — see tools/qol-ui.ts. All that is left for here is
// the width, and every call below is one the engine makes on this very window
// a few instructions apart, receivers and all — read at 0x739ce3..0x739dc6:
//
//   vt[0x94]  a child by name, on the window's virtual base. What comes back
//             is an IWindow* — the descriptors the engine then hands to
//             `__RTDynamicCast` say so: `.?AUIWindow@@` to `.?AUITextView@@`.
//   the cast  VCRUNTIME140.dll's `__RTDynamicCast`, cdecl, NULL when the
//             child is not a text view — no test of a vtable, no guess.
//   vt[0x0C]  ON THE CAST RESULT, plain: how big the text is. A slot of
//             ITextView, not of IWindow — asking anything else this question
//             is the "heap address where a width belonged" of two runs ago.
//   vt[0x50]  the margins, on the virtual base — four out-pointers, each
//             optional, `ret 10h`. The plate's width is the text's plus twice
//             the first of them: `lea edi,[edi+eax*2]`.
//   vt[0x58]  make it this big, on the virtual base — five stack values,
//             `ret 14h` in the body at 0xE35920, so x and y are FLOATS like
//             the size, and the last is a mask of which values to take.
//
// ONE RECEIVER RULE. The base slots (0x50, 0x58, 0x94) ride the virtual base:
// their entries all begin `sub ecx,[ecx-4]`, so the receiver must be the
// IWindow subobject itself. vt[0x94]'s return already IS that pointer, and the
// engine re-deriving it from the cast result — `ebx + 4 + [[ebx+4]+8]` — must
// land on the very same one. That equality is CHECKED at run time below before
// any width is set, because both crashes this feature has caused were a
// receiver assumed rather than copied.

/** A child by name. */
#define WINDOW_CHILD 0x94u
/** The margins around a window's content, each out-pointer optional. */
#define WINDOW_MARGINS 0x50u
/** Make it this big. Five values on the stack, the last a mask of which of them
 *  to take; the engine passes 0x0C for a size and leaves the position alone. */
#define WINDOW_PLACE 0x58u
#define WINDOW_PLACE_SIZE_ONLY 0x0Cu
/** How big a TEXT VIEW's text is — a slot of ITextView, only valid on what the
 *  dynamic cast answered. Into a point the caller lends it. */
#define TEXTVIEW_SIZE 0x0Cu

/** The two RTTI descriptors the engine's own cast names, image-relative. */
#define TYPE_IWINDOW_RVA 0xCAAF54u
#define TYPE_ITEXTVIEW_RVA 0xCAB114u

typedef void *(__fastcall *ChildFn)(void *self, void *edx, void *name, int flag);
typedef int *(__fastcall *SizeFn)(void *self, void *edx, int *into);
typedef void(__fastcall *MarginsFn)(void *self, void *edx, int *lowX, int *lowY, int *upX,
                                    int *upY);
typedef void(__fastcall *PlaceFn)(void *self, void *edx, float x, float y, float wide,
                                  float tall, int mask);
typedef void *(__cdecl *DynamicCastFn)(void *obj, int vfDelta, void *srcType, void *dstType,
                                       int isReference);

/** The subobject the engine talks to for children and placement. */
static void *window_base(void *window) {
  if (readable_bytes(window, 8) < 8) return NULL;
  BYTE *block = *(BYTE **)((BYTE *)window + 4);
  if (readable_bytes(block, 12) < 12) return NULL;
  return (BYTE *)window + 4 + *(int *)(block + 8);
}

/**
 * A named child of a window, asked for the way the engine asks.
 *
 * The name is a string of the engine's shape — begin, end, one past the room —
 * built on our stack, since nothing is kept and nothing is freed.
 */
static void *child_named(void *window, const char *name) {
  void *base = window_base(window);
  ChildFn find = (ChildFn)vtable_entry(base, WINDOW_CHILD);
  if (!find) return NULL;
  char text[24];
  int n = 0;
  while (name[n] && n < 22) { text[n] = name[n]; n++; }
  text[n] = 0;
  void *held[3];
  held[0] = text;
  held[1] = text + n;
  held[2] = text + n + 1;
  return find(base, NULL, held, 0);
}

/** The engine's own dynamic cast — imported by the executable from
 *  VCRUNTIME140.dll, so asked of the loader rather than read out of the image. */
static void *as_text_view(void *child) {
  static DynamicCastFn cast = NULL;
  if (!cast) {
    HMODULE crt = GetModuleHandleW(L"VCRUNTIME140.dll");
    cast = crt ? (DynamicCastFn)GetProcAddress(crt, "__RTDynamicCast") : NULL;
    if (!cast) return NULL;
  }
  BYTE *image = (BYTE *)GetModuleHandleW(NULL);
  return cast(child, 0, image + TYPE_IWINDOW_RVA, image + TYPE_ITEXTVIEW_RVA, 0);
}

/** How wide the text on the plate is — of the CAST RESULT, nothing else. */
static int text_width(void *view) {
  SizeFn size = (SizeFn)vtable_entry(view, TEXTVIEW_SIZE);
  if (!size) return 0;
  int into[2] = { 0, 0 };
  int *got = size(view, NULL, into);
  if (!got || readable_bytes(got, 8) < 8) return 0;
  // Sanity, because a wrong slot answers with something and it is never small:
  // a plate is tens of points across, never thousands and never negative.
  return got[0] > 0 && got[0] < 4096 ? got[0] : 0;
}

/** What the plate adds around its text on each side. */
static int lower_margin(void *base) {
  MarginsFn ask = (MarginsFn)vtable_entry(base, WINDOW_MARGINS);
  int x = 0;
  if (ask) ask(base, NULL, &x, NULL, NULL, NULL);
  return x >= 0 && x < 64 ? x : 0;
}

/** Make a strip this wide, leaving where it sits alone. */
static void make_wide(void *base, int wide) {
  PlaceFn place = (PlaceFn)vtable_entry(base, WINDOW_PLACE);
  if (place) place(base, NULL, 0.0f, 0.0f, (float)wide, (float)BAR_TALL,
                   WINDOW_PLACE_SIZE_ONLY);
}

/**
 * The stacks on the field, as the frame being drawn has them.
 *
 * Kept only for as long as that one call, because the plates are placed from
 * inside it: a plate carries its COUNT and nothing else, and a fighting stack
 * can be asked for the same number, so the two are matched on it. Ambiguous
 * when two stacks are the same size, which is why each is taken once and in
 * order — the plates are placed in the order this list is walked.
 */
static void **g_units = NULL;
int g_unitCount = 0;
static BYTE g_unitTaken[UNIT_MAX];

/** Which stack this plate is showing, and what its front creature has left. */
static int bar_fraction(int number, int *front, int *whole) {
  for (int i = 0; i < g_unitCount; i++) {
    if (g_unitTaken[i]) continue;
    void *unit = g_units[i];
    if (!readable_bytes(unit, 8)) continue;
    if (ask_creature(unit, CREATURE_HOW_MANY) != number) continue;
    int left = ask_creature(unit, CREATURE_FRONT_HEALTH);
    int full = ask_creature(unit, CREATURE_WHOLE_HEALTH);
    if (left < 0 || full <= 0) return 0;
    g_unitTaken[i] = 1;
    *front = left;
    *whole = full;
    return 1;
  }
  return 0;
}

/** How many plates get their arithmetic written down, first battle only. */
static int g_barLogged = 0;

/**
 * The strips sized to the plate the engine just placed.
 *
 * The plate's width is not asked of it — it is computed the way the engine
 * computes it three instructions after placing the text: the text's size plus
 * twice the margin. Both come from calls the engine makes on the same objects
 * in the same frame, so there is nothing here it would not have answered.
 *
 * THE SELF-CHECK before any width is set: the placement pass reaches vt[0x58]
 * through `cast + 4 + [[cast+4]+8]`, and vt[0x94] hands us its receivers
 * directly only if that derivation lands back on the pointer the search
 * returned. For the text child both pointers are in hand, so they are compared
 * — equal means our strip receivers are the engine's, unequal means they are
 * guesses again, and this feature has already crashed twice on a guessed
 * receiver. Then it walks away rather than calls.
 */
static void bar_follow_plate(void *window, int number) {
  if (!g_qol[QOL_STACK_HEALTH]) return;
  void *text = child_named(window, "Text");
  void *track = child_named(window, "HealthTrack");
  void *fill = child_named(window, "HealthFill");
  if (!text || !track || !fill) return;
  void *view = as_text_view(text);
  if (!view) return;
  if (window_base(view) != text) {
    if (g_barLogged < 1) {
      g_barLogged = 8;
      log_hex("bar: the search returned   ", (DWORD)text);
      log_hex("     the cast derives      ", (DWORD)window_base(view));
      log_line("     not the same pointer - widths stay unset");
    }
    return;
  }
  int wide = text_width(view);
  if (!wide) return;
  int plate = wide + 2 * lower_margin(text);
  int trackWide = plate - 2 * BAR_MARGIN;
  if (trackWide < 4) return;
  // -1 means LEAVE THE FILL ALONE. A plate can be placed more than once a
  // frame, and only one of those calls wins the stack — the count match is
  // take-once. A miss in a battle must therefore not touch the fill, or the
  // losing call writes a full bar over the fraction the winning call just set.
  // A miss with no battle behind it (the preparation screen) is different:
  // there is no damage to show, so the fill honestly follows the track.
  int fillWide = -1;
  int front = 0, whole = 0;
  if (bar_fraction(number, &front, &whole)) {
    fillWide = (int)((long long)trackWide * front / whole);
    // Nine-slice: anything narrower than its own two borders draws as noise.
    if (fillWide < 3) fillWide = front > 0 ? 3 : 0;
    if (front != whole && g_barLogged < 24) {
      g_barLogged++;
      log_pair("bar: the one in front has ", front, " of ", whole);
      log_pair("     so the fill takes ", fillWide, " of ", trackWide);
    }
  } else if (g_unitCount == 0) {
    fillWide = trackWide;
  } else if (g_barLogged < 24) {
    g_barLogged++;
    log_pair("bar: no stack claimed the count ", number, " among ", g_unitCount);
  }
  make_wide(track, trackWide);
  if (fillWide > 0) make_wide(fill, fillWide);
}

static void __fastcall battle_plates_hook(void *self, void *edx, void *a1, void *units,
                                          void *a3, void *screen, void *a5, void *a6, void *a7) {
  void **was = g_units;
  int wasCount = g_unitCount;
  if (readable(units, 8)) {
    BYTE *begin = *(BYTE **)units;
    BYTE *end = *(BYTE **)((BYTE *)units + 4);
    int count = end > begin ? (int)((end - begin) / 4) : 0;
    if (count > UNIT_MAX) count = UNIT_MAX;
    g_units = (void **)begin;
    g_unitCount = count;
    for (int i = 0; i < count; i++) g_unitTaken[i] = 0;
    if (g_unitChangesLeft > 0) for (int i = 0; i < count; i++) watch_unit(g_units[i], i);
  }
  g_battlePlates(self, NULL, a1, units, a3, screen, a5, a6, a7);
  g_units = was;
  g_unitCount = wasCount;
}

static int __fastcall finish_combat_hook(void *command, void *edx) {
  // A battle is over, so these windows are about to stand for other stacks —
  // and this command is the only way out of a battle there is. See
  // docs/engineInternals/COMBAT.md.
  g_platesKnown = 0;
  return g_finishCombat(command, edx);
}

static void install_stack_plates(void) {
  if (!have_key_state()) {
    log_line("stack plates: USER32 will not say which keys are down - not hooking");
    return;
  }
  g_countText = (CountTextFn)detour(COUNT_TEXT_RVA, COUNT_TEXT_HEAD, COUNT_TEXT_HEAD_LEN,
                                    &count_text_hook, "the count as text");
  g_plateShow = (PlateShowFn)detour(PLATE_SHOW_RVA, PLATE_SHOW_HEAD, PLATE_SHOW_HEAD_LEN,
                                    &plate_show_hook, "one plate");
  g_finishCombat = (FinishCombatFn)detour(FINISH_COMBAT_RVA, FINISH_COMBAT_HEAD,
                                          FINISH_COMBAT_HEAD_LEN, &finish_combat_hook,
                                          "the end of a battle");
  if (g_countText && g_plateShow) log_line("stack plates: losses shown while Shift is held");
  // Only what the health bar is still looking for, and only when it is asked
  // for: this one prints and changes nothing.
  if (g_qol[QOL_STACK_HEALTH]) {
    g_battlePlates = (BattlePlatesFn)detour(BATTLE_PLATES_RVA, BATTLE_PLATES_HEAD,
                                            BATTLE_PLATES_HEAD_LEN, &battle_plates_hook,
                                            "the battle's own plates");
    if (g_battlePlates) log_line("stack plates: watching what a battle fights with");
  }
}

