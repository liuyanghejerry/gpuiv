/// SSE stdin/stdout transport. Logs without a `data:` prefix cannot break it.

import { describe, expect, it } from "vitest"
import {
  connectStdio,
  encodeSse,
  handleAutomationRequest,
  InProcessBackend,
  PROTOCOL_VERSION,
  SseBackend,
} from "../automation/index.js"
import type { TestAutomationRenderer } from "../automation/client.js"

function fakeRenderer(): TestAutomationRenderer {
  let clicks = 0
  return {
    nativeSimulateClick() {
      clicks += 1
    },
    nativeSimulateMouseDown() {},
    nativeSimulateMouseUp() {},
    nativeSimulateMouseMove() {},
    nativeSimulateScrollWheel() {},
    simulateKeystrokes() {},
    nativeSimulateKeystrokes() {},
    nativeSimulateKeyDown() {},
    nativeSimulateKeyUp() {},
    scrollTo() {},
    getScrollOffset: () => null,
    getAllText: () => [`clicks:${clicks}`],
    getPaintedText: () => [`clicks:${clicks}`],
    getSelectedText: () => null,
    clearSelection() {},
    captureScreenshot() {},
    getAutomationTree: () =>
      JSON.stringify({
        id: 1,
        type: "div",
        testId: "inc",
        bounds: { x: 0, y: 0, width: 40, height: 20 },
        children: [{ id: 2, type: "text", text: `clicks:${clicks}` }],
      }),
    getElementBounds: () => [0, 0, 40, 20],
    clockPause: () => 0,
    clockSet: (nowMs) => nowMs,
    clockFastForward: (deltaMs) => deltaMs,
    clockResume: () => 0,
  }
}

describe("automation stdio", () => {
  it("round-trips through data: lines with log noise", async () => {
    const backend = new InProcessBackend(fakeRenderer())
    let listener: ((chunk: string) => void) | undefined
    const app = await connectStdio({
      write: (chunk) => {
        const raw = JSON.parse(chunk.replace(/^data: /, "").trim())
        void handleAutomationRequest(raw, backend).then((reply) => {
          listener?.(`[child] still starting\n${reply}`)
        })
      },
      feed: (fn) => {
        listener = fn
      },
    })

    await app.getByTestId("inc").click()
    expect(await app.getByText("clicks:1").textContent()).toBe("clicks:1")
    await app.close()
  })

  it("initialize handshake matches the protocol version", async () => {
    const backend = new InProcessBackend(fakeRenderer())
    const reply = await handleAutomationRequest(
      {
        id: 1,
        method: "initialize",
        params: { protocolVersion: PROTOCOL_VERSION, client: "test" },
      },
      backend
    )
    expect(reply.startsWith("data: ")).toBe(true)
    expect(reply).toContain('"protocolVersion":1')
  })

  it("encodeSse prefixes every protocol message", () => {
    expect(encodeSse({ id: 1, method: "blur", params: {} })).toMatch(
      /^data: \{/
    )
  })

  it("closes pending requests and the transport exactly once", async () => {
    let closes = 0
    const backend = new SseBackend(
      () => {},
      () => {},
      async () => {
        closes += 1
      }
    )
    const pending = backend.call("blur", {})
    const rejection = expect(pending).rejects.toMatchObject({ code: "Closed" })

    await backend.close()
    await rejection
    await backend.close()

    expect(closes).toBe(1)
  })

  it("enforces the same closed-session contract in process", async () => {
    const backend = new InProcessBackend(fakeRenderer())
    await backend.close()

    await expect(backend.call("blur", {})).rejects.toMatchObject({
      code: "Closed",
    })
  })

  it("rejects calls made after the session closes without writing", async () => {
    let writes = 0
    const backend = new SseBackend(
      () => {
        writes += 1
      },
      () => {}
    )
    await backend.close()

    const rejected = backend.call("blur", {}).then(
      () => undefined,
      (error: unknown) => error
    )
    expect(writes).toBe(0)
    await expect(rejected).resolves.toMatchObject({ code: "Closed" })
  })
})
