---
'@gpuiv/native': minor
'@gpuiv/vue': minor
---

Add drag, hover, wheel, and modifier keys to the automation API.

The protocol already carried `mouseDown`, `mouseMove`, `mouseUp`, and `scrollWheel`, but nothing exposed them, so a drag or a pan could not be driven from a test.

```ts
await app.getByTestId('clip-7').dragBy(120, 0, { steps: 6 })
await app.getByTestId('clip-7-trim-end').dragTo(app.getByTestId('clip-8'))
await app.getByTestId('canvas').wheel(0, 120, { modifiers: 'cmd' })
await app.getByTestId('row-3').hover()

await app.mouse.drag({ x: 240, y: 500 }, { x: 700, y: 620 })
await app.mouse.wheel({ x: 700, y: 600 }, -140, 0)
await app.mouse.down({ x: 100, y: 100 }, { button: 2 })
```

| Call | What it does |
|---|---|
| `locator.hover()` | Moves the pointer to the center, so hover styles and tooltips fire |
| `locator.wheel(dx, dy)` | One wheel event over the center |
| `locator.dragBy(dx, dy)` / `locator.dragTo(target)` | Press, travel, release |
| `locator.center()` | The center of the last painted bounds |
| `app.mouse.move / down / up / click / wheel / drag` | Raw pointer input in window coordinates |

A drag sends **interpolated moves**, not one jump, because snapping, live previews, and per-move commits only appear when the pointer travels. Pass `steps` to control how many, and `offset` to press away from the center.

Every mouse call takes **`modifiers`** in the same hyphenated syntax as `press('cmd-a')`, so cmd-wheel zoom, shift-click range selection, and alt-drag duplication become testable.

Three supporting fixes:

- **`launch()` can scroll and type.** The production renderer gained `simulateScrollWheel` and `simulateKeystrokes`/`simulateKeyDown`/`simulateKeyUp`, so automation against a child process no longer throws there.
- **`<input>` and `<textarea>` are locatable.** Custom elements paint themselves, so nothing registered their box for automation; a locator on an editor failed with "Element has no painted bounds".
- **`textContent()` reads descendants.** It returned the node's own text only, so `<text testId="x">{value}</text>` came back empty. It now concatenates in document order, like DOM `textContent`.
