---
'@gpuiv/vue': patch
---

Fix `onValueChange` / `onOpenChange` / `onInputValueChange` never firing in uncontrolled mode.

`useControllableState`'s setter compared the next value against `current`
after mutating the internal ref, so the comparison always reported
"unchanged" and the change callback was skipped. It now captures the previous
value before assigning. Affected uncontrolled `Select`/`Combobox` usage with
change callbacks; controlled mode was unaffected.
