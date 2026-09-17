// A crash that names itself.
//
// A piece of the ONE translation unit — native/homm5-editor.c includes every
// piece in order, so everything included before this file is visible here and
// nothing after it is. Statics stay statics; nothing here is a module.

/** Which switch turns this file's logging on — see the bottom of core/log.c. */
#undef LOG_UNIT
#define LOG_UNIT core_faults

// ---------------------------------------------------------------------------
// WHY THIS EXISTS. A fault inside the game is reported by Windows as a module
// and an offset, and that is all: `homm5-editor.dll +0x1f9dc` says which of our
// bytes the processor was on and nothing about how it got there. Working back
// from that costs a launch each time — and every launch is a person's evening.
//
// A vectored handler is told about the fault BEFORE anything unwinds, with the
// registers and the stack still standing. So one launch answers where it was,
// what it was holding, and — from the return addresses still on the stack —
// who called.
//
// IT CHANGES NOTHING. `EXCEPTION_CONTINUE_SEARCH` hands the fault straight on:
// the game crashes exactly as it would have, and we have written a page about
// it first. Every exception is reported, the engine's own C++ throws included
// — see on_fault for why the filter that used to be here went.

#define FAULTS_REPORTED 500
static int g_faultsLeft = FAULTS_REPORTED;

/** Ourselves, so an address in the log can be turned back into an offset. */
static HINSTANCE g_ourModule = NULL;

/**
 * WHICH MODULE an address is in, by name.
 *
 * A fault outside the game and outside us used to print a bare number: the log
 * gave `0x6e396689` and the two bases it knew, neither of them containing it,
 * so the report answered "somewhere else" and the next step was another
 * launch. Windows already knows which module a code address belongs to, so the
 * line names the file and the offset inside it, and a fault in a driver, in
 * granny2 or in the runtime says so on its own.
 */
static void log_module_of(DWORD address) {
  HMODULE mod = NULL;
  if (!GetModuleHandleExA(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS
                            | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                          (LPCSTR)(INT_PTR)address, &mod)
      || !mod) {
    log_line("       and that is in NO loaded module - the heap, or one already gone");
    return;
  }
  char path[MAX_PATH];
  if (GetModuleFileNameA(mod, path, sizeof(path))) {
    const char *name = path;
    for (const char *p = path; *p; p++) {
      if (*p == '\\' || *p == '/') name = p + 1;
    }
    log_text("       inside ", name);
  }
  log_hex("       at its offset         ", address - (DWORD)(INT_PTR)mod);
}

/** Where the game and we are, so an address in the log can be placed. */
static void log_where_modules_are(void) {
  log_hex("       the game is loaded at ", (DWORD)(INT_PTR)GetModuleHandleW(NULL));
  log_hex("       and we are at         ", (DWORD)(INT_PTR)g_ourModule);
}

/**
 * The stack as return addresses: whatever on it points INTO code.
 *
 * Not a real unwind — a frame pointer chain needs frames, and -Os does not keep
 * them. This is the cheap version that answers the question actually being
 * asked ("who called into us"): every word of the top of the stack that looks
 * like an address inside a loaded module is printed, and the first few of those
 * are the callers, in order.
 */
#define STACK_WORDS_LOGGED 32

static void log_stack_words(const BYTE *esp) {
  for (int i = 0; i < STACK_WORDS_LOGGED; i++) {
    const DWORD *at = (const DWORD *)(esp + i * 4);
    if (!readable(at, 4)) return;
    DWORD word = *at;
    if (!points_at_code((void *)(INT_PTR)word)) continue;
    log_hex("       stack holds code address ", word);
  }
}

/**
 * And the same words RAW, filtered by nothing.
 *
 * The line above answers "who called in" and is silent when the answer is not
 * there — which is itself a reading, and one that took a crash to notice: a
 * jump into the heap leaves no return address on the stack at all, so a report
 * made only of code addresses printed nothing and looked like a report that had
 * failed. Words are cheap and a launch is not ([[logs-must-not-be-rationed]]).
 */
static void log_stack_raw(const BYTE *esp) {
  for (int i = 0; i < STACK_WORDS_LOGGED; i++) {
    const DWORD *at = (const DWORD *)(esp + i * 4);
    if (!readable(at, 4)) return;
    log_hex("       stack word ", *at);
  }
}

/**
 * HOW MUCH ROOM WAS LEFT. A 32-bit game that is not large-address-aware has
 * two gigabytes of address space, and an allocation that finds none left
 * returns NULL into code that never checks — which then faults somewhere
 * downstream and looks like a bug in whatever it was doing. The siege of a
 * copied town (2026-09-17) faulted twice in two different places, both of
 * them right after a malloc: the question was never "what is wrong with the
 * grid" but "was there memory for it". So a fault reports the address space
 * and the physical memory still free, in megabytes.
 */
