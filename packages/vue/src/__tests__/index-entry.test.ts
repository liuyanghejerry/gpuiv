/// Entry-point import smoke: importing the public barrel must be side-effect
/// safe and re-export its runtime surface. Pure imports — no native renderer.

import { describe, expect, it } from "vitest"
import * as entry from "../index.js"

describe("public entry import", () => {
  it("resolves the app factory and renderer passthrough after evaluation", () => {
    expect(typeof entry.createApp).toBe("function")
    expect(typeof entry.startFrameLoop).toBe("function")
    expect(entry.GpuixRenderer).toBeDefined()
  })
})
