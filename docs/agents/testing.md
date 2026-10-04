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

# Beautiful UI CI gate (macOS release native binding required)
cd examples && CI=true bun run test:perf

# Resource reclamation gate + production-Bun memory trends (macOS release)
cd examples && CI=true bun run test:memory

# macOS CPU clamp. E-cores, not Chrome 6x. Do not set in CI.
THROTTLE=utility bun run test chat.perf.test.tsx
```

Use `bun run test`, not `bun test` — the suites are vitest, so `bun test` picks
the wrong runner.

`examples/chat.perf.test.tsx` is the automated profile. It uses `createTestApp()`,
not the live window. Assert **p95 draw / flush ms**, not a per-frame FPS floor.

`beautiful-ui-performance` is a separate CI job using the release macOS binding.
Its fixed p95 budgets and deterministic cadence/scroll assertions live in
`examples/beautiful-ui.perf.test.tsx`; `vitest.perf.config.ts` makes a missing
native renderer or `THROTTLE` a failure. Raw measurements and the Vitest report
go to `tmp/beautiful-ui-perf-gate/` and upload even when a test fails. The job
blocks publishing; add its status check to branch protection to require it
before merging. See [Beautiful UI performance checks](../../packages/beautiful-ui/README.md#performance-checks)
for budgets and the live audit.

### Memory resource gate

`memory-leak` reuses the release macOS binding and pins Bun 1.3.14. Run
`cd examples && bun run test:memory` after building native, Vue and Beautiful UI.
Vitest launches a separate production-Bun process for each scenario, so its own
reporter, mock history and module loader do not contaminate heap measurements.
The ordinary example suite excludes this dedicated gate.

Each scenario keeps one renderer/window alive for 30 mount/exercise/unmount
cycles: loaders, gallery scrolling, menus/dialogs, and native input, text
highlighting, virtual lists, images and Canvas resize. After empty frames and
deferred work, every per-node ownership count must return to its initial
empty-root baseline; final root unmount must leave zero. GPUI's entity snapshot
assertion also rejects new surviving entities. No resource-counter query
performs cleanup. Timer and shared-animation subscriber counts must be zero.
The native scenario verifies that each resource family was actually exercised.

Interned styles intentionally retain up to the 64-entry sweep floor on an
empty tree; syntax caching keeps at most 96 documents / 24 MiB of estimated
retained data. These caches have capacity assertions rather than zero assertions.

Ten cycles warm the runtime; synchronous Bun GC runs between event-loop turns
every five later cycles. JS heap, off-heap JS data and RSS are **reported only**
until hosted-runner data supports fixed byte budgets. They do not measure all
Rust allocations or GPU memory, so passing this gate is not proof of absence of
every possible leak. Do not silently enable a moving or per-commit budget.

Three deliberately retained resources (timer, unreachable native node, and an
event closure capturing a buffer) must each fail in a subprocess. Missing native
bindings, missing reports, skipped scenarios, timeouts and failed release builds
fail the gate. Raw per-cycle ownership, GC samples, runtime metadata, worker logs
and Vitest JSON go to `tmp/memory-leak-gate/` and upload on failure too.
The gate blocks publishing and packaging; require its `memory-leak` check in
branch protection. Keep runtime upgrades explicit so calibration is comparable.

`TestRenderer.getResourceStats()` reads ownership counts and JS event handlers.
Capture `captureEntityLeakBaseline()` on an empty root before mounting tested
content; after unmount and empty paints, call `assertNoNewEntityLeaks()`.
Set `LEAK_BACKTRACE=1` before launch for GPUI allocation traces when available.
These methods use the currently active native test context; creating another
test renderer replaces that context and its entity baseline.

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
Playwright-like automation API. Full docs are in the
[API reference](../reference.md#automation).

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
