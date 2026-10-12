# macOS trackpad event pump

The local 16ms frame-loop interval also limits AppKit event delivery and
display-link callbacks. Cheap synthetic wheel dispatch does not measure this
path: automation dispatches directly into GPUI and paints synchronously.

The Vue loop now pumps macOS every 8ms, subtracting tick work from that budget.
Windows/Linux retain 16ms because their native UI thread owns input delivery.
GPUI still decides when a dirty scene needs painting; there is no unconditional
refresh, extra rendering loop, or change to scroll deltas/inertia.

The earlier visible-row optimization remains necessary. Raising the pump rate
cannot make an expensive frame cheap. The regression in `events.test.tsx`
feeds input at 120Hz while ticks consume 3ms and verifies that a second event
does not accumulate, and stopping the loop stops ticks. It fails under the
old 16ms interval. This is a scheduler test, not proof of physical trackpad
smoothness.

Upstream research (2026-10-08):

- [GPUIX changelog](https://github.com/remorses/gpuix/blob/main/CHANGELOG.md)
  already describes the 8ms leftover-budget pump. Our 16ms cap was introduced
  locally in `5600352` while reducing expensive mounted-tree work.
- [Zed #61637](https://github.com/zed-industries/zed/issues/61637) reports a
  jump when fingers leave the trackpad. It remains open and is not evidence
  that inertia causes this application's sustained-scroll report.

Revisit when embedded GPUI provides an event-driven host wakeup or display-rate
scheduling. Avoid a `setImmediate` pump, which spins while idle. No Zed fork
patch is needed here.
