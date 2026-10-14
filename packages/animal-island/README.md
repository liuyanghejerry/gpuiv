# Animal Island for GPUIV

Private workspace port of [animal-island-vue](https://github.com/guokaigdg/animal-island-vue),
now also aligned with the [React library](https://github.com/guokaigdg/animal-island-ui/tree/c696d16167d01370f822f95db22340b05d837555).
The original Vue baseline is commit
[`ac185709`](https://github.com/guokaigdg/animal-island-vue/tree/ac18570956da9da21fe899da438f17d75d2e446d).
Tracking: [GPUIV #164](https://github.com/liuyanghejerry/gpuiv/issues/164).

All **39 original Vue component families**, plus React's **CountUp**, have
native implementations and **40 comparison pages**. `Avatar.Group`/`AvatarGroup`,
the three specialized Skeleton components, `FormItem` and `FormProvider` are
additional public companions grouped with their main component pages.
The [React parity audit](REACT_PARITY.md) checks public APIs, behavior and
appearance against the pinned React source, including explicit native limits.

```sh
cd packages/animal-island
bun run build
bun run test
cd ../../examples
bun --hot animal-island.tsx
```

Use native `StyleDesc` objects instead of Less, CSS classes or DOM event objects.
The root theme uses the original cream/warm-brown palette and structured hard
shadows. Six original Nunito/Noto Sans SC faces are bundled as native TrueType
assets. The gallery registers them before first paint; other apps call
`loadAnimalIslandFonts(useGpuix().renderer)` in their root setup. Native family
names are normalized so the original weights match. Ordinary CJK fallback
still follows the platform cascade; registration does not force the same
fallback face on every OS. See [font provenance and licences](assets/fonts/README.md).
Decorative SVGs use the full-colour image pipeline. `Icon` and all 101
named `*Icon` components are exported, together with the original palette,
categories and metadata. Menus and dialogs
use GPUI deferred anchored layers. `Form.useForm()` / `useForm()` return `[form]`;
`Button htmlType="submit"` and `htmlType="reset"` use the nearest Form context.
Upload selects actual filesystem paths through the native panel and accepts OS
file drops. Its File values come from `node:buffer`, not browser input elements.

Select accepts native `side`, `align` and `sideOffset` props (defaults: top,
start, 8px). Pagination uses the same placement for its page-size popup.
The rounded yellow popup panel owns the fill; transparent option rows preserve
the rounded outline, whole-row clicks and the outside hover arrow.

The demo follows the [reference site's layout](https://guokaigdg.github.io/animal-island-ui/#/button):
a 220px cream sidebar groups all 40 component pages, and the selected page
appears in a large white showcase with its own heading and description.
The sidebar and content are independent sibling scroll viewports. Selecting a
page resets the content scroll and mounts only that page's examples.
Buttons now lift on hover and press down using native motion; loading uses
the original rotating Donut. Select supports search/filter/clear, input/picker
controls accept React `value`, and Upload accepts `fileList`, while Vue models
remain available. CountUp provides pause/resume, formatting, easing, replay,
completion callbacks and celebration. Public component prop types use native
styles/events and Vue nodes; React browser event and CSS types are not reused.

## Fidelity audit

The [complete React parity audit](REACT_PARITY.md) lists all 40 gallery families,
the public APIs and behaviors checked against React commit `c696d161`, and
remaining native adaptations. This is a source/API audit with behavior and
native geometry tests, not a screenshot similarity score.

| Area | Retained in the native port | Remaining adaptations |
| --- | --- | --- |
| Button / Card / Tag | Original palette, sizes and modifiers; real dashed outlines; hover/press motion; rotating Donut; node-valued icons | Colour/shadow transitions are immediate; letter spacing is unavailable |
| Select and input controls | Search/filter/clear/empty states; controlled/default models, React value/fileList aliases, keyboard and composition; selection splashes and star bursts | Browser event objects and DOM accessibility references differ; path drawing and CSS transform effects use native approximations |
| CountUp / Countdown | CountUp formatting/easing/pause/replay/callbacks/celebration; Countdown's 20-face directional digit strip; island dashed outlines | CountUp uses a cancellable JS sampling clock; celebration scale/rotation use native geometry; reduced-motion preferences are not yet mapped |
| Avatar / Badge / Progress | Actual native text fitting and gap; arbitrary count nodes; four bundled scenes, three-stop fill gradients, completion colours, dotted tracks and native inset highlights | First measurement appears after paint; typography features differ |
| Rich content and overlays | Node-valued labels/titles/tips; Tooltip hover/focus/click; organic game/island artwork; Notification closes after native exit and destroy removes immediately | Arbitrary child content is not clipped to SVG silhouettes; mask/focus behavior follows native APIs |
| Image / Loading / BackTop | Stamp perforations/paper texture; decode events and preview; elliptical vignette; original Rocket return button | Image filters/multiple shadows and flake rotation differ; BackTop requires a native scroll target |
| Form / Table / pickers / Carousel | Form instance replacement and subscription cleanup; table paging; date/range/month and time selection; active slides, autoplay and native entrances | Avoid nested scrollers; picker columns page; Carousel inactive slides unmount and lose their local state |
| Skeleton / Cursor | Shared breathing timer, specialised placeholders; local cursor follower and effects | Shimmer remains opacity rather than a moving gradient; the OS cursor cannot be replaced or hidden by this API |

## Verification and limits

The complete run on this Linux workstation has **462 passing tests** across
29 files: **460 host behavior cases** and **2 real-window cases**. Eleven
platform-dependent Title layout, native IME and floating-surface pixel tests
are skipped here. The behavior tests run through the **real Vue custom renderer, GPUIV
mutation protocol and event registry**, backed by a test native facade. They
cover state transitions, native key names, controlled clearing, async rules,
upload bytes over a local HTTP server and timer/resource cleanup. They do not
paint, resolve Taffy layout or verify GPUI hit testing. Structural assertions
check that decorative surfaces do not register blocking pointer behavior.
The multipart-upload test starts a local HTTP server, so the full run requires
permission to listen on localhost.

The example's GPU tests use `createTestApp()` on macOS/Windows. Linux has no
headless image readback for this pinned GPUI build, so those tests skip there.
Earlier hidden Linux native-window checks verified the seven newly ported
families, the Carousel's single 180px slide, image events for data/local/HTTP
sources, shared resources in two windows, stale-source/unmount rejection,
Image fades/error artwork, single-axis image geometry, Avatar fallbacks,
font loading/weights, password editing/cut protection and native Input length
corrections. They also verified full-height scroll viewports, zero-height
empty overlay anchors and centered floating layers after scrolling.
Use a release build from the current source: the older npm 0.5.0 addon retains
empty text line heights and the previous floating-center calculation, and lacks
password/image lifecycle support. The comparison layout's Linux production
fixture verifies the 220px sidebar, white showcase dimensions, independent
scroll viewports, resize, real navigation and controlled Input state retention.
Native screenshot comparison remains pending; this pinned Linux renderer does
not support screenshot readback, and no claim of pixel identity is made.
The React production fixture verifies intermediate hover/press positions,
rotating loading artwork and searchable/clearable Select through real native
input. Additional native regressions verify Countdown's directional digit
motion, Avatar fitting against native text measurements and Tooltip's complete
surface entrance. macOS/Windows pixel regressions cover transparent silhouettes,
single-pass translucent fills, Tooltip backdrop opacity, inset shading and
multiple-shadow ordering. Windows production windows lack readback in this
binding; their pixel assertions use the headless native test renderer.
A focused gallery type check is available with
`tsc --noEmit -p examples/tsconfig.animal-island.json` from the repository root.

The Pagination popup production regression checks outer-edge alignment and the
8px gap before and during scrolling, after resize, and after window-edge fitting,
then clicks an option and checks the selected label, callbacks and dismissal.
The gallery Select regression navigates to the actual “选择目的地” control,
checks its above-trigger alignment before and during scrolling, and clicks
the left and right blank portions of option rows. The earlier continuous
gallery and the comparison layout both pass this native regression. The rounded-surface host test checks transparent
interactive rows, and the macOS/Windows pixel test checks that option shoulders
leave the 28px corner arcs clear.

## Scroll performance

Production bounds queries return the last painted snapshot instead of forcing
and synchronously waiting for another frame. Automation queries still wait for
fresh layout. A production regression checks that 120 consecutive bounds reads
produce no additional frames, then verifies freshness after a layout change.
Size-dependent decoration, progress and height animations ignore position-only
samples; active Skeletons share one 50ms timer and one Vue flush. Components
with the same window-size polling interval also share one query per renderer.
Image decode completion follows GPUI's next-frame notification schedule so a
burst of completed assets does not repaint the entire window once per image.
The production burst regression releases 48 HTTP images together: the previous
notification path draws 48 frames and fails the check, while the coalesced path
draws two. Before the comparison layout, a fixed 90-step scroll trajectory on
this machine reduced the maximum observed bounds wait from about 1.25 seconds
to 32ms. These measurements establish
the removed notification burst, not a frame-rate guarantee on other hardware.

The comparison gallery mounts only the selected component page, so unrelated
examples and their timers do not run while scrolling. Revisiting a page resets
its uncontrolled local component state; root-controlled values and the Form
store survive. Components used outside the gallery are unaffected. Host tests
cover all 40 navigation entries, Enter/Space activation, page isolation, state
retention, scroll reset and timer cleanup. The production layout fixture checks
sidebar/card geometry, sibling scroll ownership, resize and real navigation.

```sh
cd examples
bun run test bounds-query.production.test.ts animal-island.production.test.ts
PROFILE_LABEL=current bun profile-animal-island-scroll.ts
PROFILE_LABEL=fixed PROFILE_STEPS=90 bun profile-animal-island-scroll.ts
```

The profiling script writes draw-duration, query, mutation and event-loop
metrics to `tmp/animal-island-perf/`. It opens the long BackTop page by default;
`PROFILE_PAGE=icon` selects a different page. Compare runs on the same page and
check the recorded final offset for scroll clamping. Draw time is not FPS;
GPU load and the visible demo affect these measurements.
On this machine, the comparison layout's 90-step BackTop run records a p90
draw duration of 4.08ms and maximum draw duration of 5.67ms, with a maximum
bounds-query duration of 6.87ms. Its final offset is -1169px, so later steps
are clamped; this run does not repeat the earlier continuous-gallery trajectory.

A retained Carousel slide cache was also tested against the current renderer.
Vue KeepAlive storage left an orphan native host after unmount, while a full
translated track still needs reliable inactive-subtree focus/hit isolation.
The active-only carousel remains the documented adaptation until those ownership
and interaction constraints can be met without changing GPUI.

The port stays private. Both upstream MIT licences are bundled in
`LICENSE.animal-island-vue` and `LICENSE.animal-island-ui`; implementations and their adaptations are
tracked with the rest of this repository.
