---
'@gpuiv/native': minor
'@gpuiv/vue': minor
---

Mermaid fences in `<markdown>` get a rendering channel: ` ```mermaid ` blocks parse as their own block and render from a new `mermaid` map prop — app-supplied images (`{ src }`, typically data-URL SVGs) keyed by the fence source with outer whitespace trimmed, the same convention as the `math` map. Mapped fences paint as image blocks (natural size, clamped by `mdImageMaxHeight` like other markdown images); unmapped fences keep today's labelled `mermaid` code card, never a blank. GPUIV deliberately ships no diagram renderer — mermaid needs a real browser layout, so the producer (headless browser, build step, remote renderer) stays app-side.
