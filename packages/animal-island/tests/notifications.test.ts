import { afterEach, describe, expect, it, vi } from "vitest"
import { defineComponent, h } from "vue"
import type { HostNode } from "@gpuiv/vue"
import { Notification, NotificationContainer, notificationStore } from "../src/components/Notification.js"
import { mountHost } from "./harness.js"

const cleanups: (() => void)[] = []
function mount() {
  const app = mountHost(defineComponent({ setup: () => () => h(NotificationContainer) }))
  cleanups.push(app.unmount)
  return app
}
function motion(app: ReturnType<typeof mount>, opacity: number): HostNode {
  return app.find(node => (node.props.motion as { animate?: { opacity?: number } } | undefined)?.animate?.opacity === opacity)
}
async function finishExit(app: ReturnType<typeof mount>) {
  const exit = motion(app, 0)
  await app.fire(exit, "motionComplete", { motionGeneration: (exit.props.motion as { generation: number }).generation })
}
afterEach(() => {
  cleanups.splice(0).forEach(cleanup => cleanup())
  Notification.destroy()
  vi.useRealTimers()
})

describe("React Notification close timing through the native mutation/event protocol", () => {
  it("retains the last card and delays onClose until its current 250ms exit completes", async () => {
    const app = mount(), closed = vi.fn()
    Notification.success({ message: "Last card", key: "last", duration: 0, onClose: closed })
    await app.settle()
    const entered = motion(app, 1)
    const enterGeneration = (entered.props.motion as { generation: number }).generation
    await app.fire(app.find(node => node.props["aria-label"] === "close"), "click")
    expect(notificationStore.items).toHaveLength(1)
    expect(closed).not.toHaveBeenCalled()
    expect(app.text()).toContain("Last card")
    const exiting = motion(app, 0)
    expect(exiting.props.motion).toMatchObject({ animate: { opacity: 0, top: -16 }, transition: { duration: 0.25 } })
    await app.fire(exiting, "motionComplete", { motionGeneration: enterGeneration })
    expect(closed).not.toHaveBeenCalled()
    expect(app.text()).toContain("Last card")
    await finishExit(app)
    expect(notificationStore.items).toHaveLength(0)
    expect(closed).toHaveBeenCalledOnce()
    expect(app.text()).not.toContain("Last card")
  })

  it("destroy removes immediately and synchronously invokes onClose without a cached exit", async () => {
    vi.useFakeTimers()
    const app = mount(), closed = vi.fn()
    Notification.info({ message: "Expired soon", key: "old", duration: 0.1, onClose: closed })
    Notification.info({ message: "Keep group alive", key: "keep", duration: 0 })
    await app.settle()
    Notification.destroy("old")
    expect(closed).toHaveBeenCalledOnce()
    await app.settle()
    expect(app.text()).not.toContain("Expired soon")
    expect(app.text()).toContain("Keep group alive")
    expect(app.all().some(node => (node.props.motion as { isExit?: boolean } | undefined)?.isExit)).toBe(false)
    await vi.advanceTimersByTimeAsync(1000)
    expect(closed).toHaveBeenCalledOnce()
  })

  it("cannot double-close when destroy precedes a queued duration callback", async () => {
    vi.useFakeTimers()
    const app = mount(), closed = vi.fn()
    Notification.open({ message: "Queued", key: "queued", duration: 0.01, onClose: closed })
    await app.settle()
    Notification.destroy("queued")
    vi.advanceTimersByTime(20)
    await app.settle()
    expect(closed).toHaveBeenCalledOnce()
    expect(notificationStore.items).toHaveLength(0)
    expect(app.text()).not.toContain("Queued")
  })

  it("duration expiry starts the exit and invokes onClose only after native completion", async () => {
    vi.useFakeTimers()
    const app = mount(), closed = vi.fn()
    Notification.warning({ message: "Automatic", duration: 0.1, onClose: closed })
    await app.settle()
    await vi.advanceTimersByTimeAsync(99)
    expect(motion(app, 1)).toBeDefined()
    await vi.advanceTimersByTimeAsync(1)
    await app.settle()
    expect(closed).not.toHaveBeenCalled()
    expect(notificationStore.items).toHaveLength(1)
    expect(app.text()).toContain("Automatic")
    expect(motion(app, 0).props.motion).toMatchObject({ transition: { duration: 0.25 } })
    await finishExit(app)
    expect(closed).toHaveBeenCalledOnce()
    expect(notificationStore.items).toHaveLength(0)
    expect(app.text()).not.toContain("Automatic")
    await vi.advanceTimersByTimeAsync(1000)
    expect(closed).toHaveBeenCalledOnce()
  })

  it("updates one key and restarts its timeout from the updated duration", async () => {
    vi.useFakeTimers()
    const app = mount(), oldClosed = vi.fn(), newClosed = vi.fn()
    Notification.open({ message: "Old", key: "same", duration: 1, onClose: oldClosed })
    await app.settle()
    await vi.advanceTimersByTimeAsync(500)
    Notification.open({ message: "New", key: "same", duration: 2, onClose: newClosed })
    await app.settle()
    expect(notificationStore.items).toHaveLength(1)
    expect(app.text()).toContain("New")
    await vi.advanceTimersByTimeAsync(501)
    expect(newClosed).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1500)
    await app.settle()
    expect(newClosed).not.toHaveBeenCalled()
    await finishExit(app)
    expect(newClosed).toHaveBeenCalledOnce()
    expect(oldClosed).not.toHaveBeenCalled()
  })

  it("does not revive a leaving card on same-key updates and closes its latest callback once", async () => {
    const app = mount(), oldClosed = vi.fn(), newClosed = vi.fn()
    Notification.open({ message: "Original", key: "same", duration: 0, onClose: oldClosed })
    await app.settle()
    await app.fire(app.find(node => node.props["aria-label"] === "close"), "click")
    Notification.open({ message: "Progress update", key: "same", duration: 0, onClose: newClosed })
    await app.settle()
    expect(motion(app, 0)).toBeDefined()
    await finishExit(app)
    expect(notificationStore.items).toHaveLength(0)
    expect(newClosed).toHaveBeenCalledOnce()
    expect(oldClosed).not.toHaveBeenCalled()
  })

  it("immediate destroy during an exit cancels its stale completion callback", async () => {
    const app = mount(), closed = vi.fn()
    Notification.open({ message: "Closing", key: "same", duration: 0, onClose: closed })
    await app.settle()
    await app.fire(app.find(node => node.props["aria-label"] === "close"), "click")
    const exiting = motion(app, 0), generation = (exiting.props.motion as { generation: number }).generation
    Notification.destroy("same")
    expect(closed).toHaveBeenCalledOnce()
    await app.settle()
    await app.fire(exiting, "motionComplete", { motionGeneration: generation })
    expect(app.text()).not.toContain("Closing")
    expect(closed).toHaveBeenCalledOnce()
  })

  it("destroy and re-open of the same key within one flush mounts a fresh view", async () => {
    const app = mount(), firstClosed = vi.fn(), nextClosed = vi.fn()
    Notification.open({ message: "First", key: "same", duration: 0, onClose: firstClosed })
    await app.settle()
    await app.fire(app.find(node => node.props["aria-label"] === "close"), "click")
    const exiting = motion(app, 0), generation = (exiting.props.motion as { generation: number }).generation
    Notification.destroy("same")
    Notification.open({ message: "Replacement", key: "same", duration: 0, onClose: nextClosed })
    await app.settle()
    expect(motion(app, 1)).toBeDefined()
    await app.fire(exiting, "motionComplete", { motionGeneration: generation })
    expect(app.text()).toContain("Replacement")
    expect(notificationStore.items).toHaveLength(1)
    expect(firstClosed).toHaveBeenCalledOnce()
    expect(nextClosed).not.toHaveBeenCalled()
  })

  it("preserves six placements and reverses bottom ordering", async () => {
    const app = mount()
    Notification.open({ message: "First bottom", position: "bottom", duration: 0 })
    Notification.open({ message: "Latest bottom", position: "bottom", duration: 0 })
    Notification.open({ message: "Right top", position: "topRight", duration: 0 })
    await app.settle()
    expect(app.text().indexOf("Latest bottom")).toBeLessThan(app.text().indexOf("First bottom"))
    expect(notificationStore.items.map(item => item.placement)).toEqual(["bottom", "bottom", "top"])
    expect(app.all().filter(node => (node.props.style as { position?: string; gap?: number } | undefined)?.position === "absolute" && (node.props.style as { gap?: number }).gap === 12)).toHaveLength(6)
  })

  it("keeps card/close keyboard callbacks separate and delays keyboard close until exit completes", async () => {
    const app = mount(), clicked = vi.fn(), closed = vi.fn()
    Notification.error({ message: "Keyboard card", duration: 0, onClick: clicked, onClose: closed })
    await app.settle()
    const card = app.find(node => node.props.role === "button" && node.props["aria-label"] !== "close")
    await app.fire(card, "keyDown", { key: "enter" })
    expect(clicked).toHaveBeenCalledOnce()
    await app.fire(app.find(node => node.props["aria-label"] === "close"), "keyDown", { key: " " })
    expect(closed).not.toHaveBeenCalled()
    await finishExit(app)
    expect(closed).toHaveBeenCalledOnce()
    expect(clicked).toHaveBeenCalledOnce()
  })

  it("releases timeout ownership when the container unmounts", async () => {
    vi.useFakeTimers()
    const app = mount(), closed = vi.fn()
    Notification.open({ message: "Unmounting", duration: 0.1, onClose: closed })
    await app.settle()
    app.unmount(); cleanups.pop()
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(1000)
    expect(closed).not.toHaveBeenCalled()
  })
})
