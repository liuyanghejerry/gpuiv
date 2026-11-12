---
'@gpuiv/native': minor
'@gpuiv/vue': minor
---

Focus styles, ported from upstream gpuix: a new nested `focusVisible` style object applies natively while an element has focus after keyboard input (like CSS `:focus-visible`; a mouse press never shows it), and while a control has keyboard focus every other focusable element dims to 40% of its own opacity (paint only, bounds never move) so every Tab target stays visible. A focused text field dims nothing. Opt out per element with `style.keyboardFocusDim: false` (SelectContent and DialogPopup do), or for the whole window with `createApp(App, { keyboardFocusDim: false })` and draw your own focus look with `focusVisible: { outline: { … } }`. The dim travels as a new `setKeyboardFocusDim` batch op (one per root creation, so a remount without the option restores the default). Our existing `outline` style object stays the way to paint rings; upstream's flat `outlineWidth`/`outlineColor`/`outlineOffset` props were not adopted.
