---
'@gpuiv/native': minor
'@gpuiv/vue': minor
---

`AnimatePresence` keeps leaving children mounted until their exit animation finishes, matching Motion for React. `motion.div` gains an `exit` target and `onMotionComplete`; a child that leaves an `AnimatePresence` swaps `animate` for `exit`, and the node unmounts when the native track reaches the exit target. Completions are generation-aware, so a completion queued for a previous target never unmounts a node that retargeted, and offscreen virtual-list rows settle on schedule (motion now advances per frame over every declared track, not only during element builds). Custom components participate via `usePresence()` / `useIsPresent()`.
