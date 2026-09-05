# Upstream tracking

This fork (`liuyanghejerry/gpuiv`, Vue 3 binding) tracks upstream
[`remorses/gpuix`](https://github.com/remorses/gpuix) (React binding). This
directory is the ledger of that relationship: what we have synced, what we have
refused and why, and what is still open.

**Hard constraint:** upstream has no shared git history with us (its history
was squash-rewritten). Never `git merge upstream/main` — port per-file or
per-diff. The zed submodule protocol is in the root
[`AGENTS.md`](../../AGENTS.md#building).

## The process

An agent skill wrapping this loop (including this machine's build quirks)
lives at `.agents/skills/upstream-sync/SKILL.md`.

1. **Inventory** — `git fetch upstream`, then
   `git log --oneline <last-inventoried>..upstream/main`. Group commits by
   topic (a topic is anything that would be ported or refused as a unit).
   Update the *Last inventoried* line in the ledger.
2. **Decide** — take the grouped topics to the maintainer. Every topic gets
   exactly one status:
   - `synced` — ported here; record the PR number
   - `pending` — not synced yet; a candidate for a future round
   - `declined` — we will not port it unless a revisit trigger fires;
     **requires a topic file** in this directory with the reason and triggers
   - `diverged` — upstream moved in a direction we deliberately reject; a
     row-level reason is enough until the reasoning outgrows the row, then
     promote it to a topic file
3. **Port** — one topic per PR, never stacked on an unmerged branch (a stacked
   PR is auto-closed when its base is squash-merged and deleted — PR #5 died
   that way). React→Vue differences in the binding layer are a port, not a
   copy. Follow the PR body rules in the root `AGENTS.md`.
4. **Record** — the same PR that ports, declines, or diverges a topic updates
   the ledger below. No sync work is done until the ledger says so.

## Ledger

Inventoried range: `367ef48..cbc3de0` (2026-09-04). Earlier history is in
[Sync log](#sync-log) below.

| Topic | Upstream commits | Status | Notes |
|---|---|---|---|
| Wasm / browser rendering, website | `75a1fe6` `92082a3` `7d6e1f9` `711945f` `7f6732a` `7a3e356` `bbcea1f` `291b92d` `a906cf9` `f52fa54` `de1c74a` `4194d9b` `3bb1ac6` | declined | [wasm-web-rendering.md](./wasm-web-rendering.md) — `de1c74a` (serve infinite-chat at `/infinite`) and `4194d9b` (compact website layout) extend the same topic; `3bb1ac6`'s website-tooling half joins it (its README keyboard reference rides with the Tab-key port) |
| CI / release plumbing | `0b257d0` `301b834` `ac0426c` `322993e` `e68f2ec` `dfb83f3` `a24b4a4` | declined | one-target-per-OS matrix and archive shipping serve their matrix, not ours; our CI publishes both packages; `322993e` `e68f2ec` `dfb83f3` are their 0.6.0 release + bun-publish npmrc fixes; `a24b4a4` is their 0.7.0 release (our releases go through changesets + CI) |
| `create-gpuix-app` CLI scaffolder | `6e75327` `4a24b43` `3e2d121` | declined | [create-gpuix-app-cli.md](./create-gpuix-app-cli.md) |
| Example app / starter / timeline | `7d45d36` `691ca1f` `9472574` `6c5b0b5` `3d759b2` `813ece4` `555fa30` `8210a38` `cbc3de0` | declined | upstream-only surfaces (`example-app/` starter, timeline demo, `mail.tsx` + README hero); revisit if we ship a starter |
| Upstream contribution-policy docs | `2c807b2` | declined | their AGENTS.md change allowing collaborator PRs; no code, nothing to port |
| Occlude semantics relaxation | `d96413d` | diverged | upstream lets the wheel pass under absolutely positioned items; we keep absolute/fixed occluding (documented in root AGENTS.md). Revisit if it causes real scroll bugs |
| VirtualList wrapper removal | `3d759b2` | diverged | upstream deleted the React wrapper ("there must not be one"); we keep the Vue wrapper — `chat.tsx` depends on it. Revisit if windowed mounting moves fully native |
| macOS application menu bar | `7baa36f` `d804d93` | synced | PR #17 — `app_menu.rs`, `appName` window option (TS type comes free via native d.ts), AGENTS + README docs; no Edit menu on purpose |
| Text-search highlight | `bb138ba` `9a18172` `c444c28` `8aef438` `12fb344` `848c617` | synced | PR #18 — `text/search.rs`, two-level resolve cache on `searchRevision`, `Inherited.highlight` cascade, paint-order numbering incl. `<code>`/`<markdown>`/`<diff>`, Vue `useTextSearch` + `findRanges`, `getPaintedHighlights`; virtual-list offset is app-supplied (`matches: { total, indexOffset }`) |
| Element identity & one-root | `d655dd1` `a4730a5` `4519156` `32ffa54` `6319b0d` `3d9eb0e` `4dde73a` | synced | PR #21 — one `build_host_container` for div/text with `ElementId::Integer`, `apply_interactive_styles`/`custom_surface` everywhere, img/svg/anchored events + `on_painted` bounds, one-renderer-one-root in the Vue host, zed → `8b94def`. React's Suspense test and fresh-ids-per-root test not ported (no Vue counterpart); Vue already freed removed text nodes — pinned by test |
| Background window launch | `594ba31` `dbeca11` | synced | PR #22 — `focus`/`show` window options gating `cx.activate`, napi `activateWindow()` + `UiCommand::ActivateWindow`, `GPUIX_BACKGROUND` pattern in chat.tsx + AGENTS rule; live `fill()` doc claim corrected |
| Virtual-list pinning / anchoring | `01f5788` `ae4766f` `a8f302a` `c8a96b8` `329a52f` | synced | PR #24 — top pin on prepend guarded by `is_following_tail()`, queued `scrollToItem(id, index, offsetInItem?)` applied after the frame's splice, `getListScrollTop` logical anchor; Vue `<VirtualList>` exposes `scrollToItem`/`getListScrollTop` (sentinel decoded to `atEnd`)/`id` via template ref + window widening; anchoring-by-index and row-height docs; flushSync half of `c8a96b8` skipped (React-specific, `flushMutations()` already documented) |
| Infinite-chat example | `50e08b9` | synced | PR #25 — Vue port: host `<virtual-list>` with retained children + `onVisibleRange`; the React `PublicInstance` ref maps to our already-exported `HostNode`; `SafeMdxContent` gained an `onLinkClick` render ctx in chat.tsx; `string-dedent` inlined as a local helper (no new dep); React's `flushSync` ordering is native's queued `scrollToItem`, tests settle twice after `scrollToItem` because visibleRange dispatches at flush end |
| Mutation wire format / retained-tree perf | `230400e` `2daf988` `fd06111` `f948f50` `4369d55` | synced | PR #27 — atomic `applyBatch` only (12 per-op napi methods deleted from GpuixRenderer/wasm/TestGpuixRenderer), typed `BatchOp` decode from raw bytes (borrowing strings, `&RawValue` styles, strict bool `hasHandler`), `Arc<StyleDesc>` hash-consing + two-arm `maybe_sweep`, `destroy_element` unlink hunk from `bb138ba` (PR #18 had skipped it), Vue `MutationRenderer` facade keeping the microtask `schedule` hook, raw renderer in app context, bench tooling (`bench_serde.rs`, `bench-serialization.ts`, serialization-benchmark doc); `fd06111` already landed via PR #18; CI smoke line from `579c8c7` applied to our Windows step |
| Comet selection continuity + generic input edits | `fb75c1c` `1cd46cd` | synced | PR #28 — soft-wrap wash geometry, frame-level drag listeners (drag survives anchor unmount), virtual-list edge autoscroll stopping at list ends, input double/triple-click word/all select without arming a drag, textarea drag autoscroll, 700ms-coalesced undo (200-step cap), `TestRenderer.advanceTime` driving GPUI's test dispatcher |
| Linear gradient backgrounds | `09e0cae` | synced | PR #29 — `BackgroundValue` union + `resolved_background()` shared by painting/occlusion/anchored-fill, `LinearGradientBackground` Vue types, README section; `comparePixels` screenshot test skipped (no pixel-diff harness here), wire-level `gradient.test.tsx` instead |
| Blurred window example | `3e3249b` | synced | PR #30 — Vue port of the frosted-glass dashboard, `bun run blurred-window` script, README row; verified with a live background window screenshot |
| Docs: background automated windows | `53b3a89` | synced | PR #31 — `GPUIX_BACKGROUND` wired into counter/diff/native-text (chat/infinite-chat/blurred-window already had it), README claims corrected; also completes the live-keyboard half of `64241ce` that #16 left unwired (live client now forwards keystrokes/keyDown/keyUp/scrollWheel) |
| Repo-wide rustfmt | `ca256d3` | declined | formatting-only; our native files diverge, so porting it just adds diff noise. Revisit if formatting drift makes future hand-ports painful — then run the same rustfmt pass on our crate |
| Tablet input (zed submodule, not a React-binding topic) | — | researched | [tablet-input.md](./tablet-input.md) — pen pressure waits on zed PR #63250 (or a small aligned fork patch); tilt/coalesced are fork-only; fork's `TouchEvent` has no dispatch. Canvas ships without it |
| Automation API expansion | `c2b60e8` `ff6daf5` `5805701` `64241ce` | synced | PR #16 — Locator hover/wheel/dragTo/dragBy/center, `app.mouse.*`, modifiers everywhere, live scroll+keyboard, `<input>` bounds_tracker, `textContent` descendants; browser-input docs from `5805701` skipped (web topic) |
| Test renderer hardening | `3505f68` `20483dd` `5719d7f` `3cb50c2` `6ad8f83` `bde0ca7` `f93e891` `d1d58e0` `e4fb1c3` | synced | PR #15 — Windows DirectX suite in CI, constructor window sizing, real `getWindowSize`, teardown Drop; test-file-only parts (screenshots-in-repo, wrap literals, word chord) moot for our corpus |
| `onAuxClick` + click button | `280d6ec` | synced | PR #11 |
| Window size polling | `f587575` | synced | PR #12 |
| `<code>` as bare surface | `5033808` `f81e087` | synced | PR #14 — breaking: `showHeader` gone, `codePaddingX`→`mdCodePaddingX` etc.; card moved into app code (chat `CodeBlock`) |
| Hygiene | `f921bec` `d1e4c98` `a9cda59` | synced | PR #13 |
| Nonblocking embedded AppKit ticks | `9b1def2` `5700c96` | synced | PR #37 — zed `8b94def` → `df3c9b7`: `tick()` drains only ready AppKit events so Bun timers/sockets/PTYs progress between frames; README docs + idle-tick perf regression test (their #39) |
| Primary clicks from mouse-up | `bf98e07` | synced | PR #38 — deliver `onClick` from primary mouse-up (GPUI's semantic click never finalizes under the embedded macOS pump); renderer + custom elements + the diverged `input.rs` hunk (their #41) |
| Windows DPI + last-window quit | `aacb070` | synced | PR #39 — Per-Monitor-V2 DPI awareness from inside the `.node` (node/bun have no manifest) + Windows/Linux `tick()` reporting last-window close so the JS loop exits (their #31/#32) |
| Linux `TestGpuixRenderer` stub | `5937978` | synced | PR #40 — export the class on every platform; construction throws an explanation where the GPU test renderer is unavailable; `hasTestGpuixRenderer()` gates `hasNativeTestRenderer` (their #30) |
| `<img>` data URLs | `b20e98a` | pending | base64 + percent-encoded `data:` sources retained as `gpui::Image`; decoder shared with the SVG source path (their #35) |
| macOS window survives JS runtime errors | `2487521` | pending | `startFrameLoop` catches `tick()` throws and reschedules; native callbacks catch handler throws; `uncaughtException`/`unhandledRejection` keep bun alive; loop starts before first flush and survives remounts |
| Events live across `bun --hot` | `1c4c67b` | pending | renderer-owned containers / element-ID allocators / window key-event ids persist across module re-evaluation via a `Symbol.for` registry; stale events rejected (their #37) |
| Tab key ownership | `10e1bb0` `3bb1ac6` | pending | breaking: remove the process-wide Tab/Shift+Tab focus bindings; napi `focusNext`/`focusPrevious`/`setWindowKeyEvents` + window-level `onKeyDown`/`onKeyUp` with remount-safe generations; README keyboard reference from `3bb1ac6` (their #36) |
| Live automation mouse lease fix | `e948b20` | pending | dispatch locator mouse input through `AnyWindowHandle` instead of holding the root view (nested lease aborts the process); child-process regression test (their #38) |

Already accounted for: `4006d99` (thin-layer-first docs) was ported with the
AGENTS.md batch in PR #8.

**Last inventoried upstream head:** `cbc3de0` (2026-09-04)

## Sync log

Fork point: `9f0fb6d` (upstream PR #17 merge). Content selectively ported
from upstream through `367ef48`:

| PR | What came over |
|---|---|
| #3 | Apache-2.0 LICENSE (root + native package) |
| #4 | Syntect replaces Tree-sitter (`syntax/` rewrite, Cargo deps) |
| #6 | zed submodule `4d80927` → `773208d` (`gpuix` branch), pointer capture, virtual-list `estimatedItemHeight`, `getWindowInsets()`, markdown wrap/bounds, Vue-side ports + tests |
| #7 | Syntect warmup at renderer construction (fixes first-mount latency; our own fix, not upstream's) |
| #8 | AGENTS.md guidance port for synced code + framework-agnostic workflow |
| #11 | `onAuxClick` (gpui `on_aux_click`), `simulateClick` button param, automation `click({ button })` — upstream `280d6ec` |
| #12 | `useWindowSize` polls with `intervalMs` instead of reading once — upstream `f587575` |
| #13 | `<code>` CRLF normalize + regression test, `*.tsbuildinfo` ignored, vue `build`/`clean` split — upstream `f921bec` `d1e4c98` `a9cda59` |
| #14 | `<code>` bare surface: glyphs only, `style` is the surface, `showHeader` removed, `code*` card metrics → `mdCode*`; card moved into app code — upstream `5033808` `f81e087` |
| #15 | Test renderer hardening: Windows DirectX + full CI suite, `new TestGpuixRenderer(w, h)` / `createTestApp` sizing, real `getWindowSize`, Drop teardown, `build:release --no-default-features` for Linux — upstream `3505f68`…`e4fb1c3` (9 commits) |
| #16 | Automation expansion: drag/hover/wheel/modifiers, `app.mouse`, live scroll+keyboard, `<input>` locatable, `textContent` descendants — upstream `c2b60e8` `ff6daf5` `5805701` `64241ce` |
| #17 | macOS application menu bar: `app_menu.rs` + `with_window_menu_actions`, `appName` window option — upstream `7baa36f` `d804d93` |
| #18 | Text-search highlight: `search.rs` + paint/selection integration (3-way merged over our fork's selection work), `searchRevision` + two-level cache, `Inherited.highlight` cascade, paint-order ordinals, `useTextSearch`/`findRanges` (Vue: refs + JSX spread), `getPaintedHighlights`, `settle()` now dispatches build-time events — upstream `bb138ba`…`848c617` (6 commits) |
| #21 | Element identity & one-root: unified div/text builder with integer GPUI ids, hover/active on every element, img/svg/anchored events + `on_painted` bounds, GIF state, one-renderer-one-root guard + owner-scoped detach, `getRetainedElementCount`, zed `788c72f` → `8b94def` — upstream `d655dd1` `a4730a5` `4519156` + docs |
| #22 | Background launch: `focus`/`show` options gating `cx.activate`, `activateWindow()` napi + UiCommand, `GPUIX_BACKGROUND` in chat.tsx, agent-drive docs, live `fill()` claim corrected — upstream `594ba31` `dbeca11` |
| #24 | Virtual-list pinning/anchoring: top pin on prepend + followTail guard, queued `scrollToItem(id, index, offsetInItem?)` (negative offset = pixel-stable restore), `getListScrollTop` logical anchor; Vue `VirtualList` ref API (`scrollToItem`/`getListScrollTop` with `atEnd` decode/`id`) + window widening; chat.tsx drops the `$el.id` escape hatch — upstream `01f5788` `ae4766f` `a8f302a` `c8a96b8` `329a52f` |
| #25 | Bidirectional infinite-chat example on host `<virtual-list>` children + `onVisibleRange`, `SafeMdxContent` `onLinkClick` render ctx in chat.tsx, `HostNode` template ref (upstream's `PublicInstance` was already our `HostNode`), local `dedent` helper instead of `string-dedent` — upstream `50e08b9` |
| #31 | Background automated windows + live keyboard: every example honors `GPUIX_BACKGROUND`, live client forwards keystrokes/keyDown/keyUp/scrollWheel (completes `64241ce`), README/AGENTS claims corrected — upstream `53b3a89` |
| #30 | Blurred-window example: frosted-glass dashboard on `windowBackground: 'blurred'`, Vue port, examples script + README row — upstream `3e3249b` |
| #29 | Linear gradient backgrounds: `style.background` value union (two-stop `linear-gradient`, sRGB/Oklab), shared resolution for paint/occlude/anchored fill, Vue types + README — upstream `09e0cae` |
| #28 | Comet selection continuity + generic input edits: soft-wrap wash fix, frame-level drag listeners + virtualized drag continuation, list edge autoscroll with stop-at-end, input word/all multi-click, textarea drag scroll, coalesced bounded undo, `advanceTime` test-dispatcher API — upstream `fb75c1c` `1cd46cd` |
| #27 | Atomic mutation batches: typed-op decode from raw bytes, `Arc<StyleDesc>` hash-consing + two-arm style-table sweep, `destroy_element` unlink, per-op napi methods removed, Vue `MutationRenderer` facade (microtask `schedule` kept), bench tooling — upstream `230400e` `2daf988` `fd06111` `f948f50` `4369d55` + `bb138ba` destroy hunk + `579c8c7` CI line |
| #37 | Nonblocking embedded AppKit ticks: zed `8b94def` → `df3c9b7`, README pump docs, idle-tick child-process regression — upstream `9b1def2` `5700c96` |
| #38 | Primary clicks from mouse-up in `wire_host_events`/`wire_standard_events`/editor, click payload `button:0`, tests — upstream `bf98e07` |
| #39 | Windows Per-Monitor-V2 DPI from the UI thread + `ui_running` atomic behind `tick()`/`requiresTick()` on Win/Linux, quit-mode pin, frame-loop docs + exit-once test, `windows` 0.61 dep — upstream `aacb070` |
| #40 | `TestGpuixRenderer` throwing stub outside macOS/Windows test-support, `hasTestGpuixRenderer()` + Vue `hasNativeTestRenderer` gate, availability test — upstream `5937978` |

(#5 was auto-closed by branch deletion after its base was squash-merged; its
content re-landed as #6.)
