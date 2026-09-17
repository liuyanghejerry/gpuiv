/** Deep links: the test bridge records scheme registrations (answering from
 *  a canned queue) and delivers opened URLs through the armed callback. */

// @ts-nocheck

import { describe, expect, it } from "vitest"
import { TestRenderer, hasNativeTestRenderer } from "../testing.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

describeNative("deep links", () => {
  it("delivers opened urls to the armed handler", async () => {
    const renderer = new TestRenderer()
    const opened = []
    renderer.onOpenUrls((error, urls) => {
      expect(error).toBeNull()
      opened.push(...urls)
    })

    renderer.fireOpenUrls(["myapp://thread/42", "myapp://settings"])
    for (let i = 0; i < 100 && opened.length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    expect(opened).toEqual(["myapp://thread/42", "myapp://settings"])
  })

  it("records scheme registration and answers success by default", async () => {
    const renderer = new TestRenderer()
    const outcomes = []
    renderer.registerUrlScheme("myapp", (error) => outcomes.push(error))

    for (let i = 0; i < 100 && outcomes.length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    expect(renderer.getLastUrlScheme()).toBe("myapp")
    expect(outcomes).toEqual([null])
  })

  it("answers scheme registration from the canned queue", async () => {
    const renderer = new TestRenderer()
    renderer.setNextUrlSchemeError("Cannot register URL scheme until app is installed")
    const outcomes = []
    renderer.registerUrlScheme("myapp", (error) => outcomes.push(error))

    for (let i = 0; i < 100 && outcomes.length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    expect(outcomes[0]?.message).toMatch(/installed/)
  })

  it("the helpers reach the bridge", async () => {
    const { onOpenUrls, registerUrlScheme } = await import("../index.js")
    const renderer = new TestRenderer()
    const opened = []
    onOpenUrls(renderer as never, (urls) => opened.push(...urls))
    renderer.fireOpenUrls(["myapp://open"])
    await registerUrlScheme(renderer as never, "myapp")
    expect(opened).toEqual(["myapp://open"])
    expect(renderer.getLastUrlScheme()).toBe("myapp")
  })
})
