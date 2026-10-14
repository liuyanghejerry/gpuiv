import { afterEach, describe, expect, it, vi } from "vitest"
import { File } from "node:buffer"
import { createServer, type Server } from "node:http"
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Comment, Fragment, defineComponent, h, ref } from "vue"
import { Carousel, type CarouselExpose } from "../src/components/Carousel.js"
import { Cursor } from "../src/components/Cursor.js"
import { Upload, type UploadCustomRequestOptions, type UploadExpose, type UploadFile, type UploadProps } from "../src/components/Upload.js"
import { matchUploadAccept, readUploadPaths, type UploadNativeFile } from "../src/components/upload-files.js"
import { mountHost } from "./harness.js"

type Host = ReturnType<typeof mountHost>
const hosts: Host[] = []
const directories: string[] = []
const servers: Server[] = []
const file = (name: string, type = "text/plain", content = "真实文件内容") => new File([content], name, { type }) as UploadNativeFile
async function directory() { const path = await mkdtemp(join(tmpdir(), "animal-upload-")); directories.push(path); return path }
function mountUpload(props: UploadProps & Record<string, unknown> = {}, overrides: Parameters<typeof mountHost>[1] = {}) {
  const exposed = ref<UploadExpose | null>(null)
  const host = mountHost(defineComponent({ setup: () => () => h(Upload, { testId: "upload", ...props, ref: exposed }) }), overrides)
  hosts.push(host)
  return { host, exposed }
}
function mountCarousel(props: Record<string, unknown> = {}, count = 3) {
  const exposed = ref<CarouselExpose | null>(null)
  const host = mountHost(defineComponent({ setup: () => () => h(Carousel, { testId: "carousel", ...props, ref: exposed }, {
    default: () => Array.from({ length: count }, (_, index) => h("div", { key: index }, [h("text", `第 ${index + 1} 张`)])),
  }) }))
  hosts.push(host)
  return { host, exposed }
}
afterEach(async () => {
  hosts.splice(0).forEach((host) => host.unmount())
  vi.useRealTimers()
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections() })))
})

