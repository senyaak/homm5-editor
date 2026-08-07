// Reading the effects config the editor wrote.
//
// A piece of the ONE translation unit — native/homm5-editor.c includes every
// piece in order, so everything included before this file is visible here and
// nothing after it is. Statics stay statics; nothing here is a module.

// ---------------------------------------------------------------------------
// Reading the config.

static void load_config(void) {
  // The whole file, however long it is. This one had 8 KB where the flags file
  // had 4, and the flags file outgrew its buffer in silence — a row past the
  // end is not refused, it is never seen. See read_beside_us.
  DWORD got = 0;
  char *buf = read_beside_us(L"homm5-editor-effects.txt", &got);
  if (!buf) { log_line("no config beside the dll - nothing to add"); return; }

  const char *p = buf, *end = buf + got;
  while (p < end) {
    const char *line = p;
    while (p < end && *p != '\n') p++;
    const char *stop = p;
    if (p < end) p++;
    while (line < stop && (*line == ' ' || *line == '\t')) line++;
    if (line >= stop || *line == '#') continue;

    //   <stat> artifact <id> <amount>
    //   <stat> set <worn> <amount> <id> <id> …
    //   <stat> specialization <value> <percent per hero level>
    //
    // The specialization rows are tried FIRST and against their own stat names:
    // they share nothing with the artifact rows but the file, and a line that
    // belongs to neither grammar is skipped by both.
    {
      const char *q = line;
      SpecRow s;
      s.stat = -1;
      for (int i = 0; i < SPEC_STAT_COUNT; i++) {
        if (take_word(&q, stop, SPEC_STAT_NAMES[i])) { s.stat = i; break; }
      }
      if (s.stat >= 0) {
        if (!take_word(&q, stop, "specialization")) continue;
        if (!read_int(&q, stop, &s.specialization)) continue;
        if (!read_int(&q, stop, &s.percentPerLevel)) continue;
        if (s.specialization < 0 || !s.percentPerLevel) continue;
        if (g_specRowCount < MAX_SPEC_ROWS) g_specRows[g_specRowCount++] = s;
        continue;
      }
    }

    //   spell <id> spares <ability> <ability> …
    //   spell <id> area <dx>,<dy> <dx>,<dy> …
    //
    // Their own grammar, tried before the stat names and sharing none of them:
    // neither adds anything to a sum, both answer a question the engine asks
    // itself. Two lines about one spell land in one row.
    {
      const char *q = line;
      if (take_word(&q, stop, "spell")) {
        int id = 0;
        if (!read_int(&q, stop, &id) || id <= 0) continue;
        if (take_word(&q, stop, "spares")) {
          SpellRow *row = spell_row_for(id);
          if (!row) continue;
          // Abilities to the end of the line; the trailing `# name` stops this
          // by simply not being a number, which is why the writer puts it last.
          while (row->spareCount < MAX_SPARED
                 && read_int(&q, stop, &row->spares[row->spareCount])) {
            row->spareCount++;
          }
          continue;
        }
        if (take_word(&q, stop, "area")) {
          SpellRow *row = spell_row_for(id);
          if (!row) continue;
          // Pairs, `dx,dy`. The comma is read rather than required: it is there
          // to be read by a person, and `read_int` stops at it either way.
          while (row->areaCount < MAX_AREA) {
            int x = 0, y = 0;
            if (!read_int(&q, stop, &x)) break;
            while (q < stop && (*q == ',' || *q == ' ' || *q == '\t')) q++;
            if (!read_int(&q, stop, &y)) break;
            row->areaX[row->areaCount] = x;
            row->areaY[row->areaCount] = y;
            row->areaCount++;
          }
          continue;
        }
        continue;
      }
    }

    Row r;
    const char *q = line;
    r.stat = -1;
    for (int s = 0; s < STAT_COUNT; s++) {
      if (take_word(&q, stop, STAT_NAMES[s])) { r.stat = s; break; }
    }
    if (r.stat < 0) continue;

    // A skill row shares the stat names with the artifact rows — it enters the
    // same sums — so it is recognised here, after the stat and before the two
    // shapes that count something worn.
    if (take_word(&q, stop, "skill")) {
      SkillRow k;
      k.stat = r.stat;
      if (!read_int(&q, stop, &k.skill)) continue;
      if (!read_int(&q, stop, &k.amountPerMastery)) continue;
      if (k.skill < 0 || !k.amountPerMastery) continue;
      if (g_skillRowCount < MAX_SKILL_ROWS) g_skillRows[g_skillRowCount++] = k;
      continue;
    }

    r.memberCount = 0;
    if (take_word(&q, stop, "artifact")) {
      r.threshold = 1;
      if (!read_int(&q, stop, &r.members[0])) continue;
      if (!read_int(&q, stop, &r.amount)) continue;
      r.memberCount = 1;
    } else if (take_word(&q, stop, "set")) {
      if (!read_int(&q, stop, &r.threshold)) continue;
      if (!read_int(&q, stop, &r.amount)) continue;
      // Members to the end of the line. The trailing `# name` stops this by
      // simply not being a number, which is why the writer puts it last.
      while (r.memberCount < MAX_MEMBERS && read_int(&q, stop, &r.members[r.memberCount])) {
        r.memberCount++;
      }
    } else {
      continue;
    }
    // A row with nothing to count, or one that needs more pieces than it names,
    // can never fire; dropping it here keeps the log honest about what is live.
    if (!r.memberCount || r.threshold > r.memberCount) continue;
    if (r.threshold < 1) r.threshold = 1;
    if (g_rowCount < MAX_ROWS) g_rows[g_rowCount++] = r;
  }
  VirtualFree(buf, 0, MEM_RELEASE);
  log_num("config rows: ", g_rowCount);
  log_num("skill rows: ", g_skillRowCount);
  log_num("specialization rows: ", g_specRowCount);
  log_num("spell filter rows: ", g_spellRowCount);
}

