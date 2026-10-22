/// Typed SSE codec: only `data:` lines are protocol messages.

import { describe, expect, it } from "vitest"
import { ZodError } from "zod"
import {
  AutomationError,
  componentTreeNodeSchema,
  createSseDecoder,
  decodeSseChunk,
  encodeSse,
  parseRequest,
  parseResponse,
  parseServerEvent,
  parseWireMessage,
  PROTOCOL_VERSION,
  serializedValueSchema,
  treeNodeSchema,
  type ComponentTreeNode,
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

  describe("parseRequest validation", () => {
    it("rejects values that are not objects", () => {
      expect(() => parseRequest(null)).toThrow("Request must be an object")
      expect(() => parseRequest([1, 2])).toThrow("Request must be an object")
    })

    it("rejects ids that are not integers", () => {
      expect(() =>
        parseRequest({ id: 1.5, method: "blur", params: {} })
      ).toThrow("Request id must be an integer")
      expect(() =>
        parseRequest({ id: "1", method: "blur", params: {} })
      ).toThrow("Request id must be an integer")
    })

    it("rejects window indexes that are not non-negative integers", () => {
      for (const window of [-1, 1.5, "0"]) {
        expect(() =>
          parseRequest({ id: 1, method: "blur", params: {}, window })
        ).toThrow("Request window must be a non-negative integer")
      }
    })

    it("keeps the window index when present", () => {
      expect(
        parseRequest({ id: 1, method: "blur", params: {}, window: 3 })
      ).toEqual({ id: 1, method: "blur", params: {}, window: 3 })
    })
  })

  describe("parseResponse", () => {
    it("rejects values that are not objects or lack an integer id", () => {
      expect(() => parseResponse("nope")).toThrow("Response must be an object")
      expect(() => parseResponse({ id: 2.5, result: {} })).toThrow(
        "Response id must be an integer"
      )
    })

    it("rejects malformed error payloads", () => {
      expect(() => parseResponse({ id: 1, error: "Timeout" })).toThrow(
        "Invalid error payload"
      )
      expect(() =>
        parseResponse({ id: 1, error: { code: "Timeout", message: 7 } })
      ).toThrow("Invalid error payload")
      expect(() =>
        parseResponse({ id: 1, error: { code: "Exploded", message: "x" } })
      ).toThrow("Invalid error code")
    })

    it("parses failures with and without data", () => {
      expect(
        parseResponse({ id: 1, error: { code: "Timeout", message: "slow" } })
      ).toEqual({ id: 1, error: { code: "Timeout", message: "slow" } })
      expect(
        parseResponse({
          id: 2,
          error: { code: "NotFound", message: "gone", data: { id: 9 } },
        })
      ).toEqual({
        id: 2,
        error: { code: "NotFound", message: "gone", data: { id: 9 } },
      })
    })

    it("rejects responses with neither result nor error", () => {
      expect(() => parseResponse({ id: 1 })).toThrow(
        "Response needs result or error"
      )
    })

    it("returns success responses as-is", () => {
      expect(parseResponse({ id: 3, result: { ok: true } })).toEqual({
        id: 3,
        result: { ok: true },
      })
    })
  })

  describe("parseServerEvent", () => {
    it("rejects values without an event name", () => {
      expect(() => parseServerEvent(null)).toThrow(
        "Event must have an event name"
      )
      expect(() => parseServerEvent({ params: {} })).toThrow(
        "Event must have an event name"
      )
    })

    it("parses console, frame, and closed events", () => {
      expect(
        parseServerEvent({ event: "console", params: { text: "hi" } })
      ).toEqual({ event: "console", params: { text: "hi" } })
      expect(
        parseServerEvent({ event: "frame", params: { n: 3, path: "/tmp/f.png" } })
      ).toEqual({ event: "frame", params: { n: 3, path: "/tmp/f.png" } })
      expect(parseServerEvent({ event: "frame", params: { n: 4 } })).toEqual({
        event: "frame",
        params: { n: 4 },
      })
      expect(
        parseServerEvent({ event: "closed", params: { reason: "quit" } })
      ).toEqual({ event: "closed", params: { reason: "quit" } })
    })

    it("lets the zod schema reject events with params that do not match", () => {
      expect(() =>
        parseServerEvent({ event: "console", params: { text: 1 } })
      ).toThrow(ZodError)
      expect(() => parseServerEvent({ event: "closed", params: {} })).toThrow(
        ZodError
      )
    })

    it("rejects unknown event names", () => {
      expect(() => parseServerEvent({ event: "wat", params: {} })).toThrow(
        "Unknown server event: wat"
      )
    })
  })

  describe("parseWireMessage routing", () => {
    it("rejects values that are not objects", () => {
      expect(() => parseWireMessage(42)).toThrow(
        "Wire message must be an object"
      )
    })

    it("routes events, requests, and responses to their parsers", () => {
      expect(
        parseWireMessage({ event: "console", params: { text: "hi" } })
      ).toEqual({ event: "console", params: { text: "hi" } })
      expect(parseWireMessage({ id: 1, method: "blur", params: {} })).toEqual({
        id: 1,
        method: "blur",
        params: {},
      })
      expect(parseWireMessage({ id: 1, result: { ok: true } })).toEqual({
        id: 1,
        result: { ok: true },
      })
      expect(
        parseWireMessage({ id: 1, error: { code: "Closed", message: "bye" } })
      ).toEqual({ id: 1, error: { code: "Closed", message: "bye" } })
    })
  })

  describe("tree schemas", () => {
    it("parses element trees with every optional field", () => {
      const node = {
        id: 1,
        type: "div",
        text: "hi",
        testId: "root",
        style: { width: 10 },
        events: ["click"],
        customProps: { value: 1 },
        bounds: { x: 0, y: 0, width: 5, height: 6 },
        children: [{ id: 2, type: "text", text: "leaf" }],
      }
      expect(treeNodeSchema.parse(node)).toEqual(node)
    })

    it("parses serialized values of every JSON shape", () => {
      const value = { a: ["x", 1, true, null, { b: "y" }], c: "z" }
      expect(serializedValueSchema.parse(value)).toEqual(value)
      expect(serializedValueSchema.parse(null)).toBeNull()
    })

    it("parses component tree nodes with state records", () => {
      const node: ComponentTreeNode = {
        id: 1,
        name: "Root",
        file: "Root.vue",
        hostIds: [1, 2],
        props: { label: "a" },
        attrs: { align: "left" },
        state: { count: 3 },
        data: { open: true },
        children: [{ id: 2, name: "Child" }],
      }
      expect(componentTreeNodeSchema.parse(node)).toEqual(node)
    })
  })

  describe("createSseDecoder error reporting", () => {
    it("reports undecodable events through onInvalid", () => {
      const invalid: Array<[string, unknown]> = []
      const decoder = createSseDecoder(
        () => {
          throw new Error("no valid message expected")
        },
        (raw, error) => {
          invalid.push([raw, error])
        }
      )
      decoder.feed("data: {not json}\n\n")
      decoder.feed('data: {"unknown":true}\n\n')
      expect(invalid.map(([raw]) => raw)).toEqual([
        "{not json}",
        '{"unknown":true}',
      ])
      expect(invalid[0]![1]).toBeInstanceOf(SyntaxError)
      expect(invalid[1]![1]).toBeInstanceOf(AutomationError)
    })
  })
})
