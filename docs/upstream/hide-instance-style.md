# Hide/unhide style retention (React `hideInstance`)

Upstream commit: `2e77997` ("Keep an element's style when React hides it").

## Reason

React's reconciler calls `hideInstance`/`unhideInstance` for hidden trees
(Suspense retries, React `<Activity>`); upstream's `hideInstance` used to send
`{ visibility: hidden }` alone, dropping every other declaration. Vue's custom
renderer has no hide/unhide host hooks at all: hidden trees come from normal
`v-if`/`v-else` unmounts, and `v-show`-style toggles flow through `patchProp`
→ `setStyle(id, toGpuixStyle(next))`, which always carries the element's full
style (`packages/vue/src/reconciler/vue-renderer.ts`). The bug cannot occur
here.

## Revisit triggers

- Vue gains an Offscreen/`<Activity>`-style hidden-tree host hook in a future
  renderer API that we implement
- we ever add a `hideInstance`-like fast path to our own host config
