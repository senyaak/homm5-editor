"""Find a class's vtable through RTTI, and read a slot out of it.

MSVC lays this out as: a type descriptor holding the decorated name, a
complete-object locator pointing at it, and the locator sitting one dword
before the vtable itself. Walking that chain backwards turns a class name
into the address of any virtual function it declares.

    python tools/reverse/vtable.py CAdvMapHero 0x10 0x14
"""
import struct
import sys
from pe import PE

pe = PE()


def type_descriptors(fragment):
    """(name, descriptor VA) for every RTTI name containing `fragment`."""
    out = []
    for off in pe.find_substr_offsets('.?AV'):
        va = pe.off2va(off)
        if not va:
            continue
        name = pe.read_str(va, 120)
        if name and fragment in name:
            # the name sits at +8 in the descriptor
            out.append((name, va - 8))
    return out


def vtables_for(descriptor_va):
    """Every vtable whose complete-object locator names this descriptor."""
    found = []
    for ref in pe.xrefs_to_va(descriptor_va):
        col = pe.off2va(ref - 12)        # pTypeDescriptor is at +12 in the locator
        if col is None:
            continue
        for back in pe.xrefs_to_va(col):
            vt = pe.off2va(back + 4)     # the locator precedes the vtable
            if vt:
                found.append(vt)
    return found


def slot(vtable_va, offset):
    o = pe.va2off(vtable_va + offset)
    return struct.unpack_from('<I', pe.b, o)[0] if o is not None else None


if __name__ == '__main__':
    fragment = sys.argv[1] if len(sys.argv) > 1 else 'CAdvMapHero'
    wanted = [int(a, 16) for a in sys.argv[2:]] or [0x10, 0x14, 0x18, 0x1c, 0x13c, 0x140]
    for name, desc in type_descriptors(fragment):
        vts = vtables_for(desc)
        if not vts:
            continue
        print('%s  (descriptor 0x%x)' % (name, desc))
        for vt in vts:
            print('  vtable 0x%x' % vt)
            for off in wanted:
                fn = slot(vt, off)
                if fn and pe.va2off(fn):
                    print('    +0x%-4x -> 0x%x' % (off, fn))
