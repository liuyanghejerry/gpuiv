---
'@gpuiv/vue': minor
---

Vue DevTools integration: `connectVueDevtools()` connects a running app to the standalone Vue DevTools server (`bun x vue-devtools`) — the component tree, props, and `setup()` state appear in the devtools UI. Call it before `createApp()` so the hook installs in time; it no-ops on repeat calls after a `bun --hot` reload and returns `false` with a console hint when `@vue/devtools` is not installed (optional peer dependency). DOM-dependent devtools features (element highlight, select-element, open-in-editor) stay inert.
