// Asking the player for a number of creatures, from a script.
//
// A piece of the ONE translation unit — native/homm5-editor.c includes every
// piece in order, so everything included before this file is visible here and
// nothing after it is. Statics stay statics; nothing here is a module.

/** Which switch turns this file's logging on — see the bottom of core/log.c. */
#undef LOG_UNIT
#define LOG_UNIT ui_count_window

// ---------------------------------------------------------------------------
// The count window, opened by Lua and answered to Lua.
//
// WHY THE ENGINE'S OWN WINDOW. There is exactly one window in this game for
// "how many of these", and the player already knows it: the split slider. It is
// `CSplitStack`, it is built fresh every time one is needed, and — this is the
// part that makes it ours to use — it holds NO army, NO slot and NO screen. It
// holds a CONTROLLER, at `+0x128`, and everything it draws and everything it
// does it asks that controller for. So a controller of ours is a window of
// ours, with the game's own frame, slider and buttons around it.
//
// WHAT THE WINDOW ASKS A CONTROLLER, all of it read out of the code that reads
// `+0x128` (there are nine such places and this is the whole vocabulary):
//
//   +0x00 (side)   the stack shown on that side of the slider, for the picture
//   +0x0C ()       may this be shown at all
//   +0x10 (n)      may the slider stand at n            — Validate
//   +0x14 (n)      it stands at n, do the thing         — Execute, the OK button
//   +0x18 ()       what the LEFT side may not go below; the window keeps
//                  `total - this` as the highest n the slider will reach
//   +0x1C ()       the lowest n the slider will reach
//   +0x20 ()       where the slider starts
//   +0x24 ()       the total the two sides share
//   +0x28 ()       may this be closed without answering — the Cancel button
//
// THE BRACKETS ARE THE `ret` OF THE ENGINE'S OWN SLOT, not the shape of the
// call site. `+0x24` is called as `push ebp; call [eax+24h]` and takes nothing:
// that push is a saved register, its `pop` is at the far end of the block, and
// the engine's own function (0x883350) is a bare `ret`. Read the wrong way it
// crashed the game — see `ctrl_total`.
//
// So the window is a slider from `+0x1C` to `total - +0x18`, and ours is the
// plain case of that: the total IS the maximum, nothing is held back on either
// side, and Execute writes the number down for the script to collect.
//
// THE PICTURE COMES FROM A NUMBER, not from an army. `+0x00` is answered with
// the thing the window draws, and the engine's own controller makes that out of
// one field of the stack it was given — `stack->+0x1C`, which is WHICH CREATURE.
// So a script that says which creature this is about gets the picture, and one
// that does not gets the window with the picture left empty, which is what the
// engine itself draws when it has no stack either.

/** `operator new` — one argument, cdecl, and it may answer with nothing. */
#define ALLOCATE_RVA 0xdd2d0u
#define ALLOCATE_HEAD_LEN 8
static const BYTE ALLOCATE_HEAD[ALLOCATE_HEAD_LEN] = {
  0x53, 0x64, 0x8B, 0x1D, 0x2C, 0x00, 0x00, 0x00
};

/** `CSplitStack`, its size and its constructor. The 1 is the engine's own. */
#define SPLIT_WINDOW_SIZE 0x160u
#define SPLIT_WINDOW_CTOR_RVA 0x3f8d30u
#define SPLIT_WINDOW_CTOR_HEAD_LEN 8
static const BYTE SPLIT_WINDOW_CTOR_HEAD[SPLIT_WINDOW_CTOR_HEAD_LEN] = {
  0x83, 0x7C, 0x24, 0x04, 0x00, 0x56, 0x8B, 0xF1
};

/** `CSplitStack::Show(controller)` — it takes the controller and opens. */
#define SPLIT_WINDOW_SHOW_RVA 0x3f8fb0u
#define SPLIT_WINDOW_SHOW_HEAD_LEN 8
static const BYTE SPLIT_WINDOW_SHOW_HEAD[SPLIT_WINDOW_SHOW_HEAD_LEN] = {
  0x8B, 0x54, 0x24, 0x04, 0x83, 0xEC, 0x18, 0x53,
};

/** The window's own refcount, reached the way the engine reaches it. */
#define WINDOW_COUNTED 0x10u

