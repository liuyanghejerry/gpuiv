import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
const available = process.platform !== "linux" || Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY)
const describeWindow = available ? describe : describe.skip
describeWindow("Animal Island React parity through native input and motion", () => {
  it("paints hover/press intermediate positions and searches, selects and clears residents", () => {
    const result = spawnSync(process.env.BUN_EXECUTABLE ?? "bun", [fileURLToPath(new URL("./fixtures/animal-island-react.ts", import.meta.url))], {
      cwd: import.meta.dirname, env: { ...process.env, GPUIX_BACKGROUND: "1" }, encoding: "utf8", timeout: 20_000,
    })
    expect(result.status, result.stderr || result.error?.message).toBe(0)
    expect(result.stdout).toContain("ANIMAL_REACT_PARITY_OK")
  }, 25_000)
})
