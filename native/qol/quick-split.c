// Quick split: the keys, the screen, the drag state.
//
// A piece of the ONE translation unit — native/homm5-editor.c includes every
// piece in order, so everything included before this file is visible here and
// nothing after it is. Statics stay statics; nothing here is a module.

/** Which switch turns this file's logging on — see the bottom of core/log.c. */
#undef LOG_UNIT
#define LOG_UNIT qol_quick_split

// ---------------------------------------------------------------------------
// Quick split — a held key and a click, instead of the slider.
//
// THE SLIDER WINDOW IS NOT TOUCHED. Nothing here hooks it, or the drop, or the
// drag: there is ONE hook, on the click, and everything a gesture does it does
// through a controller it builds itself. That is the whole difference between
// this and the four attempts before it — the logic is ours and the engine is
// only asked to carry it out, so what a gesture decides can be read here rather
// than guessed at from what the screen did afterwards.
//
// WHERE A CLICK IS. Dragging in this interface is a three-state machine —
// Ready, Prepare, Drag. Pressing over a stack leaves Ready and remembers what
// was under the cursor; Prepare then becomes Drag either because the mouse
// moved or because the button was RELEASED. The slot hooked below is the
// release, so a gesture is a click and dragging stays the player's.
//
// WHAT A GESTURE NEEDS TO KNOW, and where each answer comes from — all of it
// read out of the screen's own fields, every one measured from the code that
// builds a split by hand (`CHeroScreen::Split`, and the controller's `Init`):
//
//   which slot was clicked  the screen keeps an array of slot widgets per army
//                           on screen; the clicked widget is in one of them and
//                           its position IS the slot number
//   what is in every slot   army -> owner -> a vector of stacks, one entry per
//                           slot, null where the slot is empty
//   how many, and of what   the stack itself: +0x20 the count, +0x1C the
//                           creature
//   how to move them        a controller of our own — below
//
// See docs/UI_INTERNALS.md.

#define SLOT_COUNT 7

// --- the screen ------------------------------------------------------------

/** The drag client is a subobject; the screen proper starts this far back. */
#define PART_FROM_CLIENT 0x174u
/** One array of slot widgets per army on screen, and the army each belongs to. */
#define PART_SLOTS_A 0x53Cu
#define PART_SLOTS_B 0x654u
#define PART_ARMY_A 0x1B0u
#define PART_ARMY_B 0x1B4u
/** Whether there is a second army at all. The screen keeps the answer in one of
 *  two bytes and a flag says which — a hero standing at a town has one, a hero
 *  alone in the field does not, and reading the wrong byte invents an army. */
#define PART_SECOND_FLAG 0x4B8u
#define PART_SECOND_WHEN_SET 0x338u
#define PART_SECOND_WHEN_CLEAR 0x1B8u
/** The three fields of a controller's block that belong to the screen itself. */
#define PART_BLOCK_FIRST 0x1A8u
#define PART_BLOCK_SECOND 0x1A4u
#define PART_BLOCK_LAST 0x758u

/** Slot entries are three words apart, and each begins with the object. */
#define SLOT_ENTRY_STRIDE 0xCu

/** The army's "what holds my stacks", and the owner's vector of them. */
#define ARMY_OWNER 0x48u
#define OWNER_STACKS 0x08u

/** A stack of creatures: which creature, and how many of it. */
#define STACK_TYPE 0x1Cu
#define STACK_COUNT 0x20u

// --- the controller --------------------------------------------------------

/**
 * `CHeroDragStackController`'s constructor: one argument, a block of nine
 * words, and out comes the thing that moves creatures.
 *
 * The block is not a mystery to be captured from a real split any more — the
 * screen builds one out of its own fields, and so do we:
 *
 *   0  screen +0x1A8            5  target army's owner
 *   1  screen +0x1A4            6  target slot
 *   2  source army's owner      7  target army
 *   3  source slot              8  screen +0x758
 *   4  source army
 *
 * Which is why no drag, no window and no held key are anywhere near a gesture:
 * two slot numbers are the entire difference between one split and another.
 */
#define MAKE_CONTROLLER_RVA 0x412190u
#define MAKE_CONTROLLER_HEAD_LEN 6
static const BYTE MAKE_CONTROLLER_HEAD[MAKE_CONTROLLER_HEAD_LEN] = {
  0x56, 0x57, 0x6A, 0x40, 0x8B, 0xF9
};

typedef void *(__fastcall *MakeControllerFn)(void *block, void *edx);
static MakeControllerFn g_makeController = NULL;

/** Ask, and then do — the two the split window's OK button is made of. */
#define CONTROLLER_VALIDATE 0x10u
#define CONTROLLER_EXECUTE 0x14u
/**
 * WHAT THE NUMBER MEANS: how many the TARGET ends up with, not how many cross.
 *
 * `Validate(n)` refuses unless both `total - n` and `n` clear a minimum, and
 * `total` — this field — is the two stacks ADDED TOGETHER whenever they hold
 * the same creature. So the slider in the window sets the target's share of the
 * pair. That is why every split into an EMPTY slot looked right, the two
 * numbers being equal there, and why every move into an OCCUPIED one silently
 * did nothing: "hand over two more" was read as "leave the target with the two
 * it already has", which is the whole of the 4-6-2 that no amount of arithmetic
 * above it could ever have fixed.
 *
 * It is also the same-creature test, free: a pair holding different creatures
 * is left at zero.
 */
