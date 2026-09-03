// The editor's own extension, loaded into the game.
//
// WHAT IT IS FOR. An artifact record carries six hero stats and nothing else.
// Everything a shipped artifact does beyond that is compiled into the
// executable against a specific id, so a new id gets none of it — see
// docs/ENGINE_INTERNALS.md. This adds our own terms to the engine's own
// arithmetic: it calls the original calculation, appends what our config says,
// and returns the sum. Nothing shipped changes behaviour.
//
// HOW IT GETS LOADED. Not by taking another library's name: `H5_Game_H5E.exe`
// is our copy already, and it names this file in its import table. So no file
// of the game's is touched, and turning the mod off is what it always was —
// launch the game's own executable instead.
//
// WHAT IT HOOKS, for now. `CNecromancy::RaisePercent` — one function, called
// once, that sums base + skill + perk + amplifiers + grail + pendant + set. Its
// last term is "count worn pieces of set 5, if at least 4 add a number from
// data"; ours is the same shape with our set and our number. The dark energy
// ceiling is the same again, one object up. And the first aid tent, which is
// where a SPECIALIZATION of ours enters — the same bargain one rung down: an
// enum value the executable has never heard of, and a term added where the
// engine sums its own.
//
// WHAT ASKS FOR A TERM. Three subjects, one shape: an artifact (or a set of
// them) answered by `CountEquipped`, a specialization answered by
// `HasSpecialization`, and a SKILL answered by the hero's `GetSkillMastery`.
// Each is a value the executable was never built with, and each is asked about
// through a question it already knows how to answer — so adding a subject costs
// a config row and a virtual call, while adding a SUM still costs a detour.
//
// ONE ADDRESS, AND ONLY ONE. The hero arrives as `this`, and the engine asks
// how many pieces of a set are worn through the hero's OWN vtable (+0x328), so
// that call needs no address at all — we make it the way the engine makes it,
// two instructions above where we cut in. The single address we do need is
// verified against the bytes we expect before anything is written.
//
// NO C RUNTIME. Only kernel32: this is injected into a 2007 executable, and a
// runtime that has to initialise is one more thing that can fail in a process
// that is not ours. Parsing and formatting are done by hand below; there is not
// much of either.

#include <windows.h>

// ---------------------------------------------------------------------------
// ONE translation unit, in pieces.
//
// Each include below is a WHOLE .c file, spliced in place: the compiler still
// sees a single file, in exactly this order, so every static helper and every
// global is shared without a header and invisible outside the DLL. A file sees
// what was included before it and nothing after — which is why the order below
// is not alphabetical: it is the order of need. The unusual spelling
// (#include of .c) is deliberate; see docs/ENGINE_INTERNALS.md.

#include "core/landmarks.c"
#include "combat/tent-worth.c"
#include "combat/dark-energy-pool.c"
#include "lua/registered-shape.c"
#include "core/config-rows.c"
#include "core/text.c"
#include "core/log.c"
#include "core/config-read.c"
#include "qol/config.c"
#include "combat/term.c"
#include "core/detour.c"
#include "combat/dark-energy-install.c"
#include "lua/registry.c"
#include "lua/battle.c"
#include "combat/tent-term.c"
#include "combat/tent-charges.c"
#include "combat/tent-health.c"
#include "combat/tent-mana.c"
// A spell is four files, in the order each needs the one before it: the document
// first, because everything else reads it; then the cast being watched, which is
// where the question about a stack's abilities is written; then the switches the
// executable was compiled against; and last what a cast of OURS does, which uses
// all three. See combat/spell-cast.c for what each is for.
#include "combat/spell-record.c"
#include "combat/spell-cast.c"
#include "combat/spell-switches.c"
#include "combat/spell-resolve.c"
#include "qol/borderless.c"
#include "qol/own-profile.c"
#include "qol/quick-split.c"
#include "core/call.c"
#include "core/faults.c"
#include "lua/values.c"
#include "lua/hero-specialization.c"
#include "lua/hero-spells.c"
#include "lua/adv-cast.c"
#include "ui/count-window.c"
#include "qol/quick-split-gestures.c"
#include "qol/stack-plates.c"
#include "qol/combat-ai.c"
#include "qol/fix-encourage.c"
#include "qol/fix-barbarian-learning.c"
#include "qol/fix-snare-crash.c"
#include "qol/fix-payback.c"
#include "qol/fix-dragon-form.c"
#include "qol/fix-empowered-armageddon.c"
#include "qol/fix-mass-spell-element.c"
#include "qol/fix-book-of-power.c"
#include "qol/fix-master-of-fire.c"
#include "qol/fix-imbue-ballista.c"
#include "qol/second-instance.c"
#include "qol/run-in-background.c"
#include "qol/pandora-box.c"
#include "qol/pandora-notify.c"
#include "net/ubi-log.c"
#include "net/ubi-module-probe.c"
#include "net/ubi-friends-probe.c"
#include "net/ubi-room-probe.c"
// The way out before the thing that decides to use it: agent.c calls into the
// relay, and this is one file compiled top to bottom.
#include "net/relay.c"
#include "net/agent.c"
// The other half of multiplayer, and a stranger to the one above it: agent.c
// carries the peers, lobby.c carries the u-lobby. It is here rather than beside
// relay.c because it borrows that file's URL reader and WinHTTP entry points —
// plumbing that belongs to neither feature — and nothing else.
#include "net/lobby.c"
// Last, and a stranger to everything above it: an instrument rather than a
// feature, off unless its own file is there, and it borrows nothing but the
// core — the log, the text helpers and the detour.
#include "rmg/oracle.c"
// And its neighbour, for the same reason and under the same switch file: the
// minimap is drawn at the end of a run, so what it does is only measurable in
// the same instrumented launch.
#include "rmg/minimap-probe.c"
// And what ORDERS the runs those two watch. After them because it sets the
// oracle's seed for each order in turn, which is a global of the oracle's.
#include "rmg/cli.c"

