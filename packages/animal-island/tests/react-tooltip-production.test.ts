import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const hasDisplay = process.platform !== "linux" || Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY)
;(hasDisplay ? describe : describe.skip)("Tooltip through native motion", () => {
  it("moves top and right surfaces through 4 native pixels and fades the whole backdrop", () => {
    const result = spawnSync(process.env.BUN_EXECUTABLE ?? "bun", [fileURLToPath(new URL("./fixtures/react-tooltip-motion.ts", import.meta.url))], {
      cwd: fileURLToPath(new URL("..", import.meta.url)), env: { ...process.env, GPUIX_BACKGROUND: "1" }, encoding: "utf8", timeout: 20000,
    })
    expect(result.status, result.stderr || result.error?.message).toBe(0)
    const line = result.stdout.split("\n").find(line => line.startsWith("REACT_TOOLTIP_MOTION_OK "))
    expect(line, result.stdout).toBeDefined()
    const results = JSON.parse(line!.slice("REACT_TOOLTIP_MOTION_OK ".length)) as { placement: string; start: number; middle: number; end: number; pixelChecked: boolean }[]
    expect(results.map(row => row.placement)).toEqual(["top-start", "right-end"])
    for (const row of results) {
      expect(Math.abs(row.end - row.start)).toBeCloseTo(4, 0)
      expect(row.middle).toBeGreaterThan(Math.min(row.start, row.end))
      expect(row.middle).toBeLessThan(Math.max(row.start, row.end))
      expect(row.pixelChecked).toBe(process.platform !== "linux")
    }
  }, 25000)
})
