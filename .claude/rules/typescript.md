---
paths:
  - "**/*.{ts,tsx,mts,cts}"
---

# TypeScript: every value has its real type

- No bare `string` or `number` for a value that means something: take the type
  from where it is defined — a field of its class (`FooDef['id']`), a lookup
  type, an enum. A named alias (`type AbilityName = string`, next to the class)
  only when the type is its own and nothing else defines it. No branded types.
- No `any`, no untyped object literal types, no `Record<string, …>`: narrow the
  key to the union it really is (`Record<StatDef['id'], …>`, an enum).
- A real `enum` over an `as const` array or a union of string literals.
- No `?.` or `!` to say "this is fine": write the branch, and log the state that
  should not happen (`console.warn`) where it is handled.
- A field is optional (`foo?`) only when the value can really be absent. One
  that always exists but has a default is required and gets the default where
  it is parsed or built.
