import { describe, expect, it } from "vitest"
import { connectTest } from "@gpuiv/vue/automation"
import { createTestApp, hasNativeTestRenderer } from "@gpuiv/vue/testing"
import { App } from "./animal-island"
import { defineComponent, h } from "vue"
import { Carousel } from "@gpuiv/animal-island"

const describeNative = hasNativeTestRenderer ? describe : describe.skip
async function choosePage(app: ReturnType<typeof createTestApp>, id: string) {
  const automation = await connectTest(app.renderer, app.settle)
  const navigation = automation.getByTestId("gallery-nav-scroll")
  const viewport = await navigation.bounds()
  // Use painted label bounds: a padded flex div's tracking canvas can have
  // a static-position offset, while the native text leaf has its paint box.
  const entry = automation.getByTestId(`nav-${id}`)
  const target = entry.getByText(await entry.textContent())
  const bounds = await target.bounds()
  const scrollId = (await navigation.element()).id
  const offset = app.renderer.getScrollOffset(scrollId)
  const currentOffset = offset?.[1] ?? 0
  const viewportTop = viewport.y - currentOffset
  app.renderer.scrollTo(scrollId, 0, currentOffset + viewportTop + 80 - bounds.y)
  await app.settle()
  await target.click()
}

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
  it("renders all component navigation entries and only the chosen example", async () => {
    const app = createTestApp(App)
    await app.settle()
    const text = app.renderer.getAllText()
    expect(text).toContain("Animal Island")
    expect(text).toContain("Button 按钮")
    expect(text).toContain("Tag 标签")
    expect(text).toContain("Card 卡片")
    expect(text).toContain("Pagination 分页")
    expect(text).toContain("Icon 图标")
    expect(text).toContain("DatePicker 日期选择")
    expect(text).toContain("TimePicker 时间选择")
    expect(text).toContain("Form 表单")
    expect(text).toContain("Table 表格")
    expect(text).toContain("Upload 上传")
    expect(text).toContain("Carousel 轮播")
    expect(text).toContain("Cursor 鼠标跟随")
    expect(text).not.toContain("猫猫的小岛")
    expect(text).not.toContain("第一个页签的内容。")
    app.unmount()
  })

  it("opens the Modal from the overlay section", async () => {
    const app = createTestApp(App)
    const automation = await connectTest(app.renderer, app.settle)
    await choosePage(app, "modal")
    await automation.getByText("打开 Modal").click()
    expect(app.renderer.getAllText()).toContain("欢迎来到小岛")
    app.unmount()
  })

  it("switches Tabs on click", async () => {
    const app = createTestApp(App)
    const automation = await connectTest(app.renderer, app.settle)
    await choosePage(app, "tabs")
    await automation.getByText("第二页").click()
    expect(app.renderer.getAllText()).toContain("第二个页签的内容。")
    app.unmount()
  })

  it("expands the Collapse answer", async () => {
    const app = createTestApp(App)
    const automation = await connectTest(app.renderer, app.settle)
    await choosePage(app, "collapse")
    await automation.getByText("小岛上有哪些动物?").click()
    expect(app.renderer.getAllText()).toContain("猫猫、狗狗、鸟鸟,还有一只会写代码的水獭。")
    app.unmount()
  })

  it("shows a success Notification", async () => {
    const app = createTestApp(App)
    const automation = await connectTest(app.renderer, app.settle)
    await choosePage(app, "notification")
    await automation.getByText("成功通知").click()
    expect(app.renderer.getAllText()).toContain("保存成功")
    app.unmount()
  })

  it("keeps the two sibling scroll viewports constrained to the window", async () => {
    const app = createTestApp(App, { width: 704, height: 459 })
    const automation = await connectTest(app.renderer, app.settle)
    const root = await automation.getByTestId("gallery-root").bounds()
    const scroll = await automation.getByTestId("gallery-scroll").bounds()
    const sidebar = await automation.getByTestId("gallery-sidebar").bounds()
    const navigation = await automation.getByTestId("gallery-nav-scroll").bounds()
    expect(root.height).toBeCloseTo(459, 1)
    // Closed overlays leave Vue Fragment anchors in the root. Those empty
    // text nodes must not consume line height and shorten the scroll viewport.
    expect(scroll.y + scroll.height).toBeCloseTo(root.y + root.height, 1)
    expect(sidebar.width).toBeCloseTo(220, 1)
    expect(navigation.height).toBeGreaterThan(0)
    expect(navigation.y + navigation.height).toBeLessThanOrEqual(sidebar.y + sidebar.height + 1)
    expect(scroll.width).toBeLessThan(root.width - sidebar.width)
    expect((await automation.getByTestId("gallery-showcase").bounds()).height).toBeGreaterThanOrEqual(520)
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
