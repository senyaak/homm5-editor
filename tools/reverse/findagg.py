"""Hunt for code that reads several artifact stat fields close together.

An artifact record keeps HeroStatsModif at +0x40, so Attack is +0x44,
Defence +0x48, Knowledge +0x4c, SpellPower +0x50, Morale +0x54, Luck +0x58.
Whatever sums a hero's worn artifacts has to touch most of those within a
few instructions, which is rare enough to be a usable fingerprint.
"""
import sys
from collections import defaultdict
from pe import PE

WANT = {0x44: 'Attack', 0x48: 'Defence', 0x4c: 'Knowledge',
        0x50: 'SpellPower', 0x54: 'Morale', 0x58: 'Luck'}
WINDOW = 0x160          # bytes a single sum is expected to fit in
MIN_DISTINCT = 3        # how many of the six must appear

pe = PE()
text = [s for s in pe.secs if s['name'] == '.text'][0]

hits = []               # (va, offset) for every read of one of the six
code = pe.b[text['raw']:text['raw'] + text['rsz']]
base = pe.off2va(text['raw'])
for ins in pe.md.disasm(code, base):
    for op in ins.operands:
        if op.type == 3 and op.mem.base != 0 and op.mem.disp in WANT:
            hits.append((ins.address, op.mem.disp))
            break

groups = defaultdict(set)
for i, (va, disp) in enumerate(hits):
    near = {d for a, d in hits[i:i + 24] if a - va <= WINDOW}
    if len(near) >= MIN_DISTINCT:
        groups[va] = near

# collapse runs that belong to one function
merged, last = [], -1
for va in sorted(groups):
    if va - last > WINDOW:
        merged.append((va, set()))
    merged[-1][1].update(groups[va])
    last = va

print('candidate sites: %d' % len(merged))
for va, fields in merged:
    names = ', '.join(WANT[d] for d in sorted(fields))
    print('  0x%x  %s' % (va, names))
