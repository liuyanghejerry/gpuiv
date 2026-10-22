/// Barrel smoke tests: every public entry re-exports the names its barrel
/// declares, and none of them is undefined at runtime. Guards against a
/// renamed or dropped export silently hollowing out an entry point. Pure
/// imports — no native renderer needed.

import { describe, expect, it } from "vitest"
import * as components from "../components/index.js"
import * as hmr from "../hmr/index.js"
import * as automation from "../automation/index.js"
import * as main from "../index.js"

function expectExports(barrel: object, names: string[]): void {
  for (const name of names) {
    expect(barrel, `barrel is missing ${name}`).toHaveProperty(name)
    expect((barrel as Record<string, unknown>)[name], `${name} is undefined`).toBeDefined()
  }
}

describe("components barrel", () => {
  it("exports every component family and floating helper", () => {
    expectExports(components, [
      "motion",
      "Collapsible",
      "CollapsibleTrigger",
      "CollapsiblePanel",
      "Spinner",
      "AnsiLog",
      "AnsiText",
      "VirtualList",
      "FloatingLayer",
      "floatingRootStyle",
      "mergeStyles",
      "resolveStyle",
      "useControllableState",
      "Select",
      "SelectContent",
      "SelectGroup",
      "SelectItem",
      "SelectLabel",
      "SelectScrollDownButton",
      "SelectScrollUpButton",
      "SelectSeparator",
      "SelectTrigger",
      "SelectValue",
    ])
  })
})

describe("hmr barrel", () => {
  it("exports only the two injected entry points", () => {
    expect(Object.keys(hmr).sort()).toEqual(["__gpuivHmrComponent", "__gpuivHmrFile"])
    expectExports(hmr, ["__gpuivHmrComponent", "__gpuivHmrFile"])
  })
})

describe("automation barrel", () => {
  it("exports the client, inspector, and protocol surface", () => {
    expectExports(automation, [
      "App",
      "connectStdio",
      "connectTest",
      "handleAutomationRequest",
      "InProcessBackend",
      "launch",
      "liveRendererAsTest",
      "Locator",
      "serveAutomationStdio",
      "SseBackend",
      "createComponentInspector",
      "AutomationError",
      "createSseDecoder",
      "decodeSseChunk",
      "encodeSse",
      "methods",
      "parseRequest",
      "parseResponse",
      "parseWireMessage",
      "PROTOCOL_VERSION",
    ])
  })
})

describe("public entry", () => {
  it("exports the app lifecycle API", () => {
    expectExports(main, [
      "createApp",
      "createNativeRenderer",
      "createWindow",
      "resetApp",
      "startFrameLoop",
      "promptForPaths",
      "promptForNewPath",
      "setMenus",
      "dismissSystemNotification",
      "onSystemNotificationResponse",
      "setAppIdentity",
      "showSystemNotification",
      "onOpenUrls",
      "onOpenRequests",
      "parseOpenRequest",
      "registerUrlScheme",
      "setTray",
      "clearTray",
      "registerGlobalShortcut",
      "unregisterGlobalShortcut",
    ])
  })

  it("exports packaging, updater, and single-instance APIs", () => {
    expectExports(main, [
      "isPackaged",
      "resourcesPath",
      "resolveResourcesPath",
      "acquireSingleInstance",
      "createUpdater",
      "applyDarwinSwap",
      "applyWindowsHandoff",
      "cleanWindowsLeftovers",
      "compareVersions",
      "decideUpdate",
      "finishPendingWindowsUpdate",
      "parseUpdatePublicKey",
      "platformKey",
      "verifyArtifact",
    ])
  })

  it("exports hooks and components", () => {
    expectExports(main, [
      "GPUIV_CONTEXT",
      "useGpuix",
      "useGpuixRequired",
      "useWindowSize",
      "useWindowInsets",
      "useElementBounds",
      "createScrollController",
      "useScrollController",
      "findRanges",
      "useTextSearch",
      "motion",
      "AnimatePresence",
      "useIsPresent",
      "usePresence",
      "AnimateHeight",
      "Collapsible",
      "CollapsibleTrigger",
      "CollapsiblePanel",
      "MarkdownEditor",
      "Spinner",
      "AnsiLog",
      "AnsiText",
      "ANSI_PALETTE",
      "createAnsiParser",
      "parseAnsi",
      "VirtualList",
      "GpuixCanvas",
      "GpuixCanvasGradient",
      "GpuixImageData",
      "FloatingLayer",
      "floatingRootStyle",
      "mergeStyles",
      "resolveStyle",
      "useControllableState",
      "Combobox",
      "ComboboxContent",
      "ComboboxEmpty",
      "ComboboxGroup",
      "ComboboxInput",
      "ComboboxItem",
      "ComboboxLabel",
      "ComboboxList",
      "ComboboxSeparator",
      "ComboboxTrigger",
      "ComboboxValue",
      "Tooltip",
      "TooltipContent",
      "TooltipProvider",
      "TooltipTrigger",
      "Select",
      "SelectContent",
      "SelectGroup",
      "SelectItem",
      "SelectLabel",
      "SelectScrollDownButton",
      "SelectScrollUpButton",
      "SelectSeparator",
      "SelectTrigger",
      "SelectValue",
    ])
  })

  it("exports renderer, testing, and automation passthroughs", () => {
    expectExports(main, [
      "createGpuivRendererHost",
      "connectVueDevtools",
      "handleGpuixEvent",
      "TestRenderer",
      "applyMacCpuThrottleFromEnv",
      "createTestApp",
      "hasNativeTestRenderer",
      "readMacCpuThrottle",
      "connectTest",
      "connectStdio",
      "launch",
      "GpuixRenderer",
    ])
  })
})
