/// Headless contract tests for the chrome helpers — file dialogs (dialogs.ts),
/// system notifications (notifications.ts), and the tray (tray.ts). The
/// wrappers only add missing-method guards and Promise wiring over the
/// renderer callbacks, so a canned NativeRenderer subclass is enough; the GPU
/// test renderer is not required.

import { describe, expect, it, vi } from "vitest"
import { HeadlessRenderer } from "./headless.js"
import { promptForNewPath, promptForPaths, setMenus } from "../dialogs.js"
import {
  dismissSystemNotification,
  onSystemNotificationResponse,
  setAppIdentity,
  showSystemNotification,
} from "../notifications.js"
import { clearTray, setTray } from "../tray.js"
import type {
  MenuBarMenu,
  NewPathPromptOutcome,
  PathPromptOptions,
  PathPromptOutcome,
  SystemNotificationOptions,
  SystemNotificationResponse,
} from "../types.js"

class ChromeRenderer extends HeadlessRenderer {
  // dialogs
  pathPromptOptions: PathPromptOptions | null = null
  pathOutcome: PathPromptOutcome | null = null
  pathError: Error | null = null
  newPathArgs: { directory: string | null; suggestedName: string | null } | null = null
  newPathOutcome: NewPathPromptOutcome | null = null
  newPathError: Error | null = null
  installedMenus: MenuBarMenu[] | null = null
  menuAction: ((error: Error | null, id: string) => void) | null = null
  // notifications
  identity: { identifier: string; name: string } | null = null
  shownNotifications: SystemNotificationOptions[] = []
  dismissedTags: string[] = []
  responseHandler: ((error: Error | null, response: SystemNotificationResponse) => void) | null = null
  // tray
  trayDesc: { iconPath: string; tooltip?: string | null; template?: boolean | null } | null = null
  trayClick: (() => void) | null = null
  trayError: Error | null = null
  clearTrayError: Error | null = null

  promptForPaths(
    options: PathPromptOptions,
    callback: (error: Error | null, outcome: PathPromptOutcome) => void
  ): void {
    this.pathPromptOptions = options
    const error = this.pathError
    this.pathError = null
    callback(error, this.pathOutcome ?? {})
  }

  promptForNewPath(
    directory: string | undefined | null,
    suggestedName: string | undefined | null,
    callback: (error: Error | null, outcome: NewPathPromptOutcome) => void
  ): void {
    this.newPathArgs = { directory: directory ?? null, suggestedName: suggestedName ?? null }
    const error = this.newPathError
    this.newPathError = null
    callback(error, this.newPathOutcome ?? {})
  }

  setMenus(
    menus: MenuBarMenu[],
    onAction: (error: Error | null, id: string) => void
  ): void {
    this.installedMenus = menus
    this.menuAction = onAction
  }

  setAppIdentity(identifier: string, name: string): void {
    this.identity = { identifier, name }
  }

  showSystemNotification(notification: SystemNotificationOptions): string {
    const tag = notification.tag ?? `tag-${this.shownNotifications.length + 1}`
    this.shownNotifications.push({ ...notification, tag })
    return tag
  }

  dismissSystemNotification(tag: string): void {
    this.dismissedTags.push(tag)
    this.shownNotifications = this.shownNotifications.filter(
      (notification) => notification.tag !== tag
    )
  }

  onSystemNotificationResponse(
    callback: (error: Error | null, response: SystemNotificationResponse) => void
  ): void {
    this.responseHandler = callback
  }

  setTray(
    desc: { iconPath: string; tooltip?: string | null; template?: boolean | null },
    onClick: (() => void) | null,
    callback: (error: Error | null) => void
  ): void {
    const error = this.trayError
    this.trayError = null
    if (error) {
      callback(error)
      return
    }
    this.trayDesc = desc
    this.trayClick = onClick
    callback(null)
  }

