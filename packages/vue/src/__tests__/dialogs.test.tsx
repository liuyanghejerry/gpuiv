/** End-to-end tests for the file-dialog helpers: the native test renderer
 *  answers from a canned queue, so these cover the errback→Promise wiring
 *  and the options round-trip, not the platform panels themselves. */

// @ts-nocheck

import { defineComponent } from "vue"
import { beforeEach, describe, expect, it } from "vitest"
import { promptForNewPath, promptForPaths } from "../dialogs.js"
import { createTestApp, hasNativeTestRenderer } from "../testing.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

describeNative("file dialogs", () => {
  let app: ReturnType<typeof createTestApp> | undefined

  beforeEach(() => {
    app?.unmount()
  })

  function mount() {
    const Root = defineComponent({
      setup() {
        return () => <div style={{ width: 100, height: 100 }} />
      },
    })
    app = createTestApp(Root)
    return app
  }

  it("resolves promptForPaths with the queued selection", async () => {
    const { renderer } = mount()
    renderer.setNextPathPromptResponse(["/tmp/a.png", "/tmp/b.png"])

    const paths = await promptForPaths(renderer, {
      files: true,
      directories: false,
      multiple: true,
      prompt: "Open",
    })

    expect(paths).toEqual(["/tmp/a.png", "/tmp/b.png"])
    expect(renderer.getLastPathPromptOptions()).toEqual({
      files: true,
      directories: false,
      multiple: true,
      prompt: "Open",
    })
  })

  it("resolves promptForPaths with null when cancelled", async () => {
    const { renderer } = mount()
    renderer.setNextPathPromptResponse(null)

    const paths = await promptForPaths(renderer, {
      files: true,
      directories: false,
      multiple: false,
    })

    expect(paths).toBeNull()
  })

  it("resolves promptForPaths with null when no answer is queued", async () => {
    const { renderer } = mount()

    const paths = await promptForPaths(renderer, {
      files: true,
      directories: false,
      multiple: false,
    })

    expect(paths).toBeNull()
  })

  it("resolves promptForNewPath with the queued path", async () => {
    const { renderer } = mount()
    renderer.setNextNewPathResponse("/tmp/drawing.png")

    const path = await promptForNewPath(renderer, {
      directory: "/tmp",
      suggestedName: "drawing.png",
    })

    expect(path).toBe("/tmp/drawing.png")
    expect(renderer.getLastNewPathPrompt()).toEqual({
      directory: "/tmp",
      suggestedName: "drawing.png",
    })
  })

  it("defaults promptForNewPath to the working directory", async () => {
    const { renderer } = mount()
    renderer.setNextNewPathResponse("/tmp/out.png")

    const path = await promptForNewPath(renderer)

    expect(path).toBe("/tmp/out.png")
    const last = renderer.getLastNewPathPrompt()!
    expect(last.directory).toBe(".")
    expect(last.suggestedName).toBeUndefined()
  })

  it("resolves promptForNewPath with null when cancelled", async () => {
    const { renderer } = mount()
    renderer.setNextNewPathResponse(null)

    const path = await promptForNewPath(renderer, { suggestedName: "x.png" })

    expect(path).toBeNull()
  })

  it("answers queued prompts in order", async () => {
    const { renderer } = mount()
    renderer.setNextPathPromptResponse(["/first.png"])
    renderer.setNextPathPromptResponse(null)

    await expect(
      promptForPaths(renderer, { files: true, directories: false, multiple: false })
    ).resolves.toEqual(["/first.png"])
    await expect(
      promptForPaths(renderer, { files: true, directories: false, multiple: false })
    ).resolves.toBeNull()
  })
})
