# Testing

Deep-dive extracted from the root [AGENTS.md](../../AGENTS.md) — read that first.

### Unit Tests

```bash
# Rust unit tests (selection, syntax, diff parser, markdown parser, theme)
cd packages/native && cargo test --lib

# Vue custom renderer + GPU-backed test renderer
cd packages/vue && bun run test

# Example app tests
cd examples && bun run test

# Chat draw / chrome regression (same suite, file filter)
cd examples && bun run test chat.perf.test.tsx

# macOS CPU clamp. E-cores, not Chrome 6x. Do not set in CI.
THROTTLE=utility bun run test chat.perf.test.tsx
```

Use `bun run test`, not `bun test` — the suites are vitest, so `bun test` picks
the wrong runner.

`examples/chat.perf.test.tsx` is the automated profile. It uses `createTestApp()`,
not the live window. Assert **p95 draw / flush ms**, not a per-frame FPS floor.

`packages/vue/src/__tests__/canvas-wpt.test.ts` runs a vendored subset of the
W3C web-platform-tests canvas suite (593 cases: 452 run, 141 skipped with the
missing API named in the title) against the 2D context — no window, no GPU
renderer; it loads `@gpuiv/native` for the rasterization core, so it needs a
built `.node`. The cases come from `packages/vue/wpt/yaml/`; regenerate the
JSON with `bun scripts/convert-canvas-wpt.ts` after updating them. A case the
context cannot express yet goes into the `requires` list in the converter,
not into a `skip()` in the runner — the skip reason must stay machine-visible.

`THROTTLE` re-execs under `taskpolicy -c`. `utility` is an M1/M2 Air CPU proxy.
`background` is harsher, closer to a 2019 Intel Mac. GPU and RAM stay on this
machine. `taskpolicy -c` only works at launch. The vitest config wraps the main
process so workers inherit the clamp. A throttled run **logs** numbers and
skips the default budgets. Those budgets are for an unclamped M-series CPU.

### Asserting on native elements

`getAllText()` reads the retained tree, so it only sees `<text>` nodes. `<code>`,
`<diff>` and `<markdown>` paint inside gpui and are invisible to it. Use
`renderer.getPaintedText()` (every string painted last frame, in paint order) and
`renderer.dragSelect(x1, y1, x2, y2)` instead.

`dragSelect` exists because selection listeners are registered during **paint**:
calling `simulateMouseDown` / `Move` / `Up` by hand without a flush between each
step silently selects nothing.

Vue updates flush on a **microtask**, not synchronously. After simulating input,
`await app.settle()` before asserting on the tree — it flushes Vue's scheduler,
applies pending mutations, and repaints.

Screenshots go to `packages/vue/screenshots/` (gitignored), not `/tmp`, so they
can be inspected after a run.

### Integration Test

```bash
cd examples && bun --hot chat.tsx
```

Use tuistory for the long-running process. Do not use `tsx` or raw `tmux`.

### Drive the live window

**Do not use `usecomputer`, `screencapture`, or desktop clicks.** GPUIV has a
Playwright-like automation API. Full docs are in the README **Automation**
section.

Mark targets with `testId`. Then either:

- `connectTest(app.renderer, app.settle)` against `createTestApp()` in vitest
- `launch({ command, args })` against a child process. The app serves commands
  on stdin only when stdin is a **pipe**

**Always pass `focus: false` when you start a window to check your own work.**
The user is doing something else. A window that activates on launch takes the
keyboard mid-sentence, once per iteration, and there is no reason for it:
`click()` and `screenshot()` never need focus. Wire the entry file so the flag
comes from the environment, then set it in `launch({ env })`, so a human run
still behaves normally.

```tsx
createApp(App, { focus: process.env.GPUIX_BACKGROUND !== '1' })
```

`fill()` and `press()` work against `launch()` too: the live renderer's
`simulateKeystrokes` dispatches synthetic key events through the window's GPUI
input pipeline, so native `<input>` and `<textarea>` get real key handling
without the window activating. `createTestApp()` is still preferable for
typing-heavy checks — it opens no window at all.

`click()` hits the last painted bounds. `clock.pause` / `set` / `fastForward`
freeze native motion. `captureFrames` writes one PNG per timestamp. That is how
you record a sidebar open/close, not a screen recorder.