/**
 * Which switch turns this file's logging on — see the bottom of core/log.c.
 *
 * AFTER the includes, not with the others at the top: every file above sets
 * `LOG_UNIT` to its own name as it is spliced in, so a definition before them
 * would be overwritten forty-five times and what follows would log under
 * whichever file happened to be last in the list.
 *
 * What logs here is the roll-call below — which hooks went in and which did
 * not. It is the answer to "did the mod load at all", so a build that says
 * nothing else should still say this: `--log homm5-editor` is on by default.
 */
#undef LOG_UNIT
#define LOG_UNIT homm5_editor

BOOL WINAPI DllMain(HINSTANCE self, DWORD reason, LPVOID reserved) {
  (void)reserved;
  if (reason != DLL_PROCESS_ATTACH) return TRUE;
  DisableThreadLibraryCalls(self);
  find_our_dir(self);
  // Before the first line: which file this run writes to, and room for it.
  start_this_run_log();
  log_line("--- homm5-editor extension loaded");
  // Before anything of ours runs: a fault inside the game is otherwise a module
  // and an offset in the Windows event log, and working back from that costs a
  // launch each time. This changes nothing about the crash — it writes down the
  // registers and the return addresses first.
  install_fault_report(self);
  // The MAP EDITOR is a different executable, and every hook below this line
  // is built against the game's image — bytes at addresses the editor uses for
  // other things. The one instrument that knows both executables is the RMG
  // oracle (native/rmg/oracle.c): the editor's generator screen has a seed
  // field, which makes it the better oracle for the port, and that is the whole
  // reason this DLL is ever loaded into it. So: the oracle, and nothing else.
  if (rmg_host_is_editor()) {
    log_line("--- host is the map editor: the rmg oracle applies, nothing else does");
    load_rmg_config();
    // BEFORE the oracle goes in, and it can turn the oracle on by itself: a
    // batch launched from the command line exists to be measured, so `--rmg`
    // asks for the instrument as well as the runs. The other way round — a
    // batch that ran with no readings because a file was missing — is a wasted
    // launch, and the launch is the expensive part.
    if (rmg_cli_take_orders()) g_rmgWanted = 1;
    if (g_rmgWanted) log_line(install_rmg_oracle() ? "rmg oracle installed" : "rmg oracle NOT installed");
    // A second instrument under the same file, asked for by its own word: the
    // minimap is built after the run the oracle watches, so it needs its own
    // hooks and not a flag on the oracle's.
    if (g_rmgMinimap)
      log_line(install_minimap_probe() ? "minimap probe installed" : "minimap probe NOT installed");
    if (g_rmgCliWanted)
      log_line(install_rmg_cli() ? "rmg orders will run" : "rmg orders will NOT run");
    return TRUE;
  }
  // Before the config, because what this mirrors starts talking the moment the
  // game does: the engine's own log, in our file. Only in a build that asked for
  // it — `--log net/ubi-log` — and it says so when it goes in.
  if (install_ubi_log()) log_line("the engine's own log is mirrored here");
  // A probe, and only in a build that asks for it — `--log net/ubi-module-probe`.
  // It watches the three points a module reply has to pass, because reading them
  // has been wrong twice and each wrong reading costs a launch.
  if (install_module_probe()) log_line("the module reply path is being watched");
  // And another — `--log net/ubi-friends-probe`. A friend the server says is online
  // is drawn as offline, and the two things that could mean have different fixes.
  if (install_friends_probe()) log_line("the friends list is being watched");
  // And a third — `--log net/ubi-room-probe`. A game in the list that cannot be
  // joined is either a flag we sent or a row nobody can select, and reading says both.
  if (install_room_probe()) log_line("the games list is being watched");
  load_config();
  if (g_rowCount || g_skillRowCount) install_hooks();
  // Independent of the config: the functions are ours to offer whether or not
  // any artifact asks for a bonus, and a script that calls one is a different
  // user from an artifact that carries one.
  //
  // Rows first, then the copy: what a feature further down the file adds to the
  // table has to be in it before the engine is handed the table.
  install_count_window();
  install_hero_specialization();
  // BEFORE the table is copied, not after: this adds a row of its own
  // (H5EAnswer, which is how a script's verdict comes back), and a row added
  // after the copy is a function the game's Lua has never heard of. The map
  // said so in as many words — "Value was NIL when getting global with name
  // 'H5EAnswer'".
  install_adv_cast();
  // And for the same reason, one feature over: a box asks to have its gain
  // announced by calling a function of ours, and the ask has to be in the table
  // before the table is handed over. Its hooks go in far below, with the rest
  // of the quality-of-life switches; only the two rows belong up here.
  //
  // UNCONDITIONALLY, and that is not laziness. `load_qol` runs fifty lines
  // BELOW this, so a `g_qol[QOL_PANDORA_BOX]` here reads a flag nobody has
  // filled in yet — which is how the same "Value was NIL" came back a second
  // time after the ordering was supposedly fixed. Two rows cost nothing; with
  // the feature switched off its hooks are absent and the ask sets a flag that
  // nothing ever reads.
  add_pandora_map_functions();
  // And the box's other half, for the same reason and in the same place: what a
  // hero may and may not be taught is the engine's to answer, and the box asks
  // it as a row the map calls. Unconditional like the two above — `load_qol` has
  // not run yet, so a flag read here reads nothing (native/lua/hero-spells.c).
  add_hero_spell_map_functions();
  install_lua_functions();
  // The same argument, one context over — and the one thing here that a battle
  // has to answer for itself, so it says what it saw whether or not anything
  // asked. See "Saying something to a battle's script" above.
  if (install_combat_scripts()) log_line("battles will be spoken to");
  install_energy_getter();
  if (g_specRowCount) install_specialization_hooks();
  if (rows_for(STAT_TENT_CHARGES)) {
    // Both halves, or neither: the constructor notes the tent down and the
    // amount hook is where the note is redeemed.
    install_tent_term();
    if (install_machine_charges()) log_line("first aid tent charges hook installed");
  }
  // The healing, the cleanse and the ultimate's tent all share the charges'
  // hook — it is the same function, asked more questions — and the machine's own
  // hit points are decided elsewhere.
  if (rows_for(STAT_TENT_HEALING) || rows_for(STAT_TENT_CLEANSE) || rows_for(STAT_TENT_MANA)) {
    install_tent_term();
  }
  // Not only for the row that spends it: mana changing hands is an EVENT a
  // script can ask for (`H5E_HERO_MANA_CHANGED`), and a trigger nobody has
  // registered for costs one comparison in the fired path. Hooked always, and
  // the log says so once.
  if (install_caster_mana()) log_line("combat caster mana hook installed");
  // What a battle actually casts, by id, and what a cast of ours then DOES.
  // Unconditional, like the battle scripts and for the same reason: a log that
  // has to be switched on says nothing on the run that mattered.
  // The accessors FIRST: everything under them reads a spell's document through
  // these two, and the guard below patches the getter's own head — after which
  // it would no longer recognise it.
  install_spell_record();
  install_cast_command_log();
  install_cast_gate_log();
  install_gate_refusal_log();
  install_spell_record_guard();
  install_spell_damage_filter();
  install_spell_worth_bonus();
  install_spell_power();
  install_spell_text_probe();
  install_area_shape();
  install_damaging_spell();
  // LAST of the spell hooks, because it is the one that takes the cast: the
  // tiles an area spell covers and the worth of a damage spell have to be ours
  // before the resolver walks a field with them.
  install_our_resolver();
  if (rows_for(STAT_TENT_HEALTH) && install_machine_health()) {
    log_line("first aid tent health hook installed");
  }
  // A player's own settings, read from their own file. The window has to be met
  // before the game makes it, and the game makes it from its entry point — which
  // is why this happens here and not on the first frame.
  load_qol();
  // AFTER the flags are read, and gated whole: with it off not a byte moves.
  if (g_qol[QOL_MASS_SPELL_ELEMENT_FIX]) install_whole_field_element();
  if (g_qol[QOL_BORDERLESS]) install_borderless();
  // BEFORE WinMain, which is the whole reason it can be done at all: the guard
  // it takes off is the first thing WinMain does, and a DllMain of an imported
  // library runs before the executable's entry point.
  if (g_qol[QOL_SECOND_INSTANCE]) install_second_instance();
  if (g_qol[QOL_RUN_IN_BACKGROUND]) install_run_in_background();
  // Before the game asks, which it does early: the profile it loads decides
  // what the main menu already shows.
  if (g_qol[QOL_OWN_PROFILE]) install_own_profile(self);
  // Code of the game's own, so unlike the two above it can only be written once
  // the image is there to write on — which at DLL_PROCESS_ATTACH it is.
  if (g_qol[QOL_QUICK_SPLIT]) install_quick_split();
  if (g_qol[QOL_STACK_HEALTH] || g_qol[QOL_STACK_LOSSES]) install_stack_plates();
  // Code of the game's own again, and the whole feature is the writing of it:
  // with the flag clear not a byte of the image is touched, which is what makes
  // this switch the game's own behaviour rather than a mode of ours.
  if (g_qol[QOL_COMBAT_AI_FIX]) install_combat_ai_fix();
  // Rules the shipped game gets wrong, each a byte of its own — see
  // docs/engineInternals/RULES_FIXES.md.
  if (g_qol[QOL_ENCOURAGE_FIX]) install_encourage_fix();
  if (g_qol[QOL_BARBARIAN_LEARNING_FIX]) install_barbarian_learning_fix();
  if (g_qol[QOL_SNARE_CRASH_FIX]) install_snare_fix();
  if (g_qol[QOL_PANDORA_BOX] && install_pandora_gate()) log_line("pandora: the chest's visit is ours now");
  // A spell taught by any means announces itself now — the engine announces an
  // artifact and a raised stack but not this, and a box that gave a spell read
  // as a box that did nothing.
  if (g_qol[QOL_PANDORA_BOX] && install_pandora_notify()) {
    log_line("pandora: a taught spell will announce itself");
  }
  if (g_qol[QOL_PAYBACK_FIX]) install_payback_fix();
  if (g_qol[QOL_DRAGON_FORM_FIX]) install_dragon_form_fix();
  if (g_qol[QOL_EMPOWERED_ARMAGEDDON_FIX]) install_empowered_armageddon_fix();
  if (g_qol[QOL_BOOK_OF_POWER_FIX]) install_book_of_power_fix();
  if (g_qol[QOL_MASTER_OF_FIRE_FIX]) install_master_of_fire_fix();
  if (g_qol[QOL_IMBUE_BALLISTA_FIX]) install_imbue_ballista_fix();
  // The multiplayer agent. An import table entry, so it has to be in before the
  // game makes its socket — which is long after this, WinMain not having run —
  // and it is gated on the flag like everything else here: with it clear the
  // game's own `sendto` is the one in the slot.
  if (g_qol[QOL_NET_AGENT] && install_agent()) log_line("agent: the game's peer socket is watched");
  // The lobby half, and a separate switch on purpose: it hooks nothing at all —
  // it listens on the loopback and the game comes to it — so it can be on while
  // the agent is off, or the other way round, and neither has an opinion about
  // the other. Unlike the agent it needs no import slot, so the moment does not
  // matter; what it does need is a config line naming where to carry the u-lobby.
  // What this says is only that it STARTED — the sockets, the tunnel and the
  // redirection all happen on a thread of its own and report themselves. The
  // line used to be "the u-lobby is carried out", the same sentence the thread
  // logs when it has actually done it, and one run was read wrong because of it.
  if (g_qol[QOL_NET_U_LOBBY] && install_lobby()) log_line("lobby: starting");
  // The generator's oracle, and its own file is the switch — not a flag in the
  // one above, because nothing here is for playing: it exists to make a run
  // comparable with the port (native/rmg/oracle.c). What it did lands in its own
  // log, so this line is only for the person reading THIS file.
  load_rmg_config();
  if (g_rmgWanted) log_line(install_rmg_oracle() ? "rmg oracle installed" : "rmg oracle NOT installed");
  return TRUE;
}

/** So the import that loads us has something to name. */
__declspec(dllexport) int homm5_editor_present(void) { return 1; }
