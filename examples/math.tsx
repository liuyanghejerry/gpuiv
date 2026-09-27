/**
 * Markdown math demo — `$$…$$` display formulas render as centered SVG
 * images produced by MathJax headless (`renderMathMap` from `@gpuiv/vue/math`),
 * while `$inline$` formulas keep their TeX source visible as an accent run.
 *
 * The map is awaited before mount here; a streaming app can render the
 * fallback first and swap the map in when the formulas finish.
 */

import { defineComponent, h, ref } from "vue"
import { createApp } from "@gpuiv/vue"
import { renderMathMap, type MathMap } from "@gpuiv/vue/math"

const SOURCE = `# Markdown math

Display math renders from the pre-baked SVG map:

$$E = mc^2$$

Aligned equations keep their columns:

$$\\begin{aligned} \\nabla \\cdot \\mathbf{E} &= \\frac{\\rho}{\\varepsilon_0} \\\\ \\nabla \\cdot \\mathbf{B} &= 0 \\end{aligned}$$

Inline math stays a TeX fallback for now — the value $a_1 + b^2$ paints in
accent mono until inline-baseline layout lands.

Code spans are never math: \`$not a formula$\`.

$$\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}$$

After.`

const MathDemo = defineComponent({
  setup() {
    const math = ref<MathMap | null>(null)
    renderMathMap(SOURCE, { color: "#e6e6fa" }).then((map) => {
      math.value = map
    })
    return () =>
      h("div", { style: { padding: 32, backgroundColor: "#0a0a0f", height: "100%" } }, [
        math.value
          ? h("markdown", { source: SOURCE, math: math.value })
          : h("markdown", { source: SOURCE }),
      ])
  },
})

createApp(MathDemo, { focus: process.env.GPUIX_BACKGROUND !== "1", title: "math" })
