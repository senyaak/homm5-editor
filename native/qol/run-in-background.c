// The game keeps running when it is not the window in front.
//
// A piece of the ONE translation unit — native/homm5-editor.c includes every
// piece in order, so everything included before this file is visible here and
// nothing after it is. Statics stay statics; nothing here is a module.

/** Which switch turns this file's logging on — see the bottom of core/log.c. */
#undef LOG_UNIT
#define LOG_UNIT qol_run_in_background

// ---------------------------------------------------------------------------
// WHAT THE GAME DOES. Its window procedure (0x4EBE40) answers WM_ACTIVATEAPP and
// WM_ACTIVATE by calling 0x4EC7B0, which writes the answer into two bytes —
// 0x10651D2, and 0x10651D1 as well while the game is not in exclusive
// fullscreen. Everything that cares reads them through two accessors of five
// instructions each:
//
//   0x4EB970   mov al,[0x10651D1] ; ret
//   0x4EB980   mov al,[0x10651D2] ; ret
//
// And the main loop (inside WinMain, from 0x4DC130) asks both every frame: it
// passes them to the tick at 0x5B9F60, and when the first says "not in front" it
// ends the frame with `push 28h; call edi` — Sleep(40), through the pointer to
// `Sleep` it loaded at 0x4DC126. Forty milliseconds a frame is the pause you see:
// the game does not stop dead, it is throttled to a crawl and its own tick is
// told it is in the background.
//
// WHAT THIS DOES. Makes both accessors answer 1 for ever. Not the loop's two
// call sites, which would have been narrower — the tick reads the same accessors
// again itself (0x5B293A and 0x5B2949), and so do the sound and the cursor, so a
// patch on the loop alone would leave "does it keep running" with three answers
// instead of one.
//
// WHY WE WANT IT. Two clients on one machine cannot both be in front, and a
// player waiting on the other one's turn watches a window that has stopped
// answering. It is also, on its own, what anybody with two monitors wants.
//
// WHAT IT COSTS. The game believes it is the active window whatever is actually
// in front of it, so its SOUND keeps playing when you tab away, and the frame is
// no longer throttled — an unfocused instance costs what a focused one costs.
// The window's own state is not touched: the two bytes still get the truth
// written into them, and everything that reads them directly — minimising and
// restoring in fullscreen (0x4EBB30), the window procedure itself — still sees
// it. Only the question "should I keep going" is answered yes.

/** `mov al,[the byte that says the window is in front]; ret`, twice over. */
#define WINDOW_ACTIVE_RVA 0xeb970u
static const BYTE WINDOW_ACTIVE_MARK[6] = { 0xA0, 0xD1, 0x51, 0x06, 0x01, 0xC3 };
#define WINDOW_FOCUSED_RVA 0xeb980u
static const BYTE WINDOW_FOCUSED_MARK[6] = { 0xA0, 0xD2, 0x51, 0x06, 0x01, 0xC3 };

/** `mov al,1; ret`, and the rest left as padding nobody reaches. */
static const BYTE ALWAYS_ACTIVE[6] = { 0xB0, 0x01, 0xC3, 0x90, 0x90, 0x90 };

static void install_run_in_background(void) {
  int done = overwrite_code(WINDOW_ACTIVE_RVA, WINDOW_ACTIVE_MARK, ALWAYS_ACTIVE,
                            sizeof ALWAYS_ACTIVE, "is the window in front");
  done += overwrite_code(WINDOW_FOCUSED_RVA, WINDOW_FOCUSED_MARK, ALWAYS_ACTIVE,
                         sizeof ALWAYS_ACTIVE, "does the window have the focus");
  if (done == 2) log_line("the game will keep running while another window is in front");
}