describe("Upload desktop files and transport", () => {
  it("uses the native picker and gives customRequest the actual Unicode file bytes", async () => {
    const path = join(await directory(), "海岛.txt")
    await writeFile(path, "海岛文件")
    const request = vi.fn((options: UploadCustomRequestOptions) => options.onSuccess("stored"))
    const picker = vi.fn((_options, answer) => answer(null, { paths: [path] }))
    const { host, exposed } = mountUpload({ customRequest: request }, { promptForPaths: picker })
    await host.fire("upload-trigger", "keyDown", { key: "enter" })
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce())
    const selected = request.mock.calls[0][0].file
    expect(selected).toBeInstanceOf(File)
    expect(selected.name).toBe("海岛.txt")
    expect(await selected.text()).toBe("海岛文件")
    expect(selected.path).toBe(path)
    expect(picker.mock.calls[0][0]).toMatchObject({ files: true, directories: false, multiple: false })
    expect(exposed.value!.fileList[0]).toMatchObject({ status: "done", percent: 100, response: "stored" })
  })

  it("reads only opt-in selected directory files, preserves relative names, and ignores symlinks", async () => {
    const base = await directory(), root = join(base, "相册")
    await mkdir(join(root, "子目录"), { recursive: true })
    await writeFile(join(root, "a.png"), "png-data")
    await writeFile(join(root, "子目录", "b.txt"), "text-data")
    await writeFile(join(base, "outside.txt"), "not-selected")
    await symlink(join(base, "outside.txt"), join(root, "linked.txt"))
    expect(await readUploadPaths([root], false)).toEqual([])
    const files = await readUploadPaths([root], true)
    expect(files.map((entry) => entry.name)).toEqual(["a.png", "b.txt"])
    expect(files.map((entry) => entry.webkitRelativePath)).toEqual(["相册/a.png", "相册/子目录/b.txt"])
    expect(files[0].type).toBe("image/png")
    expect(await files[1].text()).toBe("text-data")
    const request = vi.fn((options: UploadCustomRequestOptions) => options.onSuccess())
    const { exposed } = mountUpload({ directory: true, customRequest: request })
    await exposed.value!.addPaths([root])
    expect(request).toHaveBeenCalledTimes(2)
  })

  it("filters accept for filesystem drops and honours single selection", async () => {
    const root = await directory()
    const paths = [join(root, "island.png"), join(root, "notes.txt")]
    await Promise.all(paths.map((path) => writeFile(path, "bytes")))
    const request = vi.fn((options: UploadCustomRequestOptions) => options.onSuccess())
    const { host, exposed } = mountUpload({ drag: true, multiple: true, accept: "image/*", customRequest: request })
    await host.fire("upload", "fileDrop", { paths })
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce())
    expect(exposed.value!.fileList[0].name).toBe("island.png")
    expect(matchUploadAccept(file("a.PNG", ""), ".png,.pdf")).toBe(true)
    expect(matchUploadAccept(file("a.unknown", ""), "image/*")).toBe(false)
    const single = mountUpload({ customRequest: request })
    await single.exposed.value!.addFiles([file("first.txt"), file("second.txt")])
    expect(single.exposed.value!.fileList.map((entry) => entry.name)).toEqual(["first.txt"])
  })

  it("beforeUpload skips rejected files and uploads transformed bytes with the original file retained", async () => {
    const original = file("raw.txt", "text/plain", "raw")
    const transformed = file("converted.json", "application/json", '{"converted":true}')
    const request = vi.fn((options: UploadCustomRequestOptions) => options.onSuccess())
    const beforeUpload = vi.fn(async (entry: UploadNativeFile) => entry.name === "skip.txt" ? false : transformed)
    const { exposed } = mountUpload({ multiple: true, beforeUpload, customRequest: request })
    await exposed.value!.addFiles([file("skip.txt"), original])
    expect(request).toHaveBeenCalledOnce()
    expect(request.mock.calls[0][0].file).toBe(transformed)
    expect(exposed.value!.fileList[0].originFileObj).toBe(original)
    expect(exposed.value!.fileList[0].name).toBe("converted.json")
    expect(beforeUpload.mock.calls[0][1]).toHaveLength(2)
  })

  it("maxCount keeps earliest entries and reports overflow without starting their requests", async () => {
    const request = vi.fn()
    const onExceed = vi.fn(), onChange = vi.fn()
    const { exposed } = mountUpload({ multiple: true, maxCount: 2, customRequest: request, onExceed, onChange })
    await exposed.value!.addFiles([file("a.txt"), file("b.txt"), file("c.txt")])
    expect(exposed.value!.fileList.map((entry) => entry.name)).toEqual(["a.txt", "b.txt"])
    expect(onExceed.mock.calls[0][0].map((entry: File) => entry.name)).toEqual(["c.txt"])
    expect(request).toHaveBeenCalledTimes(2)
    onChange.mockClear()
    await exposed.value!.addFiles([file("d.txt")])
    expect(request).toHaveBeenCalledTimes(2)
    expect(onChange).not.toHaveBeenCalled()
    expect(onExceed.mock.calls[1][0][0].name).toBe("d.txt")
  })

  it("maxCount=1 replaces the earlier file and aborts its transfer", async () => {
    const abort = vi.fn()
    const callbacks: UploadCustomRequestOptions[] = []
    const onChange = vi.fn()
    const { exposed } = mountUpload({ maxCount: 1, customRequest: (options) => { callbacks.push(options); return { abort } }, onChange })
    await exposed.value!.addFiles([file("a.txt")])
    await exposed.value!.addFiles([file("b.txt")])
    expect(exposed.value!.fileList[0].name).toBe("b.txt")
    expect(abort).toHaveBeenCalledOnce()
    const eventCount = onChange.mock.calls.length
    callbacks[0].onProgress(80); callbacks[0].onSuccess("late")
    expect(onChange).toHaveBeenCalledTimes(eventCount)
  })

  it("serializes overlapping async selections so maxCount cannot be exceeded", async () => {
    let release!: () => void
    const barrier = new Promise<void>((resolve) => { release = resolve })
    const { exposed } = mountUpload({ maxCount: 2, customRequest: () => {}, beforeUpload: async (entry) => { if (entry.name === "a.txt") await barrier; return true } })
    const first = exposed.value!.addFiles([file("a.txt")])
    const second = exposed.value!.addFiles([file("b.txt")])
    release()
    await Promise.all([first, second])
    expect(exposed.value!.fileList.map((entry) => entry.name)).toEqual(["a.txt", "b.txt"])
  })

  it("controlled lists stay external and removing externally cancels pending transfer callbacks", async () => {
    const value = ref<UploadFile[]>([]), exposed = ref<UploadExpose | null>(null)
    const abort = vi.fn(), updates = vi.fn(), onChange = vi.fn()
    let request!: UploadCustomRequestOptions
    const host = mountHost(defineComponent({ setup: () => () => h(Upload, { ref: exposed, modelValue: value.value, testId: "controlled",
      "onUpdate:modelValue": updates, onChange, customRequest: (options: UploadCustomRequestOptions) => { request = options; return { abort } } }) }))
    hosts.push(host)
    await exposed.value!.addFiles([file("a.txt")])
    expect(exposed.value!.fileList).toEqual([])
    value.value = updates.mock.calls.at(-1)![0]
    await host.settle()
    expect(host.text()).toContain("a.txt")
    value.value.splice(0)
    await host.settle()
    expect(abort).toHaveBeenCalledOnce()
    const events = onChange.mock.calls.length
    request.onSuccess("ignored"); request.onProgress(50)
    expect(onChange).toHaveBeenCalledTimes(events)
  })

  it("supports remove vetoes, removed change status and disabled interaction", async () => {
    const onRemove = vi.fn(async () => false), onChange = vi.fn()
    const { host, exposed } = mountUpload({ defaultFileList: [{ uid: "seed", name: "kept.txt", status: "done" }], onRemove, onChange })
    await exposed.value!.remove(exposed.value!.fileList[0])
    expect(exposed.value!.fileList).toHaveLength(1)
    onRemove.mockResolvedValueOnce(undefined as unknown as boolean)
    await host.fire("upload-remove-seed", "keyDown", { key: "space" })
    await vi.waitFor(() => expect(exposed.value!.fileList).toHaveLength(0))
    expect(onChange.mock.calls.at(-1)![0].file.status).toBe("removed")
    const disabled = mountUpload({ disabled: true })
    await disabled.exposed.value!.addFiles([file("ignored.txt")])
    expect(disabled.exposed.value!.fileList).toEqual([])
    expect(disabled.host.find("upload-trigger").props.tabIndex).toBe(-1)
  })

  it("performs a real multipart fetch upload with headers, fields, method and response", async () => {
    let observed: { body: string; method?: string; token?: string } | undefined
    const server = createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
      request.on("end", () => { observed = { body: Buffer.concat(chunks).toString("utf8"), method: request.method, token: request.headers["x-island"] as string }; response.end("uploaded-real-bytes") })
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const port = (server.address() as { port: number }).port
    const onChange = vi.fn()
    const { exposed } = mountUpload({ action: async () => `http://127.0.0.1:${port}/upload`, method: "PUT", name: "photo", headers: { "x-island": "island" },
      data: async () => ({ caption: "海边" }), onChange })
    await exposed.value!.addFiles([file("island.txt", "text/plain", "bytes-from-the-actual-file")])
    await vi.waitFor(() => expect(exposed.value!.fileList[0].status).toBe("done"))
    expect(observed).toMatchObject({ method: "PUT", token: "island" })
    expect(observed!.body).toContain('name="photo"; filename="island.txt"')
    expect(observed!.body).toContain("bytes-from-the-actual-file")
    expect(observed!.body).toContain("海边")
    expect(exposed.value!.fileList[0].response).toBe("uploaded-real-bytes")
    expect(onChange.mock.calls.map(([info]) => info.file.percent)).toEqual([0, 100])
  })

  it("reports empty action as an error and never starts transport after an async action file is removed", async () => {
    const empty = mountUpload({ action: async () => "" })
    await empty.exposed.value!.addFiles([file("bad.txt")])
    await vi.waitFor(() => expect(empty.exposed.value!.fileList[0].status).toBe("error"))
    expect(String(empty.exposed.value!.fileList[0].error)).toContain("action is empty")
    let resolveAction!: (url: string) => void
    const request = vi.spyOn(globalThis, "fetch")
    const delayed = mountUpload({ action: () => new Promise<string>((resolve) => { resolveAction = resolve }) })
    await delayed.exposed.value!.addFiles([file("delayed.txt")])
    await delayed.exposed.value!.remove(delayed.exposed.value!.fileList[0])
    resolveAction("http://127.0.0.1:1/must-not-request")
    await delayed.host.settle()
    expect(request).not.toHaveBeenCalled()
    request.mockRestore()
  })

  it("renders all list modes and uses deferred full-window image preview with keyboard close", async () => {
    const seed: UploadFile = { uid: "image", name: "island.png", type: "image/png", status: "done", thumbUrl: "data:image/png;base64,aGVsbG8=" }
    const { host } = mountUpload({ listType: "picture-card", defaultFileList: [seed] })
    expect(host.find("upload-file-image").props.style).toMatchObject({ width: 84, height: 84 })
    await host.fire("upload-preview-image", "click")
    expect(host.find((node) => node.type === "anchored").props).toMatchObject({ deferred: true, position: { x: 0, y: 0 }, occlude: true })
    expect(host.find("upload-preview").props.role).toBe("dialog")
    await host.fire("upload-preview", "keyDown", { key: "escape" })
    expect(host.all().some((node) => node.type === "anchored")).toBe(false)
    const picture = mountUpload({ listType: "picture", defaultFileList: [seed], showUploadList: { showPreviewIcon: false, showRemoveIcon: false } })
    expect(picture.host.all().filter((node) => node.type === "img" && node.props.src === seed.thumbUrl)).toHaveLength(1)
    expect(picture.host.all().some((node) => node.props.testId === "upload-preview-image")).toBe(false)
    expect(picture.host.all().some((node) => node.props.testId === "upload-remove-image")).toBe(false)
  })

  it("demo mode completes and unmount aborts real/custom work and pending beforeUpload", async () => {
    vi.useFakeTimers()
    const demo = mountUpload()
    await demo.exposed.value!.addFiles([file("demo.txt")])
    await vi.advanceTimersByTimeAsync(1600)
    expect(demo.exposed.value!.fileList[0]).toMatchObject({ status: "done", percent: 100 })
    const abort = vi.fn(), onChange = vi.fn()
    const pending = mountUpload({ customRequest: () => ({ abort }), onChange })
    await pending.exposed.value!.addFiles([file("a.txt")])
    pending.host.unmount(); hosts.splice(hosts.indexOf(pending.host), 1)
    expect(abort).toHaveBeenCalledOnce()
    let finish!: (value: boolean) => void
    const late = mountUpload({ beforeUpload: () => new Promise<boolean>((resolve) => { finish = resolve }), onChange })
    const adding = late.exposed.value!.addFiles([file("late.txt")])
    await Promise.resolve()
    const changes = onChange.mock.calls.length
    late.host.unmount(); hosts.splice(hosts.indexOf(late.host), 1)
    finish(true)
    await adding
    expect(onChange).toHaveBeenCalledTimes(changes)
  })
})