/**
 * What the window draws, out of a creature stack — `CBaseDragStackController`'s
 * `+0x00` ends in exactly this call, and this is the whole of it:
 *
 *     mov ecx,[ecx+1Ch]    the stack's creature
 *     call <the creature table>    an id out of range answers with nothing
 *     add eax,0F4h                 the pictures live there
 *
 * So the only field of a "stack" it reads is WHICH CREATURE, and a block of
 * ours with that one field filled in is as good as an army's. The table refuses
 * an id it does not have, so a wrong number costs a blank picture and nothing
 * else.
 */
#define CREATURE_PICTURE_RVA 0x6bafb0u
#define CREATURE_PICTURE_HEAD_LEN 8
static const BYTE CREATURE_PICTURE_HEAD[CREATURE_PICTURE_HEAD_LEN] = {
  0x8B, 0x49, 0x1C, 0xE8, 0x78, 0xC6, 0x06, 0x00
};

/** Where that call looks, and how much of a stack has to exist for it. */
#define STACK_CREATURE 0x1Cu
#define STACK_ENOUGH (STACK_CREATURE + 4)

/**
 * `CBaseScreen::ShowWindow(window)` — 0x6cf590, and BUILDING A WINDOW IS NOT
 * SHOWING IT.
 *
 * The engine's own opener stops at `Show` and hands its caller `window+0xF8`;
 * every one of its three callers then passes that to this, on the screen it is
 * a method of. Without it the window is built, asked all its questions and
 * drawn nowhere — which is exactly what the first run of this looked like: a
 * clean log, no crash, and nothing on the screen.
 *
 * THE SCREEN IS ASKED FOR, not worked out. Every call site of this has it as
 * `this` or out of an object it already holds, which reads as "there is no way
 * to get one" — and there is: `CBaseScreen`'s own "am I the active one" (slot
 * `+0x10`) compares itself against a function that takes nothing and answers
 * with the top of the interface stack. That function is the screen the player
 * is looking at, and it is a global read rather than a guess of ours.
 */
#define SHOW_ON_SCREEN_RVA 0x2cf590u
#define SHOW_ON_SCREEN_HEAD_LEN 6
static const BYTE SHOW_ON_SCREEN_HEAD[SHOW_ON_SCREEN_HEAD_LEN] = {
  0x83, 0xEC, 0x0C, 0x55, 0x8B, 0xE9
};

/**
 * `0x5ba730` — the top of the interface stack, which is the screen on screen.
 *
 * Its head is `mov eax,[<the stack>]`, and THE ADDRESS IN IT IS THE LOADER'S:
 * this executable does not always get its preferred base, so those four bytes
 * differ between the disassembly and the run. Only the opcode and what follows
 * the operand are ours to check.
 */
#define CURRENT_SCREEN_RVA 0x1ba730u
#define CURRENT_SCREEN_OPCODE 0xA1
#define CURRENT_SCREEN_AFTER_AT 5
static const BYTE CURRENT_SCREEN_AFTER[2] = { 0x39, 0x00 };

/** What the opener hands back, and what a screen is given. */
#define WINDOW_AS_SHOWN 0xF8u

/**
 * `CGUIWindow::Close` — 0x7421b0, `__fastcall(this)`, and it is hooked because
 * of a window that never came back.
 *
 * OK and Cancel each end in it, and the controller hears about both — Execute
 * for one, "may I be cancelled" for the other. But those are the two paths
 * through the BUTTONS. Closed any other way, the controller is asked nothing at
 * all, and ours went on believing its window was up: every cast after that said
 * "a count window of ours is already open" and drew nothing, for the rest of
 * the session. So the engine's own closing is what clears it, whichever way it
 * was reached.
 */
#define CLOSE_WINDOW_RVA 0x3421b0u
#define CLOSE_WINDOW_HEAD_LEN 6
static const BYTE CLOSE_WINDOW_HEAD[CLOSE_WINDOW_HEAD_LEN] = {
  0x83, 0xEC, 0x0C, 0x56, 0x8B, 0xF1
};

