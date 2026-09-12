---
'@gpuiv/vue': patch
---

Vue Fast Refresh under `bun --hot` no longer breaks multi-file apps: the
preload used to abort startup ("Expected module mock to return an object")
on any matched `.ts`/`.tsx` it declined — a component-less `theme.ts`, or any
`.ts` file under `node_modules` — because Bun rejects an onLoad that returns
nothing for a matched path. Exclusions now live in the plugin's path filter
and a matched file always resolves to a module.

Fast Refresh also survives a classic remount (an asset save, the error
overlay's Reload button) again: the runtime pins the HMR runtime of the vue
copy that mounted the live tree, and re-pins it on every mount, so a later
component save reloads instead of being silently dropped.

The source transform no longer emits a module that cannot parse when a
`defineComponent(...)` statement has a tail it cannot follow (`as T`,
`satisfies T`, a comma, a ternary); that file keeps the classic remount.
