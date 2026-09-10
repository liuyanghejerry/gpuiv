---
'@gpuiv/native': minor
'@gpuiv/vue': minor
---

Wire pinch gestures end to end. Any element (including `<canvas>`) can now take an `onPinch` listener: each step carries `x`/`y` (the pinch center), `zoomDelta` (0.1 ≈ a 10% zoom-in, accumulate it into a scale like a browser zoom handler), `touchPhase` (`started`/`moved`/`ended`/`cancelled`) and `modifiers`. Trackpad pinches already arrive from GPUI on macOS, Windows and Linux; they now reach Vue handlers.

Automation gained synthetic pinch: the `pinch` protocol method, `app.mouse.pinch(target, delta, { phase, modifiers })`, `locator.pinch(delta, options)`, and `nativeSimulatePinch` / renderer `simulatePinch`, so tests drive the gesture deterministically through the GPUI input pipeline.
