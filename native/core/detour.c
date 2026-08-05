// Detours and replaced vtable slots — the ways in.
//
// A piece of the ONE translation unit — native/homm5-editor.c includes every
// piece in order, so everything included before this file is visible here and
// nothing after it is. Statics stay statics; nothing here is a module.

// ---------------------------------------------------------------------------
// Installing it.

/**
 * Overwrite the head of a function with a jump to us, and keep a trampoline
 * that runs the bytes we displaced and jumps back.
 *
 * `headLen` is how many bytes the trampoline takes, and it must be a WHOLE
 * number of instructions — five is only the size of the jump. A detour that
 * splits an instruction corrupts the function rather than replacing it, and the
 * crash lands somewhere else entirely, so the caller counts the boundary out of
 * a disassembly and the bytes are compared before anything is written.
 *
 * Only relocatable heads: nothing displaced may be a `call`/`jmp rel32`, whose
 * meaning is its distance from where it sits.
 */
static void *detour_relocated(DWORD rva, const BYTE *head, const BYTE *skip, int headLen,
                              void *hook, const char *what);

/** A detour where every byte of the head is the compiler's, not the loader's. */
static void *detour(DWORD rva, const BYTE *head, int headLen, void *hook, const char *what) {
  return detour_relocated(rva, head, NULL, headLen, hook, what);
}

/**
 * As `detour`, but with the bytes that the LOADER may have rewritten skipped.
 *
 * An instruction naming an absolute address carries that address in its
 * operand, and relocation rewrites the operand wherever the image did not get
 * its preferred base. Those bytes are still copied to the trampoline — the copy
 * takes what is actually there — but comparing them against what the
 * disassembly said would refuse a function that is perfectly correct. `skip`
 * marks them: non-zero means "this byte is the loader's business, not ours".
 */
static void *detour_relocated(DWORD rva, const BYTE *head, const BYTE *skip, int headLen,
                              void *hook, const char *what) {
  // The RVA, added to wherever the loader actually put the image — the game's
  // preferred base is 0x400000 but nothing guarantees it got that one.
  BYTE *target = (BYTE *)GetModuleHandleW(NULL) + rva;
  for (int i = 0; i < headLen; i++) {
    if (skip && skip[i]) continue;
    if (target[i] != head[i]) {
      char msg[96];
      int n = 0;
      while (what[n] && n < 60) { msg[n] = what[n]; n++; }
      const char *tail = ": the bytes are not the ones we know - not hooking";
      int j = 0;
      while (tail[j]) msg[n + j] = tail[j], j++;
      msg[n + j] = 0;
      log_line(msg);
      return NULL;
    }
  }

  if (headLen < DETOUR_LEN || headLen > MAX_HEAD_LEN) {
    log_line("the head to displace is not a length we can take - not hooking");
    return NULL;
  }

  BYTE *tramp = (BYTE *)VirtualAlloc(NULL, 32, MEM_COMMIT | MEM_RESERVE, PAGE_EXECUTE_READWRITE);
  if (!tramp) { log_line("no memory for the trampoline"); return NULL; }
  for (int i = 0; i < headLen; i++) tramp[i] = target[i];
  tramp[headLen] = 0xE9;
  *(DWORD *)(tramp + headLen + 1) = (DWORD)(target + headLen) - (DWORD)(tramp + headLen + 5);

  DWORD old = 0;
  if (!VirtualProtect(target, headLen, PAGE_EXECUTE_READWRITE, &old)) {
    log_line("could not make the code writable");
    return NULL;
  }
  target[0] = 0xE9;
  *(DWORD *)(target + 1) = (DWORD)hook - ((DWORD)target + DETOUR_LEN);
  // What is left of the head is never reached — the jump leaves before it — but
  // a patched image that disassembles cleanly is worth five bytes of nothing.
  for (int i = DETOUR_LEN; i < headLen; i++) target[i] = 0x90;
  VirtualProtect(target, headLen, old, &old);
  FlushInstructionCache(GetCurrentProcess(), target, headLen);
  return tramp;
}

