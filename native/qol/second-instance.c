// Two copies of the game at once.
//
// A piece of the ONE translation unit — native/homm5-editor.c includes every
// piece in order, so everything included before this file is visible here and
// nothing after it is. Statics stay statics; nothing here is a module.

/** Which switch turns this file's logging on — see the bottom of core/log.c. */
#undef LOG_UNIT
#define LOG_UNIT qol_second_instance

// ---------------------------------------------------------------------------
// WHAT THE GAME DOES. `WinMain` (0x4DB860) opens with
//
//   CreateMutexA(NULL, TRUE, "NIVAL_H5")
//   if (GetLastError() == ERROR_ALREADY_EXISTS)
//       MessageBox("You can't run game and editor or two instances of any of
//                   then at the same time") and return
//
// The name carries no `Local\` or `Global\` prefix, so it is one name per logon
// session: a second copy of the folder, a second shortcut, a second anything
// hits the same mutex. The branch that decides is the `jne` at 0x4DB8AA, five
// bytes past the compare, and `EB` in place of `75` means "carry on regardless".
//
// WHY WE WANT IT. A multiplayer game needs a second player, and testing our own
// lobby against one machine means two clients on it. The other half of that is
// the game port — `net_game_port`, default 8888 (registered at 0x4CF2B0) — which
// two instances cannot share; it is an ordinary config variable, so the second
// install sets it in its own profile rather than in code. See
// h5e-lobby's docs/NETWORK_STATE.md.
//
// WHAT IT COSTS. The guard was also the thing that said "you left one running",
// and an install with this on will no longer say it. That is the whole price,
// and it is why this is a flag and not a patch applied to every build: leave it
// off in the copy you play, turn it on in the copy you test with.

/** The mutex guard's branch: taken when the name is already ours, then not. */
#define ONE_INSTANCE_RVA 0xdb8aau
static const BYTE ONE_INSTANCE_MARK[2] = { 0x75, 0x1D };
static const BYTE SECOND_INSTANCE_ALLOWED[2] = { 0xEB, 0x1D };

static void install_second_instance(void) {
  // Before WinMain, which is what makes this possible at all: the loader runs a
  // DllMain of an imported library before the executable's own entry point, so
  // the branch is ours to change while the code that reads it has not run yet.
  if (overwrite_code(ONE_INSTANCE_RVA, ONE_INSTANCE_MARK, SECOND_INSTANCE_ALLOWED,
                     sizeof ONE_INSTANCE_MARK, "the one-instance guard")) {
    log_line("a second instance of the game is allowed");
  }
}
