// Quick split: reading an army, moving creatures, the gestures.
//
// A piece of the ONE translation unit — native/homm5-editor.c includes every
// piece in order, so everything included before this file is visible here and
// nothing after it is. Statics stay statics; nothing here is a module.

// --- reading an army -------------------------------------------------------

/** The widget a slot entry stands for: the object, adjusted onto the subobject
 *  the drag deals in — the same three instructions the screen uses. */
static void *entry_widget(void *array, int slot) {
  if (readable_bytes(array, (DWORD)slot * SLOT_ENTRY_STRIDE + 4) < (DWORD)slot * SLOT_ENTRY_STRIDE + 4)
    return NULL;
  BYTE *obj = *(BYTE **)((BYTE *)array + (DWORD)slot * SLOT_ENTRY_STRIDE);
  if (readable_bytes(obj, 8) < 8) return NULL;
  BYTE *block = *(BYTE **)(obj + 4);
  if (readable_bytes(block, 12) < 12) return NULL;
  return obj + *(DWORD *)(block + 8) + 4;
}

/** Is there a second army on this screen to move things between? */
static int two_armies(void *part) {
  BYTE *flag = (BYTE *)part + PART_SECOND_FLAG;
  if (!readable_bytes(flag, 1)) return 0;
  BYTE *say = (BYTE *)part + (*flag ? PART_SECOND_WHEN_SET : PART_SECOND_WHEN_CLEAR);
  return readable_bytes(say, 1) && *say;
}

static void *army_of(void *part, int side) {
  BYTE *at = (BYTE *)part + (side ? PART_ARMY_B : PART_ARMY_A);
  return readable_bytes(at, 4) >= 4 ? *(void **)at : NULL;
}

static void *slots_of(void *part, int side) {
  BYTE *at = (BYTE *)part + (side ? PART_SLOTS_B : PART_SLOTS_A);
  return readable_bytes(at, 4) >= 4 ? *(void **)at : NULL;
}

/** Which army, and which of its seven slots, this widget is. */
static int find_slot(void *part, void *widget, int *side, int *slot) {
  for (int s = 0; s < 2; s++) {
    if (s == 1 && !two_armies(part)) break;
    void *array = slots_of(part, s);
    if (!array) continue;
    for (int i = 0; i < SLOT_COUNT; i++) {
      if (entry_widget(array, i) != widget) continue;
      *side = s;
      *slot = i;
      return 1;
    }
  }
  return 0;
}

/** What holds an army's stacks. Asked of the army, as the engine asks it. */
static void *army_owner(void *army) {
  NoArgFn get = (NoArgFn)vtable_entry(army, ARMY_OWNER);
  return get ? get(army, NULL) : NULL;
}

/** The stack in a slot, or nothing when the slot is empty. */
static void *stack_in(void *owner, int slot) {
  NoArgFn get = (NoArgFn)vtable_entry(owner, OWNER_STACKS);
  if (!get) return NULL;
  void *list = get(owner, NULL);
  if (readable_bytes(list, 8) < 8) return NULL;
  BYTE **begin = *(BYTE ***)list;
  BYTE **end = *(BYTE ***)((BYTE *)list + 4);
  if (readable_bytes(begin, 4) < 4 || end < begin) return NULL;
  if (slot < 0 || slot >= (int)(end - begin)) return NULL;
  if (readable_bytes(begin + slot, 4) < 4) return NULL;
  return begin[slot];
}

typedef struct {
  /** Which creature, or -1 for an empty slot. */
  int type;
  int count;
} SlotState;

/** How many entries the army's own vector had, for the log: if it is shorter
 *  than the slots on screen, an emptied slot is REMOVED from it and a slot
 *  number is not an index into it. */
static int g_stacksSeen = 0;
/**
 * Whether a slot has a stack OBJECT in it, whatever that object says.
 *
 * Which is not the same question as whether it holds creatures, and the
 * difference is what is being measured. A merge of ours is a split command told
 * to hand over everything, so the source ends at nothing — and a split was never
 * meant to empty its source. If the engine leaves the emptied stack in place at
 * zero where its own merge would have removed it, that leftover is what the
 * panel has been drawing.
 */