/**
 * Point the ONE dword that names `fn` at `to` instead — a virtual slot.
 *
 * No code is written: a vtable is a table of pointers, and replacing an entry
 * is how the engine itself would swap an implementation. It is only done when
 * the image holds exactly one such pointer and the function it names begins
 * with the bytes we expect; two candidates mean this is not the slot we mapped
 * and the safe thing is to leave the game alone.
 */
static int replace_vtable_entry(DWORD rva, const BYTE *head, int headLen, void *to, const char *what) {
  BYTE *base = (BYTE *)GetModuleHandleW(NULL);
  BYTE *target = base + rva;
  for (int i = 0; i < headLen; i++) {
    if (target[i] != head[i]) {
      log_line("the accessor bytes are not the ones we know - not replacing");
      return 0;
    }
  }

  IMAGE_DOS_HEADER *dos = (IMAGE_DOS_HEADER *)base;
  IMAGE_NT_HEADERS *nt = (IMAGE_NT_HEADERS *)(base + dos->e_lfanew);
  IMAGE_SECTION_HEADER *section = IMAGE_FIRST_SECTION(nt);
  void **found = NULL;
  int hits = 0;
  for (WORD s = 0; s < nt->FileHeader.NumberOfSections; s++, section++) {
    // Data only. A vtable lives in read-only data, and scanning code would
    // find an immediate that merely looks like this pointer.
    if (section->Characteristics & IMAGE_SCN_MEM_EXECUTE) continue;
    if (!(section->Characteristics & IMAGE_SCN_MEM_READ)) continue;
    BYTE *from = base + section->VirtualAddress;
    DWORD size = section->Misc.VirtualSize;
    for (DWORD off = 0; off + 4 <= size; off += 4) {
      void **slot = (void **)(from + off);
      if (*slot == (void *)target) { found = slot; hits++; }
    }
  }
  if (hits != 1) {
    log_num("the accessor is named by this many pointers, expected 1: ", hits);
    return 0;
  }

  DWORD old = 0;
  if (!VirtualProtect(found, sizeof(void *), PAGE_READWRITE, &old)) {
    log_line("could not make the vtable writable");
    return 0;
  }
  *found = to;
  VirtualProtect(found, sizeof(void *), old, &old);
  log_line(what);
  return 1;
}

/**
 * Overwrite code in place — no jump, no trampoline, nothing called.
 *
 * The smallest way in there is, and the only one for a change that is a DELETION:
 * an instruction the compiler emitted and the game would be better without. A
 * detour cannot express that — it would have to jump out, do nothing and jump
 * back — and a vtable slot is the wrong shape entirely, since what is being
 * changed sits in the middle of a function rather than at its front.
 *
 * The bytes that must be there are given in full, and `after` is the same length:
 * so a build this was not measured on is refused rather than mangled, and what
 * the patch DOES can be read here as one line against another.
 */
static int overwrite_code(DWORD rva, const BYTE *before, const BYTE *after, int len,
                          const char *what) {
  BYTE *target = (BYTE *)GetModuleHandleW(NULL) + rva;
  for (int i = 0; i < len; i++) {
    if (target[i] == before[i]) continue;
    log_text("not the bytes we know, leaving it alone: ", what);
    return 0;
  }

  DWORD old = 0;
  if (!VirtualProtect(target, len, PAGE_EXECUTE_READWRITE, &old)) {
    log_text("could not make the code writable: ", what);
    return 0;
  }
  for (int i = 0; i < len; i++) target[i] = after[i];
  VirtualProtect(target, len, old, &old);
  FlushInstructionCache(GetCurrentProcess(), target, len);
  return 1;
}

typedef int(__thiscall *EnergyGetterFn)(void *player);
typedef void(__thiscall *RefillFn)(void *player);

