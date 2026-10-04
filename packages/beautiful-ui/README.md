# Beautiful UI for GPUIV

This private workspace package ports [beautiful-ui](https://github.com/slev12397/beautiful-ui)
to Vue and GPUIV. The parity review uses source commit
`ff0f74d62d8be9d89bcb735b3632e31a6ccf88dc`. Run the gallery with
`cd examples && bun --hot beautiful-ui.tsx` after building the Vue and Beautiful UI packages.

The package includes the original primitives, including Flowchart and AgentScreen.
Components use bundled Inter and JetBrains Mono fonts, registered once per native
renderer. The font licenses are in `fonts/`; the source license is in
`LICENSE.beautiful-ui`.

```tsx
const theme = provideTheme(createTheme({ dark: false, reducedMotion: true }))
// Both preferences can change while components are mounted.
theme.reducedMotion.value = false
```

`GPUIV_REDUCED_MOTION=1` sets the default. This is an app preference: GPUIV does
not expose the browser's `prefers-reduced-motion` media query. Decorative motion
stops; clocks, streamed text, and work progress continue.

## Interactive parity

- Buttons and menu actions support Enter and Space; disabled/hidden controls
  leave the tab order. Buttons expose focus outlines. Checkbox/radio state,
  pressed state, and slider ranges reach GPUI's accessibility tree.
- StreamingText resumes when tokens arrive after completion, including an
  initially empty stream. It responds to loop changes. ThinkingState restarts
  its trace when the variant changes.
- StreamingText and ThinkingState use `onSourceClick` when supplied, otherwise
  the renderer's `openUrl`. RecordsTable's `onWebsiteClick` works the same way.
- RecordsTable uses independent pixel column widths and a single scroll region
  for both axes. Header, footer, and Company stay fixed. Resize handles support
  dragging or Left/Right (Shift changes by ten pixels). Small fill viewports and
  shrinking data update the mounted row range. `onColumnResize` reports widths.
  Set `scrollY={false}` for a small table inside a scrolling page: all rows
  mount, the page handles vertical gestures, and columns still pan horizontally.
  Give the page `overflow: "scroll"` so GPUI keeps horizontal wheels on X
  instead of remapping them onto a Y-only page scroller.
- Property prompts use an editable native textarea with styled `@Input` spans.
  Edits persist for each property and emit `onPromptChange(column, prompt)`.
  The web contentEditable mention picker is represented by the existing Inputs
  selector and textual mentions; chips are not embedded editor objects.
- Flowchart accepts `steps` and `edges`. Drag the kind handle or use arrow keys
  to move a node; `onMove(id, offset)` reports its canvas-relative offset. Mounted
  Select items drive condition pickers, and `onConditionChange` reports changes.
- AgentScreen expands into a deferred native dialog. Teach/End controls emit
  `onTeachTask` and `onEndTask(seconds)`; recording continues after collapse.
  `onOpenChange` reports viewer state, and Escape collapses the viewer.

## Performance checks

For a repeatable smoothness audit, run from `examples/`:

```bash
NODE_ENV=production bun profile-beautiful-ui.ts
NODE_ENV=production bun run test beautiful-ui.perf.test.tsx
CI=true bun run test:perf
```

The audit opens a background window, measures animation and two-way page
scrolling, then exits. JSON and PNG output go to `tmp/beautiful-ui-perf/`.
`drawsPerSecond` counts completed GPUI draws, not display presentations;
draw p90/p99 report CPU frame cost. `MOUNT_ONLY=1` uses the test renderer and
exits after mount, for `bun --cpu-prof` analysis.

The `beautiful-ui-performance` CI job runs separately on macOS using the release
Metal binding. It gates animation update/draw, scrolled-gallery draw, wheel
dispatch/draw, clicks and hover at p95 < 25.05ms, and a 12-step scrub drag at
< 150ms. Local budgets are 16.7ms and 100ms; CI has a fixed 1.5× allowance for
runner variance. Each repeated measurement excludes warmup samples. Cadence,
shared batching, pinned/reduced-motion timers, offscreen section reclamation and
wheel ownership have deterministic assertions as well.

`test:perf` requires the native macOS test renderer and rejects `THROTTLE`; a
missing renderer fails instead of skipping the gate. Every CI run uploads
`metrics.json` (all samples, budgets and machine metadata) and `tests.json`,
including on test failure, and adds a table to the Actions job summary. The
gate also blocks package publishing. To make it mandatory for merging, add
`beautiful-ui-performance` to the repository's required status checks; changing
the workflow alone does not change branch protection. Do not raise budgets
automatically from the preceding commit; investigate failures with these
artifacts and the live audit before recalibrating them.

## Native adaptations

| Web behavior | GPUIV behavior |
| --- | --- |
| AgentScreen image/video stream | `streamSrc` accepts image snapshots. Video sources use `poster`; a `screen` slot can render a host-managed feed. GPUIV has no video decoder. |
| LoadingState Surfer video | `variant="Surfer"` displays `surferImage` as a frozen frame; missing frames show an unavailable preview. |
| Full-page viewer portal | Deferred anchored dialog in the native window; opening focuses the dialog and closing restores the preview focus. |
| CSS scale, rotate, blur, inset shadows | Native opacity/geometry transitions, glyph swaps, and available GPUI shadows. |
| Text gradient shimmer | Opacity shimmer; disabled under reduced motion. |
| Liveline timing/inertia and WebGL glimm | Native canvas charts and the existing native sweep; browser engines are not embedded. |
| Browser focus trapping / live regions | Native focus and roles; no DOM live-region or modal focus-trap implementation. |

Website scaffolding, analytics, sound preferences, and browser developer tools
belong to the original demo site and are outside this component package.
