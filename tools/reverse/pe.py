"""Read-only PE/x86 helper for poking at H5_Game_NCF.exe."""
import struct, sys
from capstone import Cs, CS_ARCH_X86, CS_MODE_32

PATH = r"C:\Games\Steam\steamapps\common\Heroes of Might and Magic 5 Tribes of the East\bin\H5_Game_NCF.exe"

class PE:
    def __init__(self, path=PATH):
        self.b = open(path, 'rb').read()
        b = self.b
        pe = struct.unpack_from('<I', b, 0x3c)[0]
        nsec = struct.unpack_from('<H', b, pe + 6)[0]
        optsz = struct.unpack_from('<H', b, pe + 20)[0]
        opt = pe + 24
        self.image_base = struct.unpack_from('<I', b, opt + 28)[0]
        sect = opt + optsz
        self.secs = []
        for i in range(nsec):
            o = sect + i * 40
            name = b[o:o+8].split(b'\0')[0].decode()
            vsz, va, rsz, raw = struct.unpack_from('<IIII', b, o + 8)
            self.secs.append(dict(name=name, va=va, vsz=vsz, raw=raw, rsz=rsz))
        self.md = Cs(CS_ARCH_X86, CS_MODE_32)
        self.md.detail = True

    def va2off(self, va):
        r = va - self.image_base
        for s in self.secs:
            if s['va'] <= r < s['va'] + s['vsz']:
                off = s['raw'] + (r - s['va'])
                return off if off < len(self.b) else None
        return None

    def off2va(self, off):
        for s in self.secs:
            if s['raw'] <= off < s['raw'] + s['rsz']:
                return self.image_base + s['va'] + (off - s['raw'])
        return None

    def read_str(self, va, maxlen=100):
        o = self.va2off(va)
        if o is None:
            return None
        s = b''
        for i in range(o, min(o + maxlen, len(self.b))):
            if self.b[i] == 0:
                try:
                    return s.decode('ascii')
                except Exception:
                    return None
            if self.b[i] < 9 or self.b[i] > 126:
                return None
            s += self.b[i:i+1]
        return None

    def find_str_va(self, text):
        """All VAs of a NUL-terminated ascii string equal to text."""
        needle = text.encode() + b'\0'
        out, i = [], 0
        while True:
            i = self.b.find(needle, i)
            if i < 0:
                break
            # must be start of string (preceded by NUL or padding)
            if i == 0 or self.b[i-1] in (0, 0xcc):
                va = self.off2va(i)
                if va:
                    out.append(va)
            i += 1
        return out

    def find_substr_offsets(self, text):
        needle = text.encode()
        out, i = [], 0
        while True:
            i = self.b.find(needle, i)
            if i < 0:
                break
            out.append(i)
            i += 1
        return out

    def xrefs_to_va(self, va):
        """Offsets where the literal dword va appears (immediates/pointers)."""
        needle = struct.pack('<I', va)
        out, i = [], 0
        while True:
            i = self.b.find(needle, i)
            if i < 0:
                break
            out.append(i)
            i += 1
        return out

    def calls_to(self, target_va, scan_sec='.text'):
        """Find E8 rel32 calls / E9 jmps to target_va."""
        s = [x for x in self.secs if x['name'] == scan_sec][0]
        out = []
        for o in range(s['raw'], s['raw'] + s['rsz'] - 5):
            if self.b[o] in (0xe8, 0xe9):
                rel = struct.unpack_from('<i', self.b, o + 1)[0]
                src = self.off2va(o)
                if src and src + 5 + rel == target_va:
                    out.append((o, src, 'call' if self.b[o] == 0xe8 else 'jmp'))
        return out

    def disasm(self, va, count=60, annotate=True):
        o = self.va2off(va)
        if o is None:
            return []
        code = self.b[o:o + count * 16]
        lines = []
        for ins in self.md.disasm(code, va):
            txt = '0x%x  %-8s %s' % (ins.address, ins.mnemonic, ins.op_str)
            if annotate:
                notes = []
                for m in [ins.op_str]:
                    pass
                # annotate immediates that look like string pointers
                for op in ins.operands:
                    if op.type == 2:  # IMM
                        s = self.read_str(op.imm)
                        if s and len(s) > 2:
                            notes.append('"%s"' % s)
                    elif op.type == 3 and op.mem.base == 0 and op.mem.disp:
                        s = self.read_str(op.mem.disp)
                        if s and len(s) > 2:
                            notes.append('"%s"' % s)
                if notes:
                    txt += '   ; ' + ' '.join(notes)
                lines.append(txt)
            else:
                lines.append(txt)
            if len(lines) >= count:
                break
        return lines

    def func(self, va, maxins=200):
        """Disassemble until ret/jmp-out heuristic."""
        o = self.va2off(va)
        code = self.b[o:o + maxins * 16]
        out = []
        for ins in self.md.disasm(code, va):
            line = '0x%x  %-8s %s' % (ins.address, ins.mnemonic, ins.op_str)
            notes = []
            for op in ins.operands:
                if op.type == 2:
                    s = self.read_str(op.imm)
                    if s and len(s) > 2:
                        notes.append('"%s"' % s)
                elif op.type == 3 and op.mem.base == 0 and op.mem.disp:
                    s = self.read_str(op.mem.disp)
                    if s and len(s) > 2:
                        notes.append('"%s"' % s)
            if notes:
                line += '   ; ' + ' '.join(notes)
            out.append(line)
            if ins.mnemonic == 'ret':
                break
            if len(out) >= maxins:
                break
        return out

if __name__ == '__main__':
    pe = PE()
    print('image base 0x%x' % pe.image_base)
    for s in pe.secs:
        print('%-10s va 0x%08x vsz 0x%x raw 0x%x' % (s['name'], s['va'], s['vsz'], s['raw']))
