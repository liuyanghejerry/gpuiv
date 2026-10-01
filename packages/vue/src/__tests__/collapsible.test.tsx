import { defineComponent, h, ref } from "vue"
import { describe, expect, it, vi } from "vitest"
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../components/collapsible.js"
import { createTestApp, hasNativeTestRenderer } from "../testing.js"
import { handleGpuixEvent } from "../reconciler/event-registry.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip
const triggerStyle = { width: 200, height: 40, backgroundColor: "#222222" }
function click(app: ReturnType<typeof createTestApp>, id = "trigger") {
  const target = app.renderer.findByTestId(id)!
  const box = app.renderer.getElementBounds(target.id)!
  app.renderer.nativeSimulateClick(box.x + 4, box.y + 4)
}
function buttonAria(app: ReturnType<typeof createTestApp>) {
  return Object.values(app.renderer.getA11yTree().nodes ?? {}).map((node) => node.aria).find((aria) => aria?.label === "Details")
}

describeNative("Collapsible", () => {
  it("toggles default state by mouse, Enter and Space with one change notification", async () => {
    const changes: boolean[] = []
    const app = createTestApp(defineComponent({ setup: () => () => <Collapsible onOpenChange={(open) => changes.push(open)}>
      <CollapsibleTrigger testId="trigger" aria-label="Details" style={triggerStyle}><text>Details</text></CollapsibleTrigger>
      <CollapsiblePanel duration={0}><text>Panel content</text></CollapsiblePanel>
    </Collapsible> }))
    try {
      expect(app.renderer.getPaintedText()).not.toContain("Panel content")
      expect(buttonAria(app)?.expanded).toBe(false)
      click(app); await app.settle()
      expect(app.renderer.getPaintedText()).toContain("Panel content")
      expect(buttonAria(app)?.expanded).toBe(true)
      app.renderer.focusElement(app.renderer.findByTestId("trigger")!.id)
      app.renderer.nativeSimulateKeystrokes(app.renderer.findByTestId("trigger")!.id, "enter"); await app.settle()
      expect(app.renderer.getPaintedText()).not.toContain("Panel content")
      app.renderer.nativeSimulateKeystrokes(app.renderer.findByTestId("trigger")!.id, "space"); await app.settle()
      expect(changes).toEqual([true, false, true])
    } finally { app.unmount() }
  })

  it("keeps controlled state authoritative", async () => {
    const open = ref(false)
    const changes: boolean[] = []
    const app = createTestApp(defineComponent({ setup: () => () => <Collapsible open={open.value} onOpenChange={(value) => changes.push(value)}>
      <CollapsibleTrigger testId="trigger" style={triggerStyle}>Details</CollapsibleTrigger>
      <CollapsiblePanel duration={0}>Controlled</CollapsiblePanel>
    </Collapsible> }))
    try {
      click(app); await app.settle()
      expect(changes).toEqual([true])
      expect(app.renderer.getPaintedText()).not.toContain("Controlled")
      open.value = true; await app.settle()
      expect(app.renderer.getPaintedText()).toContain("Controlled")
      open.value = false; await app.settle()
      expect(app.renderer.getPaintedText()).not.toContain("Controlled")
    } finally { app.unmount() }
  })

  it("does not activate or enter Tab order while disabled", async () => {
    const disabled = ref(true)
    let calls = 0
    const app = createTestApp(defineComponent({ setup: () => () => <Collapsible disabled={disabled.value} onOpenChange={() => calls++}>
      <CollapsibleTrigger testId="trigger" style={triggerStyle}>Details</CollapsibleTrigger>
      <CollapsiblePanel duration={0}>Disabled</CollapsiblePanel>
    </Collapsible> }))
    try {
      click(app); await app.settle()
      app.renderer.focusElement(app.renderer.findByTestId("trigger")!.id)
      app.renderer.nativeSimulateKeystrokes(app.renderer.findByTestId("trigger")!.id, "enter"); await app.settle()
      expect(calls).toBe(0)
      expect(app.renderer.findByTestId("trigger")!.customProps?.tabIndex).toBe(-1)
      disabled.value = false; await app.settle()
      click(app); await app.settle()
      expect(calls).toBe(1)
    } finally { app.unmount() }
  })

  it("restores focus from the closing panel and skips retained hidden controls", async () => {
    const open = ref(true)
    const app = createTestApp(defineComponent({ setup: () => () => <div>
      <Collapsible open={open.value}>
        <CollapsibleTrigger testId="trigger" style={triggerStyle}>Details</CollapsibleTrigger>
        <CollapsiblePanel keepMounted duration={0}><input testId="inside" value="Inside" /></CollapsiblePanel>
      </Collapsible>
      <div testId="outside" tabIndex={0}><text>Outside</text></div>
    </div> }))
    try {
      app.renderer.focusElement(app.renderer.findByTestId("inside")!.id)
      open.value = false; await app.settle()
      expect(app.renderer.getFocusedElementId()).toBe(app.renderer.findByTestId("trigger")!.id)
      expect(app.renderer.getPaintedText()).not.toContain("Inside")
      app.renderer.focusNext(); await app.settle()
      expect(app.renderer.getFocusedElementId()).toBe(app.renderer.findByTestId("outside")!.id)
      open.value = true; await app.settle()
      app.renderer.focusElement(app.renderer.findByTestId("outside")!.id)
      open.value = false; await app.settle()
      expect(app.renderer.getFocusedElementId()).toBe(app.renderer.findByTestId("outside")!.id)
    } finally { app.unmount() }
  })

  it("retains panel component state only when keepMounted is selected", async () => {
    let mounts = 0
    const Body = defineComponent({ setup() { mounts++; const value = ref(0)
      return () => <div testId="counter" onClick={() => value.value++} style={triggerStyle}><text>{`Count ${value.value}`}</text></div>
    } })
    const app = createTestApp(defineComponent({ setup: () => () => <Collapsible defaultOpen>
      <CollapsibleTrigger testId="trigger" style={triggerStyle}>Details</CollapsibleTrigger>
      <CollapsiblePanel keepMounted duration={0}><Body /></CollapsiblePanel>
    </Collapsible> }))
    try {
      click(app, "counter"); await app.settle()
      click(app); await app.settle()
      click(app); await app.settle()
      expect(app.renderer.getPaintedText()).toContain("Count 1")
      expect(mounts).toBe(1)
    } finally { app.unmount() }
  })

  it("merges an asChild trigger without duplicate click handlers", async () => {
    let child = 0; let outer = 0
    const app = createTestApp(defineComponent({ setup: () => () => <Collapsible>
      <CollapsibleTrigger asChild onClick={() => outer++}>
        <div testId="trigger" onClick={() => child++} style={triggerStyle}>Details</div>
      </CollapsibleTrigger>
      <CollapsiblePanel duration={0}>Opened</CollapsiblePanel>
    </Collapsible> }))
    try {
      click(app); await app.settle()
      expect([child, outer]).toEqual([1, 1])
      expect(app.renderer.getPaintedText()).toContain("Opened")
    } finally { app.unmount() }
  })

  it("restores focus through an asChild component and opens immediately with zero duration", async () => {
    const open = ref(false)
    const Button = defineComponent({ setup: () => () => <div style={triggerStyle}>Details</div> })
    const app = createTestApp(defineComponent({ setup: () => () => <Collapsible open={open.value} onOpenChange={(value) => { open.value = value }}>
      <CollapsibleTrigger asChild><Button testId="trigger" /></CollapsibleTrigger>
      <CollapsiblePanel keepMounted testId="panel" duration={0}>
        <div style={{ height: 80 }}><input testId="inside" value="Inside" /></div>
      </CollapsiblePanel>
    </Collapsible> }))
    try {
      click(app); await app.settle()
      expect(app.renderer.getElementBounds(app.renderer.findByTestId("panel")!.id)!.height).toBe(80)
      app.renderer.focusElement(app.renderer.findByTestId("inside")!.id)
      open.value = false; await app.settle()
      expect(app.renderer.getFocusedElementId()).toBe(app.renderer.findByTestId("trigger")!.id)
      expect(app.renderer.getElementBounds(app.renderer.findByTestId("panel")!.id)!.height).toBe(0)
    } finally { app.unmount() }
  })

  it("finishes interrupted height transitions without hiding a reopened panel", async () => {
    const open = ref(true)
    const app = createTestApp(defineComponent({ setup: () => () => <Collapsible open={open.value}>
      <CollapsibleTrigger style={triggerStyle}>Details</CollapsibleTrigger>
      <CollapsiblePanel testId="panel" duration={0.2}><div style={{ height: 80 }}><text>Animated</text></div></CollapsiblePanel>
    </Collapsible> }))
    try {
      app.renderer.clockPause(); await app.settle()
      // Measurement polls the painted tree on the JS clock, independently
      // of the paused native animation clock.
      await vi.waitFor(async () => {
        await app.settle()
        const panel = app.renderer.findByTestId("panel")!
        expect((panel.customProps?.motion as { animate: { height: number } }).animate.height).toBe(80)
      })
      open.value = false; await app.settle()
      const closing = app.renderer.findByTestId("panel")!
      const oldGeneration = (closing.customProps?.motion as { generation: number }).generation
      app.renderer.clockFastForward(80); await app.settle()
      open.value = true; await app.settle()
      app.renderer.clockFastForward(300); await app.settle(); await app.settle()
      expect(app.renderer.getPaintedText()).toContain("Animated")
      expect(app.renderer.getElementBounds(app.renderer.findByTestId("panel")!.id)!.height).toBe(80)
      open.value = false; await app.settle()
      // A completion already queued on the Node event loop can arrive after
      // close → reopen → close. It must not finish the current closing target.
      handleGpuixEvent({ elementId: closing.id, eventType: "motionComplete", motionGeneration: oldGeneration } as never, app.renderer)
      await app.settle()
      expect(app.renderer.findByTestId("panel")).toBeDefined()
      app.renderer.clockFastForward(300); await app.settle(); await app.settle()
      expect(app.renderer.findByTestId("panel")).toBeUndefined()
    } finally { app.unmount() }
  })

  it("emits update:open for a Vue controlled binding", async () => {
    const open = ref(false)
    const app = createTestApp(defineComponent({ setup: () => () => h(Collapsible, {
      open: open.value, "onUpdate:open": (value: boolean) => { open.value = value },
    }, { default: () => [
      h(CollapsibleTrigger, { testId: "trigger", style: triggerStyle }, { default: () => "Details" }),
      h(CollapsiblePanel, { duration: 0 }, { default: () => "Bound panel" }),
    ] }) }))
    try {
      click(app); await app.settle()
      expect(open.value).toBe(true)
      expect(app.renderer.getPaintedText()).toContain("Bound panel")
      click(app); await app.settle()
      expect(open.value).toBe(false)
    } finally { app.unmount() }
  })

  it("animates a newly mounted panel from zero and removes it after closing", async () => {
    const app = createTestApp(defineComponent({ setup: () => () => <Collapsible>
      <CollapsibleTrigger testId="trigger" style={triggerStyle}>Details</CollapsibleTrigger>
      <CollapsiblePanel testId="panel" duration={0.2}><div style={{ height: 80 }}><text>Animated body</text></div></CollapsiblePanel>
    </Collapsible> }))
    try {
      app.renderer.clockPause()
      click(app); await app.settle()
      const panel = () => app.renderer.findByTestId("panel")!
      await vi.waitFor(async () => {
        await app.settle()
        expect((panel().customProps?.motion as { animate: { height: number } }).animate.height).toBe(80)
      })
      expect(app.renderer.getElementBounds(panel().id)!.height).toBe(0)
      app.renderer.clockFastForward(100); await app.settle()
      const middle = app.renderer.getElementBounds(panel().id)!.height
      expect(middle).toBeGreaterThan(0)
      expect(middle).toBeLessThan(80)
      app.renderer.clockFastForward(200); await app.settle()
      expect(app.renderer.getElementBounds(panel().id)!.height).toBe(80)
      click(app); await app.settle()
      expect(app.renderer.findByTestId("panel")).toBeDefined()
      app.renderer.clockFastForward(100); await app.settle()
      expect(app.renderer.getElementBounds(panel().id)!.height).toBeGreaterThan(0)
      app.renderer.clockFastForward(200); await app.settle(); await app.settle()
      expect(app.renderer.findByTestId("panel")).toBeUndefined()
    } finally { app.unmount() }
  })

  it("unmounts closed content by default and isolates nested roots", async () => {
    let mounts = 0
    const Body = defineComponent({ setup() { mounts++; return () => <text>Body</text> } })
    const app = createTestApp(defineComponent({ setup: () => () => <Collapsible defaultOpen>
      <CollapsibleTrigger testId="trigger" style={triggerStyle}>Outer</CollapsibleTrigger>
      <CollapsiblePanel duration={0}>
        <Body />
        <Collapsible>
          <CollapsibleTrigger testId="nested" style={triggerStyle}>Inner</CollapsibleTrigger>
          <CollapsiblePanel duration={0}>Nested body</CollapsiblePanel>
        </Collapsible>
      </CollapsiblePanel>
    </Collapsible> }))
    try {
      click(app, "nested"); await app.settle()
      expect(app.renderer.getPaintedText()).toContain("Nested body")
      click(app); await app.settle()
      expect(app.renderer.findByTestId("nested")).toBeUndefined()
      click(app); await app.settle()
      expect(mounts).toBe(2)
      expect(app.renderer.getPaintedText()).not.toContain("Nested body")
    } finally { app.unmount() }
  })
})