typedef void(__fastcall *CloseWindowFn)(void *window, void *edx);
static CloseWindowFn g_closeWindow = NULL;
/** The window we put up, so its closing can be told from any other's. */
static void *g_askWindow = NULL;

typedef void *(__cdecl *AllocateFn)(SIZE_T bytes);
typedef void *(__fastcall *WindowCtorFn)(void *self, void *edx, int one);
typedef int(__fastcall *WindowShowFn)(void *self, void *edx, void *controller);
typedef void *(__fastcall *CreaturePictureFn)(void *stack);
typedef void(__fastcall *ShowOnScreenFn)(void *screen, void *edx, void *window);
typedef void *(__cdecl *CurrentScreenFn)(void);

static AllocateFn g_allocate = NULL;
static WindowCtorFn g_windowCtor = NULL;
static WindowShowFn g_windowShow = NULL;
static CreaturePictureFn g_creaturePicture = NULL;
static ShowOnScreenFn g_showOnScreen = NULL;
static CurrentScreenFn g_currentScreen = NULL;

// --- a controller of ours --------------------------------------------------
//
// THE SHAPE IT HAS TO HAVE, and it is not only the vtable. Before the window
// calls a controller it asks whether the pointer still points, in the engine's
// own way: `[[self+4]+4]` is a displacement, the word at that displacement plus
// eight has to be positive, and the one four further along is the count Show
// raises and lowers. So a controller is a vtable, a descriptor whose second
// word is that displacement, and two words where the descriptor says.
//
// Ours is ONE static object with the count set out of reach of zero. It is
// never freed and never has to be: there is one count window at a time, the
// window is destroyed by the engine, and a controller that cannot reach zero
// cannot reach the engine's destroyer either — which is a function we have not
// measured and would be calling on an object it never made.

#define CONTROLLER_DISPLACEMENT 0x10u
#define CONTROLLER_SLOTS 16

/** Never lowered to zero by any number of windows. */
#define CONTROLLER_HELD 0x40000000

/* Bytes rather than a struct, on purpose: C says nothing about where it puts a
   member and the engine says exactly where these two are. Everything else the
   controller "has" is a static below, because there is one of it. */
#define CONTROLLER_ALIVE_AT (CONTROLLER_DISPLACEMENT + 8)
#define CONTROLLER_HELD_AT (CONTROLLER_DISPLACEMENT + 12)
#define CONTROLLER_BYTES (CONTROLLER_HELD_AT + 4)

static BYTE g_controller[CONTROLLER_BYTES];
static void *g_controllerVtable[CONTROLLER_SLOTS];
static const int g_controllerDescriptor[2] = { 0, (int)CONTROLLER_DISPLACEMENT };

/** What the window is being asked for, and what came back. */
static int g_askLowest = 0;
static int g_askHighest = 0;
static int g_askStart = 0;
/**
 * The creatures the two sides are about, and why only one of them is drawn.
 *
 * The window asks its controller for a creature ONCE, with side 0, and puts the
 * one picture it gets into both icons. That is right for a split — both halves
 * are the same creature — and wrong for a conversion, where the point is that
 * they differ. The target is carried here anyway: it is what a script means,
 * and drawing it is a matter of filling the second icon ourselves rather than
 * of the script saying more.
 */
static int g_askCreature = 0;
static int g_askBecomes = 0;
/** 0 while the window is open, 1 answered, -1 closed without an answer. */
static int g_askState = 0;
static int g_askAnswer = 0;
/** Set while a window of ours is up, so a second ask cannot steal the first. */
static int g_askOpen = 0;

static int *controller_word(DWORD at) { return (int *)(g_controller + at); }

// --- what the window asks it ------------------------------------------------
//
// The order the engine asks them in, measured on the first window that ever
// opened: the total, the lowest, the left floor, the start, the picture, then
// `Validate` for wherever the slider landed. Only `Execute` and the cancel say
// anything to the log now — the rest were traced while this was being made to
// work and the trace is in the history where it belongs.

/**
 * The picture drawn on that side.
 *
 * The window asks for side 0 only and puts the answer in BOTH pictures, which
 * is right for a split and is as right as this window gets for us: one creature
 * is what the player is counting. Nothing is a legal answer — the engine tests
 * for it and leaves the pictures empty.
 */