describe("Carousel navigation, slots and lifecycle", () => {
  it("flattens fragments, skips comments, preserves slide semantics and keyboard navigation", async () => {
    const host = mountHost(defineComponent({ setup: () => () => h(Carousel, { testId: "carousel" }, { default: () => [
      h(Fragment, null, [h("div", [h("text", "first")]), h(Comment), h("div", [h("text", "second")])]), h("div", [h("text", "third")]),
    ] }) }))
    hosts.push(host)
    // Explicit JSX Fragments create empty text anchors in GPUIV. Their native
    // line boxes must not become in-flow children beside the viewport.
    expect(host.find("carousel").children.some((node) => node.type === "#text" && node.text === "")).toBe(false)
    expect(host.find("carousel-slide-0").props.style).toMatchObject({ display: "flex" })
    expect(host.all().some((node) => node.props.testId === "carousel-slide-1")).toBe(false)
    expect(host.all().some((node) => node.props.testId === "carousel-slide-2")).toBe(false)
    await host.fire("carousel", "keyDown", { key: "right" })
    expect(host.find("carousel-slide-1").props.style).toMatchObject({ display: "flex" })
    await host.fire("carousel", "keyDown", { key: "end" })
    expect(host.find("carousel-slide-2").props.style).toMatchObject({ display: "flex" })
    expect(host.find("carousel-slide-2").props["aria-label"]).toBe("第 3 张，共 3 张")
    await host.fire("carousel", "keyDown", { key: "home" })
    expect(host.find("carousel-slide-0").props.style).toMatchObject({ display: "flex" })
  })

  it("controlled activeIndex takes priority, emits changes and waits for external updates", async () => {
    const onChange = vi.fn(), update = vi.fn()
    const { host, exposed } = mountCarousel({ modelValue: 0, activeIndex: 1, onChange, "onUpdate:modelValue": update })
    await host.fire("carousel-next", "click")
    expect(update).toHaveBeenCalledWith(2)
    expect(onChange).toHaveBeenCalledWith(2)
    expect(exposed.value!.currentIndex).toBe(1)
    expect(host.find("carousel-slide-1").props.style).toMatchObject({ display: "flex" })
    expect(host.all().some((node) => node.props.testId === "carousel-slide-0")).toBe(false)
    expect(host.all().some((node) => node.props.testId === "carousel-slide-2")).toBe(false)
  })

  it("supports expose methods, non-loop boundaries, dots and single-slide controls", async () => {
    const { host, exposed } = mountCarousel({ loop: false })
    expect(host.find("carousel-prev").props.tabIndex).toBe(-1)
    exposed.value!.goTo(99)
    await host.settle()
    expect(exposed.value!.currentIndex).toBe(2)
    expect(host.find("carousel-next").props.tabIndex).toBe(-1)
    exposed.value!.prev()
    await host.settle()
    expect(exposed.value!.currentIndex).toBe(1)
    await host.fire("carousel-dot-0", "keyDown", { key: "space" })
    expect(exposed.value!.currentIndex).toBe(0)
    const single = mountCarousel({ autoplay: true }, 1)
    expect(single.host.all().some((node) => node.props.testId === "carousel-next")).toBe(false)
    const empty = mountCarousel({}, 0)
    empty.exposed.value!.next()
    expect(empty.exposed.value!.currentIndex).toBe(0)
  })

  it("unmounts inactive controls, removes their keyboard hosts and ignores their stale events", async () => {
    const firstClick = vi.fn(), secondClick = vi.fn()
    const host = mountHost(defineComponent({ setup: () => () => h(Carousel, { testId: "carousel" }, { default: () => [
      h("div", { key: "first", testId: "first-control", tabIndex: 0, onClick: firstClick, onKeyDown: firstClick }, [h("text", "first")]),
      h("div", { key: "second", testId: "second-control", tabIndex: 0, onClick: secondClick, onKeyDown: secondClick }, [h("text", "second")]),
    ] }) }))
    hosts.push(host)
    const oldControl = host.find("first-control")
    const oldSlide = host.find("carousel-slide-0")
    expect(host.all().some((node) => node.props.testId === "second-control")).toBe(false)
    await host.fire(oldControl, "keyDown", { key: "enter" })
    expect(firstClick).toHaveBeenCalledOnce()
    await host.fire("carousel-next", "click")
    expect(host.all().some((node) => node.id === oldControl.id)).toBe(false)
    // One destroy op tears down the native subtree, including the control's
    // focus handle; descendants intentionally do not receive duplicate ops.
    expect(host.operations).toContainEqual(["destroyElement", oldSlide.id])
    expect(host.all().filter((node) => node.props.tabIndex === 0 && ["first-control", "second-control"].includes(String(node.props.testId))))
      .toEqual([host.find("second-control")])
    await host.fire(oldControl, "click")
    await host.fire(oldControl, "keyDown", { key: "enter" })
    expect(firstClick).toHaveBeenCalledOnce()
    await host.fire("second-control", "keyDown", { key: "enter" })
    expect(secondClick).toHaveBeenCalledOnce()
    expect((host.find("carousel-slide-1").props.motion as { initial: unknown; animate: unknown }).initial).toEqual({ opacity: 0 })
    expect((host.find("carousel-slide-1").props.motion as { animate: unknown }).animate).toEqual({ opacity: 1 })
  })

  it("autoplay loops, pauses on hover and focus, and can explicitly resume", async () => {
    vi.useFakeTimers()
    const { host, exposed } = mountCarousel({ autoplay: true, interval: 1000 })
    await vi.advanceTimersByTimeAsync(1000)
    await host.settle()
    expect(exposed.value!.currentIndex).toBe(1)
    await host.fire("carousel", "mouseEnter")
    await vi.advanceTimersByTimeAsync(3000)
    expect(exposed.value!.currentIndex).toBe(1)
    await host.fire("carousel", "mouseLeave")
    await vi.advanceTimersByTimeAsync(1000)
    expect(exposed.value!.currentIndex).toBe(2)
    await host.fire("carousel", "focus")
    await vi.advanceTimersByTimeAsync(3000)
    expect(exposed.value!.currentIndex).toBe(2)
    await host.fire("carousel-rotation", "click")
    await vi.advanceTimersByTimeAsync(1000)
    expect(exposed.value!.currentIndex).toBe(0)
    exposed.value!.pause()
    await host.settle()
    await vi.advanceTimersByTimeAsync(2000)
    expect(exposed.value!.currentIndex).toBe(0)
    exposed.value!.play()
    await host.settle()
    await vi.advanceTimersByTimeAsync(1000)
    expect(exposed.value!.currentIndex).toBe(1)
  })

  it("detects arbitrary focused slide descendants and cleans all timers on unmount", async () => {
    vi.useFakeTimers()
    const { host, exposed } = mountCarousel({ autoplay: true, interval: 1000 })
    host.native.focusElement!(host.find("carousel-slide-0").children[0].id!)
    await vi.advanceTimersByTimeAsync(100)
    await host.settle()
    await vi.advanceTimersByTimeAsync(3000)
    expect(exposed.value!.currentIndex).toBe(0)
    host.native.focusElement!(-1)
    await vi.advanceTimersByTimeAsync(100)
    await vi.advanceTimersByTimeAsync(1000)
    expect(exposed.value!.currentIndex).toBe(1)
    host.unmount(); hosts.splice(hosts.indexOf(host), 1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("pauses on a filled direct slide or control without ancestor hover and preserves slide callbacks", async () => {
    vi.useFakeTimers()
    const exposed = ref<CarouselExpose | null>(null), enter = vi.fn(), leave = vi.fn()
    const host = mountHost(defineComponent({ setup: () => () => h(Carousel, { autoplay: true, interval: 1000, testId: "carousel", ref: exposed }, {
      default: () => [0, 1].map((index) => h("div", { key: index, testId: `filled-${index}`, style: { backgroundColor: "#ff0000", height: 180 },
        onMouseEnter: enter, onMouseLeave: leave }, [h("text", "filled slide")])),
    }) }))
    hosts.push(host)
    expect(host.find("carousel").props.style).toMatchObject({ display: "flex", flexDirection: "column" })
    expect(host.find("carousel-viewport").props.style).toMatchObject({ display: "flex", flexDirection: "column" })
    await host.fire("filled-0", "mouseEnter")
    await vi.advanceTimersByTimeAsync(2000)
    expect(exposed.value!.currentIndex).toBe(0)
    expect(enter).toHaveBeenCalledOnce()
    await host.fire("filled-0", "mouseLeave")
    expect(leave).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1000)
    expect(exposed.value!.currentIndex).toBe(1)
    await host.fire("carousel-next", "mouseEnter")
    await vi.advanceTimersByTimeAsync(2000)
    expect(exposed.value!.currentIndex).toBe(1)
    await host.fire("carousel-next", "mouseLeave")
    await vi.advanceTimersByTimeAsync(1000)
    expect(exposed.value!.currentIndex).toBe(0)
    await host.fire("carousel-viewport", "mouseEnter")
    await vi.advanceTimersByTimeAsync(2000)
    expect(exposed.value!.currentIndex).toBe(0)
  })
})

describe("Cursor local native follower", () => {
  it("converts window coordinates, preserves content/events and leaves the system pointer supported", async () => {
    const onMouseMove = vi.fn()
    const host = mountHost(defineComponent({ setup: () => () => h(Cursor, { testId: "cursor", onMouseMove }, { default: () => h("text", "content") }) }), {
      getElementBounds: () => ({ x: 80, y: 120, width: 300, height: 200 }),
    })
    hosts.push(host)
    expect(host.text()).toContain("content")
    await host.fire("cursor", "mouseMove", { x: 130, y: 180 })
    expect(onMouseMove).toHaveBeenCalledOnce()
    expect(host.find("cursor-point").props.style).toMatchObject({ left: 48, top: 58, pointerEvents: "none" })
    expect(host.find("cursor-follower").props.style).toMatchObject({ left: 44, top: 56, width: 28, height: 28, pointerEvents: "none" })
    expect(host.find("cursor").props.style.cursor).toBe("default")
    expect(host.operations.some((operation) => operation[0] === "setStyle" && String(operation[2]).includes("url("))).toBe(false)
  })

  it("uses raindrop hotspot, changes press state and hides outside its own bounds", async () => {
    const host = mountHost(defineComponent({ setup: () => () => h(Cursor, { testId: "cursor", type: "raindrop", forceAll: false }, { default: () => h("text", "water") }) }), {
      getElementBounds: () => ({ x: 100, y: 200, width: 300, height: 100 }),
    })
    hosts.push(host)
    await host.fire("cursor", "mouseEnter", { x: 160, y: 250 })
    expect(host.find("cursor-follower").props.style).toMatchObject({ left: 44, top: 44, width: 32 })
    await host.fire("cursor", "mouseDown", { x: 160, y: 250, button: 0 })
    expect((host.find("cursor-ring").props.motion as { animate: unknown }).animate).toMatchObject({ width: 20, height: 20 })
    await host.fire("cursor", "mouseUp", { x: 160, y: 250, button: 0 })
    expect((host.find("cursor-ring").props.motion as { animate: unknown }).animate).toMatchObject({ width: 30, height: 30 })
    expect(host.find("cursor").props.style.cursor).toBeUndefined()
    await host.fire("cursor", "mouseMove", { x: 99, y: 250 })
    expect(host.all().some((node) => node.props.testId === "cursor-follower")).toBe(false)
  })
})
