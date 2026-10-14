import { describe, expect, it } from "vitest"
import { connectTest } from "@gpuiv/vue/automation"
import { createTestApp, hasNativeTestRenderer } from "@gpuiv/vue/testing"
import { App } from "./animal-island"
import { defineComponent, h } from "vue"
import { Carousel } from "@gpuiv/animal-island"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

describeNative("animal-island gallery", () => {
  it("keeps inactive carousel slides out of native layout and input", async () => {
    const app = createTestApp(defineComponent(() => () => h(Carousel, { testId: "native-carousel", duration: 0 }, {
      default: () => [1, 2, 3].map(index => h("div", { key: index, style: { height: 180 } }, [h("text", `slide-${index}`)])),
    })))
    const automation = await connectTest(app.renderer, app.settle)
    try {
      await app.settle()
      expect((await automation.getByTestId("native-carousel").bounds()).height).toBeCloseTo(180, 1)
      expect(app.renderer.getAllText()).toContain("slide-1")
      expect(app.renderer.getAllText()).not.toContain("slide-2")
      await automation.getByTestId("native-carousel-next").click()
      expect(app.renderer.getAllText()).toContain("slide-2")
      expect(app.renderer.getAllText()).not.toContain("slide-1")
      expect((await automation.getByTestId("native-carousel").bounds()).height).toBeCloseTo(180, 1)
    } finally { app.unmount() }
  })
  it("renders the header and gallery sections", async () => {
    const app = createTestApp(App)
    await app.settle()
    const text = app.renderer.getAllText()
    expect(text).toContain("Animal Island")
    expect(text).toContain("Button 按钮")
    expect(text).toContain("Tag 标签")
    expect(text).toContain("Card 卡片")
    expect(text).toContain("Pagination 分页")
    expect(text).toContain(`Icon 图标 · 共 101 个`)
    expect(text).toContain("DatePicker / TimePicker 日期与时间")
    expect(text).toContain("Form 表单")
    expect(text).toContain("Table 表格")
    expect(text).toContain("Upload 上传")
    expect(text).toContain("Carousel 轮播")
    expect(text).toContain("Cursor 鼠标跟随")
    app.unmount()
  })

  it("opens the Modal from the overlay section", async () => {
    const app = createTestApp(App)
    const automation = await connectTest(app.renderer, app.settle)
    await automation.getByText("打开 Modal").click()
    expect(app.renderer.getAllText()).toContain("欢迎来到小岛")
    app.unmount()
  })

  it("switches Tabs on click", async () => {
    const app = createTestApp(App)
    const automation = await connectTest(app.renderer, app.settle)
    await automation.getByText("第二页").click()
    expect(app.renderer.getAllText()).toContain("第二个页签的内容。")
    app.unmount()
  })

  it("expands the Collapse answer", async () => {
    const app = createTestApp(App)
    const automation = await connectTest(app.renderer, app.settle)
    await automation.getByText("小岛上有哪些动物?").click()
    expect(app.renderer.getAllText()).toContain("猫猫、狗狗、鸟鸟,还有一只会写代码的水獭。")
    app.unmount()
  })

  it("shows a success Notification", async () => {
    const app = createTestApp(App)
    const automation = await connectTest(app.renderer, app.settle)
    await automation.getByText("成功通知").click()
    expect(app.renderer.getAllText()).toContain("保存成功")
    app.unmount()
  })

  it("scrolls the gallery (flex-constrained scroll parent)", async () => {
    const app = createTestApp(App, { width: 704, height: 459 })
    const automation = await connectTest(app.renderer, app.settle)
    const root = await automation.getByTestId("gallery-root").bounds()
    const scroll = await automation.getByTestId("gallery-scroll").bounds()
    expect(root.height).toBeCloseTo(459, 1)
    // Closed overlays leave Vue Fragment anchors in the root. Those empty
    // text nodes must not consume line height and shorten the scroll viewport.
    expect(scroll.y + scroll.height).toBeCloseTo(root.y + root.height, 1)
    const target = automation.getByText("Pagination 分页")
    const before = await target.bounds().catch(() => null)
    await automation.getByTestId("gallery-scroll").wheel(0, -2400)
    await app.settle()
    const afterScroll = await automation.getByTestId("gallery-scroll").bounds()
    // The scroll tracker includes the content translation in y; assert the
    // viewport size, which must remain fixed while its content moves.
    expect(afterScroll.height).toBeCloseTo(scroll.height, 1)
    const after = await target.bounds()
    // Offscreen-below before the wheel; pinned near the top after.
    if (before) expect(after.y).toBeLessThan(before.y)
    else expect(after.y).toBeGreaterThan(0)
    app.unmount()
  })

  it("ports the Button style contract (hard shadow + cream fill)", () => {
    const app = createTestApp(App)
    // The primary Button is the only gallery element carrying the signature
    // hard shadow (offsetY 5, blur 0) on the cream fill.
    const hard = app.renderer.findByType("div").find((el) => {
      const shadow = el.style?.boxShadow as { offsetY?: number; blurRadius?: number } | undefined
      return shadow?.offsetY === 5 && shadow?.blurRadius === 0 && el.style?.backgroundColor === "#f8f8f0"
    })
    expect(hard).toBeDefined()
    app.unmount()
  })
})
