---
'@gpuiv/vue': minor
---

Headless `Button` component (Base UI shape): a focusable `div` that acts like `<button>` — `onClick` from a press, Enter on key-down (not a held repeat) or Space on key-up; `disabled` removes it from the Tab order unless `focusableWhenDisabled` keeps it; `style` can be a function of `{ disabled }`; `asChild` merges the behavior onto your own element. The shared `buttonProps()` helper is exported too, and `DialogTrigger` / `DialogClose` now build on it (they gain `role="button"`, and a disabled trigger no longer fires its own `onClick`).
