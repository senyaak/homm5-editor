---
paths:
  - "**/*.component.{ts,html,css,scss}"
  - "**/src/app/**"
---

# Angular

- A component is three files, `.ts` + `.html` + `.css`; never an inline
  `template:` or `styles:`.
- Dependencies come through the constructor (`constructor(private foo: Foo)`);
  `inject()` only where there is no constructor (functional guards,
  interceptors, resolvers).
- State is a `signal()` / `computed()` by default. An observable (RxJS) only
  where the logic is a stream: operators, cancellation, debounce, combining
  sources over time.
- Forms are reactive: a `FormGroup` handed in through `@Input()`, no
  template-driven forms, no `name=` attributes.
