# AGENTS.md - GPUIV Codebase Guide

**Read [README.md](./README.md) first** to understand what GPUIV is, the architecture, mutation API, event flow, supported elements/events/styles, and the test renderer.

> **GPUIV is a self-maintained fork of GPUIX**
> ([`remorses/gpuix`](https://github.com/remorses/gpuix), the React binding),
> ported to Vue 3. How this fork relates to upstream — what is synced,
> declined, or deliberately diverged — is tracked in
> [`docs/upstream/`](./docs/upstream/README.md).

Deep-dive topics live in `docs/agents/` and are linked from the sections below:
[native element rules](./docs/agents/native-elements.md),
[scrolling and hit-testing](./docs/agents/scrolling-hit-testing.md),
[testing](./docs/agents/testing.md),
[profiling](./docs/agents/profiling.md),
[working with the Zed fork](./docs/agents/zed-workflow.md),
[publishing](./docs/agents/publishing.md).

## GPUIV is a thin layer on GPUI

**Read the GPUI docs and the GPUI source before you write native code.** `zed/crates/gpui`
is checked out in this repository. `gpui::ListState`, `gpui::div`, `gpui::Window` and the
rest are the real API; GPUIV only translates a Vue tree into calls on them.

Do not invent behaviour on top of GPUI. If a GPUIV element needs something GPUI does not
do, the order is:

1. Find the GPUI API that already does it. Search `zed/crates/gpui` for the symbol
2. Search `zed-industries/zed` issues and PRs. Someone may have shipped it already
3. Fix it in the `remorses/zed` fork as a normal GPUI change, and bump the submodule
4. Only then, add GPUIV code

**Never paper over GPUI in `packages/native`.** A workaround that re-applies state after
GPUI computed it, patches a value GPUI owns, or reaches around a GPUI invariant will break
on the next submodule bump and is very hard to debug. When such a change is unavoidable,
it must state in a comment what GPUI does, why that is not what GPUIV needs, and which
GPUI call makes it safe.

Prefer the smallest translation. Fewer moving parts is more important than matching any
other framework's behaviour.

## Architecture

```
Vue 3 (TypeScript)  →  napi-rs  →  GPUI (Rust)  →  GPU
```

Vue's custom renderer queues DOM-like mutations; Rust applies them as one atomic
`applyBatch(json)` per flush to a **RetainedTree**; each GPUI frame
`GpuixView::render()` walks that tree and builds ephemeral GPUI elements (Taffy
layout, Metal/Vulkan paint). GPUI is **immediate-mode** — it rebuilds the tree
every frame — and the mutation protocol embraces that instead of fighting it.
Only changed elements cross the FFI boundary.

Full diagrams and explanation: [README Architecture](./README.md#architecture),
[Why This Works](./README.md#why-this-works), [Event Flow](./README.md#event-flow).

## Package Structure

- `packages/native` — `@gpuiv/native`, Rust napi-rs bindings: `renderer.rs`
  (GpuixView, build_element), `retained_tree.rs`, `style.rs`, `theme.rs`,
  `motion.rs`, `automation.rs`, `test_renderer.rs`, `text/`, `syntax/`,
  `markdown/`, `diff/`, `custom_elements/`
- `packages/vue` — `@gpuiv/vue`, Vue 3 custom renderer: `reconciler/` (host
  config, batching, event registry), `components/` (motion, VirtualList, Select,
  FloatingLayer), `automation/`, `packaged.ts`, `testing.ts`, `__tests__/`
- `packages/packager` — `@gpuiv/packager`, app packaging (workspace-only for
  now): `bun run package` → macOS `.app` + Windows portable exe, plus the
  publish/promote auto-update feed. Design: `docs/packaging-plan.md`,
  `docs/auto-update-plan.md`
- `examples/` — chat.tsx (the flagship) and its tests; `scripts/` — dev.ts,
  screenshots.ts; `docs/` — design plans, agents/ deep-dives, upstream/ ledger;
  `zed/` — pinned GPUI fork submodule

This fork has no `zed/crates/gpuix`: Rust changes go directly in
`packages/native/src/`, TypeScript changes in `packages/vue/`.

## The Mutation Protocol (JS → Rust)

The FFI surface is one atomic batch call. The `NativeRenderer` interface (`packages/vue/src/types.ts`) has a single required mutation method — everything else is optional query/command API:

```ts
interface NativeRenderer {
  /** Apply one commit. Returns every element id destroyed by the batch. */
  applyBatch(json: string): Array<number>
  // …optional focus/scroll/selection/window/debug methods
}
```

Element IDs are plain numbers from a JS incrementing counter (u64 in Rust, f64-safe across napi).

The host config talks to a commit-phase `MutationRenderer` facade (`packages/vue/src/reconciler/batch-renderer.ts`): its explicit methods (`createElement`, `setStyle`, …) only push `["opName", ...args]` tuples onto a queue, and `flushMutations()` — invoked on a microtask after Vue's scheduler has run its component update jobs, or synchronously by callers that need the Rust tree current (mount, tests, clock-pinned frames) — flushes the whole queue in **one `applyBatch(json)` FFI call**. The wire format is nine ops:

```
["createElement", id, "type"]      ["setStyle", id, { …style }]   ← raw object
["destroyElement", id]             ["setText", id, "content"]
["appendChild", parentId, childId] ["setEventListener", id, "type", bool]
["insertBefore", parentId, childId, beforeId]
["setRoot", id]                    ["setCustomProp", id, "key", value]   ← raw JSON value
```

- There is no `removeChild` op: `destroy_element` unlinks the child from its parent and invalidates the parent chain in Rust, and `appendChild`/`insertBefore` re-parent. Never reintroduce a detach op — a dangling child id in `parent.children` or a stale `subtree_revision` cache is the bug it hides.
- Queue **raw objects** for `setStyle` / `setCustomProp`. Do not `JSON.stringify` them first — the outer applyBatch stringify would escape that string again and Rust would parse twice. A 10k-row mount spent 626ms in `applyBatch` that way.
- Adding a new mutation means one facade method in `batch-renderer.ts` plus one `BatchOp` variant in `renderer.rs`. The TS facade type is the JS-side validation; the Rust visitor errors on unknown ops (`unknown operation: …`), so a typo fails loudly, not silently.
- Rust decodes the batch straight from its JSON bytes into typed ops, then hash-conses identical style payloads into shared `Arc`s **before** applying — parse-then-apply keeps the batch atomic, and a failed style rolls back what the batch interned. The style table is swept when it doubles or when it outlives a shrunken tree (`maybe_sweep`).

### Event Flow (Rust → JS)

GPUI fires a listener on the element → the Rust closure calls
`emit_event_full(callback, id, type, payload)` → a `ThreadsafeFunction` queues the
`EventPayload` on the Node.js event loop → the JS event registry
(`eventHandlers.get(id)?.get(type)`) runs the Vue handler → the state update
schedules a patch and mutations flow back to Rust. Rust only knows **whether** an
element has a listener (via `setEventListener`), never the closure — handlers live
in JS. Step-by-step diagram: [README Event Flow](./README.md#event-flow).

### Mouse capture is armed by the press

A `div` with `onMouseDown`, `onMouseMove`, and `onMouseUp` keeps receiving move and up after the pointer leaves the hitbox, matching HTML `setPointerCapture`. GPUIV arms that automatically when the same node listens for both `mouseDown` and `mouseMove`: `build_element` calls GPUI's `el.capture_pointer()` on it.

Put all three on the element the user grabs — a clip handle, a resizer, a slider. Capture is armed by the **press**, so an overlay mounted during that press never arms it, and a release past the window edge is lost. A node with only `onMouseDown` / `onMouseUp` does not capture, and a release outside still cancels the click, as in the DOM.

## Iterating on the Rust side

There is no hot reload and there cannot be: `require()` of a `.node` calls
`process.dlopen`, Node has no unload, and the event loop, GPU device, window and
selection registry all live in thread-locals of the loaded library.

Use `bun run dev` (see `scripts/dev.ts`). It watches `packages/native/src`,
rebuilds, and re-renders the screenshot tests. **A Rust edit reaches fresh PNGs
in about 4 seconds.** Prefer screenshot mode over `--app`: PNGs in
`packages/vue/screenshots/` can be read by an agent, a live window cannot.

**Never run `bun run clean` in `packages/vue` while `bun --hot chat.tsx` is
up.** `packages/vue/dist` is inside the app's module graph, so deleting it
under a running watcher breaks every subsequent load until the process is
restarted. Build first, then start the app.

```bash
bun run dev                      # rebuild, re-render the showcase screenshots
bun scripts/dev.ts --shots diff  # only tests matching "diff"
bun scripts/dev.ts --app native-text   # rebuild, restart an example app
```

**Never ship or start the app on a debug native build.** `bun run build:debug`
and `cargo build` without `--release` produce an unoptimized `.node`. GPUI
paint is then many times slower, and that looks like an app bug. Always use
`bun run build` in `packages/native` (release). Use `build:debug` only when
the user asks, or when a debug-only tool (lldb, sanitizers) cannot run on
release. After any debug build, rebuild release before starting `chat.tsx`
or judging frame time.

Two things avoid the rebuild entirely:

- **Content** already lives in props. Change `patch` or `source` and the next
  frame shows it.
- **Design numbers** live in `theme.metrics`. Tuning a row height or heading
  scale is a Vue re-render.

## Native element rules

Full rules: [docs/agents/native-elements.md](./docs/agents/native-elements.md) —
text funnel, GPUI ids, bounds trackers, `Theme::metrics`, macOS menu,
`cx.processor`, virtual-list prepend anchoring. The traps that bite most:

- Every painted string goes through `crate::text` (`selectable_text` for content,
  `chrome_text` for chrome) — **never `div().child(some_string)`**, or the text is
  invisible to selection and to `getPaintedText()`.
- Every element needs a host-derived `.id(..)` or gpui silently loses hover,
  active, pointer capture, and its element state. Never `.id(<index>)` — that is
  the host-id namespace; use a formatted `__gpuix_<kind>_<host id>` name. Never
  `apply_styles` on a stateful root — use `apply_interactive_styles`
  (`custom_surface` does this for you).
- Layout numbers live on `Theme::metrics`, never in a new Rust `const`.
- **Never add an Edit menu carrying ⌘C / ⌘V / ⌘X / ⌘A** — AppKit consumes a menu
  key equivalent before the window sees the key event.
- Virtual-list prepend/loading-row anchoring and `scrollToItem` timing have
  hard-won traps — read the deep-dive before touching virtual-list scroll.

## Scrolling and hit-testing

Full rules: [docs/agents/scrolling-hit-testing.md](./docs/agents/scrolling-hit-testing.md) —
nested scrolling, scroll cost, overlays, icons. The traps that bite most:

- **Nested scrolling is not supported** — keep one scroll parent; an inner
  `overflow: "scroll"`, `<virtual-list>`, or `<diff>` steals the wheel.
- Every native `overflow_x_scroll()` must call `restrict_scroll_to_axis()`, or the
  parent scroller jumps sideways when the pointer is over `<code>` or a table.
- A filled in-flow `div` uses BlockMouseExceptScroll (clicks stop, the wheel
  passes); absolute/fixed or `pointerEvents: "auto"` steals the wheel too;
  `pointerEvents: "none"` inserts no hitbox and does not inherit.
- Menus, tooltips, and dialogs go through `SelectContent` / `FloatingLayer` /
  `<anchored deferred>` — never overflow an absolute card into a `<virtual-list>`.

## Profiling and optimizing

Full playbook: [docs/agents/profiling.md](./docs/agents/profiling.md) (load the
**profano** skill first; do not guess CLI flags). The short version:

- Separate **first mount**, **scroll**, and **chrome setState** — different paths.
- Profile mount through a `createTestApp()` script that exits, not the live window.
  Read **self** time first; **total** is the caller chain.
- `debugFrameOverlay: 'full'` shows **draw time**, not FPS.
- After a renderer change, **build `@gpuiv/vue`** (`cd packages/vue && bun run build`).
  `examples/` and `bun --hot` load `packages/vue/dist`, not `src`; vitest uses `src`.

## Upstream tracking

This fork tracks `remorses/gpuix` (the React binding), which shares no git
history with us — never `git merge upstream/main`; port per-file or per-diff.
The status of every upstream topic (synced / pending / declined / diverged)
lives in [`docs/upstream/README.md`](docs/upstream/README.md). Update that
ledger in the same PR whenever you port, decline, or deliberately diverge from
an upstream change. A declined topic needs its own file under `docs/upstream/`
recording the reason and the revisit triggers. An agent skill driving this
loop lives at `.agents/skills/upstream-sync/SKILL.md`.

## Ported code

`text/`, `syntax/`, `markdown/`, `diff/`, `theme.rs`, `custom_elements/code.rs`,
`custom_elements/diff.rs`, and the caret blink sections of
`custom_elements/input.rs` are ported from [Comet](https://github.com/zeronsh/comet)
(MIT). Each file names its original in
its header, and `THIRD_PARTY_NOTICES.md` has the full table. When fixing a bug in
one of them, read the Comet original first: it usually documents why the code is
shaped that way.

## Auto-generated files (do NOT edit manually)

The following files in `packages/native/` are auto-generated by napi-rs during `bun run build`. Never edit them by hand — they are regenerated from the Rust `#[napi]` annotations every build:

- `packages/native/index.d.ts` — TypeScript type declarations
- `packages/native/index.js` — Node.js loader/binding glue
- `packages/native/*.node` — compiled native binary

To update the TypeScript API surface, edit the Rust source files in `packages/native/src/` (add/modify `#[napi]` structs, methods, functions), then run `bun run build` in `packages/native` to regenerate.

## Changesets

**Always** add a `.changeset/*.md` file after a user-facing fix or feature. Do this before you consider the work done. Never skip it. Never edit CHANGELOG.md. Never bump `package.json` version by hand.

Format (see `.changeset/readme.md`): one kebab-case `.md` file per logical change, `patch` for fixes and `minor` for features, present tense, focused on what users see. Front-matter lists the affected packages:

```md
---
'@gpuiv/native': minor
'@gpuiv/vue': minor
---

Description of the user-facing change.
```

If the change fixes a GitHub issue or should close a PR, put `Fixes #N` / `Closes #N` on its own line. changepub copies those onto the release commit. Do not run the interactive changeset CLI, and do not add vague entries like "misc improvements".

## Publishing

**Never publish from a local machine — CI is the only release path.** Both
packages' `prepublishOnly` scripts exit if `CI` is unset. Publish order is
required (per-platform napi packages → `@gpuiv/native` → `@gpuiv/vue`), because
`@gpuiv/vue` depends on the exact published native version. Full pipeline:
[docs/agents/publishing.md](./docs/agents/publishing.md).

## Building

Cargo uses path dependencies from the `zed/` submodule, which tracks the `gpuix`
branch of `remorses/zed`, so the native addon and native platforms always compile
from the same source. **Always keep `zed/` checked out on the local `gpuix`
branch. Never leave the submodule in detached HEAD state**, including after
`git submodule update` or a pointer update. If Git detaches it, switch back to
`gpuix` before doing any other work.

First-time setup:

```bash
bun install
git submodule update --init --recursive
xcodebuild -downloadComponent MetalToolchain   # macOS, Xcode 26+: gpui_apple compiles shaders.metal
```

- macOS uses `MacPlatform::new_embedded()` and pumps AppKit on Node's main thread;
  Windows and Linux run `gpui_platform::application().run()` on a dedicated UI thread
- Keep `core-text = 21.0.0` / `core-graphics = 0.24.0` on macOS — they avoid the
  core-graphics 0.24 vs 0.25 conflict between `core-text` and Zed's `font-kit` fork
- The default cargo feature is `test-support`, so published binaries include
  `TestGpuixRenderer` and users can write GPU-backed tests for their own apps
- `rust-toolchain.toml` pins the same channel as `zed/rust-toolchain.toml`; when
  the submodule moves, update ours to match or GPUI may not compile

Searching upstream Zed, fixing GPUI in the fork, bumping the gpui revision, and
PRs to Zed: [docs/agents/zed-workflow.md](./docs/agents/zed-workflow.md).

## PRs to GPUIV

When you open a PR with `gh pr create` against **this repo**
(`liuyanghejerry/gpuiv`), the body must name the **harness**, **agent**, and
**model** that wrote the change. Then put **every user prompt** from the
session in a collapsed `<details>` block. Reviewers use that to judge prompt
quality and how much the agent invented.

Do this for `gh pr create` and for later `gh pr edit` if the first body missed
it. Do not add this block to Zed PRs.

```md
**Harness:** OpenCode / Kimaki
**Agent:** build
**Model:** xai/grok-4.6

<details>
<summary>User prompts</summary>

1. first user message, verbatim

2. second user message, verbatim

</details>
```

- **Harness:** the product that ran the agent. Examples: OpenCode, Kimaki,
  Claude Code, Cursor, Codex.
- **Agent:** the named agent if the harness has one (`build`, `plan`, `opus`).
  Write `none` if there is no named agent.
- **Model:** the exact model id from the session (`xai/grok-4.6`,
  `anthropic/claude-opus-4.6`). Do not guess a shorter marketing name.
- **User prompts:** every user message that drove the PR, in order, verbatim.
  Skip system reminders, tool output, and your own replies. If a prompt is
  huge, keep the full text inside the details block; do not summarize it.

## Current Status

Completed features are tracked in the [README **Status** section](./README.md#status);
user-facing APIs belong there. This list is only the remaining engineering work.

### TODO

#### High Priority

- [ ] **Background highlighting** - move Syntect off the frame thread once
      there is a way to request a repaint from a background task

#### Medium Priority

- [ ] **Tablet input** - pen pressure waits on zed PR #63250 (or an aligned
      fork patch); tilt and coalesced events are fork-only. Research and
      revisit triggers in `docs/upstream/tablet-input.md`
- [ ] **Mid-press pointer capture** - arming capture on a press that is
      already in flight needs a hitbox-aware GPUI listener; today
      `setPointerCapture` arms from the next press on

#### Low Priority

- [ ] **Packaging P1/P2** - release signing + notarization (macOS CI),
      Windows signing hook, dmg/installer, S3-backed auto-update feed +
      pure-TS updater (`docs/auto-update-plan.md`), Linux AppImage,
      universal-macOS `lipo` spike. See `docs/packaging-plan.md` phasing
- [ ] **Window controls** - resize, minimize (title already works)
- [ ] **Multiple windows** - Support multiple GPUI windows
- [ ] **Vue HMR** - keep `ref` state across saves. Needs Bun to run the Fast Refresh transform during `bun --hot`
- [ ] **Native hot reload** - cannot unload a `.node`. `bun run dev` rebuilds and restarts
- [ ] **DevTools** - Vue DevTools integration

## Testing

```bash
# Rust unit tests (selection, syntax, diff parser, markdown parser, theme)
cd packages/native && cargo test --lib

# Vue custom renderer + GPU-backed test renderer
cd packages/vue && bun run test

# Example app tests (chat.perf.test.tsx is the draw/chrome perf regression: assert p95 ms)
cd examples && bun run test
```

Use `bun run test`, not `bun test` — the suites are vitest. Vue updates flush on
a **microtask**: after simulating input, `await app.settle()` before asserting.
`getAllText()` only sees `<text>` nodes; `<code>`, `<diff>` and `<markdown>`
paint inside gpui — use `getPaintedText()` and `dragSelect(x1, y1, x2, y2)`.
Screenshots go to `packages/vue/screenshots/` (gitignored).

Integration: `cd examples && bun --hot chat.tsx`. Use tuistory for the
long-running process; do not use `tsx` or raw `tmux`.

Details (THROTTLE CPU clamp, canvas WPT suite, asserting on native elements):
[docs/agents/testing.md](./docs/agents/testing.md).

### Drive the live window

**Do not use `usecomputer`, `screencapture`, or desktop clicks** — use the
Playwright-like automation API (README **Automation** section). Mark targets with
`testId`; `connectTest(app.renderer, app.settle)` in vitest, or
`launch({ command, args })` against a child process.

**Always pass `focus: false` when you start a window to check your own work** —
wire it from the environment (`createApp(App, { focus: process.env.GPUIX_BACKGROUND !== '1' })`)
and set it in `launch({ env })`. `click()` hits the last painted bounds;
`clock.pause` / `set` / `fastForward` freeze native motion; `captureFrames`
writes one PNG per timestamp. `fill()` / `press()` dispatch synthetic keys
through the GPUI input pipeline without activating the window. Full details:
[docs/agents/testing.md](./docs/agents/testing.md).

## Related Projects

- [GPUI](https://github.com/zed-industries/zed/tree/main/crates/gpui) - Zed's GPU UI framework. Read `zed/crates/gpui` before writing native code
- [create-gpui-app](https://github.com/zed-industries/create-gpui-app) - official GPUI starter; example of a pure-Rust gpui app
- [Vue custom renderer API](https://vuejs.org/api/custom-renderer.html) - the `createRenderer` host-config approach GPUIV uses
- [opentui](https://github.com/anomalyco/opentui) - terminal UI with a custom renderer (host-config reference)
- [napi-rs/package-template](https://github.com/napi-rs/package-template) and [Brooooooklyn/Image](https://github.com/Brooooooklyn/Image) - napi-rs native package examples
