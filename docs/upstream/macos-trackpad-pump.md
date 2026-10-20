# macOS trackpad event pump

**Resolved (2026-10-21):** the revisit trigger below fired — upstream shipped
the event-driven host wakeup. `515df19` + zed `2565b8a3e` add
`gpui_macos::set_frame_wake_hook` and the `setFrameWakeCallback()` napi method;
`startFrameLoop` in `packages/vue/src/renderer.ts` now wakes from GPUI's
display link (vsync) through a weak, coalesced callback. The fallback timer is
the platform's default poll rate, not upstream's 100ms: macOS stops
display-link delivery to occluded windows, and CI's live automation reads
last-painted bounds — a 100ms fallback let clicks land between a commit and
its first paint (fixed in PR #170 after instrumented CI runs showed ~100ms
wake gaps). An explicit `frameMs` keeps fixed-rate timer polling.

The original divergence, for the record:

The local 16ms frame-loop interval also limited AppKit event delivery and
display-link callbacks. Cheap synthetic wheel dispatch does not measure this
path: automation dispatches directly into GPUI and paints synchronously.

The Vue loop pumped macOS every 8ms, subtracting tick work from that budget.
Windows/Linux retained 16ms because their native UI thread owns input delivery.
GPUI still decided when a dirty scene needed painting; there was no
unconditional refresh, extra rendering loop, or change to scroll
deltas/inertia.

The earlier visible-row optimization remained necessary: raising the pump rate
cannot make an expensive frame cheap. The regression in `events.test.tsx`
fed input at 120Hz while ticks consumed 3ms and verified that a second event
did not accumulate, and stopping the loop stopped ticks. It failed under the
old 16ms interval. That test now pins the poll fallback path; the wake path
has its own tests in the same file.

Upstream research (2026-10-08):

- [GPUIX changelog](https://github.com/remorse/gpuix/blob/main/CHANGELOG.md)
  already described the 8ms leftover-budget pump. Our 16ms cap was introduced
  locally in `5600352` while reducing expensive mounted-tree work.
- [Zed #61637](https://github.com/zed-industries/zed/issues/61637) reports a
  jump when fingers leave the trackpad. It remains open and is not evidence
  that inertia causes this application's sustained-scroll report.