  clearTray(callback: (error: Error | null) => void): void {
    const error = this.clearTrayError
    this.clearTrayError = null
    if (error) {
      callback(error)
      return
    }
    this.trayDesc = null
    callback(null)
  }
}

describe("file dialogs (headless)", () => {
  it("promptForPaths resolves with the outcome paths and passes options through", async () => {
    const renderer = new ChromeRenderer()
    renderer.pathOutcome = { paths: ["/tmp/a.png", "/tmp/b.png"] } as PathPromptOutcome
    const options: PathPromptOptions = { files: true, directories: false, multiple: true, prompt: "Open" }

    await expect(promptForPaths(renderer, options)).resolves.toEqual(["/tmp/a.png", "/tmp/b.png"])
    expect(renderer.pathPromptOptions).toBe(options)
  })

  it("promptForPaths resolves with null when the user cancelled", async () => {
    const renderer = new ChromeRenderer()
    await expect(
      promptForPaths(renderer, { files: true, directories: false, multiple: false })
    ).resolves.toBeNull()
  })

  it("promptForPaths rejects with the renderer error", async () => {
    const renderer = new ChromeRenderer()
    renderer.pathError = new Error("panel failed")
    await expect(
      promptForPaths(renderer, { files: true, directories: false, multiple: false })
    ).rejects.toThrow("panel failed")
  })

  it("promptForPaths rejects when the renderer predates the method", async () => {
    await expect(
      promptForPaths(new HeadlessRenderer(), { files: true, directories: false, multiple: false })
    ).rejects.toThrow(/does not implement promptForPaths/)
  })

  it("promptForNewPath forwards directory and suggested name, defaulting both to null", async () => {
    const renderer = new ChromeRenderer()
    renderer.newPathOutcome = { path: "/tmp/notes.txt" } as NewPathPromptOutcome
    await expect(promptForNewPath(renderer)).resolves.toBe("/tmp/notes.txt")
    expect(renderer.newPathArgs).toEqual({ directory: null, suggestedName: null })

    await promptForNewPath(renderer, { directory: "/tmp", suggestedName: "notes.txt" })
    expect(renderer.newPathArgs).toEqual({ directory: "/tmp", suggestedName: "notes.txt" })
  })

  it("promptForNewPath resolves with null on cancel and rejects on error", async () => {
    const renderer = new ChromeRenderer()
    renderer.newPathOutcome = {} as NewPathPromptOutcome
    await expect(promptForNewPath(renderer)).resolves.toBeNull()

    renderer.newPathError = new Error("save failed")
    await expect(promptForNewPath(renderer)).rejects.toThrow("save failed")
  })

  it("promptForNewPath rejects when the renderer predates the method", async () => {
    await expect(
      promptForNewPath(new HeadlessRenderer())
    ).rejects.toThrow(/does not implement promptForNewPath/)
  })

  it("setMenus installs the bar and forwards fired item ids to onAction", () => {
    const renderer = new ChromeRenderer()
    const onAction = vi.fn()
    const menus: MenuBarMenu[] = [
      { name: "File", items: [{ id: "open", label: "Open" }] },
    ]

    setMenus(renderer, menus, onAction)
    expect(renderer.installedMenus).toBe(menus)

    renderer.menuAction?.(null, "open")
    expect(onAction).toHaveBeenCalledWith("open")

    expect(() => renderer.menuAction?.(new Error("menu broken"), "open")).toThrow("menu broken")
  })

  it("setMenus throws when the renderer predates the method", () => {
    expect(() => setMenus(new HeadlessRenderer(), [], () => {})).toThrow(
      /does not implement setMenus/
    )
  })
})

