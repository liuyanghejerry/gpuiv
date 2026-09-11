# `@gpuix/react/floating` barrel and `useFocusTrap` removal

Upstream commits: `f24d270` (point `@gpuix/react/floating` at a public barrel,
drop `useFocusTrap` from the docs), `e02a607` (remove `useFocusTrap` from
`@gpuix/react/floating`).

## Reason

Both commits reshape the React package's export surface (`package.json`
exports and a barrel file) and delete the `useFocusTrap` hook upstream had
shipped. This fork's component layer is Vue (`packages/vue/src/components/`):
there is no `@gpuix/react/floating` entry point and `useFocusTrap` was never
ported, so there is nothing to remove and no docs claiming it.

Subtree focus confinement, the use case the hook served, is covered natively
by `focusNextWithin` / `focusPreviousWithin` (PR #72).

## Revisit triggers

- upstream re-introduces a focus-trap utility built on the focus-within
  primitives and our Vue `Select` / `FloatingLayer` need it
