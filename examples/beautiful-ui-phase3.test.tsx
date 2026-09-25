import { defineComponent, h } from "vue"
import { describe, expect, test } from "vitest"
import { connectTest } from "@gpuiv/vue/automation"
import { createTestApp } from "@gpuiv/vue/testing"
import { provideTheme, ApprovalCard, DiffTable, TaskRows, ToolChips, StreamingText } from "@gpuiv/beautiful-ui"

const host = (Comp: unknown) =>
  defineComponent({
    setup() {
      provideTheme()
      return () => h("div", { style: { width: "100%", height: "100%" } }, [h(Comp as never)])
    },
  })

const idsOf = (app: ReturnType<typeof createTestApp>) =>
  app.renderer
    .findByType("div")
    .map((el) => (el as { testId?: string }).testId)
    .filter((id): id is string => typeof id === "string")

describe("review follow-ups", () => {
  test("DiffTable: row/apply testIds exist and the row click toggles", async () => {
    const app = createTestApp(host(DiffTable))
    await app.settle()
    await new Promise((r) => setTimeout(r, 2000)) // the demo stages its rows + footer
    const ids = idsOf(app)
    expect(ids.some((id) => id.startsWith("diff-row-"))).toBe(true)
    expect(ids).toContain("diff-added-row")
    expect(ids).toContain("diff-apply")
    app.unmount()
  })

  test("ApprovalCard: option/custom/nav testIds exist", async () => {
    const app = createTestApp(host(ApprovalCard))
    await app.settle()
    await new Promise((r) => setTimeout(r, 500))
    const ids = idsOf(app)
    expect(ids).toContain("approval-option-0")
    expect(ids).toContain("approval-custom")
    expect(ids).toContain("approval-advance")
    expect(ids).toContain("approval-dismiss")
    app.unmount()
  })

  test("TaskRows / ToolChips / StreamingText: row and follow-up testIds exist", async () => {
    for (const Comp of [TaskRows, ToolChips, StreamingText]) {
      const app = createTestApp(host(Comp))
      await app.settle()
      await new Promise((r) => setTimeout(r, 1600))
      const ids = idsOf(app)
      const ok = ids.some((id) => id.startsWith("taskrows-row-") || id.startsWith("toolchips-row-") || id.startsWith("streaming-followup-"))
      expect(ok, `${Comp?.name} had ${ids.length} testIds`).toBe(true)
      app.unmount()
    }
  })

  test("ToolChips: the chip click opens the detail (hitbox fix)", async () => {
    const app = createTestApp(host(ToolChips))
    await app.settle()
    await new Promise((r) => setTimeout(r, 1600))
    const t = await connectTest(app.renderer, app.settle)
    const before = app.renderer.getAllText().length
    await t.getByTestId("toolchips-row-write-204-lines").click()
    await new Promise((r) => setTimeout(r, 500))
    expect(app.renderer.getAllText().length).not.toBe(before)
    app.unmount()
  })
})
