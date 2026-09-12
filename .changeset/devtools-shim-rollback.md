---
'@gpuiv/vue': patch
---

Vue DevTools: `connectVueDevtools()` rolls the `window`/`document` shims back when `@vue/devtools` cannot be imported or the devtools client fails to start, so a failed connect no longer leaves a fake browser visible to the rest of the process. Its `scroll to component` action no longer throws, and `installDevtoolsShims` is no longer part of the public API.
