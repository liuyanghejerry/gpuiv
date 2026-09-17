/** System notifications: the test bridge records notifications through the
 *  production conversion path (mirroring gpui's test platform — an app
 *  identity must be armed first, and same-tag notifications replace) and
 *  drives activations through the armed callback. */

// @ts-nocheck

import { describe, expect, it } from "vitest"
import { TestRenderer, hasNativeTestRenderer } from "../testing.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

describeNative("system notifications", () => {
  it("is a no-op until an app identity is armed", () => {
    const renderer = new TestRenderer()
    const tag = renderer.showSystemNotification({ title: "No identity" })
    expect(tag).not.toBe("")
    expect(renderer.getShownSystemNotifications()).toEqual([])
    expect(renderer.getDeliveredSystemNotifications()).toEqual([])
  })

  it("records shown and delivered notifications", () => {
    const renderer = new TestRenderer()
    renderer.setAppIdentity("com.example.chat", "Chat")
    expect(renderer.getAppIdentity()).toEqual({
      identifier: "com.example.chat",
      name: "Chat",
    })

    renderer.showSystemNotification({
      title: "Job finished",
      body: "All rows written",
      actions: [{ id: "open", label: "Open" }],
    })

    const [recorded] = renderer.getShownSystemNotifications()
    expect(recorded.title).toBe("Job finished")
    expect(recorded.body).toBe("All rows written")
    expect(recorded.actions).toEqual([{ id: "open", label: "Open" }])
    expect(recorded.tag).not.toBe("")
    expect(renderer.getDeliveredSystemNotifications()).toHaveLength(1)
  })

  it("replaces the delivered notification when the tag matches", () => {
    const renderer = new TestRenderer()
    renderer.setAppIdentity("com.example.chat", "Chat")

    renderer.showSystemNotification({ tag: "job-1", title: "First" })
    renderer.showSystemNotification({ tag: "job-1", title: "Second" })

    const shown = renderer.getShownSystemNotifications()
    expect(shown).toHaveLength(2)
    expect(shown.map((n) => n.title)).toEqual(["First", "Second"])
    const delivered = renderer.getDeliveredSystemNotifications()
    expect(delivered).toHaveLength(1)
    expect(delivered[0].title).toBe("Second")
  })

  it("generates a unique tag for untagged notifications", () => {
    const renderer = new TestRenderer()
    renderer.setAppIdentity("com.example.chat", "Chat")

    const first = renderer.showSystemNotification({ title: "One" })
    const second = renderer.showSystemNotification({ title: "Two" })
    expect(first).not.toBe(second)
    expect(renderer.getDeliveredSystemNotifications()).toHaveLength(2)
  })

  it("dismissal records the tag and removes the notification", () => {
    const renderer = new TestRenderer()
    renderer.setAppIdentity("com.example.chat", "Chat")

    const tag = renderer.showSystemNotification({ tag: "job-1", title: "First" })
    renderer.showSystemNotification({ tag: "job-2", title: "Second" })
    renderer.dismissSystemNotification(tag)

    expect(renderer.getDismissedSystemNotifications()).toEqual([tag])
    expect(
      renderer.getDeliveredSystemNotifications().map((n) => n.tag)
    ).toEqual(["job-2"])
  })

  it("delivers activations to the armed callback", async () => {
    const renderer = new TestRenderer()
    renderer.setAppIdentity("com.example.chat", "Chat")
    const responses = []
    renderer.onSystemNotificationResponse((error, response) => {
      expect(error).toBeNull()
      responses.push(response)
    })

    renderer.fireSystemNotificationResponse("job-1", null)
    renderer.fireSystemNotificationResponse("job-1", "open")
    for (let i = 0; i < 100 && responses.length < 2; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    expect(responses).toEqual([{ tag: "job-1" }, { tag: "job-1", actionId: "open" }])
  })

  it("the promise-free helpers reach the bridge", async () => {
    const { showSystemNotification, onSystemNotificationResponse } = await import(
      "../index.js"
    )
    const renderer = new TestRenderer()
    renderer.setAppIdentity("com.example.chat", "Chat")

    const tag = showSystemNotification(renderer as never, {
      tag: "helper-1",
      title: "From the helper",
    })
    expect(tag).toBe("helper-1")
    expect(renderer.getShownSystemNotifications()[0].title).toBe("From the helper")

    const responses = []
    onSystemNotificationResponse(renderer as never, (response) =>
      responses.push(response)
    )
    renderer.fireSystemNotificationResponse("helper-1", "open")
    for (let i = 0; i < 100 && responses.length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    expect(responses).toEqual([{ tag: "helper-1", actionId: "open" }])
  })
})
