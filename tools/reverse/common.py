"""What several functions all call — the way to find a shared choke point.

An artifact can leave a hero from the hero screen, from a script, from a quest,
or because the hero died. If the engine recomputes equipment in one place,
every one of those paths has to reach it, so the intersection of what they call
is where to look.

    python tools/reverse/common.py 0x5d2800 0x5d2a00 0x7623c0

Direct `call rel32` only, followed `--depth` levels deep (2 by default).
Virtual calls are listed separately, by vtable slot, since they cannot be
resolved without knowing the object.
"""
import sys
from collections import defaultdict
from pe import PE

pe = PE()
text = [s for s in pe.secs if s['name'] == '.text'][0]


def in_text(va):
    r = va - pe.image_base
    return text['va'] <= r < text['va'] + text['vsz']


def body(va, limit=0x900):
    """Instructions of one function, stopping at padding after a return."""
    o = pe.va2off(va)
    if o is None:
        return []
    out, saw_ret = [], False
    for ins in pe.md.disasm(pe.b[o:o + limit], va):
        # int3 padding after a ret is the end of the function
        if saw_ret and ins.mnemonic == 'int3':
            break
        saw_ret = ins.mnemonic == 'ret'
        out.append(ins)
    return out


def calls(va):
    """(direct callees, virtual slots) of one function."""
    direct, virtual = set(), set()
    for ins in body(va):
        if ins.mnemonic != 'call':
            continue
        op = ins.operands[0]
        if op.type == 2 and in_text(op.imm):
            direct.add(op.imm)
        elif op.type == 3 and op.mem.base != 0 and op.mem.disp:
            virtual.add(op.mem.disp)
    return direct, virtual


def reach(root, depth):
    """Everything `root` calls, up to `depth` levels, with the level recorded."""
    seen, frontier = {}, {root}
    for level in range(depth):
        nxt = set()
        for fn in frontier:
            for callee in calls(fn)[0]:
                if callee not in seen:
                    seen[callee] = level + 1
                    nxt.add(callee)
        frontier = nxt
    return seen


if __name__ == '__main__':
    argv = sys.argv[1:]
    depth = 2
    if '--depth' in argv:
        i = argv.index('--depth')
        depth = int(argv[i + 1])
        del argv[i:i + 2]
    roots = [int(a, 16) for a in argv if not a.startswith('--')]

    reached = {r: reach(r, depth) for r in roots}
    for r in roots:
        d, v = calls(r)
        print('0x%x calls %d directly, %d virtual slots: %s'
              % (r, len(d), len(v), ' '.join('+0x%x' % s for s in sorted(v))))

    shared = defaultdict(list)
    for r, fns in reached.items():
        for fn, level in fns.items():
            shared[fn].append((r, level))
    common = {fn: hits for fn, hits in shared.items() if len(hits) == len(roots)}
    print('\nreached by all %d roots: %d functions' % (len(roots), len(common)))
    for fn in sorted(common, key=lambda f: max(l for _, l in common[f])):
        levels = ', '.join('0x%x@%d' % (r, l) for r, l in common[fn])
        print('  0x%-9x  %s' % (fn, levels))
