"""Render docs/EXE_LUA_REGISTRY.md from the extracted signature table."""
import json, re, sys

sigs = json.load(open(sys.argv[1]))
manual = open(r"C:\Games\Steam\steamapps\common\Heroes of Might and Magic 5 Tribes of the East\homm5-editor\docs\SCRIPT_API.md", encoding='utf8').read()
known = set(re.findall(r'`([A-Za-z_][A-Za-z0-9_]*)\(', manual))

TYPE = {'s': 'string', 'n': 'number', 'b': 'bool', 'f': 'float',
        'o': 'object', 't': 'table', 'v': 'var'}


def pretty(sig):
    """"snn[0]" -> "(string, number, number = 0)"."""
    if not sig:
        return ''
    out, i = [], 0
    while i < len(sig):
        c = sig[i]
        if c in TYPE:
            name = TYPE[c]
            if i + 1 < len(sig) and sig[i + 1] == '[':
                j = sig.index(']', i) if ']' in sig[i:] else len(sig)
                default = sig[i + 2:j]
                name += ' = ' + (default if default else '?')
                i = j
            out.append(name)
        i += 1
    return '(' + ', '.join(out) + ')'


by_table = {}
for name, v in sigs.items():
    by_table.setdefault(v['table'], []).append((name, v))

lines = ["# The executable's Lua registration tables", "",
"Read out of `bin/H5_Game_NCF.exe` on 2026-07-27. **Use the NCF binary for any",
"reverse engineering** — `H5_Game.exe` ships with its `.text` encrypted by the",
"Steam wrapper (entropy 7.98, an extra `.bind` section); the NCF build is the",
"same program in the clear, and it is the one our patchers already edit.",
"Data sections are identical between the two, so addresses found here line up.",
"",
"Seven `{name pointer, function pointer}` arrays sit in `.data`. Together they",
"expose **%d functions to Lua** — against the 204 signatures the shipped" % len(sigs),
"manuals admit to. Everything marked ·undoc is absent from those manuals.",
"",
"## Signatures come from the binary",
"",
"Every registered function opens by copying two strings onto the heap: an",
"argument format and its own name. The format is a compact grammar —",
"`s` string, `n` number, `b` bool, `f` float, `o` object, `t` table, and",
"`[default]` marking an optional argument. `GiveArtefact` carries `snn[0]`,",
"which is exactly the manual's `GiveArtefact(hero, id, [bindToHero = 0])`.",
"The parser at `0xa454d0` reads it and reports mismatches by function name.",
"",
"So the tables below are not guesses: the argument list is what the engine",
"itself checks. Where the manual and the binary disagree, **the binary wins** —",
"see `HasArtefact`, which really takes a third argument",
"([ARTIFACT_EFFECTS.md](ARTIFACT_EFFECTS.md#knowing-what-the-hero-has)).",
"",
"Function addresses belong to this build only. Patch by pattern, never by",
"address — the same rule the creature and artifact ceilings follow.",
""]

order = sorted(by_table.items(), key=lambda kv: int(kv[0], 16))
for ti, (table, items) in enumerate(order, 1):
    lines += ["", "## Table %d — `%s` (%d entries)" % (ti, table, len(items)), "",
              "| function | arguments | code | |", "|---|---|---|---|"]
    for name, v in items:
        lines.append("| `%s` | `%s` | `%s` | %s |" % (
            name, pretty(v['sig']) or '?', v['func'],
            '' if name in known else '·undoc'))

open(sys.argv[2], 'w', encoding='utf8').write('\n'.join(lines) + '\n')
print('wrote', sys.argv[2], '-', len(sigs), 'functions')
