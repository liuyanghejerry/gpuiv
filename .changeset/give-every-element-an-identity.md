---
'@gpuiv/native': minor
'@gpuiv/vue': minor
---

Give every interactive host surface a stable GPUI identity, so the props you can already write actually do something.

**`hover` and `active` work on every element, not only `<div>`**

`StyleDesc` always accepted `hover` and `active`, but only `<div>` consumed them. On `<text>`, `<input>`, `<textarea>`, `<code>`, `<markdown>`, `<diff>`, `<img>`, `<svg>` and `<anchored>` the style type-checked, crossed the bridge, and was dropped. All of them apply it now.

```tsx
<code
  code={source}
  language="ts"
  style={{ backgroundColor: '#1e1e2e', hover: { backgroundColor: '#313244' } }}
/>
```

`<virtual-list>` is the one exception, and its `style` type no longer accepts them: gpui's `List` has no interactive identity to hold a hovered or pressed state. Put those on a wrapping `<div>`.

**`<text>` is a real element**

`<text>` had its own builder that ignored every interaction prop on the shared props surface. `onClick`, `onMouseEnter`, `onKeyDown`, `autoFocus`, `tabIndex` and pointer capture all registered a listener and then never fired. `<text>` and `<div>` now go through one builder, so a text node behaves like any other element.

```tsx
<text style={{ padding: 8, hover: { color: '#f38ba8' } }} onClick={select}>
  {label}
</text>
```

One behaviour change comes with that. A `<text>` with an opaque `backgroundColor` now **takes mouse hits**, like an HTML element with a background, so it stops clicks and hovers reaching whatever is behind it. The wheel still passes through to a scroll container. The old text builder inserted no hitbox at all, so a filled label was transparent to the pointer. Set `pointerEvents: 'none'` to get the old behaviour back.

**Events reach `<img>`, `<svg>` and `<anchored>`**

Those three declared no supported events, so `onClick`, `onMouseEnter` and `onMouseLeave` type-checked, registered a listener, and never fired. This was the same defect as `<text>`, in three more places.

```tsx
<img src={avatar} onClick={openProfile} />
<anchored side="bottom" onMouseLeave={close}>{items}</anchored>
```

**`active` no longer needs an unrelated click handler**

An `active` style with no `onClick` painted nothing. gpui only inserted the hitbox that tracks the press when the element had some *other* reason for one, so the press was never recorded. Fixed in gpui itself (submodule bump) rather than by attaching an empty click listener.

**Automation can click anything**

`<img>`, `<svg>` and `<anchored>` accepted `testId`, appeared in the automation tree, and then threw `Element has no painted bounds` on `click()`. They record their box now. An `<anchored>` reports the **overlay's** final position, after deferral and window snapping, not the trigger's.

```ts
await app.getByTestId('menu').click()
```

**Animated GIFs animate**

`<img>` built a gpui image with no element id, so `ImgState` (the frame index and the delayed loading placeholder) was thrown away every frame and an animation never left frame zero.

**One renderer, one root**

Mounting a second root on a renderer that already drives one throws instead of silently taking over its window, its native root id, and its event map. `createApp()` unmounts the previous tree first, so remounts (including `bun --hot`) are unaffected.

**Test renderer: `getRetainedElementCount()`**

`getTreeJson()` walks from the root, so it cannot see a node that was detached and never destroyed. The new `renderer.getRetainedElementCount()` is the only way a test can prove a removal actually freed a node. The Vue host config already frees removed text nodes (Vue's `remove` op covers them); a regression test now pins that.
