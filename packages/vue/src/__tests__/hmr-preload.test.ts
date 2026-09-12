/** Unit tests for the HMR preload's filter/loader split (src/hmr/preload.ts).
 *
 *  Bun's plugin runtime requires every path the onLoad filter matches to
 *  resolve to a module: an onLoad that returns `undefined` for a matched file
 *  aborts the load with "Expected module mock to return an object" (Bun
 *  1.3.14). A component-less sibling module — or any .ts file under
 *  node_modules — did exactly that, so the tests below pin both halves of the
 *  contract: excluded paths never match, and every matched path comes back as
 *  contents. */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createHmrPreload } from "../hmr/preload.js"

const srcDir = fileURLToPath(new URL("..", import.meta.url))
const fixtureDir = join(srcDir, "tmp-hmr-preload-fixtures")

function writeFixture(name: string, source: string): string {
  const path = join(fixtureDir, name)
  writeFileSync(path, source, "utf8")
  return path
}

describe("createHmrPreload", () => {
  beforeEach(() => {
    rmSync(fixtureDir, { recursive: true, force: true })
    mkdirSync(fixtureDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(fixtureDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it("never matches node_modules, this package, or declaration files", () => {
    const posix = createHmrPreload({ packageDir: "/repo/packages/vue" })
    const windows = createHmrPreload({ packageDir: "C:\\repo\\packages\\vue" })
    const excluded: Array<[RegExp, string]> = [
      [posix, "/repo/node_modules/@gpuiv/vue/src/theme.ts"],
      [posix, "/repo/examples/node_modules/@gpuiv/vue/dist/index.js"],
      [posix, "/repo/packages/vue/dist/hmr/runtime.ts"],
      [posix, "/repo/packages/vue/src/hmr/runtime.ts"],
      [posix, "/repo/examples/env.d.ts"],
      [posix, "/repo/examples/env.d.mts"],
      [posix, "/repo/examples/app.css"],
      [posix, "/repo/examples/notes.md"],
      [windows, "C:\\repo\\node_modules\\@gpuiv\\vue\\src\\theme.ts"],
      [windows, "C:\\repo\\packages\\vue\\src\\hmr\\runtime.ts"],
      [windows, "C:\\repo\\examples\\env.d.ts"],
      [windows, "C:\\repo\\examples\\app.css"],
    ]
    for (const [preload, path] of excluded) {
      expect(preload.filter.test(path), path).toBe(false)
    }
    const matched: Array<[RegExp, string]> = [
      [posix, "/repo/examples/app.tsx"],
      [posix, "/repo/examples/theme.ts"],
      [windows, "C:\\repo\\examples\\app.tsx"],
      [windows, "C:\\repo\\examples\\theme.ts"],
    ]
    for (const [preload, path] of matched) {
      expect(preload.filter.test(path), path).toBe(true)
    }
  })

  it("matches a sibling package that only shares the directory name", () => {
    // The exclusion is the package the preload ships in, not every path that
    // happens to contain "packages/vue" — a user monorepo app living there
    // must keep its Fast Refresh.
    const preload = createHmrPreload({ packageDir: "/repo/node_modules/@gpuiv/vue" })
    expect(preload.filter.test("/home/me/app/packages/vue/src/app.tsx")).toBe(true)
    expect(preload.filter.test("/repo/node_modules/@gpuiv/vue/hmr-preload.js")).toBe(false)
    expect(preload.filter.test("/repo/node_modules/@gpuiv/vue/src/thing.ts")).toBe(false)
  })

  it("matches everything outside node_modules without a packageDir", () => {
    const preload = createHmrPreload()
    expect(preload.filter.test("/repo/packages/vue/src/hmr/runtime.ts")).toBe(true)
    expect(preload.filter.test("/repo/node_modules/thing/src/index.ts")).toBe(false)
  })

  it("returns a component-less module unchanged instead of declining", async () => {
    const preload = createHmrPreload()
    const source = 'export const THEME = "dark"\n'
    const path = writeFixture("theme.ts", source)
    expect(preload.filter.test(path)).toBe(true)
    await expect(preload.load(path)).resolves.toEqual({ contents: source, loader: "ts" })
  })

  it("transforms a component module and picks the loader from the extension", async () => {
    const preload = createHmrPreload()
    const source = 'import { defineComponent } from "vue"\nconst App = defineComponent({ setup: () => () => null })\n'
    const path = writeFixture("app.tsx", source)
    const result = await preload.load(path)
    expect(result.loader).toBe("tsx")
    expect(result.contents).toContain(";App.__hmrId =")
    expect(result.contents).toContain('from "@gpuiv/vue/hmr"')
    expect(result.contents).not.toBe(source)
  })

  it("resolves every matched file to contents, whatever the source", async () => {
    const preload = createHmrPreload()
    const sources: Record<string, string> = {
      "empty.ts": "",
      "comment-only.ts": "// nothing to see\n",
      "broken.ts": "const x = (((\n",
      "plain.ts": "export const helper = () => 1\n",
      "assertion.tsx":
        'import { defineComponent } from "vue"\nconst App = defineComponent({ setup: () => () => null }) satisfies unknown\n',
    }
    for (const [name, source] of Object.entries(sources)) {
      const path = writeFixture(name, source)
      expect(preload.filter.test(path), name).toBe(true)
      const result = await preload.load(path)
      expect(result.contents, name).toBe(source)
      expect(result.loader, name).toBe(name.endsWith(".tsx") ? "tsx" : "ts")
    }
  })

  it("warns with the path and keeps the source when the transform throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.resetModules()
    vi.doMock("../hmr/transform.js", () => ({
      transformHmrSource: () => {
        throw new Error("scanner exploded")
      },
    }))
    const { createHmrPreload: create } = await import("../hmr/preload.js")
    const source = 'import { defineComponent } from "vue"\nconst App = defineComponent({ setup: () => () => null })\n'
    const path = writeFixture("boom.ts", source)
    const result = await create().load(path)
    expect(result).toEqual({ contents: source, loader: "ts" })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(path), expect.anything())
    vi.doUnmock("../hmr/transform.js")
  })

  it("reads the file it reports, so a matched path really is a module", async () => {
    const preload = createHmrPreload()
    const source = "export const VALUE = 1\n"
    const path = writeFixture("value.ts", source)
    const result = await preload.load(path)
    expect(result.contents).toBe(readFileSync(path, "utf8"))
  })
})
