# Vendored W3C canvas conformance cases

`yaml/` holds a vendored subset of the W3C web-platform-tests canvas suite
(3-Clause BSD; see `THIRD_PARTY_NOTICES.md`), downloaded from
[`html/canvas/tools/yaml/`](https://github.com/web-platform-tests/wpt/tree/master/html/canvas/tools/yaml).
These suites cover the API surface our 2D context implements; text, shadows,
filters, drawing-images and OffscreenCanvas suites are deliberately not vendored.

`generated/canvas-wpt.json` is the committed case table the vitest runner
(`src/__tests__/canvas-wpt.test.ts`) consumes. Regenerate it after changing
the YAML:

```bash
bun scripts/convert-canvas-wpt.ts
```

The converter rewrites the YAML's `@assert` / `@nonfinite` pseudo-lines into
executable assertions — the same rule set WPT's gentest applies — and tags
each case with the APIs our context does not implement yet, which the runner
skips with the missing API in the test name.