static int g_hasEntry[SLOT_COUNT];

static void read_army(void *army, SlotState *out) {
  void *owner = army_owner(army);
  g_stacksSeen = 0;
  {
    NoArgFn get = (NoArgFn)vtable_entry(owner, OWNER_STACKS);
    void *list = get ? get(owner, NULL) : NULL;
    if (readable_bytes(list, 8) >= 8) {
      BYTE **begin = *(BYTE ***)list, **end = *(BYTE ***)((BYTE *)list + 4);
      if (end >= begin) g_stacksSeen = (int)(end - begin);
    }
  }
  for (int i = 0; i < SLOT_COUNT; i++) {
    void *s = owner ? stack_in(owner, i) : NULL;
    int room = (int)readable_bytes(s, STACK_COUNT + 4);
    g_hasEntry[i] = s != NULL;
    out[i].type = room >= (int)(STACK_COUNT + 4) ? *(int *)((BYTE *)s + STACK_TYPE) : -1;
    out[i].count = room >= (int)(STACK_COUNT + 4) ? *(int *)((BYTE *)s + STACK_COUNT) : 0;
    if (out[i].count <= 0) { out[i].type = -1; out[i].count = 0; }
  }
}

// --- moving creatures ------------------------------------------------------

/**
 * A GESTURE IS DECIDED BEFORE ANY OF IT IS DONE.
 *
 * What a slot holds does not change while a gesture runs. `Execute` hands the
 * engine a command carrying two slot numbers and a number, and it is carried
 * out later — until then the army reads exactly as it did. So a gesture that
 * looked at the slots between its own moves saw the state it started from and
 * worked the next move out as if the last had not happened: that is how Alt
 * gathered one stack and stopped, and how an even split of 4, 4, 4 became
 * 8, 0, 4.
 *
 * Hence a plan. The arithmetic is done here, on a copy of the army that we keep
 * ourselves, and what comes out is a list of moves that are right in the order
 * they are sent. Commands carry no counts, so they mean the same thing whenever
 * the engine gets round to them.
 */
#define MAX_MOVES 16

typedef struct {
  int from, to;
  /** What the target is to end up holding — see CONTROLLER_TOTAL. */
  int want;
  /** The source is left with nothing, so this is a merge and goes to the
   *  engine's own — see SCREEN_SPLIT_RVA. */
  int whole;
} Move;

typedef struct {
  SlotState slot[SLOT_COUNT];
  Move move[MAX_MOVES];
  int moves;
} Plan;

/** Hand this many creatures over — on paper, where the arithmetic is ours. */
static void plan_move(Plan *p, int from, int to, int howMany) {
  if (p->moves >= MAX_MOVES || howMany <= 0 || howMany > p->slot[from].count) return;
  p->move[p->moves].from = from;
  p->move[p->moves].to = to;
  p->move[p->moves].want = p->slot[to].count + howMany;
  p->move[p->moves].whole = howMany == p->slot[from].count;
  p->moves++;
  p->slot[to].type = p->slot[from].type;
  p->slot[to].count += howMany;
  p->slot[from].count -= howMany;
  if (!p->slot[from].count) p->slot[from].type = -1;
}

/**
 * Leave the target slot holding exactly `want`, and the source the rest.
 *
 * The one thing this feature does to the game. Everything above it is
 * arithmetic on numbers we have read; this is the engine's own command, built
 * the way the OK button builds it, so the screen, the network and the save all
 * learn about it the way they always did.
 *
 * `judge` asks the engine whether it would allow this. Only the FIRST move of a
 * gesture may be asked: after that the controller is answering about a state
 * the engine has not caught up with, and its answer is no about the wrong
 * question.
 */