static void *__fastcall ctrl_stack(void *self, void *edx, int side) {
  (void)self; (void)edx;
  if (!g_askCreature || !g_creaturePicture) return NULL;
  /* A stack of ours, of which one field is ever read. Zeroed rather than left
     as it was, so a change of mind about that field reads a zero and not the
     creature of the window before. */
  static int stack[STACK_ENOUGH / 4];
  for (int i = 0; i < (int)(STACK_ENOUGH / 4); i++) stack[i] = 0;
  stack[STACK_CREATURE / 4] = g_askCreature;
  return g_creaturePicture(stack);
}

/** May it be shown. Ours always may; the numbers were settled before it opened. */
static int __fastcall ctrl_may_show(void *self, void *edx) {
  (void)self; (void)edx;
  return 1;
}

/** May the slider stand here. */
static int __fastcall ctrl_validate(void *self, void *edx, int n) {
  (void)self; (void)edx;
  return n >= g_askLowest && n <= g_askHighest;
}

/**
 * It stands here and OK was pressed — which is the whole answer.
 *
 * The OK button asks `Validate` first and closes the window straight after this
 * returns (both measured in the button's own code), so this runs once and the
 * window is gone by the time the script wakes up to collect the number.
 */
static void __fastcall ctrl_execute(void *self, void *edx, int n) {
  (void)self; (void)edx;
  g_askAnswer = n;
  g_askState = 1;
  g_askOpen = 0;
  log_num("H5EAskCount: the player chose ", n);
}

/** What the left side may not go below. The window keeps `total - this` as the
 *  highest the slider will reach, so nothing held back means the whole total. */
static int __fastcall ctrl_left_floor(void *self, void *edx) {
  (void)self; (void)edx;
  return 0;
}

/** The lowest, and where the slider starts. */
static int __fastcall ctrl_lowest(void *self, void *edx) {
  (void)self; (void)edx;
  return g_askLowest;
}

static int __fastcall ctrl_start(void *self, void *edx) {
  (void)self; (void)edx;
  return g_askStart;
}

/**
 * The total the two sides share — ours is the maximum, whole.
 *
 * NO ARGUMENT, and this is what the first run of this window cost. The call
 * site is `push ebp; call [eax+24h]`, which reads as "the side, please" and is
 * not: the `pop ebp` is at the other end of the block and the branch that skips
 * the block lands after it, so the push is a SAVED REGISTER. Declared with an
 * argument, this returned `ret 4` and ate that saved ebp; four bytes later the
 * function returned into whatever was next on the stack, which was the
 * controller we had passed to `Show`, and the processor ran our data as code.
 *
 * The engine's own slot says so in one byte: `0x883350` ends in a bare `ret`.
 * ARITY COMES FROM THE `ret` OF THE FUNCTION BEING REPLACED, never from the
 * shape of a call site — the same rule that cost four battles in
 * docs/ENGINE_INTERNALS.md, learned again here.
 */
static int __fastcall ctrl_total(void *self, void *edx) {
  (void)self; (void)edx;
  return g_askHighest;
}

/**
 * Cancel, and this is where we hear about it.
 *
 * The Cancel button asks this and closes the window only if the answer is yes —
 * so a controller that always says yes is asked exactly once, when the player
 * has cancelled. Ours may always be cancelled.
 */
static int __fastcall ctrl_may_cancel(void *self, void *edx) {
  (void)self; (void)edx;
  if (!g_askState) {
    g_askState = -1;
    log_line("H5EAskCount: the window was closed without an answer");
  }
  g_askOpen = 0;
  return 1;
}

/**
 * A slot we have not measured, and WHICH one.
 *
 * IT CANNOT RETURN SAFELY and says so: a virtual of this engine's takes its
 * arguments off the stack itself, and a stub that does not know how many there
 * are leaves the caller's stack wrong however it returns. So this is not a
 * safety net — it is a NAME for a crash that would otherwise happen at a wild
 * address, and the line it writes is the whole point of it.
 *
 * ONE STUB PER SLOT rather than one shared stub, because "something we never
 * measured" is not an answer: what has to come out of the run is the offset, so
 * the next thing to read is a known function rather than a search. Nine of them
 * are overwritten below with the slots that are measured; the rest exist to
 * name themselves.
 */
