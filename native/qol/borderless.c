// The game's own window, without its frame.
//
// A piece of the ONE translation unit — native/homm5-editor.c includes every
// piece in order, so everything included before this file is visible here and
// nothing after it is. Statics stay statics; nothing here is a module.

/** Which switch turns this file's logging on — see the bottom of core/log.c. */
#undef LOG_UNIT
#define LOG_UNIT qol_borderless

// ---------------------------------------------------------------------------
// Borderless — the game's own window, without its frame.
//
// The game asks USER32 for one window and never revisits its style, so the
// whole of the feature is answering that one call differently: take the frame
// off, put the window at the corner of the screen and make it the size of it.
//
// IN THE IMPORT TABLE, not in the code. `CreateWindowExA` is imported by name,
// beside `RegisterClassExA` and `DefWindowProcA` — the ordinary message loop —
// so the call can be met where the loader wrote its address. One pointer is
// replaced, no instruction is touched, and no address of the game's own is
// needed at all: this is the one hook here that a different build cannot break.
//
// WHAT IT CANNOT DO ALONE. Exclusive fullscreen belongs to Direct3D, not to the
// window: with `gfx_fullscreen = 1` the device takes the display and the frame
// is beside the point. So the other half of borderless is that variable, which
// is the editor's to write — the game keeps it in `profiles/*/user_a2.cfg`.

typedef HWND(WINAPI *CreateWindowExAFn)(DWORD, LPCSTR, LPCSTR, DWORD, int, int, int, int,
                                        HWND, HMENU, HINSTANCE, LPVOID);
typedef BOOL(WINAPI *SetWindowPosFn)(HWND, HWND, int, int, int, int, UINT);
typedef LONG(WINAPI *SetWindowLongAFn)(HWND, int, LONG);
typedef int(WINAPI *MetricFn)(int);

static CreateWindowExAFn g_createWindowExA = NULL;
static SetWindowPosFn g_setWindowPos = NULL;
static SetWindowLongAFn g_setWindowLongA = NULL;

/**
 * The window we took, so the two calls that could undo it know which it is.
 *
 * The game asks for its window with CW_USEDEFAULT and sizes it afterwards, once
 * the device exists — so creation is where the FRAME is decided and something
 * later decides the geometry. Both have to agree, or the window ends up without
 * a border at whatever size the engine had in mind.
 */
static HWND g_mainWindow = NULL;
static int g_screenW = 0;
static int g_screenH = 0;

/** The screen, asked for once and remembered. Zero if USER32 would not say. */
static void screen_size(void) {
  if (g_screenW && g_screenH) return;
  HMODULE user32 = GetModuleHandleW(L"user32.dll");
  MetricFn metric = user32 ? (MetricFn)GetProcAddress(user32, "GetSystemMetrics") : NULL;
  if (!metric) return;
  g_screenW = metric(SM_CXSCREEN);
  g_screenH = metric(SM_CYSCREEN);
}

/** What a framed window is made of, and what we take off it. */
#define WINDOW_FRAME (WS_CAPTION | WS_THICKFRAME | WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_SYSMENU)

/**
 * The slot in the import address table that holds `want`.
 *
 * The table is a list of pointers the loader filled in, so writing one here
 * changes no code. A name can also be an ordinal, in which case there is no
 * name to compare and the entry is skipped rather than guessed at.
 */
static void **find_import_slot(const char *want) {
  BYTE *base = (BYTE *)GetModuleHandleW(NULL);
  IMAGE_DOS_HEADER *dos = (IMAGE_DOS_HEADER *)base;
  IMAGE_NT_HEADERS *nt = (IMAGE_NT_HEADERS *)(base + dos->e_lfanew);
  IMAGE_DATA_DIRECTORY *dir = &nt->OptionalHeader.DataDirectory[IMAGE_DIRECTORY_ENTRY_IMPORT];
  if (!dir->VirtualAddress) return NULL;

  IMAGE_IMPORT_DESCRIPTOR *imp = (IMAGE_IMPORT_DESCRIPTOR *)(base + dir->VirtualAddress);
  for (; imp->Name; imp++) {
    // The names live in one array and the addresses in another, at the same
    // index. A descriptor with no separate name array names them in place.
    DWORD nameRva = imp->OriginalFirstThunk ? imp->OriginalFirstThunk : imp->FirstThunk;
    DWORD *names = (DWORD *)(base + nameRva);
    DWORD *slots = (DWORD *)(base + imp->FirstThunk);
    for (int i = 0; names[i]; i++) {
      if (names[i] & IMAGE_ORDINAL_FLAG32) continue;
      const char *name = (const char *)(base + names[i] + 2); // past the hint
      int j = 0;
      while (want[j] && name[j] == want[j]) j++;
      if (want[j] || name[j]) continue;
      return (void **)&slots[i];
    }
  }
  return NULL;
}

