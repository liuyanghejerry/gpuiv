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
Illustrations use the full-colour SVG image pipeline; dashed outlines keep
cached monochrome geometry and animate native tint. `Icon` and all 101
named `*Icon` components are exported, together with the original palette,
categories and metadata. Menus and dialogs
use GPUI deferred anchored layers. `Form.useForm()` / `useForm()` return `[form]`;
`Button htmlType="submit"` and `htmlType="reset"` use the nearest Form context.
Upload selects actual filesystem paths through the native panel and accepts OS
file drops. Its File values come from `node:buffer`, not browser input elements.

Select accepts native `side`, `align` and `sideOffset` props (defaults: auto,
start, 8px). `auto` opens below when the estimated panel fits and above
otherwise; the panel's minimum width follows the measured trigger. Pagination
keeps its page-size popup above the trigger with the same left alignment.
The rounded yellow popup panel owns the fill; transparent option rows preserve
the rounded outline, whole-row clicks and the outside hover arrow.

The demo follows the [reference site's layout](https://guokaigdg.github.io/animal-island-ui/#/button):
a 220px cream sidebar groups all 40 component pages, and the selected page
appears in a large white showcase with its own heading and description.
The sidebar and content are independent sibling scroll viewports. Selecting a
page resets the content scroll and mounts only that page's examples.
Buttons lift on hover and press down using native motion, with background,
text, border and shadow transitions on the same native frame clock. Card/Tag,
form controls, tabs, paging and table surfaces also use native color/shadow
tracks; loading uses the original rotating Donut. Select supports search/filter/clear,
input/picker controls accept React `value`, and Upload accepts `fileList`, while Vue models
remain available. CountUp provides pause/resume, formatting, easing, replay,
completion callbacks and celebration. Public component prop types use native
styles/events and Vue nodes; React browser event and CSS types are not reused.

Native `<img filter="…">` now supports `brightness`, `contrast`, `saturate`,
`grayscale`, `sepia`, `invert`, `opacity`, `hue-rotate`, `blur` and `drop-shadow`.
It processes and caches pixels on GPUI's background asset executor rather than
reprocessing them during paint. The stamp photo uses `saturate(0.93) contrast(1.03)`;
its paper SVG chains the two original alpha shadows around
the perforated outline. Island Tooltip shadows follow their organic silhouette.
Rocket keeps the original 64px artwork and its rest shadow is baked from the
original σ10 / 22% silhouette, with the viewport reserving the hover σ14 / 32%
envelope. Hover and press scale that whole baked artwork, which keeps the size
tween smooth; BackTop deliberately does not regenerate a filter per frame.
Matching filter lists in `motion` still animate natively for images that do not
change size, and the static `filter` prop keeps its cached-result behavior. See
the [native image filter API](../../docs/reference.md#image-filters) for syntax
and boundaries.

## Fidelity audit

The [complete React parity audit](REACT_PARITY.md) lists all 40 gallery families,
the public APIs and behaviors checked against React commit `c696d161`, and
remaining native adaptations. This is a source/API audit with behavior and
native geometry tests, not a screenshot similarity score.

GPUI paints drop shadows beneath the complete fill, so a translucent fill can
reveal shadow inside its border box; CSS outer shadows remove that interior.

| Area | Retained in the native port | Remaining adaptations |
| --- | --- | --- |
| Button / Card / Tag | Original palette, sizes and modifiers; fixed dashed geometry with animated tint; native color/shadow and hover/press motion; rotating Donut; node-valued icons | Generic CSS transforms and letter spacing remain unavailable; Donut rotation uses cached SVG frames |
| Select and input controls | Search/filter/clear/empty states; controlled/default models, React value/fileList aliases, keyboard and composition; native surface/shadow transitions, Switch handle colors, selection splashes and star bursts | Browser event objects and DOM accessibility references differ; check-path drawing and CSS transform effects use native approximations; Rate's full-colour star artwork still changes discretely |
| CountUp / Countdown | CountUp formatting/easing/pause/replay/callbacks/celebration; Countdown's 20-face directional digit strip; island dashed outlines | CountUp uses a cancellable JS sampling clock; celebration scale/rotation use native geometry; reduced-motion preferences are not yet mapped |
| Avatar / Badge / Progress | Actual native text fitting and gap; arbitrary count nodes; four bundled scenes, three-stop fill gradients, completion colours, dotted tracks and native inset highlights | First measurement appears after paint; typography features differ |
| Rich content and overlays | Node-valued labels/titles/tips; Tooltip hover/focus/click and organic silhouette shadow; native copy/close-button colors; Notification closes after native exit and destroy removes immediately | Arbitrary child content is not clipped to SVG silhouettes; mask/focus behavior follows native APIs; generic subtree scale/filter effects remain separate work |
| Image / Loading / BackTop | Stamp photo saturation/contrast, perforations/paper texture and chained SVG alpha shadows; decode events and preview; three-layer frame shadows; elliptical vignette; Rocket with the baked rest shadow and reserved hover envelope | Stamp-year typography and preview scale differ; BackTop requires a native scroll target and scales its baked shadow rather than retargeting hover sigma per frame; filter lists with different functions switch discretely at the midpoint |
| Form / Table / pickers / Carousel | Form instance replacement and subscription cleanup; table paging and hover colors/radii; picker double shadows and option transitions; all slides stay mounted with `display:none` on hidden pages, crossfade on switch, control/dot transitions, autoplay and native entrances | Avoid nested scrollers; picker columns page; Table loading backdrop blur is not a single-image filter; hidden pages do not enter tab-stop collection, and an already-focused hidden descendant no longer pauses autoplay |
| Skeleton / Cursor | Native moving five-stop shimmer, specialised placeholders; local cursor follower and effects | Shimmer overflow clipping is rectangular, with remaining rounded/circular edge differences; the OS cursor cannot be replaced or hidden by this API |

## Verification and limits

The suite combines host behavior cases with real native-window regressions.
Platform-dependent Title layout, native IME and floating-surface pixel tests
skip when the required native test renderer is unavailable. Host behavior
tests run through the **real Vue custom renderer, GPUIV mutation protocol and
event registry**, backed by a test native facade. They cover state transitions,
native key names, controlled clearing, async rules, upload bytes over a local
HTTP server and timer/resource cleanup. They do not paint, resolve Taffy layout
or verify GPUI hit testing. Structural assertions check that decorative surfaces
do not register blocking pointer behavior. Current complete-run counts and
platform results belong in the commit/PR verification record.

The multipart-upload test starts a local HTTP server, so the full run requires
permission to listen on localhost.

The example's GPU tests use `createTestApp()` on macOS/Windows. Linux has no
headless image readback for this pinned GPUI build, so those tests skip there.
Earlier hidden Linux native-window checks verified the seven newly ported
families, the Carousel's hidden-slide `display:none` behavior and 180px active
slide, image events for data/local/HTTP
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
Browser/native screenshot similarity remains unscored; this pinned Linux
renderer does not support screenshot readback, and no claim of pixel identity
is made.
The React production fixture verifies intermediate hover/press positions,
rotating loading artwork and searchable/clearable Select through real native
input. Additional native regressions verify Countdown's directional digit
motion, Avatar fitting against native text measurements and Tooltip's complete
surface entrance. macOS/Windows pixel regressions cover transparent silhouettes,
single-pass translucent fills, Tooltip backdrop opacity, inset shading and
multiple-shadow ordering. Windows production windows lack readback in this
binding; their pixel assertions use the headless native test renderer.

New color/shadow and image-filter GPU regressions use exact pixel samples on a
fixed matte and derive screenshot coordinates from the actual native window
size/DPI. Coverage includes interrupted color targets, translucent/inset shadow
layers, stamp saturation/contrast, transparent blur edges, enlarged-image CSS
blur radius, source clipping before shadow generation, stable layout bounds,
filter changes without repeat loads and stale-source rejection. These pixel
checks run on supported macOS/Windows test renderers without a CI bypass;
Linux skips do not count as successful pixel verification. Image/filter and SVG
host tests separately check geometry caches, transition targets and event/ref
preservation.

A focused gallery type check is available with
`tsc --noEmit -p examples/tsconfig.animal-island.json` from the repository root.

The Pagination popup production regression checks outer-edge alignment and the
8px gap before and during scrolling, after resize, and after window-edge fitting,
then clicks an option and checks the selected label, callbacks and dismissal.
The gallery Select regression navigates to the actual “选择目的地” control,
checks its trigger-width panel and below-trigger alignment before and during scrolling, and clicks
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
samples; active Skeletons share one 100ms width poll. Their shimmer uses native motion,
with no Vue animation-frame updates. Only width changes and one native
completion per 1.6s cycle update the band; completion starts the next offscreen sweep. Components
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

A retained Carousel slide cache is no longer needed: hidden pages stay mounted
with `display:none`, so Vue local state and native element identity survive
without contributing layout, paint or tab stops. The outgoing page remains
visible only for the crossfade window, and a focus handle inside a hidden page
no longer counts as focus inside the carousel.

The port stays private. Both upstream MIT licences are bundled in
`LICENSE.animal-island-vue` and `LICENSE.animal-island-ui`; implementations and their adaptations are
tracked with the rest of this repository.
