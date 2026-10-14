# Animal Island for GPUIV

Private workspace port of [animal-island-vue](https://github.com/guokaigdg/animal-island-vue).
The audit below compares source at commit
[`ac185709`](https://github.com/guokaigdg/animal-island-vue/tree/ac18570956da9da21fe899da438f17d75d2e446d).
Tracking: [GPUIV #164](https://github.com/liuyanghejerry/gpuiv/issues/164).

All **39 original component families** have native implementations. `AvatarGroup`,
the three specialized Skeleton components, `FormItem` and `FormProvider` are
additional public companions; they do not change the 39-family denominator.
The previous report of 35 implemented families was incorrect: it was 32 before
DatePicker, TimePicker, Table, Form, Upload, Carousel and Cursor were added.

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

## Fidelity audit

This is a **source/API audit with behavior tests**, not a screenshot similarity
score. “Core retained” means the listed main behavior has been ported; the last
column names remaining differences. CSS scale/rotation, arbitrary clipping,
inset/multiple shadows and DOM-specific accessibility links remain platform
limits. Native `lineHeight` values are pixels, so CSS multipliers are converted
using each text size.

| Family | Retained behavior and appearance | Remaining native differences |
| --- | --- | --- |
| Avatar | Size/shape, image crop, icon/slot/default User fallback, image-error callback and fallback, group folding and defaults | Label auto-fit/gap is unavailable; returning false from onError retains the native failed-image placeholder |
| BackTop | Target threshold, responsive icon, smooth return, keyboard and callback | Requires a native host target instead of a default browser window; 120ms sampling and native easing |
| Background | All types; original two dot periods, grid, three sprinkle tiles and two scene SVGs | Texture follows painted bounds and appears after initial measurement |
| Badge | Numeric/string/slot count, cap, zero/dot, sizes and palette | Capsule corner offset is approximate; no zoom entrance or native title tooltip |
| Button | All variants/sizes, danger/ghost/loading/disabled, focus/keyboard and Form submit/reset | Hard-shadow press retained; vertical press movement, dashed border and moving loading stripes omitted |
| Card | Colour/pattern precedence, two-layer dot textures, geometry, hoverable | Dashed border is solid; hover shadow replaces vertical lift |
| Carousel | Controlled/default index, arrows/dots, keyboard, loop, autoplay and hover/focus pause | Fade replaces translated slide track; inactive slides unmount and lose local component state; native accessibility supports fewer roles; deeper custom filled children must forward hover to the slide root |
| Checkbox | Group values/options, disabled states, sizes, check artwork and keyboard | Check drawing/splash animations and letter spacing omitted |
| CodeBlock | Warm code surface, original token palette approximation, copy/reset states | Syntect classification replaces the original JS/TS regex tokenizer; no exact token-by-token colouring |
| Collapse | Question/answer/slots, controlled/default expanded state, disabled and AnimateHeight | Fish/indicator rotation and DOM ID linkage omitted |
| Countdown | Deadline/formats, prefix, variants, sizing, change/finish and restart | Digits change without odometer motion; island dashed border is solid; no tabular-number font feature |
| Cursor | Default/raindrop artwork, local position tracking, trailing effects and press/leave state | Local wrapper follower, not a global replacement: system pointer stays visible; filled/interactive child hitboxes can block tracking; forceAll cannot override arbitrary child cursors |
| DatePicker | Date/month/year panels, paired range, confirmation, format, disabledDate, today/clear, controlled open/value and keys | Flex replaces CSS grids; inset/multiple emphasis becomes border/outline; close is immediate |
| Divider | Five line styles, original SVG wave/dash cadence and icon repetition | Baked line length is about 3.2k px; icon repeat count updates after bounds sampling |
| Drawer | Four placements, geometry, edge animation, mask/close/footer and focus restore | pushBackground scale/blur is inactive; native Tab correction approximates focus trapping; mask shows without a fade |
| Footer | Text/year, original colour/spacing and native contentinfo role | No material core difference found in source audit |
| Form | Field binding/defaults, rules/async validation, dependencies, reset/submit, Provider and native field reveal | Proportional flex replaces 24-column CSS; native scroll chooses alignment; DOM label/error ID relationships differ |
| Icon | 101 source SVGs, root stroke/width overrides retaining inner fills, custom component/src and label | Bounce scale/rotation omitted; no em/rem dimensions or DOM SVG selector styling |
| Image | Three frames, colour palette, stamp year, decode events, pixel single-axis sizing by decoded ratio, loading fade/error artwork, preview, close and focus restore | Stamp perforation/filter, multiple shadows and lazy missing; unknown percentage/auto sizing follows native layout; empty sources stay idle and SVG event dimensions are decoded 2x bitmap pixels |
| Input | Controlled/default text, native password masking, placeholder colour, affixes, clear, status/shadow, surrogate-safe maxLength, composition handling, disabled/readonly and submit | Other browser input types remain text editors; change(value, nativePayload) replaces the DOM event |
| Loading | Original night cover, 50 moving snowflakes, tip, delay/fade/show lifecycle | No flake rotation; a uniform vignette replaces radial shading; deferred window overlay uses numeric priority and a 25fps opacity phase |
| Modal | Original cream panel, mask, variant padding/footer, Typewriter replay and focus restore | Game silhouette is a rounded rectangle; scale entry is opacity; native Tab trap is approximate; mask has no fade |
| Notification | Imperative store, six positions, types, icons, durations and dismissal | onClose runs when closing starts; native motion replaces CSS; mount the container explicitly; ordinary notification layers cannot paint above deferred dialogs |
| Pagination | Original ghost circles, orange/teal palettes, page/size/jumper and events | Size menu reuses side-opening Select; colour swaps are immediate; ellipsis glyph differs |
| Progress | Clamped percent, track/fill/info, measured numeric width animation | Inset track shadow omitted; fill is measured after first paint and re-tweens on resize |
| Radio | Group values, options/sizes/disabled, original check artwork and roving keyboard focus | Check splash/drawing and colour transitions omitted |
| Rate | Whole stars with original face artwork, hover preview, clear, readonly and keyboard | Pop/splash/lift omitted; half-stars/custom characters are absent in the original Vue source too |
| Select | Native mounted item registry, disabled-aware arrows/Home/End, controlled/default values, white trigger, yellow menu, amber bar and arrow | No hover arrow entrance animation; row-width layout differs from inline-block |
| Skeleton | Text/rect/circle/paragraph plus Button/Input/Avatar companions and sizes | Opacity breathing replaces the moving shimmer band |
| Switch | Controlled/default state, sizes/labels/disabled/loading, keyboard and numeric handle motion | No inset shadow; dot loader replaces rotating ring; slot label width is estimated |
| Table | Columns/data, nested fields, header/cell slots, row render/events, stripes, loading/empty and client paging | Flex replaces HTML table layout; fixed columns unavailable; header scrolls with body; use one scroll owner |
| Tabs | Active pill/leaf, items/slots, controlled/default key, keyboard and focus | Leaf wiggle/content translation and DOM ID linkage omitted |
| Tag | Palette/variants/sizes, close and click, disabled and focus | Dashed border is solid; hover shadow replaces lift; colour changes are immediate |
| Time | Original clock/date card, timer cleanup and blinking colon | No tabular-number font feature, tracking or colon optical shift |
| TimePicker | Format/steps, hidden seconds, confirmation, now/clear, controlled open/value and keyboard | Seven visible rows per column, wheel/page controls instead of nested continuous scrollers; close is immediate |
| Title | Sizes/colours, ribbon tails/folds/perspective/inset shade, layered papers and transparent tab cut/fold; selectable native text | No letter spacing/text shadow or hover scale; projected ribbon curves approximate perspective; layout reserves space for overhanging decoration |
| Tooltip | Twelve placements, variants, border/tail, hover/focus/click and keyboard | Island silhouette becomes rounded; triangular arrow approximates rotated square; hover/focus triggers share the platform channel |
| Typewriter | Original VNode clipping, speed/trigger/autoplay/done and cleanup | Optional blinking cursor is an extension; arbitrary DOM-only children need native replacements |
| Upload | Native chooser/drop, directories, accept/multiple/maxCount, controlled lists, beforeUpload/customRequest, actual multipart request, remove/preview | fetch lacks XHR byte progress and browser cookie jar; no drag-enter highlight; directories do not follow symlinks; unknown extensions have empty MIME |

## Verification and limits

The package has **280 passing behavior tests** across eighteen files, plus four
platform-dependent Title layout and native IME tests. The behavior tests run on Linux through the **real Vue custom renderer, GPUIV
mutation protocol and event registry**, backed by a test native facade. They
cover state transitions, native key names, controlled clearing, async rules,
upload bytes over a local HTTP server and timer/resource cleanup. They do not
paint, resolve Taffy layout or verify GPUI hit testing. Structural assertions
check that decorative surfaces do not register blocking pointer behavior.

The example's GPU tests use `createTestApp()` on macOS/Windows. Linux has no
headless image readback for this pinned GPUI build, so those tests skip there.
A hidden Linux native window also mounts and reports real bounds for the seven newly ported families; its carousel occupies one 180px slide, rather than stacking inactive pages. Production fixtures verify image events for data/local/HTTP sources, shared resources in two windows, stale-source/unmount rejection, Image fades/error artwork, single-axis frame/image geometry, Avatar fallbacks, font loading/weight selection, password editing/cut protection and Input length corrections to the actual native buffer. The current release addon also verifies that the gallery scroll viewport fills the window below its header, empty overlay anchors have zero height, and centered floating layers stay aligned on all four sides after scrolling. Use a release build from the current source: the older npm 0.5.0 addon retains empty text line heights and the previous floating-center calculation, and lacks password/image lifecycle support. Native screenshot comparison remains pending; no claim of pixel identity is
made. A focused gallery type check is available with
`tsc --noEmit -p examples/tsconfig.animal-island.json` from the repository root.

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
draws two. A fixed 90-step scroll trajectory on this machine reduces the maximum
observed bounds wait from about 1.25 seconds to 32ms. These measurements establish
the removed notification burst, not a frame-rate guarantee on other hardware.

The gallery mounts nearby sections and keeps measured placeholders for distant
ones, with overscan and hysteresis to avoid repeated mount/unmount at an edge.
Resize remeasures the section heights. This is a demo optimisation: remounting
resets a section's uncontrolled local component state; root-controlled values
and the Form store survive. Components used outside the gallery are unaffected.
The production windowing test checks the single scroll owner, viewport height,
deep scrolling, resize and return to the top.

```sh
cd examples
bun run test bounds-query.production.test.ts animal-island.production.test.ts
PROFILE_LABEL=current bun profile-animal-island-scroll.ts
PROFILE_LABEL=fixed PROFILE_STEPS=90 bun profile-animal-island-scroll.ts
```

The profiling script writes draw-duration, query, mutation and event-loop
metrics to `tmp/animal-island-perf/`. Draw time is not FPS; GPU load and the
visible demo affect these measurements.

A retained Carousel slide cache was also tested against the current renderer.
Vue KeepAlive storage left an orphan native host after unmount, while a full
translated track still needs reliable inactive-subtree focus/hit isolation.
The active-only carousel remains the documented adaptation until those ownership
and interaction constraints can be met without changing GPUI.

The port stays private. Its upstream MIT licence is bundled in
`LICENSE.animal-island-vue`; the added implementations and their adaptations are
tracked with the rest of this repository.
