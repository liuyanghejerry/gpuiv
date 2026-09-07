# Profiling and optimizing

Load the **profano** skill first. Fetch its README. Do not guess CLI flags.

Separate **first mount**, **scroll**, and **chrome setState**. They are
different paths.

```
first mount
  Vue maps every child
    ►  createElement / setStyle / setCustomProp  (queued)
    ►  one applyBatch JSON
    ►  Rust RetainedTree
    ►  first paint (list builds visible rows only)

scroll
  wheel  ►  notify GpuixView  ►  render()  ►  Taffy on visible rows  ►  paint

chrome setState
  sidebar click / composer key
    ►  parent re-render
    ►  {rows.map(...)} again unless the list props stay stable
    ►  same JS cost as mount if you forget
```

## JS / mount

Write a short script that mounts through `createTestApp()` and exits. Profile
that, not the live window. The tick loop will drown the mount.

```ts
import { createTestApp } from '@gpuiv/vue/testing'
import { ChatApp } from './chat'

const start = performance.now()
const app = createTestApp(ChatApp)
console.log(`mount ${(performance.now() - start).toFixed(1)}ms`)
```

```bash
cd examples
MOUNT_ONLY=1 bun --cpu-prof --cpu-prof-dir=../tmp/cpu-profiles profile-chat-scroll.tsx
INTERACT=1 bun profile-chat-scroll.tsx
npx profano ../tmp/cpu-profiles/CPU.*.cpuprofile -n 30
npx profano ../tmp/cpu-profiles/CPU.*.cpuprofile --sort total -n 20
```

Read **self** first. That is where the CPU sat. **Total** is the caller chain.

The 10k chat mount was 850ms. profano said:

| Function | Self | What it was |
|---|---|---|
| `applyBatch` | 626ms | Rust parsing the mutation JSON |
| (renderer scheduler) | 31ms | Vue |
| `stringify` | 26ms | `JSON.stringify(queue)` |

Vue was not the problem. The batch **stringified every style and theme**, then
stringified the queue, then Rust parsed each escaped string again. Fix: queue
raw objects (see "The Mutation Protocol" in the root AGENTS.md).

After a renderer change, **build `@gpuiv/vue`**. `examples/` and
`bun --hot chat.tsx` load `packages/vue/dist`, not `src`. packages/vue
vitest uses `src`. You will think the fix works in one suite and fail in the
app.

```bash
cd packages/vue && bun run build
```

## Scroll / paint

Turn on `debugFrameOverlay: 'full'`. The number is **draw time**, not FPS.
`8.3 MS` is about 120 Hz.

The chat wheel jank was **not** the tick loop. GPUI remaps a vertical wheel
onto `overflow-x`. `<code>` and markdown tables stole the gesture. Fix is
`restrict_scroll_to_axis()` on every `overflow_x_scroll()`.

Keep `overdraw` modest. 820px on a short list keeps almost every row live.

Do not flatten the frame loop to hide fat rows. Flatten the rows
(`<markdown>` / `<code>` / `<diff>` as one native node).

## Native

For Rust time, `sample` the bun/node pid, or `samply`. GPUI also has
`ZED_MEASUREMENTS=1`. That is Zed's frame log, not our overlay.

A `.node` cannot unload. After a native rebuild, restart the app. `bun --hot`
only remounts Vue.