#define CONTROLLER_STUB(n) \
  static int __fastcall ctrl_stub_##n(void *self, void *edx) { \
    (void)self; (void)edx; \
    log_hex("H5EAskCount: the window asked an unmeasured slot +", (n) * 4); \
    return 0; \
  }
#define CONTROLLER_EVERY_SLOT(X) \
  X(0) X(1) X(2) X(3) X(4) X(5) X(6) X(7) \
  X(8) X(9) X(10) X(11) X(12) X(13) X(14) X(15)
CONTROLLER_EVERY_SLOT(CONTROLLER_STUB)

#define CONTROLLER_STUB_NAME(n) (void *)&ctrl_stub_##n,
static void *const g_controllerStubs[CONTROLLER_SLOTS] = {
  CONTROLLER_EVERY_SLOT(CONTROLLER_STUB_NAME)
};

static void build_controller(void) {
  for (int i = 0; i < CONTROLLER_SLOTS; i++) g_controllerVtable[i] = g_controllerStubs[i];
  g_controllerVtable[0x00 / 4] = (void *)&ctrl_stack;
  g_controllerVtable[0x0C / 4] = (void *)&ctrl_may_show;
  g_controllerVtable[0x10 / 4] = (void *)&ctrl_validate;
  g_controllerVtable[0x14 / 4] = (void *)&ctrl_execute;
  g_controllerVtable[0x18 / 4] = (void *)&ctrl_left_floor;
  g_controllerVtable[0x1C / 4] = (void *)&ctrl_lowest;
  g_controllerVtable[0x20 / 4] = (void *)&ctrl_start;
  g_controllerVtable[0x24 / 4] = (void *)&ctrl_total;
  g_controllerVtable[0x28 / 4] = (void *)&ctrl_may_cancel;

  *(void ***)(g_controller + 0) = g_controllerVtable;
  *(const int **)(g_controller + 4) = g_controllerDescriptor;
  *controller_word(CONTROLLER_ALIVE_AT) = 0;
  *controller_word(CONTROLLER_HELD_AT) = CONTROLLER_HELD;
}

// --- opening it -------------------------------------------------------------

/**
 * The screen's root widget, and why it is worth asking about.
 *
 * `ShowWindow`'s first act is to read it and leave without a word when it is
 * empty — so it is both the engine's own precondition and the one honest way to
 * say "this screen is not ready to be shown anything", before a window has been
 * built to be thrown away.
 */
#define SCREEN_ROOT 0xA0u

/** Every address this needs, checked against the bytes it was measured by. */
static int count_window_ready(void) {
  if (g_windowShow) return 1;
  g_allocate = (AllocateFn)code_at(ALLOCATE_RVA, ALLOCATE_HEAD, ALLOCATE_HEAD_LEN,
                                   "the engine's allocator");
  g_windowCtor = (WindowCtorFn)code_at(SPLIT_WINDOW_CTOR_RVA, SPLIT_WINDOW_CTOR_HEAD,
                                       SPLIT_WINDOW_CTOR_HEAD_LEN, "the count window");
  WindowShowFn show = (WindowShowFn)code_at(SPLIT_WINDOW_SHOW_RVA, SPLIT_WINDOW_SHOW_HEAD,
                                            SPLIT_WINDOW_SHOW_HEAD_LEN, "the count window's Show");
  g_showOnScreen = (ShowOnScreenFn)code_at(SHOW_ON_SCREEN_RVA, SHOW_ON_SCREEN_HEAD,
                                           SHOW_ON_SCREEN_HEAD_LEN, "a screen showing a window");
  /* Checked either side of the address the loader may have rewritten, which is
     the whole of what is ours to check in this one. */
  BYTE *top = (BYTE *)GetModuleHandleW(NULL) + CURRENT_SCREEN_RVA;
  if (top[0] == CURRENT_SCREEN_OPCODE
      && top[CURRENT_SCREEN_AFTER_AT] == CURRENT_SCREEN_AFTER[0]
      && top[CURRENT_SCREEN_AFTER_AT + 1] == CURRENT_SCREEN_AFTER[1]) {
    g_currentScreen = (CurrentScreenFn)top;
  } else {
    log_line("count window: the screen the player is looking at is not where it was measured");
  }
  if (!g_allocate || !g_windowCtor || !show || !g_showOnScreen || !g_currentScreen) return 0;
  /* The picture is not required: without it the window opens with an empty
     frame where the creature goes, which is what the engine draws when its own
     controller has no stack either. */
  g_creaturePicture = (CreaturePictureFn)code_at(CREATURE_PICTURE_RVA, CREATURE_PICTURE_HEAD,
                                                 CREATURE_PICTURE_HEAD_LEN,
                                                 "the creature a stack draws as");
  build_controller();
  g_windowShow = show;
  return 1;
}