static int set_target(void *part, int fromSide, int fromSlot, int toSide, int toSlot, int want,
                      int judge) {
  if (!g_makeController || want < 0) return 0;
  void *fromArmy = army_of(part, fromSide), *toArmy = army_of(part, toSide);
  if (!fromArmy || !toArmy) return 0;
  if (readable_bytes((BYTE *)part + PART_BLOCK_LAST, 4) < 4) return 0;

  void *block[9];
  block[0] = *(void **)((BYTE *)part + PART_BLOCK_FIRST);
  block[1] = *(void **)((BYTE *)part + PART_BLOCK_SECOND);
  block[2] = army_owner(fromArmy);
  block[3] = (void *)(DWORD)fromSlot;
  block[4] = fromArmy;
  block[5] = army_owner(toArmy);
  block[6] = (void *)(DWORD)toSlot;
  block[7] = toArmy;
  block[8] = *(void **)((BYTE *)part + PART_BLOCK_LAST);
  if (!block[2] || !block[5]) return 0;

  void *c = g_makeController(block, NULL);
  if (readable_bytes(c, CONTROLLER_TOTAL + 4) < CONTROLLER_TOTAL + 4) return 0;
  ControllerAskFn allowed = (ControllerAskFn)vtable_entry(c, CONTROLLER_VALIDATE);
  ControllerAskFn apply = (ControllerAskFn)vtable_entry(c, CONTROLLER_EXECUTE);
  if (!allowed || !apply) return 0;
  if (judge) {
    // Zero total means the pair was refused: an empty source, or two different
    // creatures. Both are questions answered by our own reading of the army,
    // but this is the engine agreeing with it before anything is sent.
    if (*(int *)((BYTE *)c + CONTROLLER_TOTAL) < want) return 0;
    if (!allowed(c, NULL, want)) return 0;
  }
  apply(c, NULL, want);
  return 1;
}

/**
 * Give a stack away whole, the way the engine does it — a merge, not a split.
 *
 * Everything the call needs it looks up itself from the two widgets; what it
 * cannot look up is the handle behind them, which is the drag's business and
 * comes from the drag's own map.
 */
static int merge_whole(void *part, void *map, void *array, int from, int to) {
  if (!g_screenSplit) return 0;
  void *fromWidget = entry_widget(array, from), *toWidget = entry_widget(array, to);
  InSlotFn in_slot = (InSlotFn)vtable_entry(map, SLOT_CONTENTS);
  if (!fromWidget || !toWidget || !in_slot) return 0;
  void *fromStack = in_slot(map, NULL, fromWidget);
  if (!fromStack) return 0;
  void *toStack = in_slot(map, NULL, toWidget);

  BYTE *allowed = readable_bytes((BYTE *)part + SCREEN_SPLIT_ALLOWED, 4) >= 4
    ? *(BYTE **)((BYTE *)part + SCREEN_SPLIT_ALLOWED) : NULL;
  int poke = readable_bytes(allowed, 1) != 0;
  BYTE was = poke ? *allowed : 0;
  if (poke) *allowed = 0;
  g_screenSplit(part, NULL, fromWidget, fromStack, toWidget, toStack);
  if (poke) *allowed = was;
  return 1;
}

/** Send a plan, in order. */
static int carry_out(void *part, int side, void *map, const Plan *p) {
  void *array = slots_of(part, side);
  int did = 0;
  for (int i = 0; i < p->moves; i++) {
    const Move *m = &p->move[i];
    int done = m->whole
      ? merge_whole(part, map, array, m->from, m->to)
      : set_target(part, side, m->from, side, m->to, m->want, i == 0);
    if (!done) break;
    did++;
  }
  return did;
}

// --- the gestures ----------------------------------------------------------

/** Ctrl on a stack of more than one: a single creature into the first free slot. */
static void put_one_out(Plan *p, int from, int everyFreeSlot) {
  for (int i = 0; i < SLOT_COUNT; i++) {
    if (p->slot[i].type >= 0 || p->slot[from].count < 2) continue;
    plan_move(p, from, i, 1);
    if (!everyFreeSlot) return;
  }
}

/**
 * Ctrl on a stack of ONE: back where it came from.
 *
 * The gesture reads the same either way — "this single creature is in the wrong
 * place" — and which way it goes is a question the stack itself answers.
 */
static void put_one_back(Plan *p, int from) {
  int home = -1;
  for (int i = 0; i < SLOT_COUNT; i++) {
    if (i == from || p->slot[i].type != p->slot[from].type) continue;
    if (home < 0 || p->slot[i].count > p->slot[home].count) home = i;
  }
  if (home >= 0) plan_move(p, from, home, 1);
}