static void log_memory_left(void) {
  MEMORYSTATUSEX m;
  m.dwLength = sizeof m;
  if (!GlobalMemoryStatusEx(&m)) return;
  log_num("       address space free, MB   ", (long)(m.ullAvailVirtual >> 20));
  log_num("       address space total, MB  ", (long)(m.ullTotalVirtual >> 20));
  log_num("       physical memory free, MB ", (long)(m.ullAvailPhys >> 20));
  log_num("       memory in use, %         ", (long)m.dwMemoryLoad);
}

static void report(EXCEPTION_POINTERS *info, const char *what) {
  CONTEXT *c = info->ContextRecord;
  log_line(what);
  log_hex("       exception code        ", info->ExceptionRecord->ExceptionCode);
  log_hex("       at code address       ", (DWORD)(INT_PTR)info->ExceptionRecord->ExceptionAddress);
  log_module_of((DWORD)(INT_PTR)info->ExceptionRecord->ExceptionAddress);
  log_hex("       eip ", c->Eip);
  log_hex("       esp ", c->Esp);
  log_hex("       ebp ", c->Ebp);
  log_hex("       eax ", c->Eax);
  log_hex("       ecx ", c->Ecx);
  log_hex("       edx ", c->Edx);
  log_hex("       esi ", c->Esi);
  log_hex("       edi ", c->Edi);
  log_where_modules_are();
  log_memory_left();
  log_stack_words((const BYTE *)(INT_PTR)c->Esp);
  log_stack_raw((const BYTE *)(INT_PTR)c->Esp);
}

static LONG CALLBACK on_fault(EXCEPTION_POINTERS *info) {
  if (!info || !info->ExceptionRecord || !info->ContextRecord) return EXCEPTION_CONTINUE_SEARCH;
  DWORD code = info->ExceptionRecord->ExceptionCode;
  // EVERY exception, whatever its kind — the C++ throws the engine makes in
  // normal play included. Three sieges of a copied town (2026-09-17) ended
  // with a log that simply stopped, because only access violations were
  // reported and whatever killed the process was not one; a stack overflow
  // reaches no unhandled filter at all (there is no stack left to run it on).
  // A launch is the expensive thing, a page of text is not: everything is
  // written, and the reading is done in the file. The one cap is against a
  // runaway — a throw in a loop would otherwise fill the disk.
  // OutputDebugString arrives as an exception too (DBG_PRINTEXCEPTION_C and
  // its wide twin): the engine prints a few at start-up, and a full page for
  // each ate the three reports a run used to have before the map even loaded.
  // One line, and not counted.
  if (code == 0x40010006 || code == 0x4001000A) {
    log_hex("debug print from ", (DWORD)(INT_PTR)info->ExceptionRecord->ExceptionAddress);
    return EXCEPTION_CONTINUE_SEARCH;
  }
  if (g_faultsLeft <= 0) return EXCEPTION_CONTINUE_SEARCH;
  g_faultsLeft--;
  if (g_faultsLeft == 0) log_line("crash: that was the last exception reported this run");
  report(info, code == EXCEPTION_ACCESS_VIOLATION ? "crash: an access violation"
    : code == EXCEPTION_STACK_OVERFLOW ? "crash: a stack overflow"
    : code == 0xE06D7363 ? "exception: a C++ throw"
    : code == EXCEPTION_BREAKPOINT ? "exception: a breakpoint" : "exception: another kind");
  return EXCEPTION_CONTINUE_SEARCH;
}

/**
 * THE DEATH THAT IS NOT A FAULT. Two launches of a siege (2026-09-17) ended
 * with a log that simply stopped: no access violation, so the handler above
 * had nothing to say, and the process was gone. A C++ exception nobody
 * catches — `bad_alloc` out of a full address space is the one to expect —
 * reaches the UNHANDLED filter and nothing else, and is not noise there:
 * whatever gets this far is the end of the process. The same page, with the
 * code that says which kind (0xE06D7363 is a C++ throw).
 */
static LPTOP_LEVEL_EXCEPTION_FILTER g_previousUnhandled = NULL;

static LONG WINAPI on_unhandled(EXCEPTION_POINTERS *info) {
  if (info && info->ExceptionRecord && info->ContextRecord) report(info, "crash: an unhandled exception");
  return g_previousUnhandled ? g_previousUnhandled(info) : EXCEPTION_CONTINUE_SEARCH;
}

static void install_fault_report(HINSTANCE self) {
  g_ourModule = self;
  AddVectoredExceptionHandler(1, &on_fault);
  g_previousUnhandled = SetUnhandledExceptionFilter(&on_unhandled);
}
