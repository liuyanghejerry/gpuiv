/**
 * Live-app component-state inspection over the automation protocol.
 *
 * Spawns the real component-inspector example in a background window and
 * speaks the automation protocol over stdio, asserting the component
 * inspector sees through the host tree into the Vue components — including
 * state that changes after mount. The in-process side of the inspector is
 * covered by packages/vue suites; this file pins the live wiring
 * (renderer.ts attaching the inspector after mount).
 */

import path from "path"
import { fileURLToPath } from "url"
import { describe, expect, it } from "vitest"
import { launch } from "@gpuiv/vue/automation"

const HERE = path.dirname(fileURLToPath(import.meta.url))

describe("live component inspector", () => {
  // Same gate as chat.test.tsx's live test: the child's stdio handshake is
  // only reliable on macOS CI runners.
  it.skipIf(process.platform !== "darwin")(
    "reads and tracks component state through a real window",
    async () => {
      const app = await launch({
        command: "bun",
        args: ["component-inspector.tsx"],
        cwd: HERE,
        // VITEST is inherited from this worker and would disable the child's
        // automation stdio server; blank it so the child serves commands.
        env: { GPUIX_BACKGROUND: "1", VITEST: "" },
      })

      try {
        await app.getByTestId("inspector-value").waitFor({ timeoutMs: 30_000 })

        // The tree names components and links them to host element ids.
        const tree = await app.components.tree()
        const root = tree?.[0]
        expect(root?.name).toBe("InspectorApp")
        expect(root?.state?.title).toBe("inspector demo")
        const counter = root?.children?.find((c) => c.name === "CounterBlock")
        expect(counter?.state?.count).toBe(0)

        // Attribution: an element from getTree resolves to its component.
        const node = await app.getByTestId("inspector-value").element()
        const owner = await app.components.state(node.id)
        expect(owner?.name).toBe("CounterBlock")
        expect(owner?.state?.count).toBe(0)

        // State that changes after mount is visible — a live read, not a
        // mount-time snapshot. Poll, like the live mouse test in chat.test,
        // because the child's Vue update flushes on its own microtask.
        await app.getByTestId("inspector-increment").click()
        const deadline = Date.now() + 5_000
        let count: unknown = 0
        while (Date.now() < deadline) {
          count = (await app.components.state(node.id))?.state?.count
          if (count === 1) break
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
        expect(count).toBe(1)
      } finally {
        await app.close()
      }
    },
    60_000
  )
})