/** Alt: every stack of this creature into the clicked one. */
static void gather(Plan *p, int into) {
  for (int i = 0; i < SLOT_COUNT; i++) {
    if (i == into || p->slot[i].type != p->slot[into].type) continue;
    plan_move(p, i, into, p->slot[i].count);
  }
}

/**
 * Shift: the "smart" split the HD mod for Heroes 3 has.
 *
 * Every stack of this creature ends up the same size give or take one, and each
 * click makes one more of them — 12 becomes 6 and 6, then 4, 4 and 4. Stacks of
 * a single creature are left out of it entirely, deliberately: they are scouts
 * and gate-blockers, and the player put them there.
 *
 * Two things happen depending on what is already on screen. Stacks that are NOT
 * level yet are levelled, keeping their number — 12 and 5 becomes 9 and 8. Once
 * they are level, the next click adds a stack — 9 and 8 becomes 6, 6 and 5.
 *
 * The moving is gather-then-deal: everything into the clicked slot, then dealt
 * back out. Dealing is always into an EMPTY slot, which is the one case where
 * "how many the target ends up with" and "how many cross" are the same number,
 * so nothing here has to reason about the pair.
 */
static void spread(Plan *p, int from) {
  int member[SLOT_COUNT], members = 0, total = 0, most = 0, least = 0;
  for (int i = 0; i < SLOT_COUNT; i++) {
    if (p->slot[i].type != p->slot[from].type || p->slot[i].count < 2) continue;
    if (!members || p->slot[i].count > most) most = p->slot[i].count;
    if (!members || p->slot[i].count < least) least = p->slot[i].count;
    total += p->slot[i].count;
    member[members++] = i;
  }
  if (!members) return;

  // Where a stack may go: the ones this creature already has, and the free ones.
  int target[SLOT_COUNT], targets = 0;
  for (int i = 0; i < members; i++) if (member[i] != from) target[targets++] = member[i];
  for (int i = 0; i < SLOT_COUNT; i++) if (p->slot[i].type < 0) target[targets++] = i;

  // Level first, then grow: one more stack only once the ones there are even.
  int level = most - least <= 1;
  int parts = level ? members + 1 : members;
  if (parts > targets + 1) parts = targets + 1;
  if (parts > total) parts = total;
  // Nothing at all rather than a move that changes nothing: even stacks with no
  // free slot to grow into, or a lone creature that cannot be halved.
  if (parts < 2 || (level && parts == members)) return;

  for (int i = 0; i < members; i++)
    if (member[i] != from) plan_move(p, member[i], from, p->slot[member[i]].count);

  int base = total / parts, over = total % parts;
  for (int i = 1; i < parts; i++) plan_move(p, from, target[i - 1], base + (i < over ? 1 : 0));
}

