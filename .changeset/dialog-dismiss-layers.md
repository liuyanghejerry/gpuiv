---
'@gpuiv/native': minor
'@gpuiv/vue': minor
---

Headless `Dialog` components in Base UI's shape: `Dialog` (Root), `DialogTrigger`, `DialogPortal`, `DialogBackdrop`, `DialogPopup`, `DialogTitle`, `DialogDescription`, `DialogClose`. The portal is a new native `<anchored fill="window">` layer — Rust sizes it from the viewport every frame, so a resize never leaves an uncovered strip that clicks could reach. Escape closes through the dismiss layer stack, a modal popup traps Tab inside itself, and focus moves to the popup on open and back to the trigger (or whatever held focus before) on close; `initialFocus` / `finalFocus` override those targets and `modal: false` renders a non-blocking layer. `DismissableLayer` orders nested overlays by nesting rather than mount order, so a Dialog and a Select opening in one commit still stack correctly, and only the topmost layer closes on one Escape. `resolveFocusTarget` is exported for custom overlays.
