import { defineComponent, h, ref } from "vue"
import { describe, expect, it } from "vitest"
import { connectTest } from "@gpuiv/vue/automation"
import { createTestApp, hasNativeTestRenderer } from "@gpuiv/vue/testing"
import {
  AgentScreen,
  Flowchart,
  LoadingState,
  ApprovalCard,
  Button,
  DiffTable,
  INITIAL_ROWS,
  RecordsTable,
  StreamingText,
  ThinkingState,
  ToolChips,
  SidebarNav,
  createTheme,
  Shimmer,
  mix,
  provideTheme,
  type StreamingToken,
} from "@gpuiv/beautiful-ui"

const describeNative = hasNativeTestRenderer ? describe : describe.skip
const host = (render: () => ReturnType<typeof h>, reducedMotion = false) =>
  defineComponent({
    setup() {
      provideTheme(createTheme({ reducedMotion }))
      return render
    },
  })
const until = async (app: ReturnType<typeof createTestApp>, check: () => boolean, timeout = 4000) => {
  const deadline = Date.now() + timeout
  do {
    await app.settle()
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 30))
  } while (Date.now() < deadline)
  expect(check()).toBe(true)
}
const rowIds = (app: ReturnType<typeof createTestApp>) =>
  app.renderer
    .findByType("div")
    .map((el) => el.testId)
    .filter((id): id is string => id?.startsWith("records-row-") ?? false)

