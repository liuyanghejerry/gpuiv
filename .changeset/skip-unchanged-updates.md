---
'@gpuiv/vue': patch
---

A re-render that produces the same values no longer sends mutations for them. Inline `style={{ ... }}` objects and object-valued props are new on every render but identical in content; they are now compared by their serialized payload and skipped, and a swapped inline event handler re-registers locally without re-sending `setEventListener`. On a 300-row styled list, a no-change re-render went from ~1,450 redundant ops (styles, props, listener flags — each JSON-stringified across the FFI and parsed by Rust just to be discarded) to zero; a Rust-side comparison still guards the remaining ops.
