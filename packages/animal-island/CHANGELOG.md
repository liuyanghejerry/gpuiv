# @gpuiv/animal-island

## 0.2.1

### Patch Changes

- cab21fa: Add user-facing npm READMEs with installation instructions, minimal examples, platform notes, and documentation links for the native, Vue, Animal Island, and packager packages.
- Updated dependencies [cab21fa]
  - @gpuiv/vue@0.6.1

## 0.2.0

### Minor Changes

- 502faf4: Organize the demo into a left sidebar for all 39 component families and a large white showcase for the selected component, matching the reference site's layout. Mount one component page at a time, retain controlled values and the Form store across navigation, and reset the content scroll when switching pages.
- 811d00a: Port all 39 animal-island-vue component families into the private `@gpuiv/animal-island` workspace package and showcase them in the native component gallery. Include AvatarGroup, specialized Skeleton components and Form companions, all 101 colour icons, scene assets, native date/time pickers, validated forms and tables, file selection/drop/upload, a controllable carousel and a local pointer follower.
  
  Restore original Select/Pagination colours, button variant combinations, avatar defaults and SVG dot/grid/sprinkle textures. Connect Modal's Typewriter, native Space activation, Form submit/reset and input Enter; correct pixel line heights, decorative hitboxes, controlled clearing and overlay focus/lifecycle handling. Document per-component fidelity and remaining native adaptations in the package README, with behavior tests that run on Linux without GPU readback.
  
  Refs #164
- d2a05c5: Align the native component library with the React Animal Island reference. Add CountUp with pause, replay, formatting and celebration; searchable and clearable Select controls; React value/fileList aliases and rich node content; Avatar text fitting; Progress gradients, completion colors, dotted tracks and four scenes; and compound Avatar.Group.
  
  Restore button hover/press motion and the rotating Donut loading icon, selection splashes and rating bursts, Countdown digit scrolling, card/tag lift, dashed outlines, stamp perforations, organic dialog/tooltip artwork, Rocket BackTop and the Loading vignette. Expand the comparison demo to 40 pages, retain Table pagination callbacks, support Form instance replacement and Typewriter component slots, and call Notification close callbacks after native exit completes.
- 4ccbf78: Restore color and shadow transitions across interactive controls, apply the original vintage stamp photo filters, and paint stamp, island Tooltip and Rocket shadows along their transparent silhouettes.

### Patch Changes

- 364acfb: Keep avatar text inside its configured gap when native font hinting rounds the fitted width. Measure the painted text after resizing, correct oversized results, and stop fitting once the text fits.
- 811d00a: Keep image-preview clicks inside the dialog from reaching its dismissal mask. Include the Image close button and Modal/Drawer panels in native Tab traversal so an otherwise empty dialog can retain keyboard focus.
- 4914c7b: Support `display: none` for retained elements and native `filter` motion tracks. Hidden subtrees keep their Vue state and native identity while skipping layout, paint and hit-testing, and matching image-filter lists interpolate on the frame clock while the last filtered frame (or the unfiltered source before the first) stays visible until the next one is ready. Keep every Carousel slide mounted so hidden pages retain local state, add the outgoing-slide crossfade, and keep BackTop's hover scale on one baked rest shadow that scales with the artwork instead of regenerating a filter per frame.
- 811d00a: Bundle the original Nunito 500/700/900 and Noto Sans SC 400/500/700 fonts with normalized native family names and complete SIL OFL licenses. Register all six faces before the first gallery render and expose a reusable root-setup font loader, restoring the original Latin typography while preserving native Chinese fallback and Unicode text selection.
- 811d00a: Preserve decoded image proportions when Animal Island Image receives only one pixel dimension. Account for final frame padding and borders, keep explicit two-axis boxes stretched, and reset derived dimensions when the source changes or fails.
- 811d00a: Keep bounds polling on Windows and Linux from forcing and waiting for another frame. Share window-size polling between components on the same renderer and interval. Preserve fresh automation snapshots, avoid updating animated height, pattern surfaces, progress bars and carousels when only their screen position changes, batch active Skeleton animations on one timer, and keep distant Animal Island gallery sections out of the active render tree.
- f24b457: Restore Skeleton's moving five-stop highlight using native motion, sharing width queries and stopping work when inactive. Smooth Switch disabled/loading opacity and animate Pagination arrow colors with their buttons. Skeleton rounded-edge clipping remains limited by GPUI's rectangular overflow mask.
- 811d00a: Restore ribbon tails, folds, perspective and inset shading, layered title papers, and transparent tab corner cuts using full-colour SVG decoration beneath selectable native title text.
- 2d195d7: Keep range DatePicker previews responsive: cache month grids, day styles and event handlers, and use native hover styling so hovering only re-styles the day cells whose range state changed.
- 811d00a: Position centered floating menus and tooltips at the trigger's midpoint without applying the popup's size twice. Keep the Animal Island gallery header fixed and its scroll viewport filling the remaining window height.
- 811d00a: Keep Animal Island Input UTF-16 length limits from splitting emoji surrogate pairs. Preserve provisional IME text and apply the limit to the final full value, including compositions that end without a final change event. Treat negative and non-finite limits as unrestricted.
  
  Make native `valueRevision` corrections override pending value echoes even when Vue combines a changed value and revision in one render, so length corrections reach the actual editor.