describeNative("beautiful-ui behavior parity", () => {
  it("gives each tool row one tab stop and toggles once per keyboard or chip click", async () => {
    const toggles: Array<[string, boolean]> = []
    const app = createTestApp(
      host(
        () =>
          h("div", {}, [
            h(ToolChips, {
              steps: [
                {
                  icon: "think",
                  label: "Thinking",
                  chip: "Plan",
                  mono: false,
                  detailMono: false,
                  detail: [{ text: "Plan detail" }],
                },
              ],
              diffs: [],
              onToggleRow: (label, open) => toggles.push([label, open]),
            }),
            h(Button, { testId: "after-tools" }, () => "Next"),
          ]),
        true,
      ),
    )
    try {
      await until(app, () => !!app.renderer.findByTestId("toolchips-row-thinking"))
      const row = app.renderer.findByTestId("toolchips-row-thinking")!
      app.renderer.focusElement(row.id)
      app.renderer.focusNext()
      await app.settle()
      expect(app.renderer.getFocusedElementId()).toBe(app.renderer.findByTestId("after-tools")!.id)
      app.renderer.nativeSimulateKeystrokes(row.id, "enter space")
      await app.settle()
      expect(toggles).toEqual([
        ["Thinking", true],
        ["Thinking", false],
      ])
      const chip = app.renderer.findByType("div").find((node) => node.parentId === row.id && node.events.has("click"))!
      await new Promise((resolve) => setTimeout(resolve, 250))
      await app.settle()
      const box = app.renderer.getElementBounds(chip.id)!
      const automation = await connectTest(app.renderer, app.settle)
      await automation.mouse.click({ x: box.x + box.width / 2, y: box.y + box.height / 2 })
      expect(toggles).toEqual([
        ["Thinking", true],
        ["Thinking", false],
        ["Thinking", true],
      ])
    } finally {
      app.unmount()
    }
  })

  it("skips invisible sidebar expand/collapse actions during native focus traversal", async () => {
    const app = createTestApp(host(() => h(SidebarNav)))
    try {
      const workspace = app.renderer.findByTestId("sidebar-workspace-trigger")!.id
      const collapse = app.renderer.findByTestId("sidebar-collapse")!.id
      const expand = app.renderer.findByTestId("sidebar-expand")!.id
      const visited = (start: number) => {
        app.renderer.focusElement(start)
        const ids: Array<number | null> = []
        for (let i = 0; i < 16; i++) {
          app.renderer.focusNext()
          ids.push(app.renderer.getFocusedElementId())
        }
        return ids
      }
      expect(visited(workspace)).not.toContain(expand)
      expect(app.renderer.findByTestId("sidebar-expand")!.events.has("keyDown")).toBe(false)
      app.renderer.nativeSimulateKeystrokes(collapse, "enter")
      await app.settle()
      const collapsedOrder = visited(expand)
      expect(collapsedOrder).not.toContain(collapse)
      expect(collapsedOrder).not.toContain(workspace)
      expect(app.renderer.findByTestId("sidebar-collapse")!.events.has("keyDown")).toBe(false)
      app.renderer.nativeSimulateKeystrokes(expand, "space")
      await app.settle()
      expect(visited(workspace)).not.toContain(expand)
    } finally {
      app.unmount()
    }
  })

  it("resumes a completed non-looping stream when tokens arrive", async () => {
    const content = ref<StreamingToken[]>([{ text: "initial" }])
    let completions = 0
    const app = createTestApp(
      host(() =>
        h(StreamingText, {
          content: content.value,
          loop: false,
          onDone: () => completions++,
        }),
      ),
    )
    try {
      await until(app, () => completions === 1)
      content.value.push({ text: "appended" })
      await until(app, () => app.renderer.getAllText().includes("appended"))
      expect(completions).toBe(2)
      expect(app.renderer.getAllText()).toContain("initial")
    } finally {
      app.unmount()
    }
  })

  it("starts an initially empty stream and reacts to loop changes", async () => {
    const content = ref<StreamingToken[]>([])
    const loop = ref(false)
    let completions = 0
    const app = createTestApp(
      host(() =>
        h(StreamingText, {
          content: content.value,
          loop: loop.value,
          onDone: () => completions++,
        }),
      ),
    )
    try {
      expect(completions).toBe(1)
      content.value = [{ text: "new" }]
      await until(app, () => completions === 2)
      loop.value = true
      await app.settle()
      loop.value = false
      await until(app, () => completions === 3)
      expect(app.renderer.getAllText()).toContain("new")
    } finally {
      app.unmount()
    }
  })

  it("activates buttons with Enter and Space and respects disabled", async () => {
    const disabled = ref(false)
    let clicks = 0
    const app = createTestApp(
      host(() =>
        h(
          Button,
          {
            testId: "keyboard-button",
            disabled: disabled.value,
            onClick: () => clicks++,
          },
          () => "Action",
        ),
      ),
    )
    try {
      const id = app.renderer.findByTestId("keyboard-button")!.id
      app.renderer.nativeSimulateKeystrokes(id, "enter space")
      await app.settle()
      expect(clicks).toBe(2)
      disabled.value = true
      await app.settle()
      app.renderer.nativeSimulateKeystrokes(id, "enter space")
      await app.settle()
      expect(clicks).toBe(2)
    } finally {
      app.unmount()
    }
  })

  it("updates virtual rows in a small fill viewport and after shrinking data", async () => {
    const rows = ref(INITIAL_ROWS.slice(0, 10))
    const app = createTestApp(
      host(() =>
        h(
          "div",
          {
            style: { height: 200, width: 900, display: "flex", flexDirection: "column" },
          },
          [h(RecordsTable, { fill: true, rows: rows.value })],
        ),
      ),
    )
    try {
      await until(app, () => rowIds(app).length > 0 && rowIds(app).length < 10)
      const initial = rowIds(app)
      const scroller = app.renderer.findByTestId("records-scroll")!
      app.renderer.scrollTo(scroller.id, 0, -300)
      await until(app, () => rowIds(app).some((id) => !initial.includes(id)))
      const last = [...rows.value].sort((a, b) => a.name.localeCompare(b.name)).at(-1)!
      expect(rowIds(app)).toContain(`records-row-${last.id}`)
      rows.value = INITIAL_ROWS.slice(0, 2)
      await until(app, () => rowIds(app).length === 2)
    } finally {
      app.unmount()
    }
  })

  it("activates changed diff rows from the keyboard and locks applied edits", async () => {
    const app = createTestApp(host(() => h(DiffTable)))
    try {
      await until(app, () => !!app.renderer.findByTestId("diff-apply"))
      const row = app.renderer.findByTestId("diff-row-rocky")!
      app.renderer.nativeSimulateKeystrokes(row.id, "space")
      await app.settle()
      expect(app.renderer.getAllText()).toContain("Apply 2 changes")
      app.renderer.nativeSimulateKeystrokes(app.renderer.findByTestId("diff-apply")!.id, "enter")
      await app.settle()
      expect(app.renderer.getAllText()).toContain("2 edits applied")
      app.renderer.nativeSimulateKeystrokes(row.id, "space")
      await app.settle()
      expect(app.renderer.getAllText()).toContain("2 edits applied")
    } finally {
      app.unmount()
    }
  })

  it("selects approval options from the keyboard", async () => {
    const app = createTestApp(host(() => h(ApprovalCard)))
    try {
      const option = app.renderer.findByTestId("approval-option-0")!
      app.renderer.nativeSimulateKeystrokes(option.id, "space")
      await app.settle()
      await until(app, () => app.renderer.getAllText().includes("Which mix-ins should we stock?"))
    } finally {
      app.unmount()
    }
  })

  it("opens both inline citations and source rows through app navigation", async () => {
    const opened: string[] = []
    const app = createTestApp(
      host(() =>
        h(StreamingText, {
          loop: false,
          content: [{ text: "", cite: true }],
          sources: [{ name: "Docs", domain: "docs.example", href: "https://example.com/docs", image: "" }],
          onSourceClick: (source) => opened.push(source.href),
        }),
      ),
    )
    try {
      await until(app, () => !!app.renderer.findByTestId("streaming-citation-0"))
      app.renderer.nativeSimulateKeystrokes(app.renderer.findByTestId("streaming-citation-0")!.id, "enter")
      await app.settle()
      const automation = await connectTest(app.renderer, app.settle)
      await automation.getByTestId("streaming-sources").click()
      app.renderer.nativeSimulateKeystrokes(app.renderer.findByTestId("streaming-source-docs.example")!.id, "enter")
      await app.settle()
      expect(opened).toEqual(["https://example.com/docs", "https://example.com/docs"])
    } finally {
      app.unmount()
    }
  })

  it("opens search trace sources through app navigation", async () => {
    const opened: string[] = []
    const app = createTestApp(
      host(() =>
        h(ThinkingState, {
          variant: "Search",
          rows: [{ primary: "Docs", href: "https://example.com/docs" }],
          onSourceClick: (row) => opened.push(row.href!),
        }),
      ),
    )
    try {
      await until(app, () => !!app.renderer.findByTestId("thinking-source-0"))
      app.renderer.nativeSimulateKeystrokes(app.renderer.findByTestId("thinking-source-0")!.id, "enter")
      await app.settle()
      expect(opened).toEqual(["https://example.com/docs"])
    } finally {
      app.unmount()
    }
  })
  it("restarts the thinking trace when its variant changes", async () => {
    const variant = ref<"Search" | "Reasoning">("Search")
    const app = createTestApp(
      host(() =>
        h(ThinkingState, {
          variant: variant.value,
          rows: [{ primary: "Docs", href: "https://example.com/docs" }],
        }),
      ),
    )
    try {
      await until(app, () => !!app.renderer.findByTestId("thinking-source-0"))
      variant.value = "Reasoning"
      await app.settle()
      variant.value = "Search"
      await app.settle()
      expect(app.renderer.findByTestId("thinking-source-0")).toBeFalsy()
      await until(app, () => !!app.renderer.findByTestId("thinking-source-0"))
    } finally {
      app.unmount()
    }
  })

  it("moves workflow nodes with the keyboard", async () => {
    const moved: number[] = []
    const conditions: string[] = []
    const app = createTestApp(
      host(() =>
        h("div", { style: { width: 600 } }, [
          h(Flowchart, {
            onMove: (_id, offset) => moved.push(offset.dx),
            onConditionChange: (_id, values) => conditions.push(values.prop1!),
          }),
        ]),
      ),
    )
    try {
      await app.settle()
      app.renderer.nativeSimulateKeystrokes(app.renderer.findByTestId("flowchart-drag-trigger")!.id, "right right")
      await app.settle()
      expect(moved).toEqual([1, 2])
      const automation = await connectTest(app.renderer, app.settle)
      await automation.getByTestId("flowchart-drag-trigger").dragBy(80, 20)
      expect(moved.at(-1)).toBe(82)
      await automation.getByTestId("flowchart-cond-prop1").click()
      const options = app.renderer.findByType("div").filter((node) => node.customProps?.role === "option")
      expect(options).toHaveLength(4)
      app.renderer.nativeSimulateKeystrokes(app.renderer.findByTestId("flowchart-condition-menu")!.id, "down enter")
      await app.settle()
      expect(conditions).toEqual(["topping"])
    } finally {
      app.unmount()
    }
  })

  it("keeps recording while the agent viewer is collapsed", async () => {
    let starts = 0
    const durations: number[] = []
    const app = createTestApp(
      host(() =>
        h(AgentScreen, {
          streamSrc: "",
          onTeachTask: () => starts++,
          onEndTask: (seconds) => durations.push(seconds),
        }),
      ),
    )
    try {
      const automation = await connectTest(app.renderer, app.settle)
      await automation.getByTestId("agent-screen-open").click()
      await automation.getByTestId("agent-screen-teach").click()
      expect(starts).toBe(1)
      // Recording replaces Teach with End and adds the REC badge. Finish the
      // resulting focus/layout update before resolving the next click's bounds.
      await until(app, () => app.renderer.getPaintedText().includes("End"))
      const collapseBounds = await automation.getByTestId("agent-screen-collapse").bounds()
      await automation.getByTestId("agent-screen-collapse").click()
      expect(
        app.renderer.findByTestId("agent-screen-viewer"),
        JSON.stringify({
          collapseBounds,
          nodes: app.renderer.findByType("div").map((node) => ({
            id: node.id,
            parentId: node.parentId,
            testId: node.testId,
            bounds: app.renderer.getElementBounds(node.id),
            style: node.style,
            events: [...node.events],
          })),
        }),
      ).toBeFalsy()
      await until(app, () => app.renderer.getAllText().includes("REC 00:01"))
      await automation.getByTestId("agent-screen-open").click()
      await automation.getByTestId("agent-screen-end").click()
      expect(durations[0]).toBeGreaterThanOrEqual(1)
      expect(app.renderer.findByTestId("agent-recording")).toBeFalsy()
      app.renderer.nativeSimulateKeystrokes(app.renderer.findByTestId("agent-screen-viewer")!.id, "escape")
      await app.settle()
      expect(app.renderer.findByTestId("agent-screen-viewer")).toBeFalsy()
    } finally {
      app.unmount()
    }
  })

  it("renders the native Surfer context card", () => {
    const app = createTestApp(host(() => h(LoadingState, { variant: "Surfer", phase: 0 })))
    try {
      expect(app.renderer.findByTestId("loading-surfer")).not.toBeFalsy()
    } finally {
      app.unmount()
    }
  })

  it("resizes columns and keeps Company fixed during horizontal scrolling", async () => {
    const sizes: number[] = []
    const opened: string[] = []
    const app = createTestApp(
      host(() =>
        h("div", { style: { width: 700 } }, [
          h(RecordsTable, {
            rows: INITIAL_ROWS.slice(0, 2),
            onColumnResize: (_col, width) => sizes.push(width),
            onWebsiteClick: (row) => opened.push(row.id),
          }),
        ]),
      ),
    )
    try {
      await until(app, () => !!app.renderer.getElementBounds(app.renderer.findByTestId("records-header-company")!.id))
      const resize = app.renderer.findByTestId("records-resize-company")!
      app.renderer.nativeSimulateKeystrokes(resize.id, "right shift-right")
      await app.settle()
      expect(sizes[1]! - sizes[0]!).toBe(10)
      const automation = await connectTest(app.renderer, app.settle)
      await automation.getByTestId("records-resize-company").dragBy(60, 0)
      expect(sizes.at(-1)! - sizes[1]!).toBe(60)
      const company = app.renderer.findByTestId("records-header-company")!
      const categories = app.renderer.findByTestId("records-header-categories")!
      const companyX = app.renderer.getElementBounds(company.id)!.x
      const categoryX = app.renderer.getElementBounds(categories.id)!.x
      app.renderer.scrollTo(app.renderer.findByTestId("records-scroll")!.id, -200, 0)
      await until(app, () => app.renderer.getElementBounds(categories.id)!.x < categoryX - 100)
      expect(app.renderer.getElementBounds(company.id)!.x).toBeCloseTo(companyX, 0)
      const name = app.renderer.findByTestId(`records-name-${INITIAL_ROWS[0]!.id}`)!
      expect(app.renderer.getElementBounds(name.id)!.x).toBeLessThan(companyX + sizes[1]!)
      app.renderer.nativeSimulateKeystrokes(name.id, "enter")
      await app.settle()
      expect(opened).toEqual([INITIAL_ROWS[0]!.id])
    } finally {
      app.unmount()
    }
  })

  it("edits a property prompt and keeps it after reopening", async () => {
    const changes: string[] = []
    const app = createTestApp(
      host(() =>
        h(RecordsTable, {
          rows: INITIAL_ROWS.slice(0, 2),
          onPromptChange: (_column, text) => changes.push(text),
        }),
      ),
    )
    try {
      const automation = await connectTest(app.renderer, app.settle)
      const header = app.renderer.findByTestId("records-header-categories")!
      app.renderer.nativeSimulateKeystrokes(header.id, "enter")
      await app.settle()
      await automation.getByTestId("records-prompt").fill("Summarize @Company")
      expect(changes.at(-1)).toBe("Summarize @Company")
      app.renderer.nativeSimulateKeystrokes(header.id, "enter")
      await app.settle()
      app.renderer.nativeSimulateKeystrokes(header.id, "enter")
      await app.settle()
      expect(app.renderer.findByTestId("records-prompt")!.customProps!.value).toBe("Summarize @Company")
    } finally {
      app.unmount()
    }
  })

  it("freezes decorative shimmer when reduced motion changes", async () => {
    const theme = createTheme()
    const Root = defineComponent({
      setup() {
        provideTheme(theme)
        return () => h(Shimmer, { phase: 0, testId: "reduced-shimmer" }, () => "Working")
      },
    })
    const app = createTestApp(Root)
    try {
      expect(app.renderer.findByTestId("reduced-shimmer")!.style.opacity).toBeLessThan(1)
      theme.reducedMotion.value = true
      await app.settle()
      expect(app.renderer.findByTestId("reduced-shimmer")!.style.opacity).toBe(1)
    } finally {
      app.unmount()
    }
  })
})

describe("beautiful-ui source color space", () => {
  it("matches sRGB mixing instead of shifting saturated hues through OKLCH", () => {
    expect(mix("#ff0000", "#0000ff", 50)).toBe("rgba(127.5, 0, 127.5, 1)")
    expect(mix("#ff0000", "transparent", 50)).toBe("rgba(255, 0, 0, 0.5)")
    expect(mix(mix("#ff0000", "#0000ff", 50), "#ffffff", 50)).toBe("rgba(191.25, 127.5, 191.25, 1)")
  })
})
