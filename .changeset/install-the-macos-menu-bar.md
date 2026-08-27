---
'@gpuiv/native': minor
'@gpuiv/vue': minor
---

Install the macOS application menu bar, so a GPUIV app answers `⌘Q`, `⌘H`, `⌥⌘H`, `⌘M` and `⌘W` instead of showing an empty menu bar.

GPUI never calls `NSApplication.setMainMenu:` on its own, so `NSApp.mainMenu` stayed nil. macOS paints nothing next to the Apple menu, and the standard shortcuts do not exist either, because AppKit only provides them through menu items. There was no way to quit a GPUIV app from the keyboard.

```
Apple    <appName>                Window
         ├ Services               ├ (AppKit window tiling)
         ├ Hide <appName>   ⌘H    ├ Minimize          ⌘M
         ├ Hide Others     ⌥⌘H    ├ Zoom
         ├ Show All               ├ Close Window      ⌘W
         └ Quit <appName>   ⌘Q    └ (open windows)
```

New `appName` window option for the name inside `Hide X` and `Quit X`. It defaults to `title`.

```tsx
createApp(App, { title: 'Todo', appName: 'Todo' })
```

The **title of the application menu comes from the executable**, not from `appName`. macOS reads it from the running binary, so `bun app.tsx` shows `bun` and a `bun build --compile` binary shows its own file name. Only a real `.app` bundle changes it.

There is **no Edit menu**, on purpose. AppKit consumes a menu key equivalent before the window sees the key event, so an Edit menu carrying `⌘C` would take the keystroke away from cross-element text selection and from `<input>`.