- 364acfb: Support inset shadows and shadow arrays in native styles through GPUI's existing shadow API. Keep single shadows compatible, preserve CSS's first-shadow-on-top array order, and accept an empty array to clear the shadow stack.
  
  Restore Animal Island Switch inset depth and Progress fill highlights to match the React components.
- f2bf831: Open the Pagination page-size menu above its trigger, aligned with the trigger's left edge and separated by the original 8px gap. Keep the panel anchored during scrolling.
  
  Position Select menus against the trigger's outer edge so its border does not shift alignment or reduce the requested gap.
- c557b2f: Open Select menus on the side with enough space instead of always above, size the panel to the measured trigger width, and center the hover arrow on the option row.
- d0dfd65: Open the ordinary Select popup above its trigger by default, aligned with the trigger's left edge and separated by 8px. Apply this placement to the gallery's destination selector as well as Pagination, while retaining explicit side and alignment overrides.
- 502faf4: Keep Select and Pagination popup corners smoothly rounded by letting the popup panel own the background instead of painting rectangular option backgrounds over its corners. Preserve whole-row hover and click behavior and the outside hover arrow.
- 211e859: Tab and Escape now have DOM-like defaults. Tab / Shift+Tab move focus through `tabIndex` elements and never type `"\t"` into a focused `<input>`; Escape closes the topmost open dismiss layer (Select, Combobox and Tooltip popups now close through it). The defaults run after every element `onKeyDown` and the render-level `onKeyDown`, so any handler can cancel one with the new `KeyEvent.preventDefault()`; `stopPropagation()` skips the ancestors and the window handler of the same keystroke. `createApp(App, { tabNavigation: false })` turns the Tab default off. Native key events carry a `keystrokeId` that groups one dispatch's element events and its trailing window event.
  
  animal-island's Modal, Drawer, Image preview and Upload preview keep their focus traps by cancelling the Tab default before walking the subtree.
- Updated dependencies [4914c7b]
- Updated dependencies [811d00a]
- Updated dependencies [73772d7]
- Updated dependencies [879c2dc]
- Updated dependencies [04f9021]
- Updated dependencies [60ec8d1]
- Updated dependencies [3ef4af3]
- Updated dependencies [9cfbb1c]
- Updated dependencies [bff363b]
- Updated dependencies [08687c3]
- Updated dependencies [45f5d31]
- Updated dependencies [d634380]
- Updated dependencies [08687c3]
- Updated dependencies [5600352]
- Updated dependencies [4b0558b]
- Updated dependencies [525a332]
- Updated dependencies [11b7de2]
- Updated dependencies [eaf511d]
- Updated dependencies [5e230dd]
- Updated dependencies [5e230dd]
- Updated dependencies [5e230dd]
- Updated dependencies [5e230dd]
- Updated dependencies [71a105e]
- Updated dependencies [d2a05c5]
- Updated dependencies [d26b1c1]
- Updated dependencies [9f4fa9b]
- Updated dependencies [327fe05]
- Updated dependencies [3f526fe]
- Updated dependencies [21f87c4]
- Updated dependencies [94f6dc6]
- Updated dependencies [9f4fa9b]
- Updated dependencies [811d00a]
- Updated dependencies [1dd5711]
- Updated dependencies [cde4787]
- Updated dependencies [05167b2]
- Updated dependencies [8c272d1]
- Updated dependencies [0a97051]
- Updated dependencies [08687c3]
- Updated dependencies [435af61]
- Updated dependencies [07526d4]
- Updated dependencies [28ce86c]
- Updated dependencies [c785e86]
- Updated dependencies [4ccbf78]
- Updated dependencies [4ccbf78]
- Updated dependencies [364acfb]
- Updated dependencies [811d00a]
- Updated dependencies [1c53356]
- Updated dependencies [a596d9b]
- Updated dependencies [4c9458f]
- Updated dependencies [c2ff4ed]
- Updated dependencies [1f3d00a]
- Updated dependencies [e4f04a6]
- Updated dependencies [d2a05c5]
- Updated dependencies [848c464]
- Updated dependencies [5e95285]
- Updated dependencies [5eb859f]
- Updated dependencies [60e41d8]
- Updated dependencies [811d00a]
- Updated dependencies [1880c00]
- Updated dependencies [deda832]
- Updated dependencies [99a30d2]
- Updated dependencies [211e859]
- Updated dependencies [2cbf95f]
- Updated dependencies [ac3dacc]
- Updated dependencies [dbdd1dd]
- Updated dependencies [194ce52]
- Updated dependencies [bff363b]
  - @gpuiv/vue@0.6.0