/**
 * A window, built and shown the way the engine builds and shows one.
 *
 * The engine's own opener (0x7f8310) cannot be called: its first act is to make
 * a controller of its own out of six army-and-slot words, and a controller is
 * exactly what we are bringing. What is left of it after that is this — a new
 * window, held while Show runs, and let go of after.
 *
 * A window whose Show refuses is LEAKED rather than destroyed. Handing it to
 * the engine's destroyer is a call we have not measured on an object nothing of
 * the engine's made, and it happens once per refusal at most.
 */
static int open_count_window(void) {
  if (!count_window_ready()) return 0;

  // THE SCREEN FIRST, because a window built for a screen that will not take it
  // is a window that has to be thrown away, and we have no way to throw one
  // away. `ShowWindow` reads the root widget before it does anything and leaves
  // silently when there is none, so that is the question, asked here.
  //
  // AND THE TOP OF THE INTERFACE STACK IS A BASE, not the screen — 0x844 bytes
  // into it, as it happens. The class name read off that pointer is right,
  // which is what made this so slow to see: every field read at its documented
  // offset belonged to somebody else, and the window went nowhere without a
  // word. RTTI carries the distance, so `whole_object_of` is the whole fix.
  void *top = g_currentScreen();
  if (!top) {
    log_line("H5EAskCount: there is no screen on screen, so there is nowhere to put a window");
    return 0;
  }
  void *screen = whole_object_of(top);
  if (!readable((BYTE *)screen + SCREEN_ROOT, 4) || !*(DWORD *)((BYTE *)screen + SCREEN_ROOT)) {
    log_line("H5EAskCount: the screen is not ready to be shown anything yet");
    return 0;
  }
  const char *of = class_name_of(top);
  log_text("H5EAskCount: the window goes on ", of ? of : "a screen with no rtti");

  void *window = g_allocate(SPLIT_WINDOW_SIZE);
  if (!window) {
    log_line("H5EAskCount: no memory for the window");
    return 0;
  }
  window = g_windowCtor(window, NULL, 1);
  if (!window) {
    log_line("H5EAskCount: the window would not be built");
    return 0;
  }

  int *held = NULL;
  if (readable(window, WINDOW_COUNTED + 4)) {
    BYTE *counted = *(BYTE **)((BYTE *)window + WINDOW_COUNTED);
    if (readable(counted, 8)) {
      held = (int *)((BYTE *)window + *(int *)(counted + 4) + 0x18);
      if (readable(held, 4)) *held += 1; else held = NULL;
    }
  }

  // The engine's own `Show` answers in AL and leaves the rest of EAX as it was,
  // so the whole register is not the answer — the byte is.
  int shown = g_windowShow(window, NULL, g_controller) & 0xFF;
  if (held) *held -= 1;
  if (!shown) {
    log_line("H5EAskCount: the window refused to open");
    return 0;
  }

  // AND ONTO THE SCREEN, which is the step that makes it visible: `Show` builds
  // the window and loads its layout, and nothing of that is on screen until a
  // screen is holding it.
  g_askWindow = window;
  g_showOnScreen(screen, NULL, (BYTE *)window + WINDOW_AS_SHOWN);
  return 1;
}

// --- and the two functions a script sees ------------------------------------

