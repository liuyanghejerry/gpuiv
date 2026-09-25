/**
 * Regression tests for the Phase 3 beautiful-ui ports: the automation
 * handles added in review, and the interaction fixes that came with them.
 *
 * Every wait here is a poll with a deadline — the demo components reveal
 * their rows from 700ms script timers, and a fixed `setTimeout` that is
 * generous on a laptop is flaky on a loaded CI runner.
 */

import { defineComponent, h } from "vue"
import { describe, expect, test } from "vitest"
import { connectTest } from "@gpuiv/vue/automation"
import { createTestApp } from "@gpuiv/vue/testing"
import {
  provideTheme,
  ApprovalCard,
  DiffTable,
  RecordsTable,
  TaskRows,
  ToolChips,
  StreamingText,
  type ToolStep,
} from "@gpuiv/beautiful-ui"

const host = (Comp: unknown, props: Record<string, unknown> = {}) =>
  defineComponent({
    setup() {
      provideTheme()
      return () => h("div", { style: { width: "100%", height: "100%" } }, [h(Comp as never, props)])
    },
  })

const idsOf = (app: ReturnType<typeof createTestApp>) =>
  app.renderer
    .findByType("div")
    .map((el) => (el as { testId?: string }).testId)
    .filter((id): id is string => typeof id === "string")

/** Poll `check` until it is true or `deadlineMs` passes. Returns the result. */
const until = async (check: () => boolean, deadlineMs = 8000) => {
  const start = Date.now()
  while (Date.now() - start < deadlineMs) {
    if (check()) return true
    await new Promise((r) => setTimeout(r, 80))
  }
  return check()
}

const timeouts = { timeout: 30_000 }

describe("phase 3 handles", () => {
  test("DiffTable: row, added-row and apply testIds exist", async () => {
    const app = createTestApp(host(DiffTable))
    await app.settle()
    // the demo stages its rows and reveals the footer over a few timers
    const ok = await until(() => {
      const ids = idsOf(app)
      return (
        ids.some((id) => id.startsWith("diff-row-")) &&
        ids.includes("diff-added-row") &&
        ids.includes("diff-apply")
      )
    }, 12_000)
    expect(ok).toBe(true)
    app.unmount()
  }, timeouts.timeout)

  test("ApprovalCard: option, custom and nav testIds exist", async () => {
    const app = createTestApp(host(ApprovalCard))
    await app.settle()
    const ok = await until(() => {
      const ids = idsOf(app)
      return (
        ids.includes("approval-option-0") &&
        ids.includes("approval-custom") &&
        ids.includes("approval-advance") &&
        ids.includes("approval-dismiss")
      )
    }, 10_000)
    expect(ok).toBe(true)
    app.unmount()
  }, timeouts.timeout)

  test("RecordsTable virtualizes rows beyond its own scroller", async () => {
    const app = createTestApp(host(RecordsTable))
    await app.settle()
    await until(() => idsOf(app).some((id) => id.startsWith("records-row-")))
    const rows = idsOf(app).filter((id) => id.startsWith("records-row-"))
    // 60 demo rows, only the visible slice (+overscan) is mounted
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.length).toBeLessThan(20)
    app.unmount()
  }, timeouts.timeout)

  test("TaskRows: row testIds exist", async () => {
    const app = createTestApp(host(TaskRows))
    await app.settle()
    const ok = await until(() => idsOf(app).some((id) => id.startsWith("taskrows-row-")), 10_000)
    expect(ok).toBe(true)
    app.unmount()
  }, timeouts.timeout)

  test("StreamingText: follow-up and sources testIds exist", async () => {
    const app = createTestApp(host(StreamingText))
    await app.settle()
    const ok = await until(() => {
      const ids = idsOf(app)
      return ids.some((id) => id.startsWith("streaming-followup-")) && ids.includes("streaming-sources")
    }, 12_000)
    expect(ok).toBe(true)
    app.unmount()
  }, timeouts.timeout)

  test("ToolChips: the chip area carries the row's click", async () => {
    // One step only: the 700ms script reveals exactly one row, so the
    // assertion does not race the demo choreography. `onToggleRow` is the
    // contract — the filled chip's hitbox used to swallow this click, so a
    // click inside the chip area must reach `toggleRow`.
    const step: ToolStep = {
      icon: "write",
      label: "Write 204 lines",
      chip: "ChurnSchedule.tsx",
      mono: true,
      detailMono: true,
      detail: [{ text: '+ return schedule(windows, { hero: "pistachio" })', tone: "add" }],
    }
    const toggles: [string, boolean][] = []
    const app = createTestApp(
      host(ToolChips, { steps: [step], onToggleRow: (label: string, open: boolean) => toggles.push([label, open]) }),
    )
    await app.settle()

    const rowId = "toolchips-row-write-204-lines"
    const appeared = await until(() => idsOf(app).includes(rowId), 10_000)
    expect(appeared).toBe(true)

    const t = await connectTest(app.renderer, app.settle)
    const boundsOf = async () =>
      ((await t.getByTestId(rowId).element()) as { bounds?: { x: number; y: number; width: number; height: number } })
        .bounds

    // Wait for the entrance tween to settle: hitboxes are registered at
    // paint, so a click aimed at the bounds captured mid-animation can miss.
    let lastY: number | undefined
    for (let i = 0; i < 40; i++) {
      const b = await boundsOf()
      if (b && b.y === lastY) break
      lastY = b?.y
      await new Promise((r) => setTimeout(r, 120))
    }

    const bounds = await boundsOf()
    expect(bounds).toBeTruthy()
    // 3/4 across the row lands inside the chip (label first, chip grows)
    const x = Math.round(bounds!.x + bounds!.width * 0.75)
    const y = Math.round(bounds!.y + bounds!.height / 2)

    // Retry at the same point: a first-paint race must not mask a real
    // regression — a chip that swallows clicks misses every time.
    for (let attempt = 0; attempt < 5 && toggles.length === 0; attempt++) {
      app.renderer.nativeSimulateClick(x, y)
      await app.settle()
      await until(() => toggles.length > 0, 800)
    }

    expect(toggles, `toggles=${JSON.stringify(toggles)}`).toContainEqual(["Write 204 lines", true])
    expect(app.renderer.getAllText().some((line) => line.includes("pistachio"))).toBe(true)
    app.unmount()
  }, timeouts.timeout)
})
