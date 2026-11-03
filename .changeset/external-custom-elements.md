---
'@gpuiv/native': minor
'@gpuiv/vue': minor
---

A Rust crate can add its own GPUI component as an element: `register_custom_element` stores a factory in a process-wide list that every renderer picks up, and the crate ships its own Node addon loaded through `NAPI_RS_NATIVE_LIBRARY_PATH`. Element names must contain a `-` and cannot reuse a built-in. The public custom-element surface (`CustomElement`, `CustomRenderContext`, `custom_surface`, `wire_standard_events`, `emit_event_full`, `EventCallback`, `GpuixView`, and a re-exported `gpui`) is now importable from `gpuiv_native`; `EventPayload` gains `detail` for custom-event data. See "Your own native elements" in the docs and the runnable `example-rust-native-element/` crate.

In `@gpuiv/vue`, every prop named `on` + an uppercase letter with a function value is now an event listener, on any element — not just the built-in event names — so externally registered elements get custom events (`onGreet` → `greet`). A non-function value stays a data prop, and a prop switching between the two keeps listeners and props in sync.