/**
 * `H5EAskCount(creature, becomes, most)` — put the slider up, answer nothing.
 *
 * IT DOES NOT WAIT, and cannot: a registered function's results are counted the
 * moment it returns, so a number it does not have yet has nowhere to go. The
 * waiting is the script's, one `sleep` at a time, and `H5EAskedCount` is what
 * it wakes up to ask. The wrapper that hides that loop is Lua, not this.
 *
 * The two creatures are `CREATURE_…` numbers, the same ones the rest of the
 * script API deals in: what the player is counting, and what it turns into. A
 * zero draws no picture, which is what the engine itself does for an empty
 * slot. The slider runs from ONE — nought is the Cancel button, and the window
 * already has one.
 */
static void *__fastcall lua_ask_count(void *ctx) {
  int source = 0;
  int becomes = 0;
  int most = 0;
  if (!lua_arg_int(ctx, 1, &source) || !lua_arg_int(ctx, 3, &most) || most < 1) {
    log_line("H5EAskCount: it takes the creature, what it becomes, and how many there are");
    return NULL;
  }
  (void)lua_arg_int(ctx, 2, &becomes);
  if (source < 0) source = 0;
  if (becomes < 0) becomes = 0;
  /* Where the slider starts, and it is not a knob a script needs: the whole
     stack is what the player means most of the time, and the slider is right
     there for the rest. */
  int from = most;

  /* A second window while the first is up would answer the first script with
     the second player's number: there is one controller and one answer. Say so
     and leave the open window alone. */
  if (g_askOpen) {
    log_line("H5EAskCount: a count window of ours is already open");
    return NULL;
  }

  /* ONE AT LEAST. Zero is not a choice anybody makes on purpose here — it is
     the Cancel button, which the window already has. */
  g_askLowest = 1;
  g_askHighest = most;
  g_askStart = from;
  g_askCreature = source;
  g_askBecomes = becomes;
  g_askState = 0;
  g_askAnswer = 0;
  g_askOpen = 1;

  /* A CHOICE OF ONE IS NOT A CHOICE. With `most` at one the slider has a single
     position, and the engine's window has nothing to do: it closes itself,
     without asking the controller anything — which left ours believing it was
     still up and refusing every window after it. Answering straight away is
     both what the player would have pressed and the end of that case. */
  if (most <= g_askLowest) {
    g_askAnswer = g_askLowest;
    g_askState = 1;
    g_askOpen = 0;
    log_num("H5EAskCount: there is only one to choose, answering ", g_askLowest);
    return NULL;
  }

  log_num("H5EAskCount: up to ", most);
  log_num("             of creature ", source);
  log_num("             becoming ", becomes);

  if (!open_count_window()) {
    // Nothing to wait for: say so in the answer rather than leave a script
    // asleep for the rest of the map.
    g_askState = -1;
    g_askOpen = 0;
    return NULL;
  }
  return NULL;
}

/**
 * `H5EAskedCount()` — nothing while the window is up, the number once it is
 * answered, and -1 when it was closed without one.
 */
static void *__fastcall lua_asked_count(void *ctx) {
  if (!g_askState) return NULL;
  return (void *)(INT_PTR)lua_push_int(ctx, g_askState > 0 ? g_askAnswer : -1);
}

/**
 * Ours closing, whichever button or key did it.
 *
 * An answer already collected is left alone: Execute runs first and this comes
 * after it. What this catches is the case with no answer at all — the script is
 * waiting on a window that is gone, and -1 is what "closed without answering"
 * has always meant to it.
 */
static void __fastcall on_window_closed(void *window, void *edx) {
  if (g_askWindow && window == g_askWindow) {
    g_askWindow = NULL;
    g_askOpen = 0;
    if (!g_askState) {
      g_askState = -1;
      log_line("H5EAskCount: the window was closed without an answer");
    }
  }
  g_closeWindow(window, edx);
}

/** Offered whether or not any map asks — the same argument as every other
 *  function of ours, and the window costs nothing until one is opened. */
static void install_count_window(void) {
  add_map_function("H5EAskCount", (void *)&lua_ask_count);
  add_map_function("H5EAskedCount", (void *)&lua_asked_count);
  g_closeWindow = (CloseWindowFn)detour(CLOSE_WINDOW_RVA, CLOSE_WINDOW_HEAD, CLOSE_WINDOW_HEAD_LEN,
                                        (void *)&on_window_closed, "a window closing");
  if (!g_closeWindow) log_line("count window: a window of ours will not know when it is closed");
}
