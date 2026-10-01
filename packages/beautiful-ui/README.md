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