#define CONTROLLER_TOTAL 0x28u

typedef int(__fastcall *ControllerAskFn)(void *self, void *edx, int howMany);
typedef void *(__fastcall *NoArgFn)(void *self, void *edx);

/**
 * `CHeroScreen::Split` — and it is only half named that.
 *
 * GIVING A STACK AWAY WHOLE IS NOT A SPLIT, and the engine knows it: this
 * function looks at one byte first and takes an entirely different branch when
 * splitting is not on. That branch compares the two creatures and builds a
 * MERGE — a different, smaller command than the split one, and the only one the
 * army panel knows how to draw the result of.
 *
 * A split command told to hand over everything leaves the source at nothing,
 * which the panel never has to cope with otherwise, and it goes on drawing the
 * slot: six stacks on screen where the army has five, until the screen is
 * reopened. So a merge of ours goes through here, and only a real division of a
 * stack goes through a controller of our own.
 *
 * The byte is the engine's Shift binding — held, it turns a drop into an offer
 * to split. Ours is cleared for the call and put back after, so a gesture means
 * the same thing whatever the player is leaning on.
 */
#define SCREEN_SPLIT_RVA 0x359360u
#define SCREEN_SPLIT_HEAD_LEN 7
static const BYTE SCREEN_SPLIT_HEAD[SCREEN_SPLIT_HEAD_LEN] = {
  0x83, 0xEC, 0x58, 0x53, 0x55, 0x8B, 0xE9
};
#define SCREEN_SPLIT_ALLOWED 0x1A0u

typedef int(__fastcall *ScreenSplitFn)(void *self, void *edx, void *fromWidget, void *fromStack,
                                       void *toWidget, void *toStack);
static ScreenSplitFn g_screenSplit = NULL;

/** The drag's own map from a widget to the handle a drop deals in — which is
 *  not the stack itself, and is what that call wants. */
#define DND_HELPER_MAP 0x10u
#define SLOT_CONTENTS 0x28u
typedef void *(__fastcall *InSlotFn)(void *self, void *edx, void *widget);

// --- the click -------------------------------------------------------------

/**
 * `CDNDStatePrepare` on the button being RELEASED — a click and nothing else.
 *
 * A click and the start of a drag both end up in the state's move handler,
 * which is why hooking that took the player's Shift-drag away along with the
 * click. This slot is reached only when the button comes back up without the
 * mouse having gone anywhere.
 */
#define DND_PICK_RVA 0x3d1ba0u
#define DND_PICK_HEAD_LEN 7
static const BYTE DND_PICK_HEAD[DND_PICK_HEAD_LEN] = {
  0x8B, 0x01, 0x8B, 0x40, 0x1C, 0xFF, 0xE0
};

/** The helper the state works through, what it picked, and whose screen it is. */
#define DND_STATE_HELPER 0x0Cu
#define DND_HELPER_PICKED 0x1Cu
#define DND_HELPER_WIDGET 0x0Cu
#define DND_HELPER_CLIENT 0x08u
/** The state's own way back to Ready — how a click is called off. */
#define DND_STATE_GIVE_UP 0x2Cu
/** What the helper has to BE for its fields to mean what we read them as: the
 *  same drag carries artifacts, and a town screen lays its own out differently. */
#define DND_HELPER_VTABLE_RVA 0xb6db14u

typedef int(__fastcall *DndPickFn)(void *state, void *edx, void *arg);
typedef void(__fastcall *GiveUpFn)(void *state, void *edx);
typedef SHORT(WINAPI *KeyStateFn)(int);

static DndPickFn g_dndPick = NULL;
static KeyStateFn g_keyState = NULL;
static int g_clicksLogged = 0;

/** Is this key down NOW — at the click, which is when the answer is wanted. */
static int held(int vk) { return g_keyState && (g_keyState(vk) & 0x8000) != 0; }

/** USER32's answer to that, got once. Two features want it and either may be
 *  turned on without the other, so neither installer may own it. */
static int have_key_state(void) {
  if (!g_keyState) {
    HMODULE user32 = GetModuleHandleW(L"user32.dll");
    g_keyState = user32 ? (KeyStateFn)GetProcAddress(user32, "GetAsyncKeyState") : NULL;
  }
  return g_keyState != NULL;
}


/** The engine's own test that one of its refcounted pointers still points. */
static int pointer_alive(void *p) {
  if (readable_bytes(p, 8) < 8) return 0;
  BYTE *block = *(BYTE **)((BYTE *)p + 4);
  if (readable_bytes(block, 8) < 8) return 0;
  DWORD at = *(DWORD *)(block + 4);
  if (readable_bytes((BYTE *)p + at, 12) < 12) return 0;
  return *(int *)((BYTE *)p + at + 8) >= 0;
}

/** Is this the type we measured — and so are its fields where we think? */
static int is_a(void *obj, DWORD vtableRva) {
  if (readable_bytes(obj, 4) < 4) return 0;
  return *(DWORD *)obj == (DWORD)(BYTE *)GetModuleHandleW(NULL) + vtableRva;
}

