---
'@gpuiv/native': minor
'@gpuiv/vue': minor
---

Multiple windows on macOS: `createWindow(root, options)` mounts a component in a new native window after `createApp`. Each window gets its own renderer, so element ids, events, focus, text selection, scroll state, automation bounds and paint logs stay per-window. Renderer state that used to live in process-wide thread-locals (automation bounds, the text-selection registry, paint logs, pending scrolls, the repaint-dirty flag) now lives on the window's view, and `GpuixRenderer` holds its own window handle. The returned handle's `close()` unmounts the tree, closes the OS window and drops the renderer from the frame loop. Windows/Linux report an explicit "not supported yet" error.
