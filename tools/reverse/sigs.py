"""Extract every Lua-exposed function's argument signature from the exe.

Each registered function starts with a preamble that inlines two string
copies: a short format string ("sn", "snn", …) describing the argument
tuple, and the function's own name.  We disassemble the first ~60
instructions, collect `mov edx, <imm>` where <imm> points to a short ascii
string, and pair them up.
"""
import struct, json, sys
from pe import PE

pe = PE()

def find_tables():
    text = [s for s in pe.secs if s['name'] == '.text'][0]
    def in_text(va):
        r = va - pe.image_base
        return text['va'] <= r < text['va'] + text['vsz']
    tables = []
    for sec in [s for s in pe.secs if 'data' in s['name']]:
        o = sec['raw']
        end = sec['raw'] + sec['rsz'] - 8
        while o < end:
            cnt, p, names = 0, o, []
            while p < end:
                n, f = struct.unpack_from('<II', pe.b, p)
                s = pe.read_str(n, 60) if (n and in_text(f)) else None
                if not s or len(s) < 2 or not s.replace('_', 'a').isalnum():
                    break
                names.append((s, f, p))
                cnt += 1
                p += 8
            if cnt >= 6:
                tables.append((o, names))
                o = p
            else:
                o += 4
    return tables

# Argument letters, plus the optional-argument syntax: "snn[0]" is
# (string, number, number = 0).  Defaults appear inside the brackets.
TYPE_CHARS = set('snbfotv')
FMT_CHARS = TYPE_CHARS | set('[],.-0123456789')


def looks_like_fmt(s):
    return (s and len(s) <= 24 and set(s) <= FMT_CHARS
            and any(c in TYPE_CHARS for c in s)
            and s[0] in TYPE_CHARS)

def signature(func_va, name, limit_va=None):
    """Return the format string found in the function preamble.

    Long formats are copied from .rdata (`mov edx, <ptr to "snn">`); short
    ones the compiler stores inline as an immediate
    (`mov word ptr [eax], 0x6e73` = "sn").  Both forms show up before the
    name copy, so the first candidate wins.
    """
    o = pe.va2off(func_va)
    if o is None:
        return None
    span = (limit_va - func_va) if limit_va and limit_va > func_va else 0x600
    code = pe.b[o:o + min(span, 0x1200)]
    cands = []
    for ins in pe.md.disasm(code, func_va):
        if ins.mnemonic == 'mov' and len(ins.operands) == 2 and ins.operands[1].type == 2:
            imm = ins.operands[1].imm
            dst = ins.operands[0]
            # pointer to a format string in .rdata
            s = pe.read_str(imm, 40)
            if s is not None and looks_like_fmt(s):
                cands.append(s)
                continue
            # inline immediate stored into memory: decode its bytes as ascii
            if dst.type == 3 and 0 < imm < (1 << 32):
                width = {1: 1, 2: 2, 4: 4}.get(ins.operands[0].size, 0)
                if width:
                    raw = struct.pack('<I', imm & 0xffffffff)[:width]
                    txt = raw.split(b'\0')[0].decode('latin1')
                    if looks_like_fmt(txt):
                        cands.append(txt)
    cands = [c for c in cands if c != name]
    return cands[0] if cands else ''

def main():
    out = {}
    tables = find_tables()
    all_fvas = sorted({f for _, names in tables for _, f, _ in names})
    nxt = {v: (all_fvas[i + 1] if i + 1 < len(all_fvas) else None)
           for i, v in enumerate(all_fvas)}
    for off, names in tables:
        for name, fva, entry in names:
            out[name] = dict(func='0x%x' % fva, entry='0x%x' % entry,
                             table='0x%x' % off,
                             sig=signature(fva, name, nxt.get(fva)))
    json.dump(out, open(sys.argv[1], 'w'), indent=1)
    got = sum(1 for v in out.values() if v['sig'])
    print('functions: %d, with signature: %d' % (len(out), got))
    for n, v in list(out.items())[:12]:
        print('  %-28s %-6s %s' % (n, v['sig'], v['func']))

if __name__ == '__main__':
    main()
