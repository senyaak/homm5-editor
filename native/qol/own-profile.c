// Profiles, settings and saves beside the mod.
//
// A piece of the ONE translation unit — native/homm5-editor.c includes every
// piece in order, so everything included before this file is visible here and
// nothing after it is. Statics stay statics; nothing here is a module.

/** Which switch turns this file's logging on — see the bottom of core/log.c. */
#undef LOG_UNIT
#define LOG_UNIT qol_own_profile

// ---------------------------------------------------------------------------
// A user folder of our own — profiles, settings and saves beside the mod
// instead of in Documents.
//
// WHAT THE GAME DOES. It asks Windows where Documents is and builds
//
//   <Documents>\My Games\<PRODUCT_NAME>\Profiles\<profile>\user_a2.cfg
//
// out of strings that sit together in .rdata. `SHGetFolderPathA` is a single
// named import from SHELL32, so the whole redirection is one pointer in the
// import table and none of the game's own path building is touched.
//
// WHY NOT REWRITE THE STRINGS, which is how the mod folder was moved: a string
// patched in place must FIT where the shipped one was, and every replacement in
// src/game/mod-paths.ts had to be shorter than what it replaced. An answer
// given at runtime has no such bargain.
//
// WHY AT ALL. Our copy of the executable already reads and writes its own mod
// folder, so a map or a mod of ours cannot disturb a plain install. Settings
// and SAVES were the exception — shared through Documents by every install on
// the machine, which is how an afternoon of testing came to rewrite the video
// settings of the game somebody actually plays.
//
// NOTHING IS SEEDED. The folder starts empty: no profile, no saves, no hall of
// fame. Copying the existing tree in would be one command and several ways to
// go wrong, and whoever wants their campaign here can copy it themselves —
// knowing, as we do not, which of their saves they mean.

/** Documents. The flags above the low byte ask for creation and for defaults. */
#define CSIDL_PERSONAL 0x0005
#define CSIDL_MASK 0xFF

typedef HRESULT(WINAPI *SHGetFolderPathAFn)(HWND, int, HANDLE, DWORD, LPSTR);

static SHGetFolderPathAFn g_shGetFolderPath = NULL;

/** `<install>\H5E\user`, in ANSI because that is what the call answers in. */
static char g_userDir[MAX_PATH];

/**
 * Where our user folder is, worked out from where WE are.
 *
 * The DLL sits in `bin/` beside the executable, so the install is one level up
 * and `H5E/` is the folder our build already calls its own. Derived rather than
 * configured: an install that was moved or copied keeps working, and there is
 * no second place for the answer to be wrong in.
 */
static void find_user_dir(HINSTANCE self) {
  char path[MAX_PATH];
  DWORD n = GetModuleFileNameA(self, path, MAX_PATH);
  if (!n || n >= MAX_PATH) return;
  // Off the file name, then off `bin\` — what is left ends with a separator.
  while (n && path[n - 1] != '\\' && path[n - 1] != '/') n--;
  if (n) n--;
  while (n && path[n - 1] != '\\' && path[n - 1] != '/') n--;
  if (!n) return;

  const char *tail = "H5E\\user";
  DWORD i = 0;
  while (tail[i] && n + i < MAX_PATH - 1) { path[n + i] = tail[i]; i++; }
  path[n + i] = 0;
  for (DWORD j = 0; j <= n + i; j++) g_userDir[j] = path[j];
}

/** Make every level of the path that is not there yet. Failures are ignored:
 *  a level that already exists fails the same way as one that cannot be made,
 *  and the call that follows is what actually needs the folder. */
static void make_dirs(const char *path) {
  char work[MAX_PATH];
  int i = 0;
  while (path[i] && i < MAX_PATH - 1) { work[i] = path[i]; i++; }
  work[i] = 0;
  // From past `C:\`, so the root itself is never handed to CreateDirectory.
  for (int j = 3; work[j]; j++) {
    if (work[j] != '\\' && work[j] != '/') continue;
    work[j] = 0;
    CreateDirectoryA(work, NULL);
    work[j] = '\\';
  }
  CreateDirectoryA(work, NULL);
}

/**
 * Where Documents is, as far as the game is concerned.
 *
 * ONLY Documents. Every other folder the game asks for is passed through — this
 * call serves several, and answering all of them with one path would put the
 * game's idea of AppData wherever its idea of Documents went. Which ones are
 * actually asked for is written down for the first few calls, because that is a
 * claim about this executable rather than about Windows.
 */
static int g_folderLogged = 0;

static HRESULT WINAPI sh_folder_hook(HWND owner, int csidl, HANDLE token, DWORD flags, LPSTR out) {
  int which = csidl & CSIDL_MASK;
  int ours = g_qol[QOL_OWN_PROFILE] && which == CSIDL_PERSONAL && out && g_userDir[0];
  if (g_folderLogged < 8) {
    g_folderLogged++;
    log_num("folder: the game asked for csidl ", which);
    log_num("        answered by us ", ours);
  }
  if (!ours) return g_shGetFolderPath(owner, csidl, token, flags, out);

  // The caller is about to build a path under this and open files in it, so it
  // has to exist — the real call creates it when asked, and so must ours.
  make_dirs(g_userDir);
  int i = 0;
  while (g_userDir[i] && i < MAX_PATH - 1) { out[i] = g_userDir[i]; i++; }
  out[i] = 0;
  return 0; // S_OK
}

static void install_own_profile(HINSTANCE self) {
  find_user_dir(self);
  if (!g_userDir[0]) {
    log_line("own profile: could not work out where we are - not redirecting");
    return;
  }
  g_shGetFolderPath = (SHGetFolderPathAFn)hook_import(L"shell32.dll", "SHGetFolderPathA", &sh_folder_hook);
  if (g_shGetFolderPath) log_text("own profile: our user folder is ", g_userDir);
}

