---
'@gpuiv/native': minor
'@gpuiv/vue': minor
'@gpuiv/animal-island': patch
---

Tab and Escape now have DOM-like defaults. Tab / Shift+Tab move focus through `tabIndex` elements and never type `"\t"` into a focused `<input>`; Escape closes the topmost open dismiss layer (Select, Combobox and Tooltip popups now close through it). The defaults run after every element `onKeyDown` and the render-level `onKeyDown`, so any handler can cancel one with the new `KeyEvent.preventDefault()`; `stopPropagation()` skips the ancestors and the window handler of the same keystroke. `createApp(App, { tabNavigation: false })` turns the Tab default off. Native key events carry a `keystrokeId` that groups one dispatch's element events and its trailing window event.

animal-island's Modal, Drawer, Image preview and Upload preview keep their focus traps by cancelling the Tab default before walking the subtree.
