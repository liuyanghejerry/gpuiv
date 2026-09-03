---
'@gpuiv/vue': minor
---

Pin the canvas 2D context to a vendored subset of the W3C web-platform-tests canvas suite (593 cases; 452 run green, 141 skipped with the missing API named), and fix the spec deviations it uncovered.

Behavior fixes, all matched to the WPT expectations:

- **Path transforms are baked in at construction time** (`2d.path.transformation.*`): `ctx.translate()` between path calls now affects only the segments added after it, and `fill`/`clip`/`isPointInPath` no longer re-transform the finished path. `isPointInPath` takes device-space points and counts path-boundary points as inside.
- **`setTransform(a, b, c, d, e, f)` with six numbers works.** The first numeric argument was being swallowed by the matrix-object overload, so every six-argument call built a shifted matrix. `setTransform()` with no arguments resets to the identity.
- **`fillStyle`/`strokeStyle` getters return the DOM serialization** (`#0a141e` for opaque colors, `rgba(r, g, b, a)` otherwise) instead of the raw input string. Setters also accept CSS color objects (`{ r, g, b, a? }`) and anything with a `toString`, and parse `color(srgb …)` values.
- **`roundRect` follows the spec**: negative width/height mirror the rectangle (and flip the traced winding), radii accept `DOMPointInit` objects, more than four radii or a negative radius throw `RangeError`, and non-finite radii make the call a no-op.
- **Composite operations**: every mode name the DOM accepts is now settable (`xor`, `clear`, `lighter`, `source-in/out/atop`, `destination-in/atop/over` render natively; separable blend modes are accepted but still rasterize as `source-over`). `"darker"` and unknown names stay rejected.
- **`ImageData` is a real constructor** (`new GpuixImageData(w, h)` / `(data, w, h)` with DOM exception types), `pixelFormat` is exposed, and instances have properly readonly dimensions. `createImageData`/`getImageData`/`putImageData` follow WebIDL conversions (truncate + absolute magnitude, `TypeError` on non-finite) and `putImageData` normalizes negative dirty rectangles.
- **Gradients match the spec's radial algorithm** (the circle family painted from ω = +∞ down; the largest root with a positive radius wins, and points no circle reaches are left untouched), zero-length linear gradients and identical radial circles paint nothing, and `addColorStop` throws `IndexSizeError`/`SyntaxError` DOM exceptions.
- **Strokes prune zero-length subpaths** (no round-cap dots), miter joins survive duplicate closing vertices, stroke flattening tightens for wide curves so the offset outline stays within the WPT ±2 channel tolerance, and `ctx.reset()` clears back to a fresh context.

The `ctx.lineWidth = "1e1"`-style WebIDL string coercions work, exceptions carry DOM exception names (`IndexSizeError` etc.), and `drawImage`, `fillRect`, `strokeRect` keep their DOM argument semantics.

The suite lives in `packages/vue/wpt/` and regenerates with `bun scripts/convert-canvas-wpt.ts`; the still-missing surface (`Path2D`, `createPattern`, text, shadows, filters, color-mix, non-sRGB spaces) is skipped with the reason in the test title so it reads as a worklist.
