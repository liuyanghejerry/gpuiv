---
'@gpuiv/vue': minor
---

Live-window automation now supports keyboard and scroll input (upstream `53b3a89` follow-through).

`fill()`, `press()`, `nativeSimulateKeystrokes`, `nativeSimulateKeyDown/Up`, and `nativeSimulateScrollWheel` now work against `launch()` — the client forwards to the live renderer's `simulateKeystrokes` / `simulateKeyDown` / `simulateKeyUp` / `simulateScrollWheel`, which dispatch through the real GPUI window input pipeline. They previously threw `keystrokes are not live yet`.

Every example entry (`counter`, `diff`, `native-text`, `infinite-chat`, `blurred-window`, `chat`) now honors `GPUIX_BACKGROUND=1` by passing `focus: false`, so agent-driven windows never take the user's keyboard.
