---
'@gpuiv/vue': minor
---

Vue Fast Refresh under `bun --hot`: register the shipped Bun preload (`preload = ["./node_modules/@gpuiv/vue/hmr-preload.js"]` in bunfig.toml) and a save reloads the edited components in place through Vue's HMR runtime instead of remounting the whole app. The edited component's local `ref` state resets (Vue reload semantics); its ancestors, siblings, and their subtrees keep theirs. A change to module-level code reloads every component in that file, and a save with no reloadable component change keeps the classic remount. Adds the `@gpuiv/vue/hmr` export that the injected registration calls import.