static int __fastcall dnd_pick_hook(void *state, void *edx, void *arg) {
  (void)edx;
  int ctrl = held(VK_CONTROL);
  int shift = held(VK_SHIFT);
  int alt = held(VK_MENU);
  if (!ctrl && !shift && !alt) return g_dndPick(state, NULL, arg);

  void *helper = readable_bytes((BYTE *)state + DND_STATE_HELPER, 4) >= 4
    ? *(void **)((BYTE *)state + DND_STATE_HELPER) : NULL;
  helper = readable_bytes(helper, DND_HELPER_PICKED + 4) >= DND_HELPER_PICKED + 4
    ? *(void **)((BYTE *)helper + DND_HELPER_PICKED) : NULL;
  if (!is_a(helper, DND_HELPER_VTABLE_RVA) || !pointer_alive(helper))
    return g_dndPick(state, NULL, arg);

  void *widget = *(void **)((BYTE *)helper + DND_HELPER_WIDGET);
  void *client = *(void **)((BYTE *)helper + DND_HELPER_CLIENT);
  if (readable_bytes(client, 4) < 4) return g_dndPick(state, NULL, arg);
  // The screen, from the drag client sitting inside it. Nothing is read out of
  // it until the clicked widget has been found in its own slot list, which is
  // what says this is the screen we think it is.
  void *part = (BYTE *)client - PART_FROM_CLIENT;
  int side = 0, from = -1;
  if (!find_slot(part, widget, &side, &from)) return g_dndPick(state, NULL, arg);

  Plan plan;
  plan.moves = 0;
  read_army(army_of(part, side), plan.slot);
  SlotState before[SLOT_COUNT];
  for (int i = 0; i < SLOT_COUNT; i++) before[i] = plan.slot[i];
  if (plan.slot[from].type < 0) {
    // The picture says there is a stack here and the army says there is not.
    // Worth a line of its own: it is the one shape of failure that says the
    // slot numbers on screen are not the ones the army is keeping.
    if (g_clicksLogged < 40) {
      g_clicksLogged++;
      log_num("click: nothing in slot ", from + 1);
      log_num("       stacks in the army's own list ", g_stacksSeen);
      if (g_hasEntry[from]) log_line("       though a stack still stands there, holding nothing");
    }
    return g_dndPick(state, NULL, arg);
  }
  int held_here = plan.slot[from].count;

  if (alt) gather(&plan, from);
  else if (shift && !ctrl) spread(&plan, from);
  else if (held_here > 1) put_one_out(&plan, from, ctrl && shift);
  else if (ctrl && !shift) put_one_back(&plan, from);

  void *map = readable_bytes((BYTE *)helper + DND_HELPER_MAP, 4) >= 4
    ? *(void **)((BYTE *)helper + DND_HELPER_MAP) : NULL;
  int did = carry_out(part, side, map, &plan);

  if (g_clicksLogged < 40) {
    g_clicksLogged++;
    log_line("click: with a key held");
    log_num("       ctrl ", ctrl);
    log_num("       shift ", shift);
    log_num("       alt ", alt);
    log_num("       army ", side + 1);
    log_num("       clicked slot ", from + 1);
    log_num("       holding ", held_here);
    log_num("       stacks in the army's own list ", g_stacksSeen);
    for (int i = 0; i < SLOT_COUNT; i++) {
      if (before[i].type < 0 && !g_hasEntry[i]) continue;
      log_num("       in slot ", i + 1);
      if (before[i].type < 0) {
        log_line("            a stack still stands here, holding nothing");
        continue;
      }
      log_num("            of creature ", before[i].type);
      log_num("            there are ", before[i].count);
    }
    for (int i = 0; i < plan.moves; i++) {
      log_num("       move out of slot ", plan.move[i].from + 1);
      log_num("               into slot ", plan.move[i].to + 1);
      if (plan.move[i].whole) log_line("               all of it, as a merge");
      else log_num("               leaving it with ", plan.move[i].want);
    }
    log_num("       moves made ", did);
  }

  // Called off whatever came of it: the key says this click was a gesture, and
  // a gesture that had nothing to do should still not leave a stack hanging on
  // the cursor. Picking one up is what a click with NO key held is for.
  GiveUpFn give_up = (GiveUpFn)vtable_entry(state, DND_STATE_GIVE_UP);
  if (give_up) give_up(state, NULL);
  return 1;
}

static void install_quick_split(void) {
  if (!have_key_state()) {
    log_line("quick split: USER32 will not say which keys are down - not hooking");
    return;
  }
  g_makeController = (MakeControllerFn)code_at(MAKE_CONTROLLER_RVA, MAKE_CONTROLLER_HEAD,
                                               MAKE_CONTROLLER_HEAD_LEN, "the split controller");
  if (!g_makeController) return;
  g_screenSplit = (ScreenSplitFn)code_at(SCREEN_SPLIT_RVA, SCREEN_SPLIT_HEAD, SCREEN_SPLIT_HEAD_LEN,
                                         "the screen's own split");
  g_dndPick = (DndPickFn)detour(DND_PICK_RVA, DND_PICK_HEAD, DND_PICK_HEAD_LEN,
                                &dnd_pick_hook, "drag and drop pick");
  if (g_dndPick) log_line("quick split: watching clicks made with a key held");
}

