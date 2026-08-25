/// Typed SSE codec: only `data:` lines are protocol messages.

import { describe, expect, it } from "vitest"
import {
  AutomationError,
  createSseDecoder,
  decodeSseChunk,
  encodeSse,
  parseRequest,
  parseWireMessage,
  PROTOCOL_VERSION,
  type WireMessage,
} from "../automation/protocol.js"

describe("automation protocol", () => {
  it("encodes one JSON object as an SSE data event", () => {
    expect(
      encodeSse({
        id: 1,
        method: "click",
        params: { x: 10, y: 20 },
      })
    ).toMatchInlineSnapshot(`
      "data: {"id":1,"method":"click","params":{"x":10,"y":20}}

      "
    `)
  })

  it("ignores logs that are not data: lines", () => {
    const chunk = [
      "Starting GPUIX...\n",
      "[GPUIX] Initial render complete\n",
      encodeSse({
        id: 1,
        method: "initialize",
        params: { protocolVersion: PROTOCOL_VERSION, client: "test" },
      }),
      "WARNING: font missing\n",
      encodeSse({
        id: 1,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          pid: 9,
          capabilities: ["input", "screenshot", "clock", "tree"],
          window: { width: 800, height: 600 },
        },
      }),
      '{"bare":"json"}\n\n',
      "id: proc-12345\n",
      "event: error\n",
    ].join("")

    expect(decodeSseChunk(chunk)).toMatchInlineSnapshot(`
      [
        {
          "id": 1,
          "method": "initialize",
          "params": {
            "client": "test",
            "protocolVersion": 1,
          },
        },
        {
          "id": 1,
          "result": {
            "capabilities": [
              "input",
              "screenshot",
              "clock",
              "tree",
            ],
            "pid": 9,
            "protocolVersion": 1,
            "window": {
              "height": 600,
              "width": 800,
            },
          },
        },
      ]
    `)
  })

  it("joins a data: line split across chunks", () => {
    const messages: WireMessage[] = []
    const decoder = createSseDecoder((message) => {
      messages.push(message)
    })
    decoder.feed("noise\ndat")
    decoder.feed('a: {"id":2,"method":"blur","params":{}}\n\n')
    expect(messages).toEqual([{ id: 2, method: "blur", params: {} }])
  })

  it("rejects unknown methods and bad params", () => {
    expect(() => parseRequest({ id: 1, method: "explode", params: {} })).toThrow(
      AutomationError
    )
    expect(() =>
      parseRequest({ id: 1, method: "click", params: { x: "left" } })
    ).toThrow(AutomationError)
    expect(() => parseWireMessage({ hello: true })).toThrow(AutomationError)
  })

  it("keeps request and result types aligned for every method", () => {
    const request = parseRequest({
      id: 3,
      method: "clockSet",
      params: { nowMs: 150 },
    })
    expect(request).toEqual({
      id: 3,
      method: "clockSet",
      params: { nowMs: 150 },
    })
    if (request.method !== "clockSet") {
      throw new Error("expected clockSet")
    }
    const nowMs: number = request.params.nowMs
    expect(nowMs).toBe(150)
  })
})
