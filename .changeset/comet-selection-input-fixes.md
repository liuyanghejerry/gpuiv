---
'@gpuiv/native': patch
'@gpuiv/vue': patch
---

Keep text selection and native inputs working after Comet's later generic editor fixes (upstream `fb75c1c`, `1cd46cd`).

**Selection**

- Soft-wrapped highlight and selection washes include the first glyph on the next visual row.
- A drag that starts in a virtual list keeps selecting after the anchor row unmounts.
- Dragging near a list edge scrolls the list and extends the selection into newly painted rows, and stops when the list can no longer move.

**Input and textarea**

- Double-click selects the word under the pointer; triple-click selects the whole value. Neither arms a drag that would collapse the selection.
- Dragging a textarea selection past the visible box scrolls the field.
- Adjacent typing or deletion undoes as one step for 700 ms, with a 200-step history cap.

**Testing**

- `TestRenderer.advanceTime(ms)` advances GPUI's deterministic test dispatcher and runs due timers (caret blink, drag autoscroll, list edge scroll). It is not `clockFastForward`, which moves the motion clock only.
