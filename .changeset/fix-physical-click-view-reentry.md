---
'@gpuiv/native': patch
'@gpuiv/vue': patch
---

Fix a live-window panic on ordinary mouse clicks and text-selection drags.

A physical left click aborted the app with `cannot update GpuixView while it is already being updated`. AppKit dispatches the event with the root view already leased, and GPUIV then nested-updated that same view from the text-selection mouse-up listener.

A tap now skips drag-end cleanup when no drag was active. Real selection-drag move and end work run after the current GPUI effect cycle, so the root lease is released first.
