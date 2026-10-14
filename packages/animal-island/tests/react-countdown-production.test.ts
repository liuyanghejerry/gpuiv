import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const hasDisplay = process.platform !== "linux" || Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY)
;(hasDisplay ? describe : describe.skip)("Countdown through native motion", () => {
  it("moves the digit strip through native pixels and fits an avatar to measured native text", () => {
    const result = spawnSync(process.env.BUN_EXECUTABLE ?? "bun", [fileURLToPath(new URL("./fixtures/react-countdown-motion.ts", import.meta.url))], {
      cwd: fileURLToPath(new URL("..", import.meta.url)), env: { ...process.env, GPUIX_BACKGROUND: "1" }, encoding: "utf8", timeout: 15000,
    })
    expect(result.status, result.stderr || result.error?.message).toBe(0)
    const line = result.stdout.split("\n").find(line => line.startsWith("REACT_COUNTDOWN_MOTION_OK "))
    expect(line, result.stdout).toBeDefined()
    const bounds = JSON.parse(line!.slice("REACT_COUNTDOWN_MOTION_OK ".length))
    expect(bounds.middle).toBeGreaterThan(bounds.start)
    expect(bounds.middle).toBeLessThan(bounds.end)
    expect(bounds.end - bounds.start).toBeCloseTo(31, 0)
    expect(bounds.naturalWidth).toBeGreaterThan(32)
    expect(bounds.visibleWidth).toBeLessThanOrEqual(33)
  }, 20000)
})