describe("system notifications (headless)", () => {
  it("setAppIdentity records the identity and guards missing renderers", () => {
    const renderer = new ChromeRenderer()
    setAppIdentity(renderer, "com.example.chat", "Chat")
    expect(renderer.identity).toEqual({ identifier: "com.example.chat", name: "Chat" })

    expect(() => setAppIdentity(new HeadlessRenderer(), "x", "y")).toThrow(
      /does not implement setAppIdentity/
    )
  })

  it("showSystemNotification returns the described tag or generates one", () => {
    const renderer = new ChromeRenderer()
    expect(
      showSystemNotification(renderer, { title: "Tagged", tag: "job-1" })
    ).toBe("job-1")
    const generated = showSystemNotification(renderer, { title: "Untagged" })
    expect(typeof generated).toBe("string")
    expect(generated).not.toBe("")
    expect(renderer.shownNotifications).toHaveLength(2)
  })

  it("showSystemNotification throws when the renderer predates the method", () => {
    expect(() =>
      showSystemNotification(new HeadlessRenderer(), { title: "Nope" })
    ).toThrow(/does not implement showSystemNotification/)
  })

  it("dismissSystemNotification removes by tag and guards missing renderers", () => {
    const renderer = new ChromeRenderer()
    showSystemNotification(renderer, { title: "Job", tag: "job-1" })
    dismissSystemNotification(renderer, "job-1")
    expect(renderer.dismissedTags).toEqual(["job-1"])
    expect(renderer.shownNotifications).toHaveLength(0)

    expect(() => dismissSystemNotification(new HeadlessRenderer(), "job-1")).toThrow(
      /does not implement dismissSystemNotification/
    )
  })

  it("onSystemNotificationResponse delivers activations and throws on errors", () => {
    const renderer = new ChromeRenderer()
    const handler = vi.fn()
    onSystemNotificationResponse(renderer, handler)

    const response = { tag: "job-1", actionId: "open" } as SystemNotificationResponse
    renderer.responseHandler?.(null, response)
    expect(handler).toHaveBeenCalledWith(response)

    expect(() =>
      renderer.responseHandler?.(new Error("activation lost"), response)
    ).toThrow("activation lost")
  })

  it("onSystemNotificationResponse throws when the renderer predates the method", () => {
    expect(() => onSystemNotificationResponse(new HeadlessRenderer(), () => {})).toThrow(
      /does not implement onSystemNotificationResponse/
    )
  })
})

describe("tray (headless)", () => {
  it("setTray installs the icon and delivers clicks to the handler", async () => {
    const renderer = new ChromeRenderer()
    const onClick = vi.fn()

    await setTray(renderer, { iconPath: "/icons/tray.png" })
    // tooltip and template stay absent when not described
    expect(renderer.trayDesc).toEqual({ iconPath: "/icons/tray.png" })
    expect(renderer.trayClick).toBeNull()

    await setTray(
      renderer,
      { iconPath: "/icons/tray@2x.png", tooltip: "Chat", template: true },
      onClick
    )
    expect(renderer.trayDesc).toEqual({
      iconPath: "/icons/tray@2x.png",
      tooltip: "Chat",
      template: true,
    })

    renderer.trayClick?.()
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it("setTray rejects with the renderer error or when the method is missing", async () => {
    const renderer = new ChromeRenderer()
    renderer.trayError = new Error("unsupported on this platform")
    await expect(setTray(renderer, { iconPath: "/icons/x.png" })).rejects.toThrow(
      "unsupported on this platform"
    )

    await expect(setTray(new HeadlessRenderer(), { iconPath: "/icons/x.png" })).rejects.toThrow(
      /does not implement setTray/
    )
  })

  it("clearTray removes the tray, rejects on error, and guards missing renderers", async () => {
    const renderer = new ChromeRenderer()
    await setTray(renderer, { iconPath: "/icons/tray.png" })
    await clearTray(renderer)
    expect(renderer.trayDesc).toBeNull()

    renderer.clearTrayError = new Error("no tray")
    await expect(clearTray(renderer)).rejects.toThrow("no tray")

    await expect(clearTray(new HeadlessRenderer())).rejects.toThrow(
      /does not implement clearTray/
    )
  })
})
