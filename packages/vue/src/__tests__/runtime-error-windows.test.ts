import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { hasNativeTestRenderer } from "../testing.js"

// Separate processes exercise real production windows without sharing the
// test renderer's single offscreen GPUI context. Both windows stay hidden.
function runWindowsScript(lines: string[]) {
  const rendererPath = fileURLToPath(new URL("../renderer.ts", import.meta.url))
  const registryPath = fileURLToPath(new URL("../reconciler/event-registry.ts", import.meta.url))
  const script = [
    'import { defineComponent, h, nextTick, ref } from "vue"',
    `import { createApp, createWindow, resetApp } from ${JSON.stringify(rendererPath)}`,
    `import { handleGpuixEvent } from ${JSON.stringify(registryPath)}`,
    'const background = { focus: false, show: false }',
    ...lines,
    'resetApp()',
    'process.exit(0)',
  ].join("\n")
  const result = spawnSync("bun", ["-e", script], {
    encoding: "utf8",
    timeout: 10_000,
    env: { ...process.env, VITEST: "1" },
  })
  expect(result.status, result.stderr || result.error?.message).toBe(0)
  const summary = result.stdout.match(/^RESULT (.+)$/m)
  expect(summary, result.stdout).not.toBeNull()
  return JSON.parse(summary![1])
}

describe.skipIf(!hasNativeTestRenderer)("runtime errors across windows", () => {
  it("honors a secondary window's observer and disabled overlay without remounting the main app", () => {
    const result = runWindowsScript([
      'const mainErrors = []; const childErrors = []; let mainMounts = 0',
      'const Main = defineComponent({ setup() { mainMounts++; return () => h("text", "unsaved main state") } })',
      'const main = createApp(Main, { ...background, onRuntimeError: e => mainErrors.push(String(e)) })',
      'const child = createWindow(defineComponent({ render() { throw new Error("child error") } }), { ...background, errorOverlay: false, onRuntimeError: e => childErrors.push(String(e)) })',
      'await new Promise(resolve => setTimeout(resolve, 40))',
      'console.log("RESULT", JSON.stringify({ mainErrors, childErrors, mainMounts, mainText: main.renderer.getAllText(), childText: child.renderer.getAllText() }))',
    ])
    expect(result).toEqual({
      mainErrors: [], childErrors: ["Error: child error"], mainMounts: 1,
      mainText: ["unsaved main state"], childText: [],
    })
  })

  it("shows and reloads an error on its own window and closes the current mounted tree", () => {
    const result = runWindowsScript([
      'const mainErrors = []; const childErrors = []; let mainMounts = 0; let childMounts = 0; let fail',
      'const Main = defineComponent({ setup() { mainMounts++; return () => h("text", "main") } })',
      'const Child = defineComponent({ setup() { childMounts++; fail = ref(false); return () => { if (fail.value) throw new Error("secondary boom"); return h("text", "child") } } })',
      'const main = createApp(Main, { ...background, onRuntimeError: e => mainErrors.push(String(e)) })',
      'const child = createWindow(Child, { ...background, onRuntimeError: e => childErrors.push(String(e)) })',
      'fail.value = true; await nextTick(); await new Promise(resolve => setTimeout(resolve, 0))',
      'const overlayText = child.renderer.getAllText()',
      'function find(node, testId) { if (node.props.testId === testId) return node; return node.children.map(c => find(c, testId)).find(Boolean) }',
      'const reload = find(child.container, "runtime-error-reload")',
      'if (!reload) throw new Error("secondary window has no Reload control")',
      'handleGpuixEvent({ elementId: reload.id, eventType: "click" }, child.renderer)',
      'await nextTick(); await new Promise(resolve => setTimeout(resolve, 0))',
      'const reloadedText = child.renderer.getAllText()',
      'fail.value = true; await nextTick(); await new Promise(resolve => setTimeout(resolve, 0))',
      'let closedUnmounts = 0; child.app.onUnmount(() => { closedUnmounts++ })',
      'child.close(); child.close()',
      'console.log("RESULT", JSON.stringify({ mainErrors, childErrors, mainMounts, childMounts, mainText: main.renderer.getAllText(), overlayText, reloadedText, closedUnmounts }))',
    ])
    expect(result.mainErrors).toEqual([])
    expect(result.childErrors).toEqual(["Error: secondary boom", "Error: secondary boom"])
    expect(result.mainMounts).toBe(1)
    expect(result.childMounts).toBe(2)
    expect(result.mainText).toEqual(["main"])
    expect(result.overlayText).toContain("secondary boom")
    expect(result.overlayText).toContain("Reload")
    expect(result.reloadedText).toEqual(["child"])
    expect(result.closedUnmounts).toBe(1)
  })
})