/**
 * How many windows still say what they were asked for.
 *
 * The game makes one window that matters and several that do not, and which is
 * which is a claim to CHECK rather than assume — so the first few are written
 * down with the style and size they asked for, whether or not we changed them.
 */
static int g_windowsLogged = 0;
static int g_borderlessDone = 0;

static HWND WINAPI create_window_hook(DWORD exStyle, LPCSTR cls, LPCSTR title, DWORD style,
                                      int x, int y, int w, int h, HWND parent, HMENU menu,
                                      HINSTANCE inst, LPVOID param) {
  // A class name can be an atom rather than a string — the low word of the
  // pointer, with nothing to read at it — which is worth a check, since this
  // runs for every window the process makes.
  const char *clsText = (ULONG_PTR)cls > 0xFFFF ? cls : "(atom)";

  // Top-level and framed is what the game's own window is. A child, a tooltip
  // or a message box is neither, and none of them should be moved to the corner
  // of the screen and made the size of it.
  int top = !parent && !(style & WS_CHILD);
  int framed = (style & WS_CAPTION) == WS_CAPTION;
  int take = g_qol[QOL_BORDERLESS] && top && framed && !g_borderlessDone;

  if (g_windowsLogged < 8) {
    g_windowsLogged++;
    log_text("window: class ", clsText);
    log_text("        title ", (ULONG_PTR)title > 0xFFFF ? title : "(none)");
    log_hex("        style ", style);
    log_num("        width ", w);
    log_num("        height ", h);
    log_num("        top-level ", top);
    log_num("        we take it ", take);
  }

  if (take) {
    // The screen is asked for here rather than at load time: USER32 is mapped
    // by then but its own initialisation may not have run, and this call is
    // already inside the game's message loop, where everything is up.
    screen_size();
    if (g_screenW > 0 && g_screenH > 0) {
      style = (style & ~(DWORD)WINDOW_FRAME) | WS_POPUP;
      exStyle &= ~(DWORD)(WS_EX_WINDOWEDGE | WS_EX_CLIENTEDGE | WS_EX_DLGMODALFRAME);
      x = 0;
      y = 0;
      w = g_screenW;
      h = g_screenH;
      g_borderlessDone = 1;
      log_num("borderless: the window is now this wide ", g_screenW);
      log_num("            and this tall ", g_screenH);
    } else {
      log_line("borderless: the screen size could not be asked for - leaving the window alone");
      take = 0;
    }
  }

  HWND made = g_createWindowExA(exStyle, cls, title, style, x, y, w, h, parent, menu, inst, param);
  if (take && made) g_mainWindow = made;
  return made;
}

/**
 * Every move the game makes on its own window, and ours holding.
 *
 * It sizes the window after the device exists, so without this the frame comes
 * off and the geometry goes back to whatever the engine had in mind — which is
 * a frameless window in the corner of the screen rather than a borderless one.
 *
 * ONLY OUR WINDOW. Every other window of the process is passed through
 * untouched: this hook sees them all, and the one thing worse than a border is
 * a dialog dragged to the corner and stretched over the screen.
 */
static int g_posLogged = 0;

typedef BOOL(WINAPI *WindowFn)(HWND);
static int g_broughtForward = 0;

/**
 * In front, once, when the game first places its window.
 *
 * A FRAMED window comes up in front because Windows activates it; a `WS_POPUP`
 * one at the corner of the screen does not, and the game — which never asked for
 * a popup — never says otherwise. So it starts full-screen-sized BEHIND whatever
 * was there, which looks like it failed to start.
 *
 * The moment is the game's first `SetWindowPos` on that window rather than its
 * creation: at creation there is nothing on screen to be in front of, and
 * `SetForegroundWindow` on a window that is not yet shown does nothing.
 *
 * TOPMOST and straight back out of it, which is the way to raise a window
 * without leaving it above everything for the rest of the session — the frame is
 * a preference, "always on top" is not. Then the foreground call for the
 * keyboard. Both through the ORIGINAL SetWindowPos, or this would meet itself.
 */
