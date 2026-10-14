/** Real native Button motion, searchable Select and compound Avatar API. */
import assert from "node:assert/strict"
import { defineComponent, h, nextTick, ref } from "vue"
import { createApp, resetApp, type HostNode } from "@gpuiv/vue"
import { connectTest, liveRendererAsTest, type LiveAutomationRenderer } from "@gpuiv/vue/automation"
import { Avatar, Button, Icon, Select } from "@gpuiv/animal-island"

let clicks = 0
const selected = ref("cat"), loading = ref(true)
const changes: string[] = [], searches: string[] = []
const app = createApp(defineComponent(() => () => h("div", {
  style: { width: "100%", height: "100%", backgroundColor: "#ffffff", padding: 32, display: "flex", flexDirection: "column", gap: 180 },
}, [
  h("div", { style: { display: "flex", alignItems: "center", gap: 24 } }, [
    h(Button, { testId: "primary", type: "primary", onClick: () => { clicks++ }, icon: h(Icon, { name: "Search" }) }, () => "Native button"),
    h(Button, { testId: "loading", loading: loading.value }, () => "Loading"),
    h(Avatar.Group, {}, () => [h(Avatar, { alt: "Cat" }), h(Avatar, { alt: "Otter" })]),
  ]),
  h(Select, { testId: "search", showSearch: true, allowClear: true, value: selected.value, style: { width: 260 },
    options: [{ key: "cat", label: "猫猫" }, { key: "dog", label: "狗狗" }, { key: "otter", label: "水獭" }],
    onChange: (value: string) => { selected.value = value; changes.push(value) }, onSearch: (value: string) => searches.push(value),
  }),
// macOS pauses its display link for hidden windows; exercise native motion in
// a visible window without taking focus from the user's demo.
])), { width: 780, height: 620, focus: false, show: true })
const renderer = app.renderer as typeof app.renderer & LiveAutomationRenderer
const walk = (node: HostNode): HostNode[] => [node, ...node.children.flatMap(walk)]
const find = (id: string) => walk(app.container).find(node => node.props.testId === id)
async function settle() { await nextTick(); await Bun.sleep(80) }
async function until(condition: () => boolean, message: string) {
  const end = Date.now() + 4000
  while (!condition() && Date.now() < end) await Bun.sleep(25)
  assert(condition(), message)
}
const near = (actual: number, expected: number) => assert(Math.abs(actual - expected) < .7, `${actual} must be close to ${expected}`)
let exitCode = 0
try {
  await Bun.sleep(400)
  const driver = await connectTest(liveRendererAsTest(renderer), settle)
  const button = driver.getByTestId("primary")
  const base = await button.bounds()
  await driver.clock.pause()
  await button.hover()
  await driver.clock.fastForward(300)
  const raised = await button.bounds()
  near(raised.y, base.y - 1)
  const point = { x: raised.x + raised.width / 2, y: raised.y + raised.height / 2 }
  await driver.mouse.down(point)
  await driver.clock.fastForward(100)
  const midway = await button.bounds()
  assert(midway.y > raised.y && midway.y < base.y + 2, "GPUI must paint an intermediate press position")
  await driver.clock.fastForward(200)
  const pressed = await button.bounds()
  near(pressed.y, base.y + 2)
  await driver.mouse.up(point)
  await driver.clock.fastForward(300)
  near((await button.bounds()).y, base.y - 1)
  assert.equal(clicks, 1)
  await driver.mouse.move({ x: 750, y: 590 })
  await driver.clock.fastForward(300)
  near((await button.bounds()).y, base.y)
  await driver.clock.resume()
  const firstFrame = find("loading-loading-icon")!.props.src
  await Bun.sleep(160)
  assert.notEqual(find("loading-loading-icon")!.props.src, firstFrame, "Loading Donut must rotate")
  loading.value = false
  await settle()
  assert(!find("loading-loading-icon"))

  const search = driver.getByTestId("search")
  await search.fill("水")
  await until(() => Boolean(find("search-option-otter")) && !find("search-option-cat"), "Real native typing must filter mounted options")
  await search.press("enter")
  await until(() => selected.value === "otter" && !find("search-popup"), "Native Enter selects the filtered resident")
  assert(searches.includes("水") && searches.includes(""))
  await driver.getByTestId("search-clear").click()
  await until(() => selected.value === "", "Clicking clear must clear the controlled native model")
  await search.fill("不存在")
  await until(() => Boolean(find("search-empty")), "No match must display the empty state")
  await search.press("escape")
  await until(() => Boolean(find("search-option-cat")), "First Escape clears the query while keeping the popup open")
  await search.press("escape")
  await until(() => !find("search-popup"), "Second Escape closes the popup")
  console.log("ANIMAL_REACT_PARITY_OK", JSON.stringify({ base, raised, midway, pressed, clicks, changes, searches }))
} catch (error) { console.error(error); exitCode = 1 }
finally { resetApp() }
process.exit(exitCode)
