---
title: Performance plan (from the open-source benchmark ports)
description: >
  Follow-up work found by porting React Native's New Architecture
  benchmarks and krausest/js-framework-benchmark to GPUIV. Ordered by
  expected impact; each item names how it is measured.
---

# Performance plan

Background: `examples/bench-oss/` ports two public benchmarks and runs the
same Vue render functions on GPUIV (plain scroll `div` and `<virtual-list>`)
and on Chromium's DOM.

- React Native New Architecture benchmarks:
  [reactwg discussion #123](https://github.com/reactwg/react-native-new-architecture/discussions/123)
- [krausest/js-framework-benchmark](https://github.com/krausest/js-framework-benchmark), keyed

Baseline (Linux, Intel UHD 630, commit `b91bcf6`):

| | GPUIV plain | GPUIV `<virtual-list>` | Chromium DOM |
|---|---:|---:|---:|
| 5000 `<Text>` mount | 170 ms | 22 ms | 80 ms |
| select row (1k rows) | 120 ms | 3.5 ms | 3.0 ms |
| create 10k rows | 1449 ms | 299 ms | 694 ms |
| append 1k to 10k | 1539 ms | 44 ms | 110 ms |
| RSS with 10k rows | 1719 MB | 482 MB | n/a |

What the numbers say:

- **Every frame rebuilds the whole retained tree.** In a plain scroll
  container, a one-row change costs a full-tree frame: about 4 µs per `div`
  and about 20 µs per `<text>` (`bench-oss/frame-probe.ts`).
- **Text costs the most per node.** One Vue `<text>` with a string child
  becomes five GPUI elements, each with its own Taffy node:
  1. the host `<text>`, a stateful `div`
  2. the `#text` instance, a second stateful `div`
  3. a wrapper `div`
  4. an absolute `canvas` underlay
  5. the `StyledText`

## Work items

### 1. Cheaper `<text>` ✅ done

A `<text>` with a string child went from five GPUI elements per frame to
two: the host `<text>` and one `TextRunElement`.

1. **Fold the run into one element.** `selectable_text` / `chrome_text`
   now build `TextRunElement` (`text/paint.rs`), which wraps `StyledText`.
   It delegates layout and prepaint through gpui's public `Element` trait, and
   paints the old canvas underlay (washes, selection registry, paint log)
   just before the glyphs. This drops the wrapper `div` and the `canvas`.
2. **No per-frame allocations on the hot path.**
   - `RetainedElement::content` is a `SharedString`, so a frame bumps a
     refcount instead of copying the string.
   - The selection key `"{id}:0"` is made once in `set_text`
     (`RetainedElement::text_key`) and reused by paint and search.
   - The inline-image cache defaults to one shared thread-local `Rc`.
3. **Text-instance fast path.** A retained `#text` instance with content and
   nothing else (no style, listeners, props, focus, capture or children) no
   longer gets a stateful host `div`. That `div` had no role, so it had no AX
   node, and its only output was automation bounds. The run now records
   those bounds itself (`TextRunElement::record_bounds_as`).

Measured as an interleaved A/B/C of the three `.node` builds
(`frame-probe.ts`, frame after a trivial change, median of 30):

| Tree | before | after step 1 | after steps 2+3 |
|---|---:|---:|---:|
| 5000 `<text>` | 103 ms | 78 ms | **51 ms** (−50%) |
| 1000 table rows | 114 ms | 95 ms | **77 ms** (−33%) |

Layout equivalence: `bench-oss/layout-snapshot.ts` + `layout-diff.ts` on
chat, beautiful-ui, animal-island, markdown-editor, diff, and a text
fixture. Every node, including every text instance, keeps its bounds within
0.5px, and the painted-text log is identical. The only diff is
beautiful-ui's live elapsed-time label.

Follow-ups:
- A `<text>` still costs a stateful host `div` plus the run, about 10 µs
  per frame each.
- The structural cost that remains is item 2.

### 2. Make unchanged or off-screen subtrees cheap per frame

The plain-scroll select-row case is 40× slower than the DOM. Options, in
the order AGENTS.md requires (GPUI first):

- Find a GPUI mechanism that culls off-screen children of an
  `overflow: scroll` container, or that reuses last frame's layout for a
  clean subtree. Search `zed/crates/gpui` and zed issues and PRs.
- If none exists, propose one upstream (`remorses/zed`, `gpuix` branch) before
  writing any GPUIV-side caching keyed on `subtree_revision`.

Measure with the js-framework-benchmark select, swap and remove rows, and
partial update, all in plain mode.

### 3. Memory of large plain trees

10k plain rows sit at 1.7 GB RSS, against 482 MB virtualized. Heap-profile
the plain 10k case: suspect per-frame element allocation and the per-node
bounds and paint registries.

### 4. Virtual-list clear path

Clearing 1k rows applies a batch in 12.6 ms with `<virtual-list>`, against
3.2 ms plain. Profile the `ListState` teardown and unmount path.

### 5. Steer long lists to `<virtual-list>`

The reference already says so. Add a dev-mode warning when one plain
scroll container retains more than about 300 children.

### 6. Track the numbers in CI

Run `bench-oss` on the macOS runner with the `GPUIV_PERF_GATE` pattern used
by `beautiful-ui.perf.test.tsx`. Publish the tables to the step summary, and
gate only on gross regressions.

## Running the benchmarks

GPUIV opens a real window. Use CI, or a private headless compositor, and
never a shared desktop:

```bash
dbus-run-session -- gnome-shell --headless --wayland --no-x11 \
  --wayland-display=gpuiv-bench --virtual-monitor 1280x800@60 &
cd examples
env -u DISPLAY WAYLAND_DISPLAY=gpuiv-bench bun bench-oss/gpuiv.ts
env -u DISPLAY WAYLAND_DISPLAY=gpuiv-bench VIRTUAL=1 bun bench-oss/gpuiv.ts
env -u DISPLAY WAYLAND_DISPLAY=gpuiv-bench KIND=texts COUNT=5000 bun bench-oss/frame-probe.ts
HEADLESS=1 bun bench-oss/browser.ts
```

Results land in `tmp/bench-oss/*.json`.