static void bring_to_front(HWND hwnd) {
  if (g_broughtForward || !hwnd) return;
  g_broughtForward = 1;
  const UINT keep = SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW;
  if (g_setWindowPos) {
    g_setWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, keep);
    g_setWindowPos(hwnd, HWND_NOTOPMOST, 0, 0, 0, 0, keep);
  }
  HMODULE user32 = GetModuleHandleW(L"user32.dll");
  WindowFn top = user32 ? (WindowFn)GetProcAddress(user32, "BringWindowToTop") : NULL;
  WindowFn fore = user32 ? (WindowFn)GetProcAddress(user32, "SetForegroundWindow") : NULL;
  if (top) top(hwnd);
  if (fore) fore(hwnd);
  log_line("borderless: the window was brought to the front");
}

static BOOL WINAPI set_window_pos_hook(HWND hwnd, HWND after, int x, int y, int cx, int cy, UINT flags) {
  int ours = g_qol[QOL_BORDERLESS] && hwnd && hwnd == g_mainWindow;
  if (ours && g_posLogged < 8) {
    g_posLogged++;
    log_num("setpos: x ", x);
    log_num("        y ", y);
    log_num("        cx ", cx);
    log_num("        cy ", cy);
    log_hex("        flags ", flags);
  }
  if (ours && g_screenW > 0 && g_screenH > 0) {
    x = 0;
    y = 0;
    cx = g_screenW;
    cy = g_screenH;
    flags &= ~(UINT)(SWP_NOMOVE | SWP_NOSIZE);
  }
  BOOL done = g_setWindowPos(hwnd, after, x, y, cx, cy, flags);
  // After the move, not before: the window is where it belongs by then, and
  // raising it is the last thing the first placement should do. Once only —
  // stealing the foreground every time the game touches its own window would
  // be a worse manner than the one this fixes.
  if (ours) bring_to_front(hwnd);
  return done;
}

/**
 * The style, if the game ever sets it again.
 *
 * Imported, so it is called somewhere; whether it is called on the window we
 * took is what the log answers. Written to hold rather than to watch, because a
 * frame that comes back halfway through a session is the same bug as one that
 * never came off.
 */
static int g_styleLogged = 0;

static LONG WINAPI set_window_long_hook(HWND hwnd, int index, LONG value) {
  if (g_qol[QOL_BORDERLESS] && hwnd && hwnd == g_mainWindow && index == GWL_STYLE) {
    if (g_styleLogged < 8) {
      g_styleLogged++;
      log_hex("setstyle: the game asked for ", (DWORD)value);
    }
    value = (LONG)(((DWORD)value & ~(DWORD)WINDOW_FRAME) | WS_POPUP);
  }
  return g_setWindowLongA(hwnd, index, value);
}

/**
 * Meet one imported function with one of ours.
 *
 * What is verified before writing is that the slot still holds what the loader
 * put there — `GetProcAddress` of the same name out of the same library — which
 * is at once a check that this is the right slot and a check that nobody got
 * here first. Returns the original, or null when it refused, so a caller can
 * install nothing rather than install half of something.
 *
 * The library is asked for by handle rather than loaded: everything hooked here
 * is a static import of the executable, so it is mapped before any of this
 * runs, and calling `LoadLibrary` from `DllMain` is a way to deadlock the
 * loader for no gain.
 */
static void *hook_import(const WCHAR *library, const char *name, void *ours) {
  void **slot = find_import_slot(name);
  if (!slot) {
    log_text("hook: not imported by name - skipping ", name);
    return NULL;
  }
  HMODULE lib = GetModuleHandleW(library);
  void *real = lib ? (void *)GetProcAddress(lib, name) : NULL;
  if (!real || *slot != real) {
    log_text("hook: the import slot is not the library's own - skipping ", name);
    return NULL;
  }
  DWORD old = 0;
  if (!VirtualProtect(slot, sizeof(void *), PAGE_READWRITE, &old)) {
    log_text("hook: could not make the import table writable for ", name);
    return NULL;
  }
  *slot = ours;
  VirtualProtect(slot, sizeof(void *), old, &old);
  log_text("hook: installed ", name);
  return real;
}

static void install_borderless(void) {
  // The frame is decided at creation, so this one is the feature; without it
  // there is nothing to hold and the other two are not worth installing.
  g_createWindowExA = (CreateWindowExAFn)hook_import(L"user32.dll", "CreateWindowExA", &create_window_hook);
  if (!g_createWindowExA) return;
  // These two are what keeps it: the game sizes its window after the device
  // exists, and it imports the call that would put a style back.
  g_setWindowPos = (SetWindowPosFn)hook_import(L"user32.dll", "SetWindowPos", &set_window_pos_hook);
  g_setWindowLongA = (SetWindowLongAFn)hook_import(L"user32.dll", "SetWindowLongA", &set_window_long_hook);
}

